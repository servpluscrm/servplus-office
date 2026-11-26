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
function stTyped(from, to) {
  const f = +from, t = +to, n = { meetings: 0, hrs: 0, supplies: 0, payroll: 0, hasPay: false };
  for (const d of stData.statDays || []) { const x = stKeyTime(d.id); if (x < f || x >= t) continue; n.meetings += +d.meetings || 0; n.hrs += +d.hrs || 0; n.supplies += stSup(d); }
  for (const w of stData.statWeeks || []) { const x = stKeyTime(w.id + 'pm'); if (x < f || x >= t) continue; if (w.payroll !== '' && w.payroll != null) { n.payroll += +w.payroll || 0; n.hasPay = true; } }
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
  if (route() === 'stats' && !document.querySelector('#main [data-st-in]:focus') && !document.querySelector('#modalRoot .modal-bg')) render();
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
    const T = stNums(null, from, to), ty = stTyped(from, to);
    const spend = T.collected > 0 && (ty.hasPay || ty.supplies) ? (ty.payroll + ty.supplies) / T.collected / 0.65 : null;
    const cols = bs.map(b => ({ b, n: stNums(null, b.from, b.to), t: stTyped(b.from, b.to), d: (stData.statDays || []).find(d => d.id === stColKey(b.from)) || {} }));
    const wk = week ? (stData.statWeeks || []).find(w => w.id === stYmd(from)) : null;
    const kpi = (v, l, cls = '') => `<div class="st-kpi ${cls}"><div class="st-kv">${v}</div><div class="st-kl">${l}</div></div>`;
    const row = (label, cls, fn, tot) => `<tr class="${cls}"><th>${label}</th>${cols.map(c => `<td class="${c.b.today ? 'st-today' : ''}">${fn(c)}</td>`).join('')}<td class="st-tot">${tot}</td></tr>`;
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
        ${kpi(week ? `<input class="st-in st-pay" data-st-in="${stYmd(from)}|payroll" value="${esc(wk?.payroll ?? '')}" placeholder="Type $" inputmode="decimal" autocomplete="off">` : stM(ty.payroll), 'Payroll $ (true labor cost)')}
        ${kpi(stM(ty.supplies), 'Supplies')}
        ${kpi(stP(spend), 'Spending · goal under 70%', spend == null ? '' : spend >= ST_GOAL ? 'st-bad' : 'st-good')}</div>
      <div class="st-scroll"><table class="st-grid">
        <tr><th></th>${cols.map(c => `<th class="${c.b.today ? 'st-today' : ''}">${esc(c.b.label)}<small>${esc(c.b.sub)}</small></th>`).join('')}<th class="st-tot">Total</th></tr>
        ${row('Calls taken', 'r-calls', c => stN(c.n.calls), stN(T.calls))}
        ${row('Landed', 'r-landed', c => stN(c.n.landed), stN(T.landed))}
        ${row('Land rate', 'r-rate', c => stP(c.n.rate), stP(T.rate))}
        ${row('Job values', 'r-values', c => stM(c.n.values), stM(T.values))}
        ${row('Invoiced', 'r-inv', c => stM(c.n.invoiced), stM(T.invoiced))}
        ${row('Collected', 'r-coll', c => stM(c.n.collected), stM(T.collected))}
        <tr class="st-co-gap"><th colspan="${cols.length + 2}">🏢 Typed in by the office · click a box and type</th></tr>
        ${row('Meetings', 'r-meet', c => cell(c, 'meetings', t => stN(t.meetings)), stN(ty.meetings))}
        ${row('Payroll hrs', 'r-hrs', c => cell(c, 'hrs', t => (t.hrs ? String(Math.round(t.hrs * 10) / 10) : '—')), ty.hrs ? String(Math.round(ty.hrs * 10) / 10) : '—')}
        ${row('Supplies', 'r-sup', c => cell(c, 'supplies', t => stM(t.supplies)), stM(ty.supplies))}
      </table></div>
      <div class="st-boards">${per}</div>
      <div class="small muted" style="margin-top:8px">Supplies fill in from your scanned receipts (shown faded); type a number to replace it. Spending = (Payroll $ + Supplies) ÷ Collected ÷ 0.65.</div></div>`;
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
