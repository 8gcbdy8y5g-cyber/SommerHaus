import { readFileSync } from 'node:fs';
// SommerHaus Erinnerungen: liest Aufgaben aus Firebase (Nur-Lesen-Konto) und schickt Push-Mitteilungen.
// Läuft per GitHub Actions morgens (Aufgaben) und abends (Mülltonnen für morgen).
let webpush = null;

const API_KEY = process.env.FIREBASE_API_KEY;
const PROJECT = process.env.FIREBASE_PROJECT;
const SEC = process.env.SECRETS_FILE ? JSON.parse(readFileSync(process.env.SECRETS_FILE, 'utf8')) : {};
const EMAIL = SEC.email || process.env.REPORT_EMAIL, PASS = SEC.password || process.env.REPORT_PASSWORD;
const MODE_IN = (process.env.MODE || 'auto').trim();
const DRY = process.env.DRY === '1';

function berlin(d = new Date()) {
  const f = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}`, hour: +p.hour };
}
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function val(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return +v.integerValue;
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return obj(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  if ('timestampValue' in v) return v.timestampValue;
  return null;
}
function obj(f) { const o = {}; for (const k of Object.keys(f)) o[k] = val(f[k]); return o; }
async function login() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS, returnSecureToken: true }) });
  if (!r.ok) throw new Error('Anmeldung fehlgeschlagen: HTTP ' + r.status);
  return (await r.json()).idToken;
}
async function list(tok, col) {
  const out = []; let page = '';
  do {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${col}?pageSize=300${page ? '&pageToken=' + page : ''}`, { headers: { authorization: 'Bearer ' + tok } });
    if (!r.ok) throw new Error(`Lesen ${col}: HTTP ${r.status}`);
    const j = await r.json();
    (j.documents || []).forEach(d => out.push({ id: d.name.split('/').pop(), ...obj(d.fields || {}) }));
    page = j.nextPageToken || '';
  } while (page);
  return out;
}
const BIN = { yellow: 'Gelbe Tonne', black: 'Restmüll', blue: 'Papier', brown: 'Biotonne', green: 'Biotonne' };
const isOpen = t => !(t.unit === 'once' && t.done === true) && !!t.due;
const nrm = s => String(s || '').toLowerCase();
function mineOk(t, sub) {
  if (!sub.prefs || !sub.prefs.mine) return true;
  const who = nrm(t.who).trim();
  return !who || (!!sub.name && who.includes(nrm(sub.name).trim()));
}
function listText(l, max) { const a = l.slice(0, max).map(t => t.title); return a.join(', ') + (l.length > max ? ` und ${l.length - max} weitere` : ''); }

export function buildMessages(mode, today, tasks, sub) {
  const msgs = [];
  if (mode === 'evening' && sub.prefs?.bins !== false) {
    const tm = addDays(today, 1);
    const bins = tasks.filter(t => isOpen(t) && t.icon && t.due === tm);
    if (bins.length) msgs.push({ title: 'Morgen ist Abholung', body: bins.map(t => t.title).join(', '), tag: 'bins-' + tm, url: './' });
  }
  if (mode === 'morning' && sub.prefs?.morning !== false) {
    const due = tasks.filter(t => isOpen(t) && t.due <= today && mineOk(t, sub));
    const over = due.filter(t => t.due < today);
    if (due.length) msgs.push({ title: due.length === 1 ? 'Heute steht 1 Aufgabe an' : `Heute stehen ${due.length} Aufgaben an`, body: listText(due.sort((a, b) => a.due < b.due ? -1 : 1), 4) + (over.length ? ` (${over.length} überfällig)` : ''), tag: 'day-' + today, url: './' });
  }
  return msgs;
}

async function main() {
  const now = berlin();
  let mode = MODE_IN;
  if (mode === 'auto') mode = now.hour === 7 ? 'morning' : now.hour === 19 ? 'evening' : '';
  if (!mode) { console.log('Keine Versandzeit (Berlin ' + now.hour + ' Uhr), nichts zu tun.'); return; }
  const tok = await login();
  const [tasks, subs] = await Promise.all([list(tok, 'tasks'), list(tok, 'pushSubs')]);
  console.log(`Modus ${mode}, ${tasks.length} Aufgaben, ${subs.length} Handys`);
  if (!DRY) { webpush = (await import('web-push')).default; }
  if (!DRY) webpush.setVapidDetails('mailto:brunosommerfeld@web.de', process.env.VAPID_PUBLIC_KEY, SEC.vapid || process.env.VAPID_PRIVATE_KEY);
  for (const s of subs) {
    const msgs = mode === 'test' ? [{ title: 'SommerHaus', body: 'Test: Erinnerungen funktionieren auf diesem Handy.', tag: 'test' }] : buildMessages(mode, now.iso, tasks, s);
    for (const m of msgs) {
      if (DRY) { console.log('[Probe]', s.name || '?', JSON.stringify(m)); continue; }
      try { await webpush.sendNotification(s.sub, JSON.stringify(m), { TTL: 6 * 3600 }); console.log('gesendet an', s.name || 'unbekannt'); }
      catch (e) { console.log('Fehler bei', s.name || 'unbekannt', e.statusCode || e.message); }
    }
  }
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main().catch(e => { console.error(e.message); process.exit(1); });
