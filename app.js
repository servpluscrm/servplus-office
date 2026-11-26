/* SERVPLUS Office Management CRM
   Plain HTML/CSS/JS. Data lives in this browser's IndexedDB "servplus-office" (store "data", key "db").
   No Social Security numbers are ever stored here (owner's rule, 2026-11-25). */

// ---------- Storage ----------
const DB_NAME = 'servplus-office';
let db = null;
const chan = ('BroadcastChannel' in window) ? new BroadcastChannel('servplus-office') : null;

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 2);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('data')) d.createObjectStore('data'); if (!d.objectStoreNames.contains('files')) d.createObjectStore('files'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function loadDb() {
  const d = await idb();
  return new Promise(res => {
    const q = d.transaction('data').objectStore('data').get('db');
    q.onsuccess = () => res(q.result || null);
    q.onerror = () => res(null);
  });
}
async function saveDb() {
  db.savedAt = Date.now();
  const d = await idb();
  await new Promise((res, rej) => {
    const t = d.transaction('data', 'readwrite');
    t.objectStore('data').put(db, 'db');
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
  if (chan) chan.postMessage({ savedAt: db.savedAt });
}
if (chan) chan.onmessage = async () => { const d = await loadDb(); if (d) { db = d; migrate(); render(); } };

// ---------- Settings / defaults ----------
const DEFAULT_WORKDAY = [
  'Review Sunday dispatch handoff',
  'Enter previous day’s timesheets',
  'Update company stats',
  'Review urgent emails',
  'Prepare 8 AM meeting info',
  'Review upcoming bills',
  'Follow up on pending purchases',
  'Confirm tomorrow’s priorities'
];
const EQUIP_STATUS = {
  working: { label: 'Working', cls: 'grn' },
  service: { label: 'Service due', cls: 'grn' },
  schedule: { label: 'Schedule repair', cls: 'amb' },
  repair: { label: 'Repair needed', cls: 'red' },
  shop: { label: 'In the shop', cls: 'amb' }
};
const PUR_STATUS = {
  pending: { label: 'Pending', cls: 'amb' },
  owner: { label: 'Waiting on owner', cls: 'amb' },
  approved: { label: 'Approved', cls: 'grn' },
  ordered: { label: 'Ordered', cls: '' },
  received: { label: 'Received', cls: 'gry' },
  declined: { label: 'Declined', cls: 'red' }
};
const BACKUP_ROLES = [
  ['coverage', 'Office coverage'],
  ['purchasing', 'Purchasing'],
  ['bills', 'Bills & payments'],
  ['coi', 'COI requests'],
  ['urgent', 'Urgent requests']
];

function migrate() {
  db.settings ||= {};
  db.settings.weeklyBudget ??= 500;
  db.settings.workday ||= DEFAULT_WORKDAY.map(t => ({ id: uid(), text: t }));
  db.settings.backups ||= {};
  db.purchases ||= [];
  db.approvals ||= [];
  db.bills ||= [];
  db.equipment ||= [];
  db.dispatch ||= [];
  db.timeOff ||= [];
  db.renewals ||= [];
  db.workdayDays ||= {};
  db.receipts ||= [];
  db.docs ||= [];
  db.contacts ||= [];
}

// ---------- Helpers ----------
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function money(n) {
  n = Number(n) || 0;
  const cents = Math.round(n * 100) % 100 !== 0;
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
}
function moneyParse(s) { const n = parseFloat(String(s || '').replace(/[$,\s]/g, '')); return isNaN(n) ? null : n; }
function ymd(d) { d = new Date(d); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function today() { return ymd(new Date()); }
function dayOf(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = dayOf(s); d.setDate(d.getDate() + n); return ymd(d); }
function daysUntil(s) { return Math.round((dayOf(s) - dayOf(today())) / 86400000); }
function fmtDay(s, year) { if (!s) return ''; return dayOf(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) }); }
function fmtWhen(t) { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function daysAgo(t) { const n = Math.floor((Date.now() - t) / 86400000); return n <= 0 ? 'Today' : n === 1 ? '1 day' : n + ' days'; }
function byId(list, id) { return list.find(x => x.id === id); }
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

// Shop week = Friday through Thursday (the $500 weekly budget, bought on Fridays).
function weekStart(s = today()) { const d = dayOf(s); const back = (d.getDay() - 5 + 7) % 7; d.setDate(d.getDate() - back); return ymd(d); }
function weekEnd(s = today()) { return addDays(weekStart(s), 6); }

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- Pop-up windows ----------
const modalRoot = () => document.getElementById('modalRoot');
// ask(title, html, buttons) → value of the button pressed (null = closed)
function ask(title, html, buttons) {
  return new Promise(res => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog"><div class="modal-head"><h3>${esc(title)}</h3></div>
      <div class="modal-body">${html}</div>
      <div class="modal-foot">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    const done = v => { bg.remove(); document.removeEventListener('keydown', key); res(v); };
    const key = e => { if (e.key === 'Escape') done(null); };
    bg.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) done(buttons[+b.dataset.i].value); });
    document.addEventListener('keydown', key);
    modalRoot().appendChild(bg); window.fillDocPreviews?.(bg);
  });
}
async function sure(title, lines, yes = 'Yes, save') {
  const html = Array.isArray(lines) ? `<ul class="ask-list">${lines.map(l => `<li>${l}</li>`).join('')}</ul>` : lines;
  return (await ask(title, html, [{ label: 'Go back', value: false }, { label: yes, cls: 'pri', value: true }])) === true;
}

// form(title, fields, values) → values or null. Fields: { name, label, type, options, required, hint, half, list }
function form(title, fields, values = {}, opts = {}) {
  return new Promise(res => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    const fieldHtml = f => {
      const v = values[f.name] ?? f.value ?? '';
      let input;
      if (f.type === 'select') input = `<select name="${f.name}">${f.options.map(o => { const [val, lbl] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lbl)}</option>`; }).join('')}</select>`;
      else if (f.type === 'textarea') input = `<textarea name="${f.name}">${esc(v)}</textarea>`;
      else if (f.type === 'photo') input = `<input type="file" accept="image/*" name="${f.name}"><img class="photo-prev" ${v ? `src="${v}"` : 'hidden'}>`;
      else if (f.type === 'check') input = `<label style="text-transform:none;font-weight:400;display:flex;gap:8px;align-items:center"><input type="checkbox" name="${f.name}" style="width:auto" ${v ? 'checked' : ''}> ${esc(f.text || '')}</label>`;
      else input = `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${f.list ? `list="dl_${f.name}"` : ''} autocomplete="off">${f.list ? `<datalist id="dl_${f.name}">${f.list.map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}`;
      return `<div class="fld"><label>${esc(f.label)}${f.required ? ' *' : ''}</label>${input}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
    };
    let body = '', i = 0;
    while (i < fields.length) {
      if (fields[i].half && fields[i + 1]?.half) { body += `<div class="fld-2">${fieldHtml(fields[i])}${fieldHtml(fields[i + 1])}</div>`; i += 2; }
      else { body += fieldHtml(fields[i]); i++; }
    }
    bg.innerHTML = `<div class="modal" role="dialog"><div class="modal-head"><button class="modal-x" data-x title="Back">‹</button><h3>${esc(title)}</h3>
      ${opts.onDelete ? '<button class="btn red sm" data-del>🗑 Delete</button>' : ''}<button class="modal-x" data-x>✕ Close</button></div>
      <form class="modal-body" autocomplete="off">${opts.top || ''}${body}</form>
      <div class="modal-foot"><button class="btn" data-x>Cancel</button><button class="btn pri" data-save>💾 ${esc(opts.saveLabel || 'Save')}</button></div></div>`;
    modalRoot().appendChild(bg); window.fillDocPreviews?.(bg);
    const fm = bg.querySelector('form');
    const photos = {};
    let dirty = false;
    fm.addEventListener('input', () => { dirty = true; });
    // Enter in a box = Save (it used to submit the page and reload it, losing what was typed)
    fm.addEventListener('submit', e => { e.preventDefault(); bg.querySelector('[data-save]').click(); });
    fm.querySelectorAll('input[type=file]').forEach(inp => inp.addEventListener('change', async () => {
      const file = inp.files[0]; if (!file) return;
      photos[inp.name] = await shrinkPhoto(file);
      const img = inp.nextElementSibling; img.src = photos[inp.name]; img.hidden = false; dirty = true;
    }));
    const close = v => { bg.remove(); document.removeEventListener('keydown', key); res(v); };
    const tryClose = async () => {
      if (dirty && !(await ask('Leave without saving?', 'What you typed in this window will be lost.', [{ label: 'Stay on this page', value: false }, { label: 'Leave without saving', cls: 'red', value: true }]))) return;
      close(null);
    };
    const key = e => { if (e.key === 'Escape' && modalRoot().lastElementChild === bg) tryClose(); };
    document.addEventListener('keydown', key);
    bg.addEventListener('click', async e => {
      if (e.target.closest('[data-x]')) { e.preventDefault(); tryClose(); }
      else if (e.target.closest('[data-del]')) { e.preventDefault(); if (await opts.onDelete()) close(null); }
      else if (e.target.closest('[data-save]')) {
        e.preventDefault();
        const out = {};
        let bad = null;
        fields.forEach(f => {
          const el = fm.elements[f.name];
          let v = f.type === 'photo' ? (photos[f.name] ?? values[f.name] ?? '') : f.type === 'check' ? el.checked : el.value.trim();
          if (f.type === 'money') v = v === '' ? '' : moneyParse(v);
          if (f.required && (v === '' || v === null)) { bad ||= el; el.classList.add('need'); } else if (el?.classList) el.classList.remove('need');
          out[f.name] = v;
        });
        if (bad) { bad.focus(); toast('Fill in the boxes marked *'); return; }
        if (opts.check) { const msg = opts.check(out); if (msg) { toast(msg); return; } }
        close(out);
      }
    });
    setTimeout(() => fm.querySelector('input:not([type=file]):not([type=checkbox]),textarea,select')?.focus(), 30);
  });
}
function shrinkPhoto(file) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 500, s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.8));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

// ---------- Menu ----------
const PAGES = [
  ['dashboard', '🏠', 'Dashboard'],
  ['scan', '📄', 'Smart Scan'],
  ['contacts', '👤', 'Contacts'],
  ['passwords', '🔐', 'Passwords'],
  ['workday', '☑️', 'My Workday'],
  ['requests', '🙋', 'Employee Requests'],
  ['purchasing', '🛒', 'Purchasing'],
  ['approvals', '✅', 'Owner Approvals'],
  ['bills', '🧾', 'Bills & Payments'],
  ['shop', '🔧', 'Shop & Equipment'],
  ['dispatch', '🌙', 'Dispatch Updates'],
  ['employees', '👥', 'Employees'],
  ['stats', '📊', 'Company Stats'],
  ['insurance', '🛡️', 'Insurance & Licenses'],
  ['vehicles', '🚚', 'Company Vehicles'],
  ['resources', '📚', 'Company Resources'],
  ['calendar', '📅', 'Calendar & Coverage'],
  ['meetings', '🗣️', 'Company Meetings'],
  ['management', '⚙️', 'Management']
];
function navCount(page) {
  if (page === 'approvals') return pendingApprovals().length;
  if (page === 'purchasing') return db.purchases.filter(p => p.status === 'pending').length;
  if (page === 'bills') return db.bills.filter(b => !b.paidAt && daysUntil(b.due) <= 7).length;
  if (page === 'shop') return db.equipment.filter(e => e.status === 'repair').length;
  return 0;
}
function drawNav(route) {
  document.getElementById('nav').innerHTML = PAGES.map(([id, ico, name]) => {
    const n = navCount(id);
    return `<a class="nav-item ${route === id ? 'on' : ''}" href="#/${id}"><span class="ni">${ico}</span>${name}${n ? `<span class="nav-n">${n}</span>` : ''}</a>`;
  }).join('');
  const b = pendingApprovals().length;
  document.getElementById('bellN').textContent = b || '';
}

// ---------- Numbers ----------
function purTotal(p) { return (Number(p.price) || 0) * (Number(p.qty) || 1); }
function shopWeek(s = today()) {
  const from = weekStart(s), to = weekEnd(s);
  const inWeek = p => p.orderedAt && ymd(p.orderedAt) >= from && ymd(p.orderedAt) <= to;
  const bought = db.purchases.filter(p => ['ordered', 'received'].includes(p.status) && inWeek(p));
  const open = db.purchases.filter(p => ['pending', 'owner', 'approved'].includes(p.status));
  const budget = Number(db.settings.weeklyBudget) || 0;
  const spent = bought.reduce((a, p) => a + purTotal(p), 0);
  const pending = open.reduce((a, p) => a + purTotal(p), 0);
  return { from, to, budget, spent, pending, left: budget - spent - pending, bought, open };
}
// How many times this item was ordered in the last 30 days
function repeatCount(item, notId) {
  const k = norm(item); if (!k) return 0;
  const since = Date.now() - 30 * 86400000;
  return db.purchases.filter(p => p.id !== notId && norm(p.item) === k && p.orderedAt && p.orderedAt >= since).length;
}
function pendingApprovals() { return db.approvals.filter(a => a.status === 'pending' || (a.status === 'later' && a.laterDate && a.laterDate <= today())); }
function billState(b) {
  if (b.paidAt) return { label: 'Paid ' + fmtWhen(b.paidAt), cls: 'gry' };
  const d = daysUntil(b.due);
  if (d < 0) return { label: (-d) + (d === -1 ? ' day' : ' days') + ' late', cls: 'red' };
  if (d === 0) return { label: 'Due today', cls: 'red' };
  if (d <= 7) return { label: fmtDay(b.due), cls: 'amb' };
  return { label: fmtDay(b.due), cls: 'gry' };
}

// ---------- Router ----------
const views = {};
function route() { return (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'dashboard'; }
function render() {
  if (!db) return;
  const r = route();
  const v = views[r] || views.soon;
  drawNav(r);
  const now = new Date();
  const h = now.getHours();
  document.getElementById('helloBig').textContent = h < 12 ? 'Good morning!' : h < 17 ? 'Good afternoon!' : 'Good evening!';
  document.getElementById('helloSub').textContent = 'Office Manager Dashboard • ' + now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  document.getElementById('main').innerHTML = (db.purchases.concat(db.bills, db.equipment).some(x => x.sample) && r === 'dashboard'
    ? `<div class="sample-bar">🧪 This is practice data so you can see how it works. <button class="btn sm" data-action="clearSamples">Remove practice data</button></div>` : '') + v.html(r);
  v.after?.();
  document.body.classList.remove('menu-open');
}
window.addEventListener('hashchange', render);

function cardHead(ico, title, extra = '', link = '') {
  return `<div class="card-head"><span class="card-ico">${ico}</span><h2>${title}</h2>${extra}${link ? `<a class="view-all" href="${link}">View all →</a>` : ''}</div>`;
}

// ---------- Dashboard ----------
views.dashboard = {
  html() {
    return `<div class="grid g-top">${budgetCard()}${approvalsCard()}</div>
      <div class="grid g-mid">${workdayCard()}${queueCard()}</div>
      <div class="grid g-bot">${billsCard()}${shopCard()}${dispatchCard()}${coverageCard()}</div>`;
  }
};
function budgetCard() {
  const w = shopWeek();
  const over = w.left < 0;
  const pct = n => w.budget ? Math.round(n / w.budget * 100) : 0;
  const total = Math.max(w.budget, w.spent + w.pending) || 1;
  const seg = (n, cls, txt) => n > 0 ? `<div class="${cls}" style="width:${n / total * 100}%" title="${esc(txt)}">${esc(txt)}</div>` : '';
  return `<div class="card">${cardHead('🛒', 'Weekly Shop Budget', `<span class="week-lbl">📅 Fri, ${fmtDay(w.from)} – Thu, ${fmtDay(w.to)}</span>`)}
    <div class="bud-boxes">
      <div class="bud-box"><div class="lbl">Weekly budget</div><div class="num">${money(w.budget)}</div></div>
      <div class="bud-box b-buy"><div class="lbl">Purchased</div><div class="num">${money(w.spent)}</div></div>
      <div class="bud-box b-pen"><div class="lbl">Pending</div><div class="num">${money(w.pending)}</div></div>
      <div class="bud-box ${over ? 'b-over' : 'b-left'}"><div class="lbl">${over ? 'Over budget after pending' : 'Remaining after pending'}</div><div class="num">${money(Math.abs(w.left))}</div></div>
    </div>
    <div class="bud-bar">${seg(w.spent, 'bb-buy', `${money(w.spent)} purchased (${pct(w.spent)}%)`)}${seg(w.pending, 'bb-pen', `${money(w.pending)} pending (${pct(w.pending)}%)`)}${over ? '' : seg(w.left, 'bb-left', `${money(w.left)} left (${pct(w.left)}%)`)}</div>
    ${over ? `<div class="alert red" style="margin:10px 0 0">Buying everything pending puts this week ${money(-w.left)} over the ${money(w.budget)} budget.</div>` : ''}
  </div>`;
}
function approvalsCard() {
  const list = pendingApprovals();
  return `<div class="card">${cardHead('🛡️', 'Owner Approval', list.length ? `<span class="pill amb">${list.length} pending</span>` : '', '#/approvals')}
    <div class="rows">${list.slice(0, 3).map(a => `<div class="row">
      <div class="row-main"><div class="row-t">${esc(a.title)}</div><div class="row-s">${esc(a.detail || '')}${a.amount ? ' • ' + money(a.amount) : ''} • waiting ${daysAgo(a.askedAt)}</div></div>
      <span class="pill gry">${esc(a.kind)}</span>
      <button class="btn sm" data-action="apReview" data-id="${a.id}">Review</button>
      <button class="btn sm ok" data-action="apApprove" data-id="${a.id}">Approve</button></div>`).join('') || '<div class="empty">Nothing waiting on the owner.</div>'}</div>
    <button class="btn sm" style="margin-top:8px" data-action="apNew">+ Ask the owner</button></div>`;
}
function workdayToday() {
  const d = db.workdayDays[today()] ||= { checked: {}, extra: [] };
  const items = db.settings.workday.concat(d.extra);
  return { d, items, done: items.filter(i => d.checked[i.id]).length };
}
function workdayList(items, d) {
  return items.map(i => `<label class="wd-item ${d.checked[i.id] ? 'done' : ''}"><input type="checkbox" data-wd="${i.id}" ${d.checked[i.id] ? 'checked' : ''}><span>${esc(i.text)}</span></label>`).join('');
}
function workdayCard() {
  const { d, items, done } = workdayToday();
  return `<div class="card">${cardHead('☑️', 'My Workday', `<span class="pill grn" style="margin-left:auto">${done} of ${items.length}</span>`)}
    <div>${workdayList(items, d)}</div>
    <a class="btn wide" style="display:block;text-align:center;margin-top:10px;text-decoration:none;background:var(--brand-soft);border-color:var(--brand-soft);color:var(--brand-dark)" href="#/workday">Open My Workday →</a></div>`;
}
function purRow(p, full) {
  const st = PUR_STATUS[p.status];
  const rep = repeatCount(p.item, p.id);
  return `<tr class="click" data-action="purOpen" data-id="${p.id}">
    <td><b>${esc(p.item)}</b>${p.qty > 1 ? ` <span class="muted">× ${p.qty}</span>` : ''}${rep >= 2 ? `<div class="small" style="color:var(--warn)">🔁 Ordered ${rep}× in 30 days</div>` : ''}${full && p.equipment ? `<div class="small muted">For: ${esc(p.equipment)}</div>` : ''}</td>
    <td class="ph-hide">${esc(p.supplier || '')}</td>
    <td class="ph-hide">${esc(p.partNo || '')}</td>
    <td class="ph-hide">${p.photo ? `<img class="thumb" src="${p.photo}">` : '<span class="thumb">📦</span>'}</td>
    <td>${money(purTotal(p))}</td>
    <td><span class="pill ${st.cls}">${st.label}</span></td>
    ${full ? `<td class="ph-hide small muted">${esc(p.by || '')} · ${fmtWhen(p.at)}</td>` : ''}</tr>`;
}
function queueCard() {
  const list = db.purchases.filter(p => !['received', 'declined'].includes(p.status)).sort((a, b) => b.at - a.at);
  return `<div class="card">${cardHead('📋', 'Purchase Request Queue', `<span class="pill grn" style="margin-left:auto">${list.length} requests</span>`, '#/purchasing')}
    ${list.length ? `<table class="tbl"><tr><th>Request</th><th class="ph-hide">Supplier</th><th class="ph-hide">Part number</th><th class="ph-hide">Photo</th><th>Price</th><th>Status</th></tr>
    ${list.slice(0, 5).map(p => purRow(p)).join('')}</table>` : '<div class="empty">No open requests.</div>'}
    <button class="btn sm pri" style="margin-top:10px" data-action="purNew">+ New purchase request</button></div>`;
}
function billsCard() {
  const open = db.bills.filter(b => !b.paidAt).sort((a, b) => a.due.localeCompare(b.due));
  const soon = open.filter(b => daysUntil(b.due) <= 7).length;
  return `<div class="card">${cardHead('🧾', 'Bills & Payments', soon ? `<span class="pill amb">${soon} due soon</span>` : '', '#/bills')}
    <table class="tbl"><tr><th>Bill / vendor</th><th>Amount</th><th>Due</th></tr>
    ${open.slice(0, 4).map(b => { const s = billState(b); return `<tr class="click" data-action="billOpen" data-id="${b.id}"><td><b>${esc(b.vendor)}</b><div class="small muted">${esc(b.what || '')}</div></td><td>${money(b.amount)}</td><td><span class="pill ${s.cls}">${s.label}</span></td></tr>`; }).join('') || '<tr><td colspan="3" class="empty">No unpaid bills.</td></tr>'}</table></div>`;
}
function shopCard() {
  const list = db.equipment.filter(e => e.status !== 'working').sort((a, b) => (a.status === 'repair' ? -1 : 0) - (b.status === 'repair' ? -1 : 0));
  const rep = db.equipment.filter(e => e.status === 'repair').length;
  return `<div class="card">${cardHead('🔧', 'Shop & Equipment', rep ? `<span class="pill red">${rep} repair alert${rep > 1 ? 's' : ''}</span>` : '', '#/shop')}
    <div class="rows">${list.slice(0, 3).map(e => `<div class="row click" data-action="eqOpen" data-id="${e.id}">
      ${e.photo ? `<img class="thumb thumb-lg" src="${e.photo}">` : '<span class="thumb thumb-lg">🛠️</span>'}
      <div class="row-main"><div class="row-t">${esc(e.name)}</div><div class="row-s">${esc(e.note || '')}</div>
      <span class="pill ${EQUIP_STATUS[e.status].cls}">${EQUIP_STATUS[e.status].label}</span></div><span class="muted">›</span></div>`).join('') || '<div class="empty">All equipment working.</div>'}</div></div>`;
}
function dispatchCard() {
  const d = db.dispatch.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  return `<div class="card">${cardHead('🌙', 'Dispatch Updates', d && !d.handedOff ? '<span class="pill amb">Sunday handoff</span>' : '', '#/dispatch')}
    ${d ? `<div style="font-weight:700;margin-bottom:6px">📅 ${dayOf(d.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} – After Hours Dispatch</div>
    <ul style="margin:0;padding-left:18px;line-height:1.5">${d.lines.slice(0, 4).map(l => `<li class="small">${l.time ? `<b>${esc(l.time)}</b> – ` : ''}${esc(l.text)}</li>`).join('')}</ul>
    <div style="display:flex;align-items:center;margin-top:10px;gap:8px"><span class="small muted">Handoff to dispatch:</span>
    ${d.handedOff ? '<span class="pill grn">✓ Handed off</span>' : `<button class="btn sm ok" data-action="dpHandoff" data-id="${d.id}">Mark handed off</button>`}</div>`
    : '<div class="empty">No after-hours notes yet.</div>'}
    <button class="btn sm" style="margin-top:8px" data-action="dpNew">+ Add after-hours call</button></div>`;
}
function coverageCard() {
  const mine = db.timeOff.filter(t => t.to >= today()).sort((a, b) => a.from.localeCompare(b.from))[0];
  const b = db.settings.backups;
  return `<div class="card">${cardHead('🏖️', 'Coverage & Time Off', mine ? '<span class="pill amb">Upcoming</span>' : '', '#/calendar')}
    ${mine ? `<div class="row"><span style="font-size:22px">✈️</span><div class="row-main"><div class="row-t">${esc(mine.who || 'My time off')}</div><div class="row-s">${fmtDay(mine.from)} – ${fmtDay(mine.to, true)}</div></div></div>` : '<div class="small muted">No time off planned.</div>'}
    <div style="font-weight:700;margin:10px 0 4px">Assigned backups</div>
    ${BACKUP_ROLES.map(([k, l]) => `<div class="small" style="display:flex;gap:6px;padding:2px 0"><span class="muted" style="min-width:110px">${l}:</span><b>${esc(b[k] || '—')}</b></div>`).join('')}</div>`;
}

// ---------- My Workday ----------
views.workday = {
  html() {
    const { d, items, done } = workdayToday();
    return `<div class="page-head"><h1>☑️ My Workday</h1><span class="pill grn">${done} of ${items.length} done</span></div>
      <div class="grid g-mid"><div class="card">${cardHead('📝', 'Today')}${workdayList(items, d)}
        <div style="display:flex;gap:8px;margin-top:12px"><input id="wdAdd" placeholder="Add something for today only" style="flex:1;padding:8px;border:1px solid #cbd5e1;border-radius:8px"><button class="btn pri" data-action="wdAdd">+ Add</button></div>
        <div class="small muted" style="margin-top:10px">The everyday list is changed in ⚙️ Management. Ticks save as you go; tomorrow starts fresh.</div></div>
      <div class="card">${cardHead('⏭️', 'Still open from earlier days')}${carryOver() || '<div class="empty">Nothing left over. Nice.</div>'}</div></div>`;
  }
};
function carryOver() {
  const out = [];
  for (let i = 1; i <= 7; i++) {
    const day = addDays(today(), -i), d = db.workdayDays[day];
    if (!d) continue;
    d.extra.filter(x => !d.checked[x.id]).forEach(x => out.push(`<div class="row"><div class="row-main"><div class="row-t">${esc(x.text)}</div><div class="row-s">From ${fmtDay(day)}</div></div><button class="btn sm" data-action="wdMove" data-day="${day}" data-id="${x.id}">Move to today</button></div>`));
  }
  return out.join('');
}

// ---------- Purchasing ----------
let purTab = 'open';
views.purchasing = {
  html() {
    const w = shopWeek();
    const tabs = [['open', 'Open'], ['ordered', 'Ordered'], ['received', 'Received'], ['all', 'All']];
    const f = { open: p => ['pending', 'owner', 'approved'].includes(p.status), ordered: p => p.status === 'ordered', received: p => p.status === 'received', all: () => true }[purTab];
    const list = db.purchases.filter(f).sort((a, b) => b.at - a.at);
    return `<div class="page-head"><h1>🛒 Purchasing</h1><button class="btn pri" data-action="purNew">+ New purchase request</button></div>
      ${budgetCard()}
      <div class="card" style="margin-top:16px"><div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${purTab === k ? 'on' : ''}" data-action="purTab" data-k="${k}">${l}</button>`).join('')}</div>
      ${list.length ? `<table class="tbl"><tr><th>Request</th><th class="ph-hide">Supplier</th><th class="ph-hide">Part number</th><th class="ph-hide">Photo</th><th>Price</th><th>Status</th><th class="ph-hide">Asked by</th></tr>${list.map(p => purRow(p, true)).join('')}</table>` : '<div class="empty">Nothing here.</div>'}</div>
      <div class="card" style="margin-top:16px">${cardHead('🔁', 'Ordered again and again (last 30 days)')}${repeatsHtml()}</div>
      <div class="small muted" style="margin-top:8px">Budget week: ${fmtDay(w.from)} (Fri) – ${fmtDay(w.to)} (Thu). Purchases count in the week they were ordered.</div>`;
  }
};
function repeatsHtml() {
  const since = Date.now() - 30 * 86400000, m = new Map();
  db.purchases.filter(p => p.orderedAt && p.orderedAt >= since).forEach(p => {
    const k = norm(p.item); const r = m.get(k) || { item: p.item, n: 0, qty: 0, spent: 0 };
    r.n++; r.qty += Number(p.qty) || 1; r.spent += purTotal(p); m.set(k, r);
  });
  const rows = [...m.values()].filter(r => r.n >= 2).sort((a, b) => b.n - a.n);
  return rows.length ? `<table class="tbl"><tr><th>Item</th><th>Times ordered</th><th>Qty bought</th><th>Spent</th></tr>${rows.map(r => `<tr><td><b>${esc(r.item)}</b></td><td>${r.n}</td><td>${r.qty}</td><td>${money(r.spent)}</td></tr>`).join('')}</table>
    <div class="alert amb" style="margin:10px 0 0">Check what's already in the shop before ordering these again.</div>` : '<div class="empty">No repeat orders.</div>';
}
function purFields() {
  return [
    { name: 'item', label: 'What is needed', required: true, list: [...new Set(db.purchases.map(p => p.item))] },
    { name: 'qty', label: 'How many', type: 'number', value: 1, half: true },
    { name: 'price', label: 'Price each', type: 'money', half: true },
    { name: 'supplier', label: 'Supplier', half: true, list: [...new Set(db.purchases.map(p => p.supplier).filter(Boolean))] },
    { name: 'partNo', label: 'Part number', half: true },
    { name: 'link', label: 'Website link', hint: 'Paste the page where it can be bought.' },
    { name: 'equipment', label: 'For which equipment', list: db.equipment.map(e => e.name), hint: 'So the supplier info is saved with that machine.' },
    { name: 'by', label: 'Asked by', list: ['Shop', 'Office Manager', 'Owner'] },
    { name: 'note', label: 'Notes', type: 'textarea' },
    { name: 'photo', label: 'Picture', type: 'photo' }
  ];
}
async function purNew() {
  const v = await form('New purchase request', purFields(), { by: 'Shop', qty: 1 });
  if (!v) return;
  v.qty = Number(v.qty) || 1;
  const rep = repeatCount(v.item);
  const w = shopWeek();
  const lines = [`<b>${esc(v.item)}</b>${v.qty > 1 ? ' × ' + v.qty : ''} · ${money((v.price || 0) * v.qty)}`];
  if (rep) lines.push(`🔁 <b>Ordered ${rep} time${rep > 1 ? 's' : ''} in the last 30 days.</b> Check the shop before ordering more.`);
  if (w.left - (v.price || 0) * v.qty < 0) lines.push(`⚠️ This puts this week over the ${money(w.budget)} budget.`);
  if (!(await sure('Add this purchase request?', lines))) return;
  db.purchases.push({ id: uid(), ...v, status: 'pending', at: Date.now() });
  await saveDb(); render(); toast('✓ Request added');
}
async function purOpen(id) {
  const p = byId(db.purchases, id); if (!p) return;
  const st = PUR_STATUS[p.status];
  const rep = repeatCount(p.item, p.id);
  const btns = [{ label: '✏️ Edit', value: 'edit' }];
  if (p.status === 'pending') btns.push({ label: 'Send to owner', value: 'owner' }, { label: '✗ Decline', cls: 'red', value: 'decline' }, { label: '✓ Approve', cls: 'ok', value: 'approve' });
  if (p.status === 'approved') btns.push({ label: '🛒 Mark ordered', cls: 'pri', value: 'order' });
  if (p.status === 'ordered') btns.push({ label: '📦 Mark received', cls: 'pri', value: 'receive' });
  const html = docPreviewHtml(p) + `<div style="display:flex;gap:12px">${p.photo ? `<img src="${p.photo}" style="width:120px;border-radius:10px">` : ''}<div>
    <div style="font-size:18px;font-weight:700">${esc(p.item)}${p.qty > 1 ? ' × ' + p.qty : ''}</div>
    <div>${money(purTotal(p))}${p.qty > 1 ? ` <span class="muted">(${money(p.price)} each)</span>` : ''} · <span class="pill ${st.cls}">${st.label}</span></div>
    ${p.supplier ? `<div>Supplier: <b>${esc(p.supplier)}</b>${p.partNo ? ' · Part # ' + esc(p.partNo) : ''}</div>` : ''}
    ${p.link ? `<div><a href="${esc(p.link)}" target="_blank" rel="noopener">Open the website ↗</a></div>` : ''}
    ${p.equipment ? `<div>For: ${esc(p.equipment)}</div>` : ''}
    <div class="small muted">Asked by ${esc(p.by || '—')} on ${fmtWhen(p.at)}${p.orderedAt ? ' · ordered ' + fmtWhen(p.orderedAt) : ''}${p.receivedAt ? ' · received ' + fmtWhen(p.receivedAt) : ''}</div>
    ${p.note ? `<div style="margin-top:6px">${esc(p.note)}</div>` : ''}
    ${rep ? `<div class="alert amb" style="margin:8px 0 0">🔁 Ordered ${rep}× in the last 30 days.</div>` : ''}</div></div>`;
  const a = await ask('Purchase request', html, btns.concat([{ label: 'Close', value: null }]));
  if (!a) return;
  if (a === 'edit') {
    const v = await form('Edit purchase request', purFields(), p, { onDelete: async () => { if (await sure('Delete this request?', [esc(p.item)], 'Delete')) { db.purchases = db.purchases.filter(x => x !== p); await saveDb(); render(); return true; } } });
    if (!v) return;
    if (!(await sure('Save these changes?', [esc(v.item)]))) return;
    Object.assign(p, v, { qty: Number(v.qty) || 1 }); await saveDb(); render(); toast('✓ Saved');
    return;
  }
  if (a === 'owner') return apNew({ title: p.item + (p.qty > 1 ? ' × ' + p.qty : ''), kind: 'Purchase', detail: [p.supplier, p.equipment].filter(Boolean).join(' · '), amount: purTotal(p), purchaseId: p.id });
  const words = { approve: ['Approve this purchase?', 'Approve'], decline: ['Decline this purchase?', 'Decline'], order: ['Mark it as ordered?', 'Yes, ordered'], receive: ['Mark it as received?', 'Yes, received'] }[a];
  const extra = a === 'order' && shopWeek().spent + purTotal(p) > shopWeek().budget ? [`⚠️ This week will be over the ${money(shopWeek().budget)} budget.`] : [];
  if (!(await sure(words[0], [`${esc(p.item)} · ${money(purTotal(p))}`, ...extra], words[1]))) return;
  if (a === 'approve') p.status = 'approved';
  if (a === 'decline') p.status = 'declined';
  if (a === 'order') { p.status = 'ordered'; p.orderedAt = Date.now(); }
  if (a === 'receive') { p.status = 'received'; p.receivedAt = Date.now(); }
  await saveDb(); render(); toast('✓ Saved');
}

// ---------- Owner approvals ----------
views.approvals = {
  html() {
    const open = pendingApprovals().sort((a, b) => a.askedAt - b.askedAt);
    const later = db.approvals.filter(a => a.status === 'later' && !(a.laterDate <= today()));
    const done = db.approvals.filter(a => ['approved', 'declined'].includes(a.status)).sort((a, b) => b.answeredAt - a.answeredAt);
    const row = a => `<div class="row"><div class="row-main"><div class="row-t">${esc(a.title)}</div><div class="row-s">${esc(a.kind)}${a.amount ? ' · ' + money(a.amount) : ''}${a.detail ? ' · ' + esc(a.detail) : ''} · asked ${fmtWhen(a.askedAt)}</div></div>
      ${a.status === 'pending' || a.status === 'later' ? `<span class="pill ${(Date.now() - a.askedAt) > 2 * 86400000 ? 'red' : 'amb'}">${a.status === 'later' ? 'Pay later ' + fmtDay(a.laterDate) : 'Waiting ' + daysAgo(a.askedAt)}</span><button class="btn sm" data-action="apReview" data-id="${a.id}">Review</button>`
        : `<span class="pill ${a.status === 'approved' ? 'grn' : 'red'}">${a.status === 'approved' ? 'Approved' : 'Declined'} ${fmtWhen(a.answeredAt)}</span>`}</div>`;
    return `<div class="page-head"><h1>✅ Owner Approvals</h1><button class="btn pri" data-action="apNew">+ Ask the owner</button></div>
      <div class="card">${cardHead('⏳', 'Waiting on the owner')}${open.map(row).join('') || '<div class="empty">Nothing waiting.</div>'}</div>
      ${later.length ? `<div class="card" style="margin-top:16px">${cardHead('🕒', 'Pay later')}${later.map(row).join('')}</div>` : ''}
      <div class="card" style="margin-top:16px">${cardHead('📜', 'Answered')}${done.slice(0, 30).map(row).join('') || '<div class="empty">No answers yet.</div>'}</div>
      <div class="small muted" style="margin-top:8px">Every answer is kept with the date, so nobody has to ask twice.</div>`;
  }
};
async function apNew(pre = {}) {
  const v = await form('Ask the owner', [
    { name: 'title', label: 'What needs approval', required: true },
    { name: 'kind', label: 'Kind', type: 'select', options: ['Purchase', 'Bill', 'Equipment', 'Insurance', 'Other'], half: true },
    { name: 'amount', label: 'Amount', type: 'money', half: true },
    { name: 'detail', label: 'Details', type: 'textarea' }
  ], pre);
  if (!v) return;
  if (!(await sure('Send this to the owner?', [`<b>${esc(v.title)}</b>${v.amount ? ' · ' + money(v.amount) : ''}`], 'Yes, send'))) return;
  db.approvals.push({ id: uid(), ...v, purchaseId: pre.purchaseId || '', billId: pre.billId || '', status: 'pending', askedAt: Date.now() });
  if (pre.purchaseId) { const p = byId(db.purchases, pre.purchaseId); if (p) p.status = 'owner'; }
  await saveDb(); render(); toast('✓ Sent to the owner');
}
async function apAnswer(a, how) {
  const words = { approved: ['Approve this?', 'Approve'], declined: ['Decline this?', 'Decline'] }[how];
  if (!(await sure(words[0], [`<b>${esc(a.title)}</b>${a.amount ? ' · ' + money(a.amount) : ''}`], words[1]))) return;
  a.status = how; a.answeredAt = Date.now();
  const p = a.purchaseId && byId(db.purchases, a.purchaseId);
  if (p && p.status === 'owner') p.status = how === 'approved' ? 'approved' : 'declined';
  await saveDb(); render(); toast(how === 'approved' ? '✓ Approved' : 'Declined');
}
async function apReview(id) {
  const a = byId(db.approvals, id); if (!a) return;
  const r = await ask(a.title, `<div>${esc(a.kind)}${a.amount ? ' · <b>' + money(a.amount) + '</b>' : ''}</div>${a.detail ? `<p>${esc(a.detail)}</p>` : ''}<div class="small muted">Asked ${fmtWhen(a.askedAt)} · waiting ${daysAgo(a.askedAt)}</div>`,
    [{ label: 'Close', value: null }, { label: '🕒 Pay later', value: 'later' }, { label: '✗ Decline', cls: 'red', value: 'declined' }, { label: '✓ Approve', cls: 'ok', value: 'approved' }]);
  if (!r) return;
  if (r === 'later') {
    const v = await form('Pay later', [{ name: 'laterDate', label: 'Remind us on', type: 'date', required: true, value: addDays(today(), 7) }]);
    if (!v) return;
    a.status = 'later'; a.laterDate = v.laterDate; await saveDb(); render(); toast('🕒 Will come back ' + fmtDay(v.laterDate));
    return;
  }
  apAnswer(a, r);
}

// ---------- Bills ----------
views.bills = {
  html() {
    const open = db.bills.filter(b => !b.paidAt).sort((a, b) => a.due.localeCompare(b.due));
    const sum = f => open.filter(f).reduce((a, b) => a + (Number(b.amount) || 0), 0);
    const late30 = open.filter(b => daysUntil(b.due) <= -23);
    const paid = db.bills.filter(b => b.paidAt).sort((a, b) => b.paidAt - a.paidAt);
    return `<div class="page-head"><h1>🧾 Bills & Payments</h1><button class="btn pri" data-action="billNew">+ Add bill</button></div>
      ${late30.length ? `<div class="alert red">⚠️ ${late30.map(b => esc(b.vendor)).join(', ')} ${late30.length > 1 ? 'are' : 'is'} close to 30 days overdue.</div>` : ''}
      <div class="bud-boxes" style="margin-bottom:16px">
        <div class="bud-box b-over"><div class="lbl">Overdue</div><div class="num">${money(sum(b => daysUntil(b.due) < 0))}</div></div>
        <div class="bud-box b-pen"><div class="lbl">Due this week</div><div class="num">${money(sum(b => daysUntil(b.due) >= 0 && daysUntil(b.due) <= 7))}</div></div>
        <div class="bud-box b-buy"><div class="lbl">Due next week</div><div class="num">${money(sum(b => daysUntil(b.due) > 7 && daysUntil(b.due) <= 14))}</div></div>
        <div class="bud-box"><div class="lbl">All unpaid</div><div class="num">${money(sum(() => true))}</div></div></div>
      <div class="card">${cardHead('📌', 'Unpaid')}<table class="tbl"><tr><th>Bill / vendor</th><th>Amount</th><th>Due</th><th class="ph-hide">Repeats</th><th></th></tr>
        ${open.map(b => { const s = billState(b); return `<tr class="click" data-action="billOpen" data-id="${b.id}"><td><b>${esc(b.vendor)}</b><div class="small muted">${esc(b.what || '')}</div></td><td>${money(b.amount)}</td><td><span class="pill ${s.cls}">${s.label}</span></td><td class="ph-hide small muted">${b.repeat === 'monthly' ? 'Monthly' : ''}</td><td><button class="btn sm ok" data-action="billPay" data-id="${b.id}">Mark paid</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">No unpaid bills.</td></tr>'}</table></div>
      <div class="card" style="margin-top:16px">${cardHead('✓', 'Paid')}${paid.slice(0, 20).map(b => `<div class="row"><div class="row-main"><div class="row-t">${esc(b.vendor)} · ${money(b.amount)}</div><div class="row-s">Due ${fmtDay(b.due)} · paid ${fmtWhen(b.paidAt)}${b.paidHow ? ' · ' + esc(b.paidHow) : ''}</div></div></div>`).join('') || '<div class="empty">Nothing paid yet.</div>'}</div>`;
  }
};
function billFields() {
  return [
    { name: 'vendor', label: 'Vendor', required: true, list: [...new Set(db.bills.map(b => b.vendor))] },
    { name: 'what', label: 'What it is for' },
    { name: 'amount', label: 'Amount', type: 'money', required: true, half: true },
    { name: 'due', label: 'Due date', type: 'date', required: true, half: true },
    { name: 'repeat', label: 'Repeats', type: 'select', options: [['none', 'No'], ['monthly', 'Every month']] },
    { name: 'note', label: 'Notes', type: 'textarea' }
  ];
}
async function billNew() {
  const v = await form('Add bill', billFields(), { repeat: 'none' });
  if (!v) return;
  if (!(await sure('Add this bill?', [`<b>${esc(v.vendor)}</b> · ${money(v.amount)} · due ${fmtDay(v.due, true)}`]))) return;
  db.bills.push({ id: uid(), ...v, at: Date.now() }); await saveDb(); render(); toast('✓ Bill added');
}
async function billOpen(id) {
  const b = byId(db.bills, id); if (!b) return;
  const v = await form('Bill · ' + b.vendor, billFields(), b, { top: docPreviewHtml(b), onDelete: async () => { if (await sure('Delete this bill?', [esc(b.vendor) + ' · ' + money(b.amount)], 'Delete')) { db.bills = db.bills.filter(x => x !== b); await saveDb(); render(); return true; } } });
  if (!v) return;
  if (!(await sure('Save these changes?', [`${esc(v.vendor)} · ${money(v.amount)} · due ${fmtDay(v.due, true)}`]))) return;
  Object.assign(b, v); await saveDb(); render(); toast('✓ Saved');
}
async function billPay(id) {
  const b = byId(db.bills, id); if (!b) return;
  const v = await form('Mark paid · ' + b.vendor, [
    { name: 'paidHow', label: 'How it was paid', list: ['Card', 'Check', 'ACH', 'Online'] },
    { name: 'paidNote', label: 'Confirmation # or note' }
  ], {}, { saveLabel: 'Mark paid' });
  if (!v) return;
  const lines = [`${esc(b.vendor)} · ${money(b.amount)}`];
  if (b.repeat === 'monthly') lines.push(`Next month's bill will be added (due ${fmtDay(nextMonth(b.due), true)}).`);
  if (!(await sure('Mark this bill paid?', lines, 'Yes, paid'))) return;
  Object.assign(b, v, { paidAt: Date.now() });
  if (b.repeat === 'monthly') db.bills.push({ id: uid(), vendor: b.vendor, what: b.what, amount: b.amount, due: nextMonth(b.due), repeat: 'monthly', note: b.note, at: Date.now() });
  await saveDb(); render(); toast('✓ Paid');
}
function nextMonth(s) { const d = dayOf(s); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + 1); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return ymd(d); }

// ---------- Shop & equipment ----------
views.shop = {
  html() {
    const kinds = {};
    db.equipment.forEach(e => { const k = kinds[e.kind || 'Other'] ||= { total: 0, ok: 0 }; k.total++; if (['working', 'service'].includes(e.status)) k.ok++; });
    const list = db.equipment.slice().sort((a, b) => Object.keys(EQUIP_STATUS).indexOf(b.status) - Object.keys(EQUIP_STATUS).indexOf(a.status));
    return `<div class="page-head"><h1>🔧 Shop & Equipment</h1><button class="btn pri" data-action="eqNew">+ Add equipment</button></div>
      <div class="grid g-bot">${Object.entries(kinds).map(([k, c]) => `<div class="card"><div class="muted small">${esc(k)}</div><div style="font-size:24px;font-weight:800">${c.ok} <span class="muted" style="font-size:14px">of ${c.total} working</span></div>${c.total - c.ok ? `<span class="pill red">${c.total - c.ok} not working</span>` : '<span class="pill grn">All working</span>'}</div>`).join('') || '<div class="card empty">Add your equipment to see counts.</div>'}</div>
      <div class="card">${cardHead('🛠️', 'All equipment')}<div class="rows">${list.map(e => `<div class="row click" data-action="eqOpen" data-id="${e.id}">${e.photo ? `<img class="thumb" src="${e.photo}">` : '<span class="thumb">🛠️</span>'}<div class="row-main"><div class="row-t">${esc(e.name)}</div><div class="row-s">${esc([e.kind, e.brand, e.model, e.serial && 'S/N ' + e.serial].filter(Boolean).join(' · '))}${e.note ? ' — ' + esc(e.note) : ''}</div></div><span class="pill ${EQUIP_STATUS[e.status].cls}">${EQUIP_STATUS[e.status].label}</span></div>`).join('') || '<div class="empty">No equipment yet.</div>'}</div></div>
      <div class="small muted" style="margin-top:8px">Coming next: how many machines are out on jobs (read from the restoration CRM) and a minimum count per type.</div>`;
  }
};
function eqFields() {
  return [
    { name: 'name', label: 'Name', required: true, hint: 'e.g. Dehu #12 or Pressure washer #3' },
    { name: 'kind', label: 'Type', list: ['Air mover', 'Dehumidifier', 'Air scrubber', 'Extractor', 'Generator', 'Pressure washer', 'Trailer', 'Other'], half: true },
    { name: 'status', label: 'Condition', type: 'select', options: Object.entries(EQUIP_STATUS).map(([k, s]) => [k, s.label]), half: true },
    { name: 'brand', label: 'Brand', half: true },
    { name: 'model', label: 'Model', half: true },
    { name: 'serial', label: 'Serial number' },
    { name: 'note', label: 'What is wrong / notes' },
    { name: 'photo', label: 'Picture (the label helps when ordering parts)', type: 'photo' }
  ];
}
async function eqNew() {
  const v = await form('Add equipment', eqFields(), { status: 'working' });
  if (!v) return;
  if (!(await sure('Add this equipment?', [esc(v.name) + ' · ' + EQUIP_STATUS[v.status].label]))) return;
  db.equipment.push({ id: uid(), ...v, at: Date.now() }); await saveDb(); render(); toast('✓ Added');
}
async function eqOpen(id) {
  const e = byId(db.equipment, id); if (!e) return;
  const repairs = db.purchases.filter(p => norm(p.equipment) === norm(e.name) && p.orderedAt);
  const top = repairs.length ? `<div class="alert amb">Parts ordered for this machine: ${repairs.length} · ${money(repairs.reduce((a, p) => a + purTotal(p), 0))}</div>` : '';
  const v = await form(e.name, eqFields(), e, { top, onDelete: async () => { if (await sure('Delete this equipment?', [esc(e.name)], 'Delete')) { db.equipment = db.equipment.filter(x => x !== e); await saveDb(); render(); return true; } } });
  if (!v) return;
  if (!(await sure('Save these changes?', [esc(v.name) + ' · ' + EQUIP_STATUS[v.status].label]))) return;
  Object.assign(e, v); await saveDb(); render(); toast('✓ Saved');
}

// ---------- Dispatch updates (Sunday after hours) ----------
views.dispatch = {
  html() {
    const list = db.dispatch.slice().sort((a, b) => b.date.localeCompare(a.date));
    return `<div class="page-head"><h1>🌙 Dispatch Updates</h1><button class="btn pri" data-action="dpNew">+ Add after-hours call</button></div>
      ${list.map(d => `<div class="card" style="margin-bottom:12px">${cardHead('📅', dayOf(d.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + ' – After Hours', d.handedOff ? `<span class="pill grn" style="margin-left:auto">✓ Handed off ${d.handedAt ? fmtWhen(d.handedAt) : ''}</span>` : `<button class="btn sm ok" style="margin-left:auto" data-action="dpHandoff" data-id="${d.id}">Mark handed off</button>`)}
        ${d.lines.map((l, i) => `<div class="row"><div class="row-main"><div class="row-t">${l.time ? esc(l.time) + ' – ' : ''}${esc(l.text)}</div></div><button class="btn sm" data-action="dpDel" data-id="${d.id}" data-i="${i}">✕</button></div>`).join('')}</div>`).join('') || '<div class="card empty">No after-hours calls logged yet.</div>'}`;
  }
};
async function dpNew() {
  const last = new Date(); last.setDate(last.getDate() - ((last.getDay() + 7) % 7));
  const v = await form('After-hours call', [
    { name: 'date', label: 'Day', type: 'date', required: true, value: ymd(last), half: true },
    { name: 'time', label: 'Time', type: 'time', half: true },
    { name: 'text', label: 'What came in / what needs to happen', type: 'textarea', required: true, hint: 'e.g. Water leak, Acct #7821, scheduled Mon 8 AM.' }
  ]);
  if (!v) return;
  if (!(await sure('Save this call?', [esc(v.text)]))) return;
  let d = db.dispatch.find(x => x.date === v.date);
  if (!d) { d = { id: uid(), date: v.date, lines: [], handedOff: false }; db.dispatch.push(d); }
  const t = v.time ? new Date('2000-01-01T' + v.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  d.lines.push({ time: t, text: v.text }); d.handedOff = false;
  await saveDb(); render(); toast('✓ Saved');
}

// ---------- Insurance & licenses ----------
views.insurance = {
  html() {
    const list = db.renewals.slice().sort((a, b) => a.expires.localeCompare(b.expires));
    const st = r => { const d = daysUntil(r.expires); return d < 0 ? ['red', 'Expired'] : d <= 30 ? ['red', d + ' days left'] : d <= 60 ? ['amb', d + ' days left'] : ['grn', d + ' days left']; };
    return `<div class="page-head"><h1>🛡️ Insurance & Licenses</h1><button class="btn pri" data-action="rnNew">+ Add</button></div>
      <div class="card">${cardHead('📅', 'Renewals')}<div class="rows">${list.map(r => { const [c, t] = st(r); return `<div class="row click" data-action="rnOpen" data-id="${r.id}"><div class="row-main"><div class="row-t">${esc(r.name)}</div><div class="row-s">Expires ${fmtDay(r.expires, true)}${r.contact ? ' · ' + esc(r.contact) : ''}</div></div><span class="pill ${c}">${t}</span></div>`; }).join('') || '<div class="empty">Add insurance, CCB, licenses, certificates and COIs.</div>'}</div></div>
      <div class="small muted" style="margin-top:8px">Reminders at 90, 60, 30 and 7 days show on the Dashboard bell. Sending them to the shared Outlook calendar comes later.</div>`;
  }
};
function rnFields() {
  return [
    { name: 'name', label: 'What it is', required: true, list: ['General Liability Insurance', 'Workers’ Compensation', 'Vehicle Insurance', 'Contractor License / CCB', 'IICRC Certification', 'COI'] },
    { name: 'expires', label: 'Expires', type: 'date', required: true, half: true },
    { name: 'cost', label: 'Renewal cost', type: 'money', half: true },
    { name: 'contact', label: 'Who to call to renew' },
    { name: 'note', label: 'Notes', type: 'textarea' }
  ];
}
async function rnNew() {
  const v = await form('Add renewal', rnFields()); if (!v) return;
  if (!(await sure('Add this?', [esc(v.name) + ' · expires ' + fmtDay(v.expires, true)]))) return;
  db.renewals.push({ id: uid(), ...v }); await saveDb(); render(); toast('✓ Added');
}
async function rnOpen(id) {
  const r = byId(db.renewals, id); if (!r) return;
  const v = await form(r.name, rnFields(), r, { top: docPreviewHtml(r), onDelete: async () => { if (await sure('Delete this?', [esc(r.name)], 'Delete')) { db.renewals = db.renewals.filter(x => x !== r); await saveDb(); render(); return true; } } });
  if (!v) return;
  if (!(await sure('Save these changes?', [esc(v.name) + ' · expires ' + fmtDay(v.expires, true)]))) return;
  Object.assign(r, v); await saveDb(); render(); toast('✓ Saved');
}

// ---------- Calendar & coverage ----------
views.calendar = {
  html() {
    const list = db.timeOff.slice().sort((a, b) => b.from.localeCompare(a.from));
    return `<div class="page-head"><h1>📅 Calendar & Coverage</h1><button class="btn pri" data-action="toNew">+ Add time off</button><button class="btn" data-action="backups">✏️ Backups</button></div>
      <div class="grid g-top"><div class="card">${cardHead('✈️', 'Time off')}${list.map(t => `<div class="row"><div class="row-main"><div class="row-t">${esc(t.who)}</div><div class="row-s">${fmtDay(t.from)} – ${fmtDay(t.to, true)}${t.note ? ' · ' + esc(t.note) : ''}</div></div>${t.to < today() ? '<span class="pill gry">Past</span>' : '<span class="pill amb">Upcoming</span>'}<button class="btn sm" data-action="toDel" data-id="${t.id}">✕</button></div>`).join('') || '<div class="empty">No time off planned.</div>'}</div>
      ${coverageCard()}</div>`;
  }
};
async function toNew() {
  const v = await form('Add time off', [
    { name: 'who', label: 'Who', required: true, value: 'Office Manager' },
    { name: 'from', label: 'From', type: 'date', required: true, half: true },
    { name: 'to', label: 'To', type: 'date', required: true, half: true },
    { name: 'note', label: 'Notes' }
  ], {}, { check: v => v.to < v.from ? 'The end date is before the start date' : '' });
  if (!v) return;
  if (!(await sure('Add this time off?', [`${esc(v.who)} · ${fmtDay(v.from)} – ${fmtDay(v.to, true)}`]))) return;
  db.timeOff.push({ id: uid(), ...v }); await saveDb(); render(); toast('✓ Added');
}
async function editBackups() {
  const v = await form('Assigned backups', BACKUP_ROLES.map(([k, l]) => ({ name: k, label: l })), db.settings.backups);
  if (!v) return;
  if (!(await sure('Save the backups?', BACKUP_ROLES.map(([k, l]) => `${l}: <b>${esc(v[k] || '—')}</b>`)))) return;
  db.settings.backups = v; await saveDb(); render(); toast('✓ Saved');
}

// ---------- Management ----------
views.management = {
  html() {
    return `<div class="page-head"><h1>⚙️ Management</h1></div>
      <div class="grid g-top"><div class="card">${cardHead('💵', 'Weekly shop budget')}<div style="font-size:24px;font-weight:800">${money(db.settings.weeklyBudget)} <span class="muted" style="font-size:14px">Friday – Thursday</span></div><button class="btn" style="margin-top:8px" data-action="setBudget">✏️ Change</button></div>
      <div class="card">${cardHead('☑️', 'My Workday everyday list')}${db.settings.workday.map((w, i) => `<div class="row"><div class="row-main">${esc(w.text)}</div><button class="btn sm" data-action="wdUp" data-i="${i}">↑</button><button class="btn sm" data-action="wdDel" data-i="${i}">✕</button></div>`).join('')}
        <div style="display:flex;gap:8px;margin-top:10px"><input id="wdTpl" placeholder="Add an everyday item" style="flex:1;padding:8px;border:1px solid #cbd5e1;border-radius:8px"><button class="btn pri" data-action="wdTplAdd">+ Add</button></div></div></div>
      <div class="card">${cardHead('💾', 'Backup')}<div class="btn-row"><button class="btn" data-action="download">⬇ Download backup</button><button class="btn red" data-action="clearSamples">Remove practice data</button></div>
      <div class="small muted" style="margin-top:8px">${window.officeCloud ? 'Everything is also saved in the office database online.' : 'The data is only on this computer until the online database is set up.'} 🔒 No Social Security numbers are stored in this CRM.</div></div>
      ${typeof clCardHtml === 'function' ? clCardHtml() : ''}`;
  }
};

// ---------- Pages not built yet ----------
const SOON = {
  requests: ['Employee Requests', ['One inbox for "Order something", "Need a document", "Question", "Problem"', 'Pick a priority and a day to handle it, so questions wait for your focus time', 'Employees see the answer without walking to your desk']],
  employees: ['Employees', ['Which papers each person has turned in (W-4, I-9, ID, …) — no Social Security numbers', 'New hire packet sent on their first day', 'Who to contact for what']],
  // stats: built (stats.js)
  vehicles: ['Company Vehicles', ['DMV registration dates', 'Insurance and maintenance', 'Reminders before they are due']],
  resources: ['Company Resources', ['One place to find answers: vendors, procedures, forms', 'How to request a COI (for when you are out)']],
  meetings: ['Company Meetings', ['8 AM meeting notes', 'To-dos from the meeting with who owns them, so nothing is forgotten']],
  help: ['Help & Training', ['Short how-tos for each screen']]
};
views.soon = {
  html(r) {
    const [title, items] = SOON[r] || ['Coming soon', []];
    return `<div class="page-head"><h1>${esc(title)}</h1><span class="pill amb">Coming next</span></div>
      <div class="card soon">This part isn't built yet. From the office manager's interview, it will hold:<ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
  }
};

// ---------- Search ----------
function searchAll(q) {
  const k = norm(q); if (k.length < 2) return [];
  // every word must be there; small words like "the" / "where is" don't count
  const STOP = ['the', 'a', 'an', 'is', 'where', 'whats', 'what', 'find', 'for', 'of', 'my', 'our', 'show', 'me', 'look', 'up', 'search'];
  const words = k.split(' ').filter(w => w.length > 1 && !STOP.includes(w));
  if (!words.length) return [];
  const hit = (...xs) => { const s = norm(xs.join(' ')); return words.every(w => s.includes(w)); };
  const out = [];
  PAGES.forEach(([id, ico, name]) => hit(name) && out.push({ t: ico + ' ' + name, w: 'Page', go: '#/' + id }));
  db.purchases.forEach(p => hit(p.item, p.supplier, p.partNo, p.equipment) && out.push({ t: p.item, w: 'Purchasing · ' + PUR_STATUS[p.status].label, act: () => purOpen(p.id) }));
  db.bills.forEach(b => hit(b.vendor, b.what) && out.push({ t: b.vendor + ' · ' + money(b.amount), w: 'Bills · ' + billState(b).label, act: () => billOpen(b.id) }));
  db.equipment.forEach(e => hit(e.name, e.kind, e.brand, e.model, e.serial) && out.push({ t: e.name, w: 'Shop & Equipment · ' + EQUIP_STATUS[e.status].label, act: () => eqOpen(e.id) }));
  db.approvals.forEach(a => hit(a.title, a.detail) && out.push({ t: a.title, w: 'Owner Approvals', go: '#/approvals' }));
  (db.contacts || []).forEach(c => hit(c.name, c.company, c.email, c.phone, c.notes) && out.push({ t: (c.important ? '⭐ ' : '') + c.name + (c.company ? ' · ' + c.company : ''), w: 'Contacts', act: () => ctOpen(c.id) }));
  db.renewals.forEach(r => hit(r.name, r.contact) && out.push({ t: r.name, w: 'Insurance & Licenses · expires ' + fmtDay(r.expires, true), act: () => rnOpen(r.id) }));
  return out.slice(0, 20);
}
function wireSearch() {
  const inp = document.getElementById('search'), box = document.getElementById('searchRes');
  let res = [];
  const draw = () => {
    res = searchAll(inp.value);
    box.innerHTML = res.map((r, i) => `<div class="sr-row" data-i="${i}"><div>${esc(r.t)}</div><div class="sr-where">${esc(r.w)}</div></div>`).join('') || (inp.value.trim().length > 1 ? '<div class="sr-row muted">Nothing found</div>' : '');
    box.classList.toggle('open', !!box.innerHTML);
  };
  const pick = r => { if (!r) return; inp.value = ''; box.classList.remove('open'); if (r.go) location.hash = r.go; else r.act(); };
  inp.addEventListener('input', draw);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') pick(res[0]); if (e.key === 'Escape') { inp.value = ''; box.classList.remove('open'); } });
  box.addEventListener('mousedown', e => { const r = e.target.closest('[data-i]'); if (r) { e.preventDefault(); pick(res[+r.dataset.i]); } });
  inp.addEventListener('blur', () => setTimeout(() => box.classList.remove('open'), 150));
}

// ---------- Clicks ----------
const actions = {
  toggleMenu: () => document.body.classList.toggle('menu-open'),
  purNew, apNew: () => apNew(), billNew, eqNew, dpNew, rnNew, toNew, backups: editBackups,
  purOpen: el => purOpen(el.dataset.id),
  purTab: el => { purTab = el.dataset.k; render(); },
  apReview: el => apReview(el.dataset.id),
  apApprove: el => { const a = byId(db.approvals, el.dataset.id); if (a) apAnswer(a, 'approved'); },
  billOpen: el => billOpen(el.dataset.id),
  billPay: el => billPay(el.dataset.id),
  eqOpen: el => eqOpen(el.dataset.id),
  rnOpen: el => rnOpen(el.dataset.id),
  dpHandoff: async el => {
    const d = byId(db.dispatch, el.dataset.id); if (!d) return;
    if (!(await sure('Mark handed off to dispatch?', [`${d.lines.length} call${d.lines.length > 1 ? 's' : ''} from ${fmtDay(d.date)}`], 'Yes'))) return;
    d.handedOff = true; d.handedAt = Date.now(); await saveDb(); render(); toast('✓ Handed off');
  },
  dpDel: async el => {
    const d = byId(db.dispatch, el.dataset.id); if (!d) return;
    const l = d.lines[+el.dataset.i];
    if (!(await sure('Remove this call?', [esc(l.text)], 'Remove'))) return;
    d.lines.splice(+el.dataset.i, 1); if (!d.lines.length) db.dispatch = db.dispatch.filter(x => x !== d);
    await saveDb(); render();
  },
  toDel: async el => {
    const t = byId(db.timeOff, el.dataset.id); if (!t) return;
    if (!(await sure('Remove this time off?', [`${esc(t.who)} · ${fmtDay(t.from)} – ${fmtDay(t.to)}`], 'Remove'))) return;
    db.timeOff = db.timeOff.filter(x => x !== t); await saveDb(); render();
  },
  wdAdd: async () => {
    const inp = document.getElementById('wdAdd'); const t = inp.value.trim(); if (!t) return inp.focus();
    workdayToday().d.extra.push({ id: uid(), text: t }); await saveDb(); render(); document.getElementById('wdAdd')?.focus();
  },
  wdMove: async el => {
    const d = db.workdayDays[el.dataset.day]; const x = d && byId(d.extra, el.dataset.id); if (!x) return;
    d.extra = d.extra.filter(y => y !== x); workdayToday().d.extra.push(x); await saveDb(); render();
  },
  wdTplAdd: async () => {
    const inp = document.getElementById('wdTpl'); const t = inp.value.trim(); if (!t) return inp.focus();
    if (!(await sure('Add to the everyday list?', [esc(t)]))) return;
    db.settings.workday.push({ id: uid(), text: t }); await saveDb(); render();
  },
  wdDel: async el => {
    const w = db.settings.workday[+el.dataset.i];
    if (!(await sure('Remove from the everyday list?', [esc(w.text)], 'Remove'))) return;
    db.settings.workday.splice(+el.dataset.i, 1); await saveDb(); render();
  },
  wdUp: async el => {
    const i = +el.dataset.i; if (!i) return;
    const l = db.settings.workday; [l[i - 1], l[i]] = [l[i], l[i - 1]]; await saveDb(); render();
  },
  setBudget: async () => {
    const v = await form('Weekly shop budget', [{ name: 'weeklyBudget', label: 'Budget each week (Friday – Thursday)', type: 'money', required: true }], db.settings);
    if (!v) return;
    if (!(await sure('Change the weekly budget?', [`${money(db.settings.weeklyBudget)} → <b>${money(v.weeklyBudget)}</b>`]))) return;
    db.settings.weeklyBudget = v.weeklyBudget; await saveDb(); render(); toast('✓ Saved');
  },
  download: () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' }));
    a.download = 'office-crm-backup-' + today() + '.json'; a.click();
  },
  clearSamples: async () => {
    if (!(await sure('Remove the practice data?', 'Only the made-up examples are removed. Anything you added yourself stays.', 'Remove'))) return;
    ['purchases', 'approvals', 'bills', 'equipment', 'dispatch', 'timeOff', 'renewals'].forEach(k => { db[k] = db[k].filter(x => !x.sample); });
    if (db.settings.backupsSample) { db.settings.backups = {}; delete db.settings.backupsSample; }
    await saveDb(); render(); toast('✓ Practice data removed');
  }
};
document.addEventListener('click', e => {
  if (e.target.closest('a[data-stop]')) return;   // a link inside a clickable card (email / phone) opens itself
  const a = e.target.closest('[data-action]');
  if (a && actions[a.dataset.action]) { e.preventDefault(); actions[a.dataset.action](a); return; }
  const g = e.target.closest('[data-go]');
  if (g) location.hash = g.dataset.go;
  if (document.body.classList.contains('menu-open') && !e.target.closest('.side')) document.body.classList.remove('menu-open');
});
// Workday ticks save instantly
document.addEventListener('change', async e => {
  const id = e.target.dataset?.wd; if (!id) return;
  const { d } = workdayToday();
  if (e.target.checked) d.checked[id] = Date.now(); else delete d.checked[id];
  await saveDb(); render();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'wdAdd') actions.wdAdd();
  if (e.key === 'Enter' && e.target.id === 'wdTpl') actions.wdTplAdd();
});

// ---------- Practice data (removable) ----------
function addSamples() {
  const t = today(), now = Date.now(), ago = n => now - n * 86400000, s = { sample: true };
  const fri = weekStart();
  db.purchases.push(
    { id: uid(), ...s, item: 'Coupling – 2" Camlock', supplier: 'SupplyHouse', partNo: 'CH200', price: 42.5, qty: 1, by: 'Shop', status: 'pending', at: ago(1) },
    { id: uid(), ...s, item: 'Pressure Gauge (0–300 PSI)', supplier: 'Grainger', partNo: '4XM72', price: 36.9, qty: 1, by: 'Shop', status: 'approved', at: ago(2) },
    { id: uid(), ...s, item: 'PVC Ball Valve – 2"', supplier: 'Ferguson', partNo: 'PV200BV', price: 28.75, qty: 1, by: 'Shop', status: 'pending', at: ago(1) },
    { id: uid(), ...s, item: 'Generator – Service Kit', supplier: 'Home Depot Pro', partNo: 'GXK-450', price: 77.99, qty: 1, by: 'Shop', status: 'ordered', at: ago(3), orderedAt: dayOf(fri).getTime() + 36e6 },
    { id: uid(), ...s, item: 'Air filters', supplier: 'Grainger', price: 18, qty: 5, by: 'Shop', status: 'ordered', at: ago(2), orderedAt: dayOf(fri).getTime() + 37e6, equipment: 'Air scrubber #4' },
    { id: uid(), ...s, item: 'Air filters', supplier: 'Grainger', price: 18, qty: 5, by: 'Shop', status: 'received', at: ago(9), orderedAt: ago(9), receivedAt: ago(6) },
    { id: uid(), ...s, item: 'Air filters', supplier: 'Grainger', price: 18, qty: 5, by: 'Shop', status: 'received', at: ago(17), orderedAt: ago(17), receivedAt: ago(14) }
  );
  db.approvals.push(
    { id: uid(), ...s, title: 'Pressure Washer (8 GPM)', kind: 'Purchase', detail: 'Shop equipment', amount: 1250, status: 'pending', askedAt: ago(3) },
    { id: uid(), ...s, title: 'Bulk Fittings Order', kind: 'Purchase', detail: 'Supplies', amount: 432.18, status: 'pending', askedAt: ago(1) },
    { id: uid(), ...s, title: 'Safety Harness Kit (x4)', kind: 'Equipment', detail: 'Equipment', amount: 620, status: 'pending', askedAt: ago(0) }
  );
  db.bills.push(
    { id: uid(), ...s, vendor: 'United Rentals', what: 'Equipment rental', amount: 1240, due: addDays(t, 2), repeat: 'none' },
    { id: uid(), ...s, vendor: 'Pacific Power', what: 'Shop electric', amount: 386.72, due: addDays(t, 3), repeat: 'monthly' },
    { id: uid(), ...s, vendor: 'Waste Management', what: 'Shop service', amount: 162.85, due: addDays(t, 7), repeat: 'monthly' },
    { id: uid(), ...s, vendor: 'Verizon Business', what: 'Phones & internet', amount: 298.4, due: addDays(t, 9), repeat: 'monthly' },
    { id: uid(), ...s, vendor: 'Equipment supplier', what: 'Parts invoice', amount: 650, due: addDays(t, -5), repeat: 'none' }
  );
  db.equipment.push(
    { id: uid(), ...s, name: 'Pressure Washer #3', kind: 'Pressure washer', status: 'repair', note: 'Low pressure – needs service' },
    { id: uid(), ...s, name: 'Trailer – Unit T-04', kind: 'Trailer', status: 'schedule', note: 'Brake lights intermittent' },
    { id: uid(), ...s, name: 'Generator – Shop', kind: 'Generator', status: 'service', note: 'Routine service due (250 hrs)' },
    { id: uid(), ...s, name: 'Dehu #12', kind: 'Dehumidifier', status: 'working' },
    { id: uid(), ...s, name: 'Dehu #14', kind: 'Dehumidifier', status: 'repair', note: 'Not pulling water' },
    { id: uid(), ...s, name: 'Air scrubber #4', kind: 'Air scrubber', status: 'working' }
  );
  const sun = addDays(t, -((dayOf(t).getDay() + 7) % 7) || -7);
  db.dispatch.push({ id: uid(), ...s, date: sun, handedOff: false, lines: [
    { time: '6:14 PM', text: 'Water leak (Acct #7821) – scheduled for Mon, 8:00 AM' },
    { time: '8:47 PM', text: 'No heat (Acct #7790) – urgent, labeled for priority dispatch' },
    { time: '10:32 PM', text: 'Sewer backup (Acct #7818) – technician declined. Follow up Mon morning.' }
  ] });
  db.timeOff.push({ id: uid(), ...s, who: 'My time off', from: addDays(t, 20), to: addDays(t, 24) });
  db.renewals.push(
    { id: uid(), ...s, name: 'General Liability Insurance', expires: addDays(t, 10) },
    { id: uid(), ...s, name: 'Contractor License / CCB', expires: addDays(t, 25) },
    { id: uid(), ...s, name: 'Workers’ Compensation', expires: addDays(t, 45) }
  );
  db.settings.backups = { coverage: 'Dispatch team', purchasing: 'Owner', bills: 'Owner', coi: 'Dispatch team', urgent: 'Dispatch → Owner (if needed)' };
  db.settings.backupsSample = true;
  db.samplesAdded = true;
}

// ---------- Start ----------
document.addEventListener('DOMContentLoaded', async () => {
  const online = window.officeCloudStart ? await officeCloudStart() : null;   // cloud.js: sign in + the office database
  db = online || (await loadDb()) || {};
  migrate();
  if (!db.samplesAdded) addSamples();
  await saveDb();                                                             // keep a copy on this computer
  wireSearch();
  render();
  window.officeCloudAfter?.();
});
