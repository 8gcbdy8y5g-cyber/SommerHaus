// Holt Brunos Favoriten (settings/favs) aus Firebase und schreibt favoriten.json,
// damit die Sonntagsrecherche gezielt nach diesen Produkten sucht. Nur Produktnamen, keine weiteren Daten.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const SEC = JSON.parse(readFileSync(process.env.SECRETS_FILE, 'utf8'));
const KEY = process.env.FIREBASE_API_KEY, P = process.env.FIREBASE_PROJECT;
const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: SEC.email, password: SEC.password, returnSecureToken: true }) });
if (!r.ok) { console.error('Anmeldung fehlgeschlagen', r.status); process.exit(1); }
const tok = (await r.json()).idToken;
const d = await fetch(`https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents/settings/favs`, { headers: { authorization: 'Bearer ' + tok } });
const j = d.ok ? await d.json() : {};
const names = (j.fields?.names?.arrayValue?.values || []).map(v => String(v.stringValue || '').trim()).filter(Boolean).slice(0, 60).sort((a, b) => a.localeCompare(b, 'de'));
const old = existsSync('favoriten.json') ? JSON.parse(readFileSync('favoriten.json', 'utf8')) : {};
if (JSON.stringify(old.names || []) === JSON.stringify(names)) { console.log('unverändert:', names.length); process.exit(0); }
writeFileSync('favoriten.json', JSON.stringify({ names, updated: new Date().toISOString().slice(0, 10) }, null, 1) + '\n');
console.log('Favoriten:', names.length);
