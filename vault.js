/* 🔐 Passwords vault (owner 2026-11-25, picked Option A: "a locked vault inside the Office CRM").
   Every saved password is locked ON THIS COMPUTER before it is saved: AES-GCM 256, the key made from a MASTER PASSWORD
   with PBKDF2-SHA256 (600,000 rounds, its own random salt). The master password is never saved anywhere, so the
   database (this browser now, Supabase later) only ever holds scrambled text: someone looking at the database sees
   garbage. Forgetting the master password = the saved passwords are gone for good (there is no back door, on purpose).
   db.vault = { v, salt, iter, check: box, items: [{ id, box, at }], setAt }; box = { iv, ct } (base64). An item box
   opens to { name, user, pass, url, notes }. While unlocked the key lives only in memory (vtKeyNow) and locks itself
   after 5 minutes with no clicks / typing (VT_IDLE_MIN) or with 🔒 Lock now. Passwords are never sent to the AI,
   never in the top search, never in a backup unlocked. 👁 shows one for 15 s; 📋 Copy clears the clipboard after 30 s. */

const VT_ITER = 600000, VT_IDLE_MIN = 5, VT_CHECK = 'servplus-vault-ok';
let vtKeyNow = null, vtLast = 0, vtFails = 0, vtWaitTill = 0, vtQ = '';
const vtOpenCache = new Map();             // ct → opened item, only while unlocked
const vtShown = new Set();                 // item ids showing their password right now

const vtB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const vtUnB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function vtMakeKey(pass, salt, iter = VT_ITER) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: vtUnB64(salt), iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function vtSeal(obj, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { iv: vtB64(iv), ct: vtB64(ct) };
}
async function vtUnseal(box, key) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: vtUnB64(box.iv) }, key, vtUnB64(box.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
function vtReady() { return !!db.vault?.check; }
function vtLock(why) {
  vtKeyNow = null; vtOpenCache.clear(); vtShown.clear();
  if (why) toast(why);
  if (route() === 'passwords') render();
}
// Locks itself after 5 minutes with nothing touched
['click', 'keydown', 'mousemove', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { if (vtKeyNow) vtLast = Date.now(); }, { passive: true }));
setInterval(() => { if (vtKeyNow && Date.now() - vtLast > VT_IDLE_MIN * 60000) vtLock('🔒 The password vault locked itself'); }, 15000);

function vtStrong(p) {
  if (p.length < 10) return 'The master password needs at least 10 characters';
  if (/^(.)\1+$/.test(p) || /^(1234567890?|password\w*|servplus\w*)$/i.test(p)) return 'Pick something harder to guess';
  return '';
}
function vtMakePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*?';
  const r = crypto.getRandomValues(new Uint32Array(16));
  return Array.from(r, n => chars[n % chars.length]).join('');
}
async function vtCopy(text, what) {
  try { await navigator.clipboard.writeText(text); } catch { return toast('Could not copy. Tap 👁 and copy it by hand.'); }
  toast(`📋 ${what} copied · it clears from the clipboard in 30 seconds`);
  clearTimeout(vtCopy.t); vtCopy.t = setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30000);
}

// ---------- Set up / unlock / change ----------
async function vtSetup() {
  const v = await form('🔐 Set up the password vault', [
    { name: 'p1', label: 'Master password', type: 'password', required: true, hint: 'At least 10 characters. A short sentence works well, e.g. "blue truck 7 rainy monday".' },
    { name: 'p2', label: 'Type it again', type: 'password', required: true }
  ], {}, { saveLabel: 'Next', top: `<div class="vt-warn">⚠️ <b>Write this password on paper and keep it in the office safe.</b> Nobody can get it back if it is forgotten, not even Claude or Supabase. That is what keeps the passwords safe.</div>`,
    check: v => v.p1 !== v.p2 ? 'The two passwords are not the same' : vtStrong(v.p1) });
  if (!v) return;
  if (!(await sure('Turn on the password vault?', ['The master password unlocks every saved password.', 'You and the office manager both use the same master password.', '<b>Written down and put somewhere safe?</b>'], 'Yes, it’s written down'))) return;
  const salt = vtB64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await vtMakeKey(v.p1, salt);
  db.vault = { v: 1, salt, iter: VT_ITER, check: await vtSeal({ ok: VT_CHECK }, key), items: (db.vault?.items || []), setAt: Date.now() };
  await saveDb();
  vtKeyNow = key; vtLast = Date.now();
  toast('🔐 Vault is on and unlocked'); render();
}
async function vtTryKey(pass, vault = db.vault) {
  const key = await vtMakeKey(pass, vault.salt, vault.iter || VT_ITER);
  try { const c = await vtUnseal(vault.check, key); return c?.ok === VT_CHECK ? key : null; } catch { return null; }
}
async function vtUnlock(inp) {
  const pass = inp.value; if (!pass) return inp.focus();
  if (Date.now() < vtWaitTill) return toast(`Too many tries. Wait ${Math.ceil((vtWaitTill - Date.now()) / 1000)} seconds.`);
  const btn = document.querySelector('[data-vt-unlock]'); if (btn) { btn.disabled = true; btn.textContent = 'Unlocking…'; }
  const key = await vtTryKey(pass);
  if (!key) {
    vtFails++; if (vtFails >= 5) { vtWaitTill = Date.now() + 30000; vtFails = 0; }
    if (btn) { btn.disabled = false; btn.textContent = '🔓 Unlock'; }
    inp.value = ''; inp.focus(); inp.classList.add('need');
    return toast('That’s not the master password');
  }
  vtFails = 0; vtKeyNow = key; vtLast = Date.now(); render();
}
async function vtChangeMaster() {
  const v = await form('🔑 Change the master password', [
    { name: 'old', label: 'Master password now', type: 'password', required: true },
    { name: 'p1', label: 'New master password', type: 'password', required: true, hint: 'At least 10 characters.' },
    { name: 'p2', label: 'Type the new one again', type: 'password', required: true }
  ], {}, { saveLabel: 'Next', check: v => v.p1 !== v.p2 ? 'The two new passwords are not the same' : vtStrong(v.p1) });
  if (!v) return;
  const oldKey = await vtTryKey(v.old); if (!oldKey) return toast('The master password now is not right');
  if (!(await sure('Change the master password?', ['Every saved password is locked again with the new one.', 'Tell the office manager the new one.', '<b>Write the new one down and put it in the safe.</b>'], 'Yes, change it'))) return;
  const salt = vtB64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await vtMakeKey(v.p1, salt);
  const items = [];
  for (const it of db.vault.items) items.push({ ...it, box: await vtSeal(await vtUnseal(it.box, oldKey), key) });
  db.vault = { ...db.vault, salt, iter: VT_ITER, check: await vtSeal({ ok: VT_CHECK }, key), items, setAt: Date.now() };
  await saveDb(); vtOpenCache.clear(); vtKeyNow = key; vtLast = Date.now();
  toast('🔑 Master password changed'); render();
}
async function vtForgot() {
  const a = await ask('Forgot the master password?', `<p>There is no way to get it back. That is what keeps the passwords safe.</p><p>Look for the paper copy first (the office safe), or ask the other person who knows it.</p><p class="muted">The last way out: start the vault over. <b>Every saved password is deleted</b> and you set a new master password.</p>`,
    [{ label: 'Go back', value: false }, { label: '🗑 Start the vault over', cls: 'red', value: true }]);
  if (!a) return;
  const n = db.vault.items.length;
  if (!(await sure('Delete every saved password?', [`${n} saved password${n === 1 ? '' : 's'} will be deleted for good.`, 'This can’t be undone.'], 'Yes, delete them all'))) return;
  db.vault = null; await saveDb(); vtLock(); toast('The vault was emptied. Set a new master password.'); render();
}

// ---------- Items ----------
function vtFields() {
  return [
    { name: 'name', label: 'What it’s for', required: true, hint: 'e.g. Comcast, Home Depot Pro, QuickBooks' },
    { name: 'user', label: 'Username or email', half: true },
    { name: 'pass', label: 'Password', type: 'password', half: true },
    { name: 'url', label: 'Website' },
    { name: 'notes', label: 'Notes', type: 'textarea', hint: 'PIN, security questions, account #… Also locked.' }
  ];
}
// The form() window's password box gets 👁 and 🎲 Make one
function vtWireForm() {
  setTimeout(() => {
    const inp = modalRoot().lastElementChild?.querySelector('input[name="pass"]'); if (!inp) return;
    inp.setAttribute('autocomplete', 'new-password');
    const row = document.createElement('div'); row.className = 'vt-pwtools';
    row.innerHTML = `<button type="button" class="btn sm" data-t="eye">👁 Show</button><button type="button" class="btn sm" data-t="gen">🎲 Make a strong one</button>`;
    inp.after(row);
    row.addEventListener('click', e => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      if (b.dataset.t === 'eye') { const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; b.textContent = show ? '🙈 Hide' : '👁 Show'; }
      else { inp.value = vtMakePassword(); inp.type = 'text'; row.querySelector('[data-t=eye]').textContent = '🙈 Hide'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    });
  }, 40);
}
function vtLine(v) { return [esc(v.name), v.user ? esc(v.user) : '', v.pass ? 'password ••••••' : 'no password', v.url ? esc(v.url) : ''].filter(Boolean).join(' · '); }
async function vtNew() {
  if (!vtKeyNow) return;
  const p = form('🔐 New password', vtFields(), {}); vtWireForm();
  const v = await p; if (!v || !vtKeyNow) return;
  if (!(await sure('Save this password?', [vtLine(v), 'It is locked before it is saved.']))) return;
  if (!vtKeyNow) return toast('The vault locked. Unlock it and try again.');
  db.vault.items.push({ id: uid(), box: await vtSeal(v, vtKeyNow), at: Date.now() });
  await saveDb(); toast('🔐 Saved and locked'); render();
}
async function vtEdit(id) {
  const it = db.vault.items.find(x => x.id === id); if (!it || !vtKeyNow) return;
  const cur = await vtUnseal(it.box, vtKeyNow);
  const p = form(cur.name, vtFields(), cur, { onDelete: async () => {
    if (!(await sure('Delete this password?', [vtLine(cur), 'This can’t be undone.'], 'Delete'))) return false;
    db.vault.items = db.vault.items.filter(x => x !== it); await saveDb(); render(); return true;
  } });
  vtWireForm();
  const v = await p; if (!v) return;
  if (!(await sure('Save these changes?', [vtLine(v)]))) return;
  if (!vtKeyNow) return toast('The vault locked. Unlock it and try again.');
  it.box = await vtSeal(v, vtKeyNow); it.at = Date.now();
  await saveDb(); toast('🔐 Saved and locked'); render();
}
async function vtOpened(it) {
  const c = vtOpenCache.get(it.box.ct); if (c) return c;
  const o = await vtUnseal(it.box, vtKeyNow); vtOpenCache.set(it.box.ct, o); return o;
}

// ---------- The page ----------
views.passwords = {
  html() {
    const head = `<div class="page-head"><h1>🔐 Passwords</h1>${vtKeyNow ? `<span class="pill grn">🔓 Unlocked · locks itself after ${VT_IDLE_MIN} min</span><button class="btn" data-vt-act="lock">🔒 Lock now</button><button class="btn pri" data-vt-act="new">+ Add password</button>` : vtReady() ? '<span class="pill gry">🔒 Locked</span>' : ''}</div>`;
    if (!vtReady()) return head + `<div class="card vt-card">${cardHead('🔐', 'Keep the company’s passwords locked')}
      <ul class="vt-how"><li>Every password is <b>locked on this computer before it is saved</b>. The database only ever holds scrambled text.</li>
      <li>One <b>master password</b> opens them, known only by you and the owner. It is never saved anywhere.</li>
      <li>It locks itself after ${VT_IDLE_MIN} minutes. Passwords are never sent to the AI and never show in search.</li>
      <li class="vt-red">If the master password is forgotten, the saved passwords can’t be opened again. Keep a paper copy in the office safe.</li></ul>
      <button class="btn pri" data-vt-act="setup">🔐 Set up the vault</button></div>`;
    if (!vtKeyNow) return head + `<div class="card vt-card vt-lockcard">${cardHead('🔒', 'The vault is locked')}
      <form class="vt-unlock" data-vt-form autocomplete="off"><input type="password" data-vt-pass placeholder="Master password" autocomplete="current-password">
      <button class="btn pri" data-vt-unlock>🔓 Unlock</button></form>
      <div class="vt-links"><a href="#" data-vt-act="forgot">Forgot the master password?</a> · <span class="muted">${db.vault.items.length} saved</span></div></div>`;
    return head + `<div class="card vt-card">${cardHead('🔐', 'Saved passwords', `<span class="pill gry">${db.vault.items.length}</span>`)}
      <div class="ct-bar"><input data-vt-q placeholder="Search what it’s for, username or website" value="${esc(vtQ)}"></div>
      <div class="vt-list" data-vt-list><div class="muted">Opening…</div></div>
      <div class="vt-links"><a href="#" data-vt-act="change">🔑 Change the master password</a></div></div>`;
  },
  async after() {
    if (!vtReady()) return;
    if (!vtKeyNow) { setTimeout(() => document.querySelector('[data-vt-pass]')?.focus(), 30); return; }
    const box = document.querySelector('[data-vt-list]'); if (!box) return;
    const q = norm(vtQ), rows = [];
    for (const it of db.vault.items) {
      let o; try { o = await vtOpened(it); } catch { o = { name: '⚠ Could not open this one', broken: true }; }
      if (!vtKeyNow) return;
      if (q && !norm([o.name, o.user, o.url].join(' ')).includes(q)) continue;
      rows.push({ it, o });
    }
    rows.sort((a, b) => String(a.o.name).localeCompare(String(b.o.name)));
    box.innerHTML = rows.length ? rows.map(({ it, o }) => {
      const site = o.url ? (/^https?:/i.test(o.url) ? o.url : 'https://' + o.url) : '';
      return `<div class="vt-row" data-vt-edit="${it.id}">
        <div class="vt-main"><b>${esc(o.name)}</b>${o.user ? `<span class="muted"> · ${esc(o.user)}</span>` : ''}${site ? `<div><a href="${esc(site)}" target="_blank" rel="noopener" data-stop>${esc(o.url)}</a></div>` : ''}</div>
        <code class="vt-pw">${o.pass ? (vtShown.has(it.id) ? esc(o.pass) : '••••••••••') : '<span class="muted">none</span>'}</code>
        <div class="vt-btns">${o.pass ? `<button class="btn sm" data-vt-eye="${it.id}">${vtShown.has(it.id) ? '🙈' : '👁'}</button>` : ''}
          ${o.user ? `<button class="btn sm" data-vt-copy="${it.id}|user">📋 Username</button>` : ''}
          ${o.pass ? `<button class="btn sm pri" data-vt-copy="${it.id}|pass">📋 Password</button>` : ''}</div></div>`;
    }).join('') : `<div class="empty">${db.vault.items.length ? 'Nothing matches that.' : 'No passwords saved yet. Tap “+ Add password”.'}</div>`;
    const qi = document.querySelector('[data-vt-q]');
    qi?.addEventListener('input', () => { vtQ = qi.value; const pos = qi.selectionStart; render(); const n = document.querySelector('[data-vt-q]'); n?.focus(); n?.setSelectionRange(pos, pos); });
  }
};
document.addEventListener('submit', e => { if (!e.target.closest('[data-vt-form]')) return; e.preventDefault(); vtUnlock(document.querySelector('[data-vt-pass]')); });
document.addEventListener('click', async e => {
  const a = e.target.closest('[data-vt-act]');
  if (a) {
    e.preventDefault();
    const k = a.dataset.vtAct;
    return k === 'setup' ? vtSetup() : k === 'lock' ? vtLock('🔒 Locked') : k === 'new' ? vtNew() : k === 'forgot' ? vtForgot() : vtChangeMaster();
  }
  const eye = e.target.closest('[data-vt-eye]');
  if (eye) {
    e.stopPropagation(); const id = eye.dataset.vtEye;
    if (vtShown.has(id)) vtShown.delete(id); else { vtShown.add(id); setTimeout(() => { if (vtShown.delete(id) && route() === 'passwords') render(); }, 15000); }
    return render();
  }
  const cp = e.target.closest('[data-vt-copy]');
  if (cp) {
    e.stopPropagation(); const [id, what] = cp.dataset.vtCopy.split('|');
    const it = db.vault?.items.find(x => x.id === id); if (!it || !vtKeyNow) return;
    const o = await vtOpened(it); return vtCopy(o[what] || '', what === 'pass' ? 'Password' : 'Username');
  }
  if (e.target.closest('a[data-stop]')) return;
  const ed = e.target.closest('[data-vt-edit]');
  if (ed && vtKeyNow) vtEdit(ed.dataset.vtEdit);
});
// Another tab saved: the locked boxes changed, so forget what was opened
if (chan) chan.addEventListener('message', () => vtOpenCache.clear());

/* 🗄️ Vault (owner 2026-11-26): one menu item for Passwords + Employees, above Management. "We will make the password and
   security later": for now it opens either page; both pages light up Vault in the menu (NAV_PARENT in app.js). */
views.vault = {
  html() {
    const n = db.vault?.items?.length || 0;
    const tile = (href, ico, title, sub) => `<a class="card vlt-tile" href="${href}"><span class="vlt-ico">${ico}</span><div><div class="vlt-t">${title}</div><div class="small muted">${sub}</div></div><span class="muted">›</span></a>`;
    return `<div class="page-head"><h1>🗄️ Vault</h1><span class="pill gry">Owner + office manager only</span></div>
      <div class="vlt-grid">
        ${tile('#/passwords', '🔐', 'Passwords', vtReady() ? `${n} saved · locked with the master password` : 'Set up the master password to start')}
        ${tile('#/employees', '👥', 'Employees', 'Employee records')}
      </div>`;
  }
};
