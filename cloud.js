/* 🌐 Online: the Office CRM's own Supabase project (owner 2026-11-25). Two people, two computers, one set of data.
   - Sign in (email + password; 2-step phone code once turned on). Only emails on office_staff get in (schema.sql).
   - db is saved in rows: every bill / purchase / contact… is its own row "bills|<id>", everything else one row per key
     "k:settings". Two people changing DIFFERENT things never overwrite each other. Removed = deleted true.
   - Every save goes to this computer first (IndexedDB, as before) and an OUTBOX (localStorage office-outbox), which is
     emptied only after Supabase says it has it, so no signal = nothing lost; it is sent when the signal comes back.
   - Live: the other person's changes arrive in a second (realtime) and the page redraws when nothing is open / typed.
   - Scanned originals go to private storage "office-files" too, so both computers can open them.
   - window.officeCloud.invoke(fn, body) = the Edge Functions (the AI). Not online = everything works on this computer only.
   Online on: the hosted site always; localhost only with localStorage office-online = "on" (or ?online=1). */

const CL = { sb: null, me: null, name: '', tab: Math.random().toString(36).slice(2, 8), last: new Map(), sending: false, ch: null, status: 'off' };
const CL_OUT = 'office-outbox', CL_FILES = 'office-files-wait', CL_WAIT = 45000;

function clWanted() {
  if (!OFFICE_ONLINE?.url || !OFFICE_ONLINE?.key || !window.supabase) return false;
  const q = new URLSearchParams(location.search);
  if (q.has('online')) localStorage.setItem('office-online', q.get('online') === '0' ? 'off' : 'on');
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  return !local || localStorage.getItem('office-online') === 'on';
}
const clTimed = (p, ms = CL_WAIT) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('No answer from the server')), ms))]);

// ---------- db ⇄ rows ----------
const CL_SKIP = ['savedAt'];
function clIdList(v) { return Array.isArray(v) && v.length > 0 && v.every(x => x && typeof x === 'object' && typeof x.id === 'string' && x.id); }
function clRows(d) {
  const m = new Map();
  for (const [k, v] of Object.entries(d || {})) {
    if (CL_SKIP.includes(k) || v === undefined) continue;
    if (clIdList(v)) v.forEach((x, i) => m.set(`${k}|${x.id}`, JSON.stringify({ pos: i, v: x })));
    else m.set('k:' + k, JSON.stringify({ v }));
  }
  return m;
}
function clApply(d, key, data) {
  if (key.startsWith('k:')) { const k = key.slice(2); if (data == null) delete d[k]; else d[k] = data.v; return; }
  const [list, id] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)];
  if (!Array.isArray(d[list])) d[list] = [];
  const arr = d[list], i = arr.findIndex(x => x?.id === id);
  if (data == null) { if (i >= 0) arr.splice(i, 1); return; }
  if (i >= 0) arr[i] = data.v;
  else { arr.splice(Math.min(Math.max(data.pos, 0), arr.length), 0, data.v); }
}
function clFromRows(rows) {
  const d = {};
  rows.filter(r => r.key.startsWith('k:')).forEach(r => clApply(d, r.key, r.data));
  rows.filter(r => !r.key.startsWith('k:')).sort((a, b) => (a.data?.pos ?? 0) - (b.data?.pos ?? 0))
    .forEach(r => { const list = r.key.slice(0, r.key.indexOf('|')); (d[list] ||= []).push(r.data.v); });
  return d;
}

// ---------- Outbox ----------
function clOut() { try { return JSON.parse(localStorage.getItem(CL_OUT) || '{}'); } catch { return {}; } }
function clOutSet(o) { localStorage.setItem(CL_OUT, JSON.stringify(o)); clPill(); }
function clQueue() {
  if (!CL.sb || !db) return;
  const now = clRows(db), out = clOut(), stamp = Date.now();
  for (const [k, s] of now) if (CL.last.get(k) !== s) out[k] = { d: s, at: stamp };
  for (const k of CL.last.keys()) if (!now.has(k)) out[k] = { d: null, at: stamp };
  CL.last = now; clOutSet(out); clFlush();
}
async function clFlush() {
  if (!CL.sb || CL.sending || !navigator.onLine) return clPill();
  const out = clOut(), keys = Object.keys(out); if (!keys.length) return clPill();
  CL.sending = true; clPill();
  try {
    const rows = keys.map(k => ({ key: k, data: out[k].d == null ? null : JSON.parse(out[k].d), deleted: out[k].d == null, updated_by: CL.me + '|' + CL.tab }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await clTimed(CL.sb.from('office_rows').upsert(rows.slice(i, i + 200)));
      if (error) throw error;
    }
    const now = clOut();                              // only remove what didn't change again while sending
    keys.forEach(k => { if (now[k] && now[k].at === out[k].at) delete now[k]; });
    clOutSet(now);
  } catch (e) { console.warn('Office CRM: could not send changes yet', e); CL.err = e.message || String(e); setTimeout(clFlush, 20000); }
  finally { CL.sending = false; clPill(); }
  if (Object.keys(clOut()).length && !CL.err) setTimeout(clFlush, 500);
}

// ---------- Load / catch up / live ----------
async function clFetchAll() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await clTimed(CL.sb.from('office_rows').select('key,data,deleted').eq('deleted', false).range(from, from + 999));
    if (error) throw error;
    all.push(...data); if (data.length < 1000) break;
  }
  return all;
}
// Put the server's copy into db, keeping what this computer still has waiting to send
function clMerge(rows) {
  const out = clOut(), server = new Map(rows.map(r => [r.key, JSON.stringify(r.data)]));
  let changed = false;
  for (const r of rows) {
    if (out[r.key]) continue;
    const s = server.get(r.key);
    if (CL.last.get(r.key) !== s) { clApply(db, r.key, r.data); changed = true; }
  }
  for (const k of [...CL.last.keys()]) if (!server.has(k) && !out[k]) { clApply(db, k, null); changed = true; }
  if (changed) { migrate(); CL.last = clRows(db); }
  return changed;
}
async function clCatchUp() {
  if (!CL.sb || !navigator.onLine) return;
  try { if (clMerge(await clFetchAll())) { await clLocalSave(); clRedraw(); } } catch (e) { console.warn('Office CRM: catch up failed', e); }
}
function clLive() {
  CL.ch = CL.sb.channel('office-rows').on('postgres_changes', { event: '*', schema: 'public', table: 'office_rows' }, p => {
    const r = p.new; if (!r?.key) return;
    if (String(r.updated_by || '').endsWith('|' + CL.tab)) return;           // my own save coming back
    if (clOut()[r.key]) return;                                               // I changed it too and haven't sent yet
    if (r.data == null && !r.deleted) return clCatchUp();                     // too big to come along: read it
    clApply(db, r.key, r.deleted ? null : r.data); migrate();
    CL.last = clRows(db); clLocalSave(); clRedraw();
  }).subscribe(s => { if (s === 'SUBSCRIBED') clCatchUp(); });
}
// Save to this computer only (the cloud copy is already right)
async function clLocalSave() { if (clSaveDb) await clSaveDb(); }
// Redraw when she isn't in the middle of something
function clRedraw() {
  const busy = () => document.querySelector('#modalRoot .modal-bg') || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.closest('#main'));
  if (busy()) { clearTimeout(clRedraw.t); clRedraw.t = setTimeout(clRedraw, 2000); return; }
  render();
}

// ---------- Files (scanned originals) ----------
function clFilesWait() { try { return JSON.parse(localStorage.getItem(CL_FILES) || '[]'); } catch { return []; } }
async function clFileUp(id) {
  const f = await clFileGetLocal(id); if (!f?.blob) return true;
  const { error } = await clTimed(CL.sb.storage.from('office-files').upload(id, f.blob, { upsert: true, contentType: f.type || f.blob.type || 'application/octet-stream' }), 120000);
  if (error) throw error;
  return true;
}
async function clFilesFlush() {
  if (!CL.sb || !navigator.onLine) return;
  let wait = clFilesWait();
  for (const id of [...wait]) { try { await clFileUp(id); wait = clFilesWait().filter(x => x !== id); localStorage.setItem(CL_FILES, JSON.stringify(wait)); } catch (e) { console.warn('Office CRM: file upload failed', e); break; } }
  clPill();
}
let clSaveDb, clFileGetLocal;
function clWrapFiles() {
  clFileGetLocal = fileGet;
  const save = fileSave, del = fileDel;
  fileSave = async rec => {
    await save(rec);
    if (!CL.sb) return;
    localStorage.setItem(CL_FILES, JSON.stringify([...new Set([...clFilesWait(), rec.id])])); clFilesFlush();
  };
  fileGet = async id => {
    const f = await clFileGetLocal(id); if (f || !CL.sb) return f;
    try {
      const { data, error } = await clTimed(CL.sb.storage.from('office-files').download(id), 60000); if (error || !data) return null;
      const doc = byId(db.docs || [], id);
      const rec = { id, blob: data, name: doc?.name || id, type: data.type, at: doc?.at || Date.now() };
      await save(rec); return rec;
    } catch { return null; }
  };
  fileDel = async id => { await del(id); if (CL.sb) CL.sb.storage.from('office-files').remove([id]).catch(() => {}); };
}

// ---------- The status bubble ----------
function clPill() {
  let p = document.getElementById('clPill');
  if (!CL.sb) { p?.remove(); return; }
  if (!p) { p = document.createElement('button'); p.id = 'clPill'; p.className = 'cl-pill'; p.addEventListener('click', () => { CL.err = ''; clFlush(); clFilesFlush(); clCatchUp(); toast('🔄 Checking…'); }); document.querySelector('.me')?.before(p); }
  const n = Object.keys(clOut()).length + clFilesWait().length;
  const [cls, txt, tip] = !navigator.onLine ? ['off', '📵 Offline', 'No internet. Everything is kept on this computer and sent when it comes back.']
    : n ? ['wait', `⏳ ${n} to send`, CL.err ? 'Not sent yet: ' + CL.err : 'Sending to the office database…']
    : ['ok', '☁ Saved', 'Everything is saved online'];
  p.className = 'cl-pill ' + cls; p.textContent = txt; p.title = tip;
}

// ---------- Sign in ----------
function clGate(html) {
  document.body.classList.add('cl-gate-on');
  let g = document.getElementById('clGate');
  if (!g) { g = document.createElement('div'); g.id = 'clGate'; g.className = 'cl-gate'; document.body.appendChild(g); }
  g.innerHTML = `<div class="cl-box"><div class="brand-name" style="color:var(--brand)">SERVPLUS</div><div class="muted" style="margin-bottom:14px">Office Management CRM</div>${html}</div>`;
  return g;
}
function clGateOff() { document.body.classList.remove('cl-gate-on'); document.getElementById('clGate')?.remove(); }
function clSignInForm(msg = '', signup = false) {
  return new Promise(res => {
    const g = clGate(`<h3 style="margin:0 0 10px">${signup ? 'Make your login' : 'Sign in'}</h3>
      ${msg ? `<div class="cl-msg">${msg}</div>` : ''}
      <form autocomplete="on" class="cl-form">
        <label>Email<input name="email" type="email" autocomplete="username" required></label>
        <label>Password<input name="pass" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="${signup ? 10 : 1}"></label>
        ${signup ? '<label>Password again<input name="pass2" type="password" autocomplete="new-password" required></label>' : ''}
        <button class="btn pri" style="width:100%">${signup ? 'Make my login' : 'Sign in'}</button></form>
      <div class="cl-links"><a href="#" data-sw>${signup ? '‹ I already have a login' : 'First time here? Make your login'}</a></div>`);
    const fm = g.querySelector('form');
    setTimeout(() => fm.email.focus(), 30);
    g.querySelector('[data-sw]').addEventListener('click', e => { e.preventDefault(); clSignInForm('', !signup).then(res); });
    fm.addEventListener('submit', e => {
      e.preventDefault();
      if (signup && fm.pass.value !== fm.pass2.value) return toast('The two passwords are not the same');
      res({ email: fm.email.value.trim().toLowerCase(), pass: fm.pass.value, signup });
    });
  });
}
function clCodeForm(msg = '') {
  return new Promise(res => {
    const g = clGate(`<h3 style="margin:0 0 6px">2-step sign-in</h3><div class="muted" style="margin-bottom:10px">Type the 6-digit code from the authenticator app on your phone.</div>
      ${msg ? `<div class="cl-msg">${msg}</div>` : ''}
      <form class="cl-form" autocomplete="off"><input name="code" inputmode="numeric" maxlength="6" placeholder="123456" style="font-size:22px;letter-spacing:6px;text-align:center" required>
      <button class="btn pri" style="width:100%">Continue</button></form>
      <div class="cl-links"><a href="#" data-out>Sign out</a></div>`);
    const fm = g.querySelector('form'); setTimeout(() => fm.code.focus(), 30);
    fm.addEventListener('submit', e => { e.preventDefault(); res(fm.code.value.replace(/\D/g, '')); });
    g.querySelector('[data-out]').addEventListener('click', e => { e.preventDefault(); res(null); });
  });
}
// Say what really went wrong (2026-11-25: "email not confirmed" was shown as "don't match")
function clAuthMsg(err, signup) {
  const c = err?.code || '', m = String(err?.message || '');
  if (c === 'email_not_confirmed' || /not confirmed/i.test(m)) return '📧 This email isn’t confirmed yet. Click the link in the email Supabase sent you (check spam), then sign in.';
  if (c === 'user_already_exists' || /already registered/i.test(m)) return 'There is already a login for this email. Sign in instead.';
  if (c === 'over_email_send_rate_limit' || c === 'over_request_rate_limit' || /rate limit/i.test(m)) return 'Too many tries for now. Wait a few minutes and try again.';
  if (c === 'weak_password' || /password should/i.test(m)) return 'Pick a longer password (at least 10 characters).';
  if (c === 'invalid_credentials' || /invalid login/i.test(m)) return 'That email and password don’t match.';
  return (signup ? 'Could not make the login: ' : 'Could not sign in: ') + esc(m || 'unknown error');
}
async function clSignIn() {
  const auth = CL.sb.auth;
  let { data: { session } } = await auth.getSession();
  let msg = '';
  while (!session) {
    const v = await clSignInForm(msg);
    const r = v.signup ? await auth.signUp({ email: v.email, password: v.pass }) : await auth.signInWithPassword({ email: v.email, password: v.pass });
    if (r.error) { msg = clAuthMsg(r.error, v.signup); continue; }
    session = r.data.session;
    if (!session) msg = '📧 Login made. Open the email Supabase just sent you and click its link to confirm, then sign in here.';
  }
  // 2-step code, when this login has it turned on
  const { data: aal } = await auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
    const { data: f } = await auth.mfa.listFactors();
    const factor = f?.totp?.find(x => x.status === 'verified');
    let msg2 = '';
    for (;;) {
      const code = await clCodeForm(msg2);
      if (code == null) { await auth.signOut(); return clSignIn(); }
      const { error } = await auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (!error) break; msg2 = 'That code didn’t work. Try the newest one.';
    }
  }
  const email = (await auth.getUser()).data.user?.email || '';
  const { data: ok } = await CL.sb.rpc('office_is_staff');
  if (ok !== true) {
    await auth.signOut();
    clGate(`<div class="cl-msg">${esc(email)} isn’t allowed in the Office CRM. Only the owner and the office manager can use it.</div><button class="btn pri" onclick="location.reload()">Try another login</button>`);
    return new Promise(() => {});
  }
  const { data: me } = await CL.sb.from('office_staff').select('name').ilike('email', email).maybeSingle();
  CL.me = email; CL.name = me?.name || email;
}

// ---------- Start (called by app.js before the CRM draws) ----------
async function officeCloudStart() {
  if (!clWanted()) return null;
  CL.sb = window.supabase.createClient(OFFICE_ONLINE.url, OFFICE_ONLINE.key, { auth: { persistSession: true, storageKey: 'office-auth' } });
  const local = await loadDb();
  try {
    if (!navigator.onLine) throw new Error('offline');
    await clSignIn();
    clGate('<div class="muted">Loading…</div>');
    const rows = await clFetchAll();
    let d;
    if (!rows.length && local && Object.keys(local).length > 2) {
      const up = await new Promise(res => {
        const g = clGate(`<h3 style="margin:0 0 8px">The office database is empty</h3><p>Put what is on this computer online? (bills, purchases, contacts, the locked passwords…)</p>
          <button class="btn pri" data-y style="width:100%;margin-bottom:8px">⬆ Put this computer’s data online</button><button class="btn" data-n style="width:100%">Start empty</button>`);
        g.querySelector('[data-y]').onclick = () => res(true); g.querySelector('[data-n]').onclick = () => res(false);
      });
      d = up ? local : {};
      CL.last = new Map();                         // everything counts as new, so it all goes up
    } else {
      d = clFromRows(rows);
      CL.last = clRows(d);
      const out = clOut();                         // my changes that never reached the server
      Object.entries(out).forEach(([k, e]) => clApply(d, k, e.d == null ? null : JSON.parse(e.d)));
    }
    clGateOff();
    return d;
  } catch (e) {
    console.warn('Office CRM: working from this computer’s copy', e);
    clGateOff();
    if (!local) { clGate('<div class="cl-msg">📵 No internet, and nothing is saved on this computer yet. Connect and try again.</div><button class="btn pri" onclick="location.reload()">Try again</button>'); return new Promise(() => {}); }
    CL.last = clRows(local); CL.offlineStart = true;
    return local;
  }
}
// After the CRM drew: hook saving, go live, send what waits
function officeCloudAfter() {
  if (!CL.sb) return;
  clSaveDb = saveDb;
  saveDb = async function () { await clSaveDb(); clQueue(); };
  clWrapFiles();
  window.officeCloud = {
    me: () => CL.me, name: () => CL.name, sb: CL.sb,
    async invoke(fn, body) {
      const { data, error } = await CL.sb.functions.invoke(fn, { body });
      if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch {} return { error: m }; }
      return data;
    }
  };
  document.querySelectorAll('.me-name').forEach(n => n.textContent = CL.name);
  document.querySelectorAll('.me-ico').forEach(n => n.textContent = CL.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase());
  clQueue();                                       // first upload / anything changed while offline
  clFilesFlush();
  if (CL.offlineStart) CL.sb.auth.getSession().then(({ data }) => { if (!data.session) location.reload(); });
  clLive();
  window.addEventListener('online', () => { clFlush(); clFilesFlush(); clCatchUp(); });
  window.addEventListener('offline', clPill);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { clFlush(); clCatchUp(); } });
  setInterval(() => { clFlush(); clFilesFlush(); }, 60000);
  setInterval(clCatchUp, 180000);
  clPill();
}

// ---------- Management page: who is signed in, 2-step, sign out ----------
function clCardHtml() {
  if (!CL.sb) return `<div class="card">${cardHead('🌐', 'Online')}<div class="muted">This computer works on its own copy. The office database turns on once the CRM is put online.</div></div>`;
  return `<div class="card">${cardHead('🌐', 'Online')}
    <div>Signed in as <b>${esc(CL.name)}</b> <span class="muted">(${esc(CL.me)})</span></div>
    <div class="muted small" style="margin:6px 0 10px">Everything is saved to the office database and shows on the other computer within seconds.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-cl="mfa">🔐 2-step sign-in</button><button class="btn" data-cl="out">Sign out</button></div></div>`;
}
async function clMfa() {
  const auth = CL.sb.auth;
  const { data: f } = await auth.mfa.listFactors();
  const on = f?.totp?.find(x => x.status === 'verified');
  if (on) {
    const a = await ask('🔐 2-step sign-in is on', '<p>This login asks for the 6-digit code from your phone when signing in.</p>', [{ label: 'Close', value: 0 }, { label: 'Turn it off', cls: 'red', value: 1 }]);
    if (!a || !(await sure('Turn off 2-step sign-in?', ['Only the password will be needed to sign in.', 'This makes the login easier to break into.'], 'Turn it off'))) return;
    const { error } = await auth.mfa.unenroll({ factorId: on.id });
    return toast(error ? 'Could not turn it off: ' + error.message : '2-step sign-in is off');
  }
  (f?.totp || []).filter(x => x.status !== 'verified').forEach(x => auth.mfa.unenroll({ factorId: x.id }));
  const { data, error } = await auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Phone ' + Date.now() });
  if (error) return toast('Could not start it: ' + error.message);
  const code = await new Promise(res => {
    const html = `<ol class="ask-list"><li>On your phone, install <b>Google Authenticator</b> or <b>Microsoft Authenticator</b> (free).</li><li>In the app tap <b>+</b> → <b>Scan a QR code</b> and scan this:</li></ol>
      <div style="text-align:center"><img src="${data.totp.qr_code}" style="width:200px;height:200px;background:#fff"></div>
      <div class="muted small" style="text-align:center">Can’t scan? Type this key in the app: <code>${esc(data.totp.secret)}</code></div>
      <ol start="3" class="ask-list"><li>Type the 6-digit code the app shows:</li></ol>
      <input id="clMfaCode" inputmode="numeric" maxlength="6" placeholder="123456" style="font-size:20px;letter-spacing:5px;text-align:center;width:100%">`;
    ask('🔐 Turn on 2-step sign-in', html, [{ label: 'Cancel', value: null }, { label: 'Turn it on', cls: 'pri', value: 'go' }]).then(v => res(v));
    const iv = setInterval(() => { const i = document.getElementById('clMfaCode'); if (i) { clearInterval(iv); i.focus(); i.addEventListener('input', () => { clMfa.code = i.value; }); } }, 50);
  });
  if (code !== 'go') { auth.mfa.unenroll({ factorId: data.id }); return; }
  const { error: e2 } = await auth.mfa.challengeAndVerify({ factorId: data.id, code: String(clMfa.code || '').replace(/\D/g, '') });
  if (e2) { auth.mfa.unenroll({ factorId: data.id }); return toast('That code didn’t work. Try again.'); }
  toast('🔐 2-step sign-in is on');
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-cl]'); if (!b || !CL.sb) return;
  if (b.dataset.cl === 'mfa') return clMfa();
  const n = Object.keys(clOut()).length;
  if (!(await sure('Sign out of the Office CRM?', n ? [`⚠ ${n} change${n > 1 ? 's are' : ' is'} not sent yet. They stay on this computer and go up the next time you sign in here.`] : ['Everything is saved online.'], 'Sign out'))) return;
  await clFlush();
  await CL.sb.auth.signOut(); location.reload();
});
