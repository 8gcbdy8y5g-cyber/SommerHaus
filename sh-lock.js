// SommerHaus: App-Sperre beim Öffnen. Entsperren mit Face ID (Passkey über WebAuthn) oder mit dem Passwort.
// Die Sperre ist ein Sichtschutz auf dem Gerät. Die Daten selbst schützt weiter die Firebase-Anmeldung.
// Einstellung und Passkey-Kennung liegen nur auf diesem Gerät (localStorage).

const K_MODE = 'sommerhaus-lock', K_CRED = 'sommerhaus-lock-cred', K_ASKED = 'sommerhaus-lock-asked';
const AWAY_MS = 5 * 60 * 1000;

const LOGO = '<svg class="logo" viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="22" fill="#EDBFAE"/><circle cx="50" cy="50" r="30" fill="none" stroke="#FFF9F2" stroke-width="6.5" stroke-linecap="round" stroke-dasharray="158 30.5" transform="rotate(-20 50 50)"/><circle cx="69.7" cy="27.4" r="5.5" fill="#F7E08F"/><path d="M37 63V51L50 40L63 51V63Z" fill="#FFF9F2" stroke="#FFF9F2" stroke-width="3" stroke-linejoin="round"/></svg>';
const FACE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9.5v1M15 9.5v1M12 9.5v3.5h-1M9.5 16c1.5 1.2 3.5 1.2 5 0"/></svg>';

const css = `
.shk{position:fixed;inset:0;z-index:120;background:var(--bg);display:grid;place-items:center;padding:24px 16px;overflow:auto}
.shk[hidden]{display:none!important}
.shk-box{width:100%;max-width:360px;display:grid;gap:16px;text-align:center}
.shk-box .logo{width:88px;height:88px;margin:0 auto;border-radius:22px;box-shadow:0 2px 6px rgba(90,62,54,.18)}
.shk-box h1{justify-content:center;font-size:32px}
.shk-box p{color:var(--fg2);font-size:15px;margin:0}
.shk-box .shk-err{color:var(--red);font-weight:500}
.shk-face{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:52px;border-radius:999px;font-size:16px;width:100%}
.shk-pw{display:grid;gap:10px;text-align:left}
.shk-pw[hidden]{display:none}
.shk-pw input{box-sizing:border-box;font:inherit;font-size:16px;border:0;border-radius:12px;background:var(--card);color:var(--fg);padding:14px 16px;min-height:50px;width:100%}
.shk-pw input:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.shk-pw button{min-height:50px;border-radius:999px;font-size:16px}
.shk-link{border:0;background:none;color:var(--accent);font:inherit;font-size:14px;font-weight:600;cursor:pointer;min-height:40px}
.shk-card{position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:110;width:calc(100% - 32px);max-width:420px;background:var(--card);color:var(--fg);border-radius:18px;box-shadow:var(--shadow);padding:16px;display:grid;gap:10px}
.shk-card[hidden]{display:none}
.shk-card b{font-size:16px}
.shk-card p{margin:0;font-size:14px;color:var(--fg2)}
.shk-card .row{display:flex;gap:8px;justify-content:flex-end}
.shk-card .row button{min-height:42px;border-radius:999px;padding:0 16px;font-size:15px}
`;

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const b64 = buf => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const r = atob(s), u = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) u[i] = r.charCodeAt(i); return u.buffer; };
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }

let opt = null, box = null, card = null, busy = false, hiddenAt = 0, locked = false;

export async function faceAvailable() {
  try {
    return !!(window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch (e) { return false; }
}
export function faceOn() { return ls.get(K_MODE) === 'faceid' && !!ls.get(K_CRED); }

function say(t, err) { const m = box.querySelector('#shkMsg'); m.textContent = t; m.className = err ? 'shk-err' : ''; }

let styled = false;
function style() { if (styled) return; styled = true; const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }
function build() {
  if (box) return;
  style();
  box = el(`<div class="shk" id="shLock" role="dialog" aria-modal="true" aria-label="SommerHaus ist gesperrt" hidden>
    <div class="shk-box">
      ${LOGO}
      <h1><span>Sommer<b>Haus</b></span></h1>
      <p id="shkMsg">Gesperrt. Entsperre mit Face ID.</p>
      <button type="button" class="btn primary shk-face" id="shkFace">${FACE}<span>Mit Face ID entsperren</span></button>
      <form class="shk-pw" id="shkPw" hidden autocomplete="on">
        <input type="email" id="shkUser" autocomplete="username" hidden>
        <input type="password" id="shkPass" autocomplete="current-password" placeholder="Passwort" required>
        <button type="submit" class="btn primary" id="shkGo">Entsperren</button>
      </form>
      <button type="button" class="shk-link" id="shkUsePw">Mit Passwort entsperren</button>
    </div>
  </div>`);
  document.body.appendChild(box);
  box.querySelector('#shkFace').addEventListener('click', () => face(true));
  box.querySelector('#shkUsePw').addEventListener('click', () => showPw(true));
  box.querySelector('#shkPw').addEventListener('submit', async ev => {
    ev.preventDefault();
    const go = box.querySelector('#shkGo'), pw = box.querySelector('#shkPass');
    go.disabled = true; say('Wird geprüft …');
    try { await opt.reauth(pw.value); pw.value = ''; unlock(); }
    catch (e) {
      const c = (e && e.code) || '';
      say(c.includes('too-many') ? 'Zu viele Versuche. Warte ein paar Minuten.' : c.includes('network') ? 'Keine Verbindung. Prüfe das Internet.' : 'Das Passwort stimmt nicht.', true);
    }
    go.disabled = false;
  });
}

function showPw(on) {
  const f = box.querySelector('#shkPw');
  f.hidden = !on;
  box.querySelector('#shkUsePw').hidden = on;
  box.querySelector('#shkUser').value = opt.email || '';
  if (on) { say('Gib dein Passwort ein.'); setTimeout(() => box.querySelector('#shkPass').focus(), 50); }
}

export function lock() {
  if (!opt) return;
  build();
  locked = true;
  box.hidden = false;
  document.documentElement.style.overflow = 'hidden';
  const fo = faceOn();
  box.querySelector('#shkFace').hidden = !fo;
  showPw(!fo);
  if (fo) { say('Gesperrt. Entsperre mit Face ID.'); face(false); }
}
function unlock() {
  locked = false;
  if (box) box.hidden = true;
  document.documentElement.style.overflow = '';
  if (card) card.hidden = true;
}

async function face(fromTap) {
  if (busy) return;
  const id = ls.get(K_CRED); if (!id) { showPw(true); return; }
  busy = true;
  try {
    const r = await navigator.credentials.get({ publicKey: {
      challenge: rnd(32), rpId: location.hostname, timeout: 60000, userVerification: 'required',
      allowCredentials: [{ type: 'public-key', id: unb64(id) }]
    } });
    if (r) unlock();
  } catch (e) {
    const n = (e && e.name) || '';
    if (n === 'InvalidStateError' || n === 'SecurityError') say('Face ID ist auf diesem Gerät nicht verfügbar. Entsperre mit dem Passwort.', true);
    else if (fromTap) say('Face ID hat nicht geklappt. Versuch es nochmal oder nimm dein Passwort.', true);
    else say('Tippe auf „Mit Face ID entsperren“.');
  }
  busy = false;
}

export async function setup() {
  if (!opt) throw new Error('nicht bereit');
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: rnd(32),
    rp: { name: 'SommerHaus', id: location.hostname },
    user: { id: rnd(16), name: opt.email || 'SommerHaus', displayName: 'SommerHaus' + (opt.email ? ' (' + opt.email + ')' : '') },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    timeout: 60000, attestation: 'none'
  } });
  if (!cred) throw new Error('abgebrochen');
  ls.set(K_CRED, b64(cred.rawId)); ls.set(K_MODE, 'faceid'); ls.set(K_ASKED, '1');
}
export function disable() { ls.del(K_CRED); ls.set(K_MODE, 'off'); ls.set(K_ASKED, '1'); }

async function offer() {
  if (ls.get(K_ASKED) || faceOn() || !(await faceAvailable())) return;
  style();
  card = el(`<div class="shk-card" role="dialog" aria-label="Face ID einrichten">
    <b>Mit Face ID entsperren?</b>
    <p>Dann fragt SommerHaus beim Öffnen nach Face ID, bevor jemand eure Daten sieht. Du kannst das in den Einstellungen unter „Konto“ wieder ausschalten.</p>
    <div class="row"><button type="button" class="btn" id="shkLater">Später</button><button type="button" class="btn primary" id="shkYes">Einrichten</button></div>
  </div>`);
  document.body.appendChild(card);
  card.querySelector('#shkLater').addEventListener('click', () => { ls.set(K_ASKED, '1'); card.hidden = true; });
  card.querySelector('#shkYes').addEventListener('click', async () => {
    try { await setup(); card.querySelector('b').textContent = 'Face ID ist eingerichtet.'; card.querySelector('p').textContent = 'Ab jetzt fragt SommerHaus beim Öffnen danach.'; card.querySelector('.row').hidden = true; setTimeout(() => { card.hidden = true; }, 3500); }
    catch (e) { card.querySelector('p').textContent = 'Das hat nicht geklappt. Du kannst es später in den Einstellungen unter „Konto“ nochmal versuchen.'; ls.set(K_ASKED, '1'); }
    opt.onChange && opt.onChange();
  });
}

// Start, sobald jemand angemeldet ist. o = { email, reauth(passwort) -> Promise, toast(text), onChange() }
export function start(o) {
  const first = !opt;
  opt = o;
  if (!first) return;
  if (faceOn()) lock(); else offer();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (!locked && faceOn() && hiddenAt && Date.now() - hiddenAt > AWAY_MS) lock();
  });
}
