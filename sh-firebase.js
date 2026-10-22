// SommerHaus Web-App: Anmeldung und gemeinsamer Speicher über Firebase.
// Die App selbst (index.html) ist dieselbe wie in Claude. Diese Datei stellt ihr
// denselben Speicher-Zugriff bereit (collection, doc, onSnapshot, add, update, set, delete),
// nur eben mit Firebase Firestore statt dem Claude-Speicher.
import { firebaseConfig } from './firebase-config.js';
import * as L from './sh-lock.js';

const V = '10.12.2';
const BASE = 'https://www.gstatic.com/firebasejs/' + V + '/';

const css = `
.shl{position:fixed;inset:0;z-index:100;background:var(--bg);display:grid;place-items:center;padding:24px 16px;overflow:auto}
.shl[hidden]{display:none!important}
.shl-box{width:100%;max-width:360px;display:grid;gap:16px;text-align:center}
.shl-box .logo{width:88px;height:88px;margin:0 auto;border-radius:22px;box-shadow:0 2px 6px rgba(90,62,54,.18)}
.shl-box h1{justify-content:center;font-size:32px}
.shl-box p{color:var(--fg2);font-size:15px;margin:0}
.shl-form{display:grid;gap:10px;text-align:left}
.shl-form input{font:inherit;font-size:16px;border:0;border-radius:12px;background:var(--card);color:var(--fg);padding:14px 16px;min-height:50px;width:100%}
.shl-form input:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.shl-form button{min-height:50px;border-radius:999px;font-size:16px}
.shl-err{color:var(--red)!important;font-weight:500}
.shl-link{border:0;background:none;color:var(--accent);font:inherit;font-size:14px;font-weight:600;cursor:pointer;min-height:40px}
.sh-extra{display:grid;gap:8px}
.shl-keep{display:flex;align-items:center;gap:10px;font-size:15px;color:var(--fg);padding:4px 4px 2px;cursor:pointer}
.shl-keep input{width:22px;height:22px;min-height:0;margin:0;accent-color:var(--accent);flex:none}
`;

const LOGO = '<svg class="logo" viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="22" fill="#EDBFAE"/><circle cx="50" cy="50" r="30" fill="none" stroke="#FFF9F2" stroke-width="6.5" stroke-linecap="round" stroke-dasharray="158 30.5" transform="rotate(-20 50 50)"/><circle cx="69.7" cy="27.4" r="5.5" fill="#F7E08F"/><path d="M37 63V51L50 40L63 51V63Z" fill="#FFF9F2" stroke="#FFF9F2" stroke-width="3" stroke-linejoin="round"/></svg>';

function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }

const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
const screen = el(`<div class="shl" id="shLogin">
  <div class="shl-box">
    ${LOGO}
    <h1><span>Sommer<b>Haus</b></span></h1>
    <p id="shMsg">Bitte melde dich an.</p>
    <form class="shl-form" id="shForm" autocomplete="on">
      <input id="shEmail" type="email" autocomplete="username" placeholder="E-Mail" required>
      <input id="shPass" type="password" autocomplete="current-password" placeholder="Passwort" required>
      <label class="shl-keep"><input type="checkbox" id="shKeep" checked> Angemeldet bleiben</label>
      <button type="submit" class="btn primary" id="shGo">Anmelden</button>
    </form>
    <button type="button" class="shl-link" id="shReset">Passwort vergessen?</button>
  </div>
</div>`);
document.body.appendChild(screen);
const msg = (t, err) => { const m = document.getElementById('shMsg'); m.textContent = t; m.className = err ? 'shl-err' : ''; };

if (!firebaseConfig || String(firebaseConfig.apiKey).includes('HIER_EINTRAGEN')) {
  document.getElementById('shForm').hidden = true;
  document.getElementById('shReset').hidden = true;
  msg('Firebase ist noch nicht eingerichtet. Trag die Zugangsdaten in firebase-config.js ein (siehe Anleitung).', true);
  throw new Error('firebase-config fehlt');
}

const [{ initializeApp }, A, F] = await Promise.all([
  import(BASE + 'firebase-app.js'), import(BASE + 'firebase-auth.js'), import(BASE + 'firebase-firestore.js')
]);
const app = initializeApp(firebaseConfig);
const auth = A.getAuth(app);
let fs;
try {
  fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
} catch (e) { fs = F.getFirestore(app); }

// Speicher-Zugriff im selben Format wie in Claude
function snapDocs(s) { return { docs: s.docs.map(d => ({ id: d.id, data: () => d.data() })) }; }
function snapDoc(d) { return { id: d.id, exists: d.exists(), data: () => d.data() }; }
function docApi(ref) {
  return {
    get: () => F.getDoc(ref).then(snapDoc),
    set: o => F.setDoc(ref, o),
    update: o => F.updateDoc(ref, o),
    delete: () => F.deleteDoc(ref),
    onSnapshot: (cb, err) => F.onSnapshot(ref, d => cb(snapDoc(d)), err)
  };
}
function colApi(path) {
  const ref = F.collection(fs, path);
  return {
    get: () => F.getDocs(ref).then(snapDocs),
    add: o => F.addDoc(ref, o),
    doc: id => docApi(F.doc(fs, path, id)),
    onSnapshot: (cb, err) => F.onSnapshot(ref, s => cb(snapDocs(s)), err)
  };
}
const db = Object.freeze({ collection: colApi, doc: path => docApi(F.doc(fs, path)) });

// Einstellungen: Abmelden und Datenimport
function addSettings() {
  const box = document.querySelector('#namesForm .sheet-in');
  if (!box || document.getElementById('shExtra')) return;
  const extra = el(`<div class="stack sh-extra" id="shExtra">
    <p class="fhead" style="margin:0 0 0 4px">Konto</p>
    <div class="fgroup">
      <div class="frow"><span class="fl">Angemeldet</span><span id="shWho" style="flex:1;text-align:right;color:var(--fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span></div>
      <button type="button" class="frow act" id="shFace" hidden><span class="fl" style="flex:1;text-align:left">Beim Öffnen mit Face ID sperren</span><span id="shFaceVal" style="color:var(--fg2)"></span></button>
      <button type="button" class="frow act" id="shImport">Daten importieren (JSON)</button>
      <button type="button" class="frow act danger" id="shOut">Abmelden</button>
    </div>
    <input type="file" id="shFile" accept="application/json,.json" hidden>
    <p class="fnote" style="margin-top:0">Der Import übernimmt einmalig die Daten aus der Claude-Version. Bereits vorhandene Einträge mit derselben Kennung werden überschrieben.</p>
  </div>`);
  box.appendChild(extra);
  faceRow();
  document.getElementById('shFace').addEventListener('click', async () => {
    const v = document.getElementById('shFaceVal');
    if (L.faceOn()) { L.disable(); faceRow(); return; }
    v.textContent = 'Wird eingerichtet …';
    try { await L.setup(); faceRow(); } catch (e) { v.textContent = 'Hat nicht geklappt'; }
  });
  document.getElementById('shOut').addEventListener('click', () => A.signOut(auth).then(() => location.reload()));
  document.getElementById('shImport').addEventListener('click', () => document.getElementById('shFile').click());
  document.getElementById('shFile').addEventListener('change', async ev => {
    const f = ev.target.files && ev.target.files[0]; if (!f) return;
    const btn = document.getElementById('shImport');
    try {
      const data = JSON.parse(await f.text());
      const writes = [];
      for (const col of ['tasks', 'events', 'shopping', 'shopLists', 'settings']) {
        const docs = data[col] || {};
        for (const id of Object.keys(docs)) writes.push([col, id, docs[id]]);
      }
      for (let i = 0; i < writes.length; i += 400) {
        const b = F.writeBatch(fs);
        writes.slice(i, i + 400).forEach(([c, id, o]) => b.set(F.doc(fs, c, id), o));
        await b.commit();
      }
      btn.textContent = writes.length + ' Einträge importiert';
    } catch (e) {
      btn.textContent = 'Import fehlgeschlagen: ' + (e.code || e.message || 'Fehler');
    }
    ev.target.value = '';
  });
}

async function faceRow() {
  const b = document.getElementById('shFace'); if (!b) return;
  b.hidden = !(await L.faceAvailable());
  document.getElementById('shFaceVal').textContent = L.faceOn() ? 'Ein' : 'Aus';
}
try { if (localStorage.getItem('sommerhaus-keep') === '0') document.getElementById('shKeep').checked = false; } catch (e) {}

let resolved = false;
A.onAuthStateChanged(auth, user => {
  if (user) {
    L.start({ email: user.email || '', reauth: pw => A.signInWithEmailAndPassword(auth, user.email, pw),
      toast: t => { if (typeof window.toast === 'function') window.toast(t); }, onChange: faceRow });
    screen.hidden = true;
    addSettings();
    const w = document.getElementById('shWho'); if (w) w.textContent = user.email || '';
    if (!resolved) { resolved = true; window.__shResolve(db); }
  } else {
    screen.hidden = false;
    msg('Bitte melde dich an.');
  }
});

document.getElementById('shForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const go = document.getElementById('shGo'); go.disabled = true; msg('Anmeldung läuft …');
  try {
    const keep = document.getElementById('shKeep').checked;
    try { localStorage.setItem('sommerhaus-keep', keep ? '1' : '0'); } catch (e) {}
    await A.setPersistence(auth, keep ? A.browserLocalPersistence : A.browserSessionPersistence);
    await A.signInWithEmailAndPassword(auth, document.getElementById('shEmail').value.trim(), document.getElementById('shPass').value);
  } catch (e) {
    const c = e.code || '';
    msg(c.includes('invalid') || c.includes('wrong') || c.includes('user-not-found')
      ? 'E-Mail oder Passwort stimmt nicht.'
      : c.includes('network') ? 'Keine Verbindung. Prüfe das Internet und versuch es nochmal.'
      : c.includes('too-many') ? 'Zu viele Versuche. Warte ein paar Minuten.'
      : 'Anmeldung fehlgeschlagen (' + c + ').', true);
  }
  go.disabled = false;
});
document.getElementById('shReset').addEventListener('click', async () => {
  const mail = document.getElementById('shEmail').value.trim();
  if (!mail) { msg('Trag zuerst deine E-Mail ein.', true); return; }
  try { await A.sendPasswordResetEmail(auth, mail); msg('Mail zum Zurücksetzen ist unterwegs an ' + mail + '.'); }
  catch (e) { msg('Konnte keine Mail senden (' + (e.code || 'Fehler') + ').', true); }
});
