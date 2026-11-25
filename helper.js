/* ✨ Ask SERVPLUS AI, the side helper on the right (2026-11-25, owner's picture: pink, "How can I help you today?" cards).
   Only the owner + office manager use this CRM. Its main job: keep her on track (she gets scattered):
   Plan My Day = ONE thing at a time (Done / Not now / I'm stuck), interruptions parked so nothing is lost, a nudge when a
   task has been open a long time. Everything here is free rules; real AI answers come once the CRM is online. */

const HP_NUDGE_MIN = 30;   // "still on it?" after this many minutes on one task
let hpView = 'home';       // home | plan | find | reports | chat
let hpChat = [];           // [{ who: 'me' | 'ai', html }] while the CRM is open
let hpFind = '';

function hp() {
  db.helper ||= {};
  const h = db.helper;
  h.parked ||= [];
  h.notNow ||= {};
  return h;
}
function hpHidden() { const v = localStorage.getItem('office-hp-hidden'); return v ? v === '1' : innerWidth < 1100; }

// ---------- The day's list, most urgent first (all from her own records) ----------
function helperTasks() {
  const t = [], day = today(), skip = hp().notNow[day] || [];
  db.bills.filter(b => !b.paidAt && daysUntil(b.due) <= 2).sort((a, b) => a.due.localeCompare(b.due)).forEach(b => {
    const d = daysUntil(b.due);
    t.push({ id: 'bill:' + b.id, ico: '🧾', title: `Pay ${b.vendor} ${money(b.amount)}`, sub: d < 0 ? `${-d} day${d === -1 ? '' : 's'} late · Bills` : d === 0 ? 'Due today · Bills' : `Due ${fmtDay(b.due)} · Bills`, urgent: d <= 0, act: () => billPay(b.id), help: 'Open the bill, pay it the usual way, then tap Mark paid. Over your comfort level? Ask the owner first.' });
  });
  db.dispatch.filter(d => !d.handedOff && d.lines.length).forEach(d => t.push({ id: 'disp:' + d.id, ico: '🌙', title: `Hand off ${d.lines.length} after-hours call${d.lines.length > 1 ? 's' : ''} to dispatch`, sub: `From ${fmtDay(d.date)} · Dispatch Updates`, urgent: true, act: () => actions.dpHandoff({ dataset: { id: d.id } }), help: 'Text the group chat with each call, make sure dispatch put them in their system, then mark it handed off.' }));
  pendingApprovals().filter(a => Date.now() - a.askedAt > 2 * 86400000).forEach(a => t.push({ id: 'ap:' + a.id, ico: '🛡️', title: `Get an answer on: ${a.title}`, sub: `Owner waiting ${daysAgo(a.askedAt)} · Approvals`, act: () => apReview(a.id), help: 'Bring it up with the owner in person or at the 8 AM meeting. When they answer, tap Approve, Pay later or Decline.' }));
  const pend = db.purchases.filter(p => p.status === 'pending');
  if (pend.length) t.push({ id: 'pur:' + day, ico: '🛒', title: `Review ${pend.length} shop request${pend.length > 1 ? 's' : ''}`, sub: (new Date().getDay() === 5 ? 'Today is purchasing day · ' : '') + `${money(shopWeek().left)} left this week`, act: () => { location.hash = '#/purchasing'; }, help: 'Open each request: Approve, Send to owner, or Decline. Watch the "ordered again" warnings.' });
  db.renewals.filter(r => daysUntil(r.expires) <= 30).forEach(r => t.push({ id: 'rn:' + r.id, ico: '📅', title: `Renew ${r.name}`, sub: daysUntil(r.expires) < 0 ? 'Expired · Insurance & Licenses' : `${daysUntil(r.expires)} days left · Insurance & Licenses`, act: () => rnOpen(r.id), help: 'Call whoever renews it (saved on the record), then change the expiration date when the new one comes in.' }));
  const { d, items } = workdayToday();
  items.filter(i => !d.checked[i.id]).forEach(i => t.push({ id: 'wd:' + i.id, ico: '☑️', title: i.text, sub: 'My Workday', work: i.id, act: () => { location.hash = '#/workday'; }, help: 'Do just this one. When it’s done, tap ✓ Done.' }));
  // "Not now" ones go to the back of the line for today
  return t.filter(x => !skip.includes(x.id)).concat(t.filter(x => skip.includes(x.id)).map(x => ({ ...x, later: true })));
}
function hpCurrent(list = helperTasks()) {
  const h = hp();
  let cur = list.find(x => x.id === h.focusId);
  if (!cur) { cur = list[0]; if (cur) { h.focusId = cur.id; h.focusAt = Date.now(); } }
  return cur;
}

// ---------- Drawing ----------
function hpShell() {
  const el = document.getElementById('helper');
  el.innerHTML = `<div class="hp-top">
      <button class="hp-x" data-action="hpHide" title="Hide">✕</button>
      <div class="hp-badge">✦</div>
      <div><div class="hp-title">Ask SERVPLUS AI</div><div class="hp-sub">Your Office Assistant</div></div>
    </div>
    <div class="hp-body" id="hpBody"></div>
    <form class="hp-ask" id="hpAsk" autocomplete="off">
      <input id="hpInput" placeholder="Ask me anything…" data-no-draft>
      <button type="button" class="hp-mic" data-action="hpMic" title="Talk">🎤</button>
      <button type="submit" class="hp-send" title="Send">➤</button>
    </form>`;
  document.getElementById('hpAsk').addEventListener('submit', e => { e.preventDefault(); hpAskText(); });
  document.getElementById('hpInput').addEventListener('input', e => { if (hpView === 'find') { hpFind = e.target.value; drawHelperBody(); } });
}
function drawHelper() {
  if (!db) return;
  document.body.classList.toggle('hp-off', hpHidden());
  if (!document.getElementById('hpBody')) hpShell();
  drawHelperBody();
}
function hpBack() { return `<button class="hp-back" data-action="hpHome">‹ Back</button>`; }
function drawHelperBody() {
  const body = document.getElementById('hpBody'); if (!body) return;
  const keep = body.scrollTop;
  body.innerHTML = hpView === 'plan' ? hpPlanHtml() : hpView === 'find' ? hpFindHtml() : hpView === 'reports' ? hpReportsHtml() : hpView === 'chat' ? hpChatHtml() : hpHomeHtml();
  body.scrollTop = hpView === 'chat' ? body.scrollHeight : keep;
}
function hpHomeHtml() {
  const list = helperTasks(), cur = hpCurrent(list), parked = hp().parked.length;
  const h = new Date().getHours();
  const hi = h < 12 ? 'Good morning! 👋' : h < 17 ? 'Hi there! 👋' : 'Good evening! 👋';
  const card = (act, ico, t, s, extra = '') => `<button class="hp-card" data-action="${act}"><span class="hp-ico">${ico}</span><span class="hp-ct"><b>${t}</b><small>${s}</small></span>${extra}<span class="hp-chev">›</span></button>`;
  return `<div class="hp-bubble"><b>${hi}</b><br>I'm here to help you stay organized, find information, process documents and get things done one at a time.</div>
    ${cur ? `<button class="hp-now" data-action="hpPlan"><span class="hp-now-l">Right now</span><b>${esc(cur.ico)} ${esc(cur.title)}</b><small>${esc(cur.sub)}</small></button>` : ''}
    <div class="hp-q">How can I help you today?</div>
    ${card('scanStart', HP_ICO.scan, 'Scan a Document', 'Bills, receipts, COIs, invoices and more')}
    ${card('hpPlan', HP_ICO.plan, 'Plan My Day', 'One thing at a time, in the right order', list.length ? `<span class="hp-n">${list.length}</span>` : '')}
    ${card('hpFindOpen', HP_ICO.find, 'Find Information', 'Search company records and documents')}
    ${card('hpReports', HP_ICO.rep, 'Show My Reports', 'Spending, bills, purchases and trends')}
    <button class="hp-park-btn" data-action="hpParkAsk">🅿 Got interrupted? Park a thought${parked ? ` <span class="hp-n">${parked}</span>` : ''}</button>`;
}
function hpPlanHtml() {
  const list = helperTasks(), cur = hpCurrent(list), h = hp();
  const mins = cur && h.focusAt ? Math.floor((Date.now() - h.focusAt) / 60000) : 0;
  const total = list.length + (hp().doneToday?.[today()] || 0);
  const done = hp().doneToday?.[today()] || 0;
  if (!cur) return `${hpBack()}<div class="hp-allclear">🎉<b>All caught up!</b><small>Nothing urgent left. Take a breath, or pick something from the menu.</small></div>${hpParkedHtml()}`;
  const next = list.filter(x => x.id !== cur.id).slice(0, 5);
  return `${hpBack()}
    <div class="hp-prog"><span>Right now · ${done + 1} of ${total}</span><div class="hp-bar"><div style="width:${total ? done / total * 100 : 0}%"></div></div></div>
    <div class="hp-focus ${cur.urgent ? 'urgent' : ''}">
      <div class="hp-f-t">${esc(cur.ico)} ${esc(cur.title)}</div>
      <div class="hp-f-s">${esc(cur.sub)}</div>
      <div class="hp-f-btns">
        <button class="hp-b pri" data-action="hpDone">✓ Done</button>
        <button class="hp-b" data-action="hpNotNow">Not now</button>
        <button class="hp-b" data-action="hpStuck">I'm stuck</button>
      </div>
      <button class="hp-link" data-action="hpGo">Open it ›</button>
    </div>
    ${mins >= HP_NUDGE_MIN ? `<div class="hp-nudge">⏱ ${mins} minutes on this one. Still on it, or did something pull you away? <button class="hp-link" data-action="hpStill">Still on it</button> · <button class="hp-link" data-action="hpParkAsk">Park the interruption</button></div>` : ''}
    ${next.length ? `<div class="hp-h">Next up</div>${next.map((x, i) => `<div class="hp-next ${x.later ? 'later' : ''}"><span>${i + 2}.</span>${esc(x.title)}${x.later ? ' <small>(later)</small>' : ''}</div>`).join('')}${list.length > 6 ? `<div class="hp-next muted">+ ${list.length - 6} more</div>` : ''}` : ''}
    ${hpParkedHtml()}`;
}
function hpParkedHtml() {
  const p = hp().parked;
  return `<div class="hp-h">🅿 Parked thoughts ${p.length ? `(${p.length})` : ''}</div>
    ${p.map(x => `<div class="hp-parked"><span>${esc(x.text)}</span><small>${fmtWhen(x.at)}</small><button class="hp-mini" data-action="hpParkTask" data-id="${x.id}" title="Add to today">＋ Today</button><button class="hp-mini" data-action="hpParkDel" data-id="${x.id}" title="Done / remove">✓</button></div>`).join('') || '<div class="hp-hint">When something pulls you away, park it here so it isn’t lost, then come back to your task.</div>'}
    <button class="hp-park-btn" data-action="hpParkAsk">🅿 Park a thought</button>`;
}
function hpFindHtml() {
  const res = hpFind.trim().length > 1 ? searchAll(hpFind) : [];
  return `${hpBack()}<div class="hp-q">Find information</div><div class="hp-hint">Type in the box at the bottom: a vendor, a bill, a part, a machine, a license…</div>
    ${res.map((r, i) => `<button class="hp-res" data-action="hpPick" data-i="${i}"><b>${esc(r.t)}</b><small>${esc(r.w)}</small></button>`).join('') || (hpFind.trim().length > 1 ? '<div class="hp-hint">Nothing found. Try another word.</div>' : '')}`;
}
function hpReportsHtml() {
  const w = shopWeek();
  const open = db.bills.filter(b => !b.paidAt);
  const sum = l => l.reduce((a, b) => a + (Number(b.amount) || 0), 0);
  const due7 = open.filter(b => daysUntil(b.due) <= 7), late = open.filter(b => daysUntil(b.due) < 0);
  const wk = db.receipts.filter(r => r.date >= w.from && r.date <= w.to);
  const tile = (n, l, cls = '') => `<div class="hp-tile ${cls}"><b>${n}</b><small>${l}</small></div>`;
  return `${hpBack()}<div class="hp-q">Your reports</div>
    <div class="hp-tiles">
      ${tile(money(w.left), w.left < 0 ? 'Over the shop budget' : 'Left in shop budget', w.left < 0 ? 'red' : 'grn')}
      ${tile(money(w.spent), 'Shop spent this week')}
      ${tile(money(sum(due7)), `${due7.length} bills due in 7 days`, due7.length ? 'amb' : '')}
      ${tile(money(sum(late)), `${late.length} bills late`, late.length ? 'red' : '')}
      ${tile(pendingApprovals().length, 'Waiting on the owner', pendingApprovals().length ? 'amb' : '')}
      ${tile(money(sum(wk)), 'Jobsite supplies this week')}
    </div>
    <div class="hp-h">Ordered again and again</div>${hpRepeats()}
    <div class="hp-hint">Week = Friday ${fmtDay(w.from)} – Thursday ${fmtDay(w.to)}. Company Stats (spending stat, calls, payroll) come next.</div>`;
}
function hpRepeats() {
  const since = Date.now() - 30 * 86400000, m = new Map();
  db.purchases.filter(p => p.orderedAt && p.orderedAt >= since).forEach(p => { const k = norm(p.item); m.set(k, { item: p.item, n: (m.get(k)?.n || 0) + 1 }); });
  const r = [...m.values()].filter(x => x.n >= 2).sort((a, b) => b.n - a.n);
  return r.map(x => `<div class="hp-next">🔁 ${esc(x.item)} <small>· ${x.n}× in 30 days</small></div>`).join('') || '<div class="hp-hint">No repeat orders.</div>';
}
function hpChatHtml() {
  return `${hpBack()}${hpChat.map(m => `<div class="hp-msg ${m.who}">${m.html}</div>`).join('')}`;
}

// ---------- Typing in the box ----------
const HP_PARK_RE = /^(park|remember|remind me|don'?t forget|note)\b[:\s,-]*/i;
function hpAskText() {
  const inp = document.getElementById('hpInput');
  const text = inp.value.trim(); if (!text) return inp.focus();
  if (hpView === 'find') { const r = searchAll(text)[0]; if (r) { inp.value = ''; hpFind = ''; hpPickRes(r); } return; }
  inp.value = '';
  hpChat.push({ who: 'me', html: esc(text) });
  hpChat.push({ who: 'ai', html: hpAnswer(text) });
  hpView = 'chat'; drawHelperBody();
}
// Free answers from her own records; anything else waits for the real AI (online).
function hpAnswer(text) {
  const n = norm(text);
  if (HP_PARK_RE.test(text)) { const t = text.replace(HP_PARK_RE, '').trim() || text; hpPark(t); return `🅿 Parked: <b>${esc(t)}</b>. It's safe in your parked thoughts; back to what you were doing.`; }
  if (/what (should|do) i (do|work on)|what now|whats next|what am i forgetting|plan my day/.test(n)) {
    const c = hpCurrent(); return c ? `Right now: <b>${esc(c.title)}</b><br><small>${esc(c.sub)}</small><br><button class="hp-link" data-action="hpPlan">Open Plan My Day ›</button>` : 'You’re all caught up. 🎉';
  }
  if (/bill/.test(n) && /(this week|due|owe|pay)/.test(n)) {
    const due = db.bills.filter(b => !b.paidAt && daysUntil(b.due) <= 7).sort((a, b) => a.due.localeCompare(b.due));
    return due.length ? `${due.length} bill${due.length > 1 ? 's' : ''} due in the next 7 days, ${money(due.reduce((a, b) => a + b.amount, 0))} total:<br>${due.map(b => `• ${esc(b.vendor)} ${money(b.amount)} · ${billState(b).label}`).join('<br>')}<br><a href="#/bills">Open Bills ›</a>` : 'No bills due in the next 7 days.';
  }
  if (/budget|how much.*(left|spend)|shop money/.test(n)) { const w = shopWeek(); return `This week (Fri ${fmtDay(w.from)} – Thu ${fmtDay(w.to)}): spent <b>${money(w.spent)}</b>, pending ${money(w.pending)}, <b>${money(w.left)}</b> left of ${money(w.budget)}.`; }
  if (/expir|renew|licen|insurance|coi/.test(n)) { const r = db.renewals.slice().sort((a, b) => a.expires.localeCompare(b.expires)).slice(0, 4); return r.length ? r.map(x => `• ${esc(x.name)} · ${daysUntil(x.expires) < 0 ? 'expired' : daysUntil(x.expires) + ' days left'}`).join('<br>') + '<br><a href="#/insurance">Open Insurance & Licenses ›</a>' : 'No renewals saved yet.'; }
  if (/owner|approv/.test(n)) { const a = pendingApprovals(); return a.length ? `${a.length} waiting on the owner:<br>${a.map(x => `• ${esc(x.title)} · ${daysAgo(x.askedAt)}`).join('<br>')}` : 'Nothing is waiting on the owner.'; }
  const res = searchAll(text.replace(/^(where is|find|search( for)?|look up|show me)\s+/i, ''));
  if (res.length) { hpLastRes = res; return `Here's what I found:<br>${res.slice(0, 6).map((r, i) => `<button class="hp-res" data-action="hpPickChat" data-i="${i}"><b>${esc(r.t)}</b><small>${esc(r.w)}</small></button>`).join('')}`; }
  return `I can't answer that one yet. Once the CRM is online the real AI will help with questions like this.<br><small>Try: "what should I do now", "bills this week", "budget", "park: call the insurance agent"</small>`;
}
let hpLastRes = [];
function hpPark(text) { hp().parked.push({ id: uid(), text, at: Date.now() }); saveDb(); }
function hpPickRes(r) { if (r.go) location.hash = r.go; else r.act(); }

// ---------- Buttons ----------
Object.assign(actions, {
  hpHome: () => { hpView = 'home'; drawHelperBody(); },
  hpPlan: () => { hpView = 'plan'; drawHelperBody(); },
  hpReports: () => { hpView = 'reports'; drawHelperBody(); },
  hpFindOpen: () => { hpView = 'find'; drawHelperBody(); const i = document.getElementById('hpInput'); i.placeholder = 'Type what you are looking for…'; i.value = hpFind; i.focus(); },
  hpPick: el => { const r = searchAll(hpFind)[+el.dataset.i]; if (r) hpPickRes(r); },
  hpPickChat: el => { const r = hpLastRes[+el.dataset.i]; if (r) hpPickRes(r); },
  hpHide: () => { localStorage.setItem('office-hp-hidden', '1'); drawHelper(); },
  hpShow: () => { localStorage.setItem('office-hp-hidden', '0'); drawHelper(); },
  hpGo: () => { const c = hpCurrent(); c?.act(); },
  hpStill: async () => { hp().focusAt = Date.now(); await saveDb(); drawHelperBody(); },
  hpDone: async () => {
    const c = hpCurrent(); if (!c) return;
    // Workday items tick right here; anything else opens the screen where it really gets done (so "done" is true)
    if (c.work) { workdayToday().d.checked[c.work] = Date.now(); }
    else if (!(await ask('Is it really done?', `<b>${esc(c.title)}</b><div class="small muted" style="margin-top:6px">This one is finished in its own screen. Open it now?</div>`, [{ label: 'Not yet', value: null }, { label: 'Open it', cls: 'pri', value: 'go' }]))) return;
    else { c.act(); return; }
    const h = hp(); h.doneToday ||= {}; h.doneToday[today()] = (h.doneToday[today()] || 0) + 1;
    h.focusId = ''; await saveDb(); render(); toast('✓ Nice. Next one.');
  },
  hpNotNow: async () => {
    const c = hpCurrent(); if (!c) return;
    const h = hp(); const l = h.notNow[today()] ||= []; if (!l.includes(c.id)) l.push(c.id);
    h.focusId = ''; await saveDb(); drawHelperBody(); toast('Moved to later today');
  },
  hpStuck: async () => {
    const c = hpCurrent(); if (!c) return;
    const r = await ask('Stuck on: ' + c.title, `<div style="background:#fdf2f4;border-radius:10px;padding:10px">💡 ${esc(c.help || 'Break it into the very first small step and do only that.')}</div><div class="small muted" style="margin-top:8px">Still stuck? Ask the owner, or park it and move on so you don't lose the whole morning.</div>`,
      [{ label: 'Close', value: null }, { label: '🅿 Park it', value: 'park' }, { label: 'Ask the owner', cls: 'pri', value: 'owner' }]);
    if (r === 'park') { hpPark('Stuck: ' + c.title); actions.hpNotNow(); }
    if (r === 'owner') apNew({ title: 'Help needed: ' + c.title, kind: 'Other', detail: c.sub });
  },
  hpParkAsk: async () => {
    const v = await form('🅿 Park a thought', [{ name: 'text', label: 'What came up?', required: true, hint: 'It stays here until you deal with it. Then go back to your task.' }], {}, { saveLabel: 'Park it' });
    if (!v) return;
    hpPark(v.text); drawHelperBody(); toast('🅿 Parked. Back to your task.');
  },
  hpParkTask: async el => {
    const h = hp(), p = byId(h.parked, el.dataset.id); if (!p) return;
    workdayToday().d.extra.push({ id: uid(), text: p.text }); h.parked = h.parked.filter(x => x !== p); await saveDb(); render(); toast('Added to today');
  },
  hpParkDel: async el => {
    const h = hp(), p = byId(h.parked, el.dataset.id); if (!p) return;
    if (!(await sure('Done with this?', [esc(p.text)], 'Yes, remove'))) return;
    h.parked = h.parked.filter(x => x !== p); await saveDb(); drawHelperBody();
  },
  hpMic: () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition, inp = document.getElementById('hpInput');
    if (!SR) { inp.focus(); return toast('Tap the 🎤 on your keyboard to talk'); }
    const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true;
    const start = inp.value ? inp.value + ' ' : '';
    const btn = document.querySelector('.hp-mic'); btn.classList.add('on');
    rec.onresult = e => { inp.value = start + [...e.results].map(r => r[0].transcript).join(''); };
    rec.onend = rec.onerror = () => btn.classList.remove('on');
    try { rec.start(); } catch { btn.classList.remove('on'); }
  }
});

const HP_ICO = {
  scan: '<svg viewBox="0 0 24 24"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/></svg>',
  plan: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4M8 14h2M14 14h2M8 17h2"/></svg>',
  find: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
  rep: '<svg viewBox="0 0 24 24"><path d="M6 20v-6M12 20V8M18 20v-9M4 20h16"/></svg>'
};

// Redraw with the rest of the CRM, and every minute (for the "still on it?" nudge)
const hpRender0 = render;
render = function () { hpRender0(); drawHelper(); };
setInterval(() => { if (db && hpView === 'plan' && !document.querySelector('.modal-bg')) drawHelperBody(); }, 60000);
