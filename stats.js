/* 📊 Company Stats (owner 2026-11-25: "stop switching from the CRM to the Google sheet… everything connected… if one
   person's typing in, it updates all of them"; picked Option 2, the numbers live in the master card).
   The SAME sheet as the ServPlus CRM's Dashboard master card. Its numbers live in the ServPlus CRM (one place): calls,
   landed, job values, invoiced and collected come from its jobs; Meetings, Payroll hrs, Supplies and the week's Payroll $
   are typed here or there and saved in the ServPlus CRM (db.statDays / db.statWeeks). Read and written through the Office
   CRM's function "office-link" → the ServPlus CRM's "crm-office-link" (shared secret on the servers only); the ServPlus CRM
   never sees anything else here. Refreshed every 20 s while the page is open.
   Supplies = typed, else this CRM's own receipts for that day (received shop purchases + job-site receipts), sent as
   `suppliesAuto` (stAutoPush). Spending = (Payroll $ + Supplies) ÷ Collected ÷ 0.65, goal under 70%.
   Weeks run Thursday 1 PM → Thursday 1 PM (same as the ServPlus CRM). */

const ST_HOUR = 13, ST_GOAL = 0.70;
let stData = null, stErr = '', stLoading = false, stMode = 'week', stOff = 0, stPoll = null;

const stYmd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function stWeek(now = new Date()) {
  const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), ST_HOUR);
  s.setDate(s.getDate() - ((s.getDay() - 4 + 7) % 7));
  if (s > now) s.setDate(s.getDate() - 7);
  const e = new Date(s); e.setDate(e.getDate() + 7);
  return { start: s, end: e };
}
const stAdd = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
function stBuckets() {
  const now = new Date(), nowT = +now, fmt = d => `${d.getMonth() + 1}/${d.getDate()}`;
  if (stMode === 'week') {
    const { start, end } = stWeek(stAdd(now, stOff * 7));
    const cuts = [start];
    for (let i = 1; i <= 7; i++) cuts.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    cuts.push(end);
    return cuts.slice(0, -1).map((from, i) => {
      const to = cuts[i + 1], first = i === 0, last = i === cuts.length - 2;
      return { from, to, today: nowT >= from && nowT < to, label: from.toLocaleDateString([], { weekday: 'short' }), sub: first ? `${fmt(from)} 1pm→` : last ? '→1pm' : fmt(from) };
    });
  }
  const first = new Date(now.getFullYear(), now.getMonth() + stOff, 1), next = new Date(first.getFullYear(), first.getMonth() + 1, 1), out = [];
  for (let s = stWeek(first).start; s < next; s = stAdd(s, 7)) {
    const from = s < first ? first : s, e = stAdd(s, 7), to = e > next ? next : e;
    out.push({ from, to, label: fmt(from), sub: `– ${fmt(new Date(to - 60000))}`, today: nowT >= from && nowT < to });
  }
  return out;
}
const stColKey = from => stYmd(from) + (from.getHours() === ST_HOUR ? 'pm' : '');
function stKeyTime(k) { const [y, m, d] = k.slice(0, 10).split('-').map(Number); return +new Date(y, m - 1, d, k.endsWith('pm') ? ST_HOUR : 0); }
const stVal = j => { const v = [+j.lo, +j.hi].filter(x => x > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };

// The same counting as the ServPlus CRM (its stats.js stNumbers), on the plain numbers its server sends
function stNums(boardId, from, to) {
  const f = +from, t = +to, inR = iso => { const x = Date.parse(iso); return x >= f && x < t; };
  const firstBoard = stData.boards[0]?.id, n = { calls: 0, landed: 0, values: 0, withEst: 0, invoiced: 0, collected: 0 };
  for (const j of stData.jobs) {
    const b = stData.boards.some(x => x.id === j.b) ? j.b : firstBoard;
    if (boardId && b !== boardId) continue;
    if (j.f) continue;
    if (j.l && inR(j.l)) n.landed++;
    if (inR(j.r)) { n.calls++; const v = stVal(j); if (v > 0) { n.values += v; n.withEst++; } }
    if (j.i && inR(j.i)) n.invoiced += +j.inv || +j.qt || stVal(j);
    for (const p of j.p || []) if ((p.s === 'paid' || p.s === 'partial') && p.a > 0 && inR(p.at)) n.collected += p.a;
  }
  n.rate = n.calls ? n.landed / n.calls : null; n.avg = n.withEst ? n.values / n.withEst : null;
  return n;
}
const stSup = d => (d.supplies !== '' && d.supplies != null ? +d.supplies || 0 : +d.suppliesAuto || 0);
// Same settings as the ServPlus CRM (its db.statConfig): Payroll $ = hrs × rate; before the cut the master numbers are the old Google sheet's
const stCfg = () => stData.statConfig || {};
const stRate = () => +stCfg().rate || 40.5;
const stCut = () => stKeyTime(stCfg().sheetUntil || '2026-11-19pm');
function stTyped(from, to) {
  const f = +from, t = +to, n = { meetings: 0, hrs: 0, supplies: 0, payroll: 0 };
  for (const d of stData.statDays || []) { const x = stKeyTime(d.id); if (x < f || x >= t) continue; n.meetings += +d.meetings || 0; n.hrs += +d.hrs || 0; n.supplies += stSup(d); }
  n.payroll = n.hrs * stRate();
  return n;
}
// 📜 The old Google sheet's days (statDays[].sheet), then the CRM's own numbers from the cut on (= the ServPlus CRM's stMaster)
function stMaster(from, to) {
  const cut = stCut(), f = +from, t2 = Math.min(+to, cut);
  const n = +to > cut ? stNums(null, new Date(Math.max(f, cut)), to) : { calls: 0, landed: 0, values: 0, withEst: 0, invoiced: 0, collected: 0 };
  n.sheet = false;
  for (const d of stData.statDays || []) {
    const s = d.sheet; if (!s) continue;
    const x = stKeyTime(d.id); if (x < f || x >= t2) continue;
    n.sheet = true;
    n.calls += +s.calls || 0; n.landed += +s.landed || 0; n.values += +s.values || 0; n.withEst += +s.landed || 0;
    n.invoiced += +s.invoiced || 0; n.collected += +s.collected || 0;
  }
  n.rate = n.calls ? n.landed / n.calls : null; n.avg = n.withEst ? n.values / n.withEst : null;
  n.allSheet = +to <= cut;
  return n;
}
const stM = v => (v ? money(Math.round(v)) : '—');
const stP = v => (v == null ? '—' : Math.round(v * 100) + '%');
const stN = v => String(v || 0);

// ---------- Loading / saving through the link ----------
async function stLoad(quiet) {
  if (!window.officeCloud?.invoke || stLoading) return;
  stLoading = true;
  try {
    const r = await window.officeCloud.invoke('office-link', { action: 'stats' });
    if (r?.error) throw new Error(r.error);
    stData = r; stErr = '';
    stAutoPush();
  } catch (e) { stErr = e.message || String(e); }
  finally { stLoading = false; }
  stLoadedAt = Date.now();
  if (['stats', 'dashboard'].includes(route()) && !document.querySelector('#main [data-st-in]:focus') && !document.querySelector('#modalRoot .modal-bg')) render();
}
async function stSave(key, field, raw) {
  const v = String(raw ?? '').replace(/[$,\s]/g, '');
  if (v !== '' && isNaN(+v)) { toast('Type a number'); return; }
  const list = field === 'payroll' ? (stData.statWeeks ||= []) : (stData.statDays ||= []);
  let rec = list.find(x => x.id === key); if (!rec) list.push(rec = { id: key });
  const f = field === 'payroll' ? 'payroll' : field;
  if (String(rec[f] ?? '') === v) return;
  rec[f] = v;                                       // show it at once, then save it in the ServPlus CRM
  const r = await window.officeCloud.invoke('office-link', field === 'payroll' ? { action: 'setWeek', week: key, value: v } : { action: 'set', key, field, value: v });
  if (r?.error) { toast('⚠ Not saved: ' + r.error); stLoad(); return; }
  toast('✓ Saved in both CRMs');
}
// Supplies from this CRM's receipts, per column, sent to the ServPlus CRM when they change
function stAutoDays() {
  const out = {}, since = Date.now() - 70 * 86400000;
  const add = (t, amt) => {
    if (!(amt > 0) || !(t >= since)) return;
    const d = new Date(t), k = stYmd(d) + (d.getDay() === 4 && d.getHours() >= ST_HOUR ? 'pm' : '');
    out[k] = Math.round(((out[k] || 0) + amt) * 100) / 100;
  };
  (db.purchases || []).filter(p => p.status === 'received' && !p.sample && p.receivedAt).forEach(p => add(p.receivedAt, (Number(p.price) || 0) * (Number(p.qty) || 1)));
  (db.receipts || []).filter(r => !r.sample && r.date).forEach(r => add(+dayOf(r.date), Number(r.amount) || 0));
  return out;
}
async function stAutoPush() {
  if (!stData) return;
  const days = stAutoDays();
  // days that had receipts before but none now go back to 0
  (stData.statDays || []).forEach(d => { if (+d.suppliesAuto && !(d.id in days) && stKeyTime(d.id) >= Date.now() - 70 * 86400000) days[d.id] = 0; });
  const changed = Object.entries(days).filter(([k, v]) => String(+((stData.statDays || []).find(d => d.id === k)?.suppliesAuto || 0)) !== String(+v));
  if (!changed.length) return;
  const r = await window.officeCloud.invoke('office-link', { action: 'auto', days: Object.fromEntries(changed) });
  if (!r?.error) changed.forEach(([k, v]) => { let d = stData.statDays.find(x => x.id === k); if (!d) stData.statDays.push(d = { id: k }); d.suppliesAuto = String(v); });
}

// ---------- The page ----------
views.stats = {
  html() {
    const head = `<div class="page-head"><h1>📊 Company Stats</h1><span class="pill gry">Same sheet as the ServPlus CRM Dashboard</span></div>`;
    if (!window.officeCloud) return head + `<div class="card"><div class="empty">Company Stats come from the ServPlus CRM, so they show once you’re signed in online.</div></div>`;
    if (!stData) { if (!stErr) setTimeout(stLoad, 0); return head + `<div class="card"><div class="empty">${stErr ? '⚠ ' + esc(stErr) + ' <button class="btn sm" data-st-retry>Try again</button>' : 'Loading the numbers from the ServPlus CRM…'}</div></div>`; }
    const bs = stBuckets(), from = bs[0].from, to = bs.at(-1).to, week = stMode === 'week';
    const T = stMaster(from, to), ty = stTyped(from, to);
    const div = (a, b, g) => (b > 0 && a > 0 ? a / b / g : null);
    const labor = div(ty.payroll, T.values, 0.5), spend = div(ty.supplies, T.values, 0.3), bills = div(ty.payroll + ty.supplies, T.collected, 0.65);
    const good = (v, goal) => (v == null ? '' : v >= goal ? 'st-bad' : 'st-good');
    const cols = bs.map(b => ({ b, n: stMaster(b.from, b.to), t: stTyped(b.from, b.to), d: (stData.statDays || []).find(d => d.id === stColKey(b.from)) || {} }));
    const kpi = (v, l, cls = '', tip = '') => `<div class="st-kpi ${cls}" title="${esc(tip)}"><div class="st-kv">${v}</div><div class="st-kl">${l}</div></div>`;
    const row = (label, cls, fn, tot, typed) => `<tr class="${cls}"><th>${label}</th>${cols.map(c => `<td class="${c.b.today ? 'st-today' : ''}${!typed && c.n.allSheet && c.n.sheet ? ' st-sheet' : ''}">${fn(c)}</td>`).join('')}<td class="st-tot">${tot}</td></tr>`;
    const cell = (c, field, fmt) => week ? `<input class="st-in" data-st-in="${stColKey(c.b.from)}|${field}" value="${esc(c.d[field] ?? '')}" placeholder="${field === 'supplies' && +c.d.suppliesAuto ? esc(money(+c.d.suppliesAuto)) : ''}" inputmode="decimal" autocomplete="off">` : fmt(c.t);
    const title = week ? `${from.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} 1 PM – ${to.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} 1 PM`
      : from.toLocaleDateString([], { month: 'long', year: 'numeric' });
    const per = stData.boards.map(b => { const n = stNums(b.id, from, to); return `<div class="st-board"><b>👤 ${esc(b.name)}</b><span>${stN(n.calls)} calls · ${stN(n.landed)} landed · ${stP(n.rate)} · collected ${stM(n.collected)}</span></div>`; }).join('');
    return head + `<div class="card st-card">
      <div class="st-nav"><div class="st-seg"><button class="${week ? 'on' : ''}" data-st-mode="week">Week</button><button class="${!week ? 'on' : ''}" data-st-mode="month">Month</button></div>
        <button class="btn sm" data-st-nav="-1">◀</button><b class="st-title">${esc(title)}</b><button class="btn sm" data-st-nav="1">▶</button>
        ${stOff ? `<button class="btn sm" data-st-nav="0">${week ? 'This week' : 'This month'}</button>` : ''}
        <span class="muted small st-live">${stErr ? '⚠ ' + esc(stErr) : '🔗 Live from the ServPlus CRM'}</span></div>
      <div class="st-kpis">${kpi(stN(T.calls), 'Calls taken')}${kpi(stP(T.rate), 'Land rate')}${kpi(stM(T.avg), 'Avg job value')}${kpi(stM(T.invoiced), 'Invoiced')}${kpi(stM(T.collected), 'Collected')}</div>
      <div class="st-kpis st-kpis-co">${kpi(stN(ty.meetings), 'Meetings')}
        ${kpi(stM(ty.payroll), `Payroll $ · ${money(stRate())}/hr`, '', 'Payroll hrs × the hourly cost (changed on the ServPlus CRM Dashboard)')}
        ${kpi(stM(ty.supplies), 'Supplies')}
        ${kpi(stP(labor), 'Labor cost', good(labor, 1), '(Payroll $ ÷ Job values) ÷ 0.5 · under 100% is on target')}
        ${kpi(stP(spend), 'Spend', good(spend, 1), '(Supplies ÷ Job values) ÷ 0.3 · under 100% is on target')}
        ${kpi(stP(bills), 'Bills · goal under 70%', good(bills, ST_GOAL), '((Payroll $ + Supplies) ÷ Collected) ÷ 0.65')}</div>
      ${T.sheet ? `<div class="small st-sheet-note">📜 Days before ${new Date(stCut()).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} show the old Google sheet (in grey)</div>` : ''}
      <div class="st-scroll"><table class="st-grid">
        <tr><th></th>${cols.map(c => `<th class="${c.b.today ? 'st-today' : ''}">${esc(c.b.label)}<small>${esc(c.b.sub)}</small></th>`).join('')}<th class="st-tot">Total</th></tr>
        ${row('Calls taken', 'r-calls', c => stN(c.n.calls), stN(T.calls))}
        ${row('Landed', 'r-landed', c => stN(c.n.landed), stN(T.landed))}
        ${row('Land rate', 'r-rate', c => stP(c.n.rate), stP(T.rate))}
        ${row('Job values', 'r-values', c => stM(c.n.values), stM(T.values))}
        ${row('Invoiced', 'r-inv', c => stM(c.n.invoiced), stM(T.invoiced))}
        ${row('Collected', 'r-coll', c => stM(c.n.collected), stM(T.collected))}
        <tr class="st-co-gap"><th colspan="${cols.length + 2}">🏢 Typed in by the office · click a box and type</th></tr>
        ${row('Meetings', 'r-meet', c => cell(c, 'meetings', t => stN(t.meetings)), stN(ty.meetings), true)}
        ${row('Payroll hrs', 'r-hrs', c => cell(c, 'hrs', t => (t.hrs ? String(Math.round(t.hrs * 100) / 100) : '—')), ty.hrs ? String(Math.round(ty.hrs * 100) / 100) : '—', true)}
        ${row('Payroll $', 'r-pay', c => stM(c.t.payroll), stM(ty.payroll), true)}
        ${row('Supplies', 'r-sup', c => cell(c, 'supplies', t => stM(t.supplies)), stM(ty.supplies), true)}
      </table></div>
      <div class="st-boards">${per}</div>
      <div class="small muted" style="margin-top:8px">Supplies fill in from your scanned receipts (shown faded); type a number to replace it. Payroll $ = Payroll hrs × the hourly cost. Labor cost = (Payroll $ ÷ Job values) ÷ 0.5, Spend = (Supplies ÷ Job values) ÷ 0.3, Bills = ((Payroll $ + Supplies) ÷ Collected) ÷ 0.65.</div></div>`;
  },
  after() {
    clearInterval(stPoll);
    stPoll = setInterval(() => { if (route() !== 'stats') return clearInterval(stPoll); if (!document.hidden) stLoad(true); }, 20000);
  }
};
document.addEventListener('click', e => {
  const m = e.target.closest('[data-st-mode]'); if (m) { stMode = m.dataset.stMode; stOff = 0; return render(); }
  const n = e.target.closest('[data-st-nav]'); if (n) { const v = +n.dataset.stNav; stOff = v === 0 ? 0 : stOff + v; return render(); }
  if (e.target.closest('[data-st-retry]')) { stErr = ''; render(); }
});
document.addEventListener('change', async e => {
  const inp = e.target.closest('[data-st-in]'); if (!inp || !stData) return;
  const [key, field] = inp.dataset.stIn.split('|');
  await stSave(key, field, inp.value);
  setTimeout(() => { const next = document.activeElement?.dataset?.stIn; render(); if (next) document.querySelector(`[data-st-in="${next}"]`)?.focus(); }, 0);
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest?.('[data-st-in]')) { e.preventDefault(); e.target.blur(); } });

/* 💰 How much can we spend this week (Dashboard, owner 2026-11-26: replaces Shop & Equipment + Coverage & Time Off there).
   This stats week (Thursday 1 PM → Thursday 1 PM): Collected, Payroll $, Supplies, Bills % against 70%, and the room left:
   Bills = (Payroll $ + Supplies) ÷ Collected ÷ 0.65 < 70%  ⇔  Payroll $ + Supplies < Collected × 0.455.
   Shop requests not received yet (pending / approved / ordered) are counted against that room, and a new request or an
   approve / order that would push the week over 70% says so in its "are you sure?" window (spendWarnLines). */
const SP_SHARE = ST_GOAL * 0.65;   // 0.455 of what was collected can go to payroll + supplies
let stLoadedAt = 0;
const spOpenShop = skipId => (db.purchases || []).filter(p => !p.sample && p.id !== skipId && ['pending', 'approved', 'ordered'].includes(p.status)).reduce((s, p) => s + purTotal(p), 0);
function spendWeek() {
  if (!stData) return null;
  const { start, end } = stWeek();
  const T = stMaster(start, end), ty = stTyped(start, end);
  const C = T.collected, used = ty.payroll + ty.supplies;
  return { start, end, C, pay: ty.payroll, sup: ty.supplies, hrs: ty.hrs, used, bills: C > 0 ? used / C / 0.65 : null, room: C * SP_SHARE - used };
}
function spendEnsure() {
  if (!window.officeCloud?.invoke || stLoading) return;
  if ((!stData && !stErr) || Date.now() - stLoadedAt > 120000) { stLoadedAt = Date.now(); setTimeout(stLoad, 0); }
}
function spendCard() {
  spendEnsure();
  const head = cardHead('💰', 'How much can we spend this week', '', '#/stats');
  if (!window.officeCloud) return `<div class="card">${head}<div class="empty">Shows once you’re signed in online (it reads the ServPlus CRM).</div></div>`;
  const s = spendWeek();
  if (!s) return `<div class="card">${head}<div class="empty">${stErr ? '⚠ ' + esc(stErr) : 'Loading this week’s numbers…'}</div></div>`;
  const open = spOpenShop(), after = s.room - open;
  const fmtD = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const bad = s.bills != null && s.bills >= ST_GOAL;
  const line = s.C <= 0
    ? `<div class="alert amb" style="margin:10px 0 0">💵 Nothing collected yet this week, so there’s no room to spend yet. Payroll and supplies so far: <b>${money(s.used)}</b>.</div>`
    : s.room >= 0
      ? `<div class="alert grn" style="margin:10px 0 0">✅ You can still spend about <b>${money(Math.floor(s.room))}</b> this week and stay under 70%.</div>`
      : `<div class="alert red" style="margin:10px 0 0">🛑 This week is <b>${money(Math.ceil(-s.room))}</b> over: payroll + supplies are past 70% of what was collected.</div>`;
  const shop = open > 0 && s.C > 0 ? `<div class="small ${after < 0 ? 'sp-red' : 'muted'}" style="margin-top:6px">🛒 Shop requests not received yet: <b>${money(open)}</b>${after < 0 ? ` · buying them all puts the week <b>${money(Math.ceil(-after))}</b> over 70%` : ` · after them about <b>${money(Math.floor(after))}</b> left`}</div>` : '';
  return `<div class="card sp-card">${cardHead('💰', 'How much can we spend this week', `<span class="week-lbl">📅 ${fmtD(s.start)} 1 PM – ${fmtD(s.end)} 1 PM</span>`, '#/stats')}
    <div class="bud-boxes">
      <div class="bud-box b-buy"><div class="lbl">Collected so far</div><div class="num">${money(Math.round(s.C))}</div></div>
      <div class="bud-box"><div class="lbl">Payroll $ <span class="muted">(${Math.round(s.hrs * 100) / 100} hrs)</span></div><div class="num">${money(Math.round(s.pay))}</div></div>
      <div class="bud-box"><div class="lbl">Supplies</div><div class="num">${money(Math.round(s.sup))}</div></div>
      <div class="bud-box ${s.bills == null ? '' : bad ? 'b-over' : 'b-left'}" title="(Payroll $ + Supplies) ÷ Collected ÷ 0.65"><div class="lbl">Bills · goal under 70%</div><div class="num">${s.bills == null ? '—' : Math.round(s.bills * 100) + '%'}</div></div>
    </div>
    ${line}${shop}</div>`;
}
// One line for the Weekly Shop Budget card
function spendBudgetLine(pending) {
  const s = spendWeek(); if (!s || s.C <= 0) return '';
  const after = s.room - spOpenShop();
  return after < 0
    ? `<div class="alert red" style="margin:10px 0 0">📊 ${s.room < 0 ? `This week’s Bills are already over 70% (about ${money(Math.ceil(-s.room))} over)` : `Buying what’s pending pushes this week’s Bills over 70% (about ${money(Math.ceil(-after))} over)`}. Check before approving.</div>`
    : `<div class="small muted" style="margin-top:8px">📊 Bills this week: <b>${s.bills == null ? '—' : Math.round(s.bills * 100) + '%'}</b> of 70% · about <b>${money(Math.floor(after))}</b> of room after pending</div>`;
}
// Lines for the "are you sure?" window of a purchase (amount = this purchase, id = this purchase when it is already open)
function spendWarnLines(amount, id) {
  const s = spendWeek(); if (!s || !(amount > 0)) return [];
  if (s.C <= 0) return [`📊 Nothing collected yet this week, so this purchase is over the 70% spending goal for now.`];
  const left = s.room - spOpenShop(id);
  return left - amount < 0 ? [`📊 <b>This pushes this week’s Bills over 70%</b>: about ${money(Math.max(0, Math.floor(left)))} of room left, this is ${money(amount)}.`] : [];
}
