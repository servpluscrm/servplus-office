/* 🗓 Week + month schedule on My Workday (2026-11-25, owner: "give her a week schedule so she can see and below that a
   month schedule"). Each weekday has a FOCUS subject (her interview: one subject a day so she isn't overwhelmed; changeable,
   db.settings.focus). Days fill in by themselves from her records (bills, renewals, time off, pay-later answers,
   deliveries, Friday purchasing, Sunday dispatch) plus her own items (db.events, added by clicking a day). */

const FOCUS_DEFAULT = {
  1: 'Dispatch handoff & stats',
  2: 'Bills & payments',
  3: 'Employees & paperwork',
  4: 'Insurance, licenses & vehicles',
  5: 'Shop purchasing & Friday meeting',
  6: 'Off',
  0: 'After-hours dispatch'
};
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
let calWeek = 0;    // weeks from this one
let calMonth = 0;   // months from this one

function focusOf(dow) { db.settings.focus ||= { ...FOCUS_DEFAULT }; return db.settings.focus[dow] ?? ''; }

// Everything on one day: { ico, text, cls, act }
function dayItems(day) {
  const out = [], dow = dayOf(day).getDay();
  db.events ||= [];
  db.events.filter(e => e.date === day).forEach(e => out.push({ ico: e.done ? '✅' : '📌', text: e.text, cls: e.done ? 'done' : 'mine', act: `calEvent" data-id="${e.id}` }));
  db.bills.filter(b => b.due === day).forEach(b => out.push({ ico: '🧾', text: `${b.vendor} ${money(b.amount)}`, cls: b.paidAt ? 'done' : daysUntil(day) < 0 ? 'late' : 'bill', act: `billOpen" data-id="${b.id}` }));
  db.renewals.filter(r => r.expires === day).forEach(r => out.push({ ico: '🛡️', text: `${r.name} expires`, cls: 'late', act: `rnOpen" data-id="${r.id}` }));
  db.approvals.filter(a => a.status === 'later' && a.laterDate === day).forEach(a => out.push({ ico: '🕒', text: `Owner: ${a.title}`, cls: 'bill', act: `apReview" data-id="${a.id}` }));
  db.purchases.filter(p => p.delivery === day && p.status === 'ordered').forEach(p => out.push({ ico: '📦', text: `Delivery: ${p.item}`, cls: '', act: `purOpen" data-id="${p.id}` }));
  db.timeOff.filter(t => t.from <= day && t.to >= day).forEach(t => out.push({ ico: '✈️', text: t.who, cls: 'off', act: 'calGo" data-go="#/calendar' }));
  if (dow === 5) out.push({ ico: '🛒', text: 'Purchasing day', cls: 'rule', act: 'calGo" data-go="#/purchasing' }, { ico: '🥐', text: 'Friday meeting breakfast', cls: 'rule', act: '' });
  if (dow === 4) out.push({ ico: '🥤', text: 'Red Bulls for Friday', cls: 'rule', act: '' });
  if (dow === 0) out.push({ ico: '🌙', text: 'After-hours dispatch', cls: 'rule', act: 'calGo" data-go="#/dispatch' });
  return out;
}
function calItemHtml(i, small) {
  const tag = i.act ? 'button' : 'div';
  return `<${tag} class="cal-it ${i.cls}${small ? ' sm' : ''}" ${i.act ? `data-action="${i.act}"` : ''} title="${esc(i.text)}">${i.ico} ${esc(i.text)}</${tag}>`;
}

function weekHtml() {
  // Monday first
  const t = today(), d0 = dayOf(t); const back = (d0.getDay() + 6) % 7;
  const mon = addDays(t, -back + calWeek * 7);
  const days = [...Array(7)].map((_, i) => addDays(mon, i));
  const label = `${fmtDay(days[0])} – ${fmtDay(days[6], true)}`;
  return `<div class="card cal-card">${cardHead('🗓', 'My week', `<span class="cal-nav"><button class="btn sm" data-action="calWeek" data-n="-1">‹</button><button class="btn sm" data-action="calWeek" data-n="0">This week</button><button class="btn sm" data-action="calWeek" data-n="1">›</button></span><span class="muted small">${label}</span><button class="btn sm" style="margin-left:auto" data-action="calFocus">✏️ Focus days</button>`)}
    <div class="cal-week">${days.map(d => {
      const dow = dayOf(d).getDay(), items = dayItems(d), f = focusOf(dow);
      return `<div class="cal-day ${d === t ? 'today' : ''} ${d < t ? 'past' : ''}">
        <div class="cal-dh"><b>${DOW[dow]}</b> <span>${fmtDay(d)}</span>${d === t ? '<span class="pill grn">Today</span>' : ''}</div>
        ${f ? `<div class="cal-focus">🎯 ${esc(f)}</div>` : ''}
        <div class="cal-list">${items.map(i => calItemHtml(i)).join('') || '<div class="muted small">Nothing due</div>'}</div>
        <button class="cal-add" data-action="calAdd" data-day="${d}">+ Add</button></div>`;
    }).join('')}</div></div>`;
}
function monthHtml() {
  const t = today(), base = dayOf(t); base.setDate(1); base.setMonth(base.getMonth() + calMonth);
  const first = ymd(base), back = (base.getDay() + 6) % 7, start = addDays(first, -back);
  const month = base.getMonth();
  const cells = [...Array(42)].map((_, i) => addDays(start, i));
  const rows = cells[35] && dayOf(cells[35]).getMonth() !== month ? 35 : 42;
  return `<div class="card cal-card" style="margin-top:16px">${cardHead('📅', base.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), `<span class="cal-nav"><button class="btn sm" data-action="calMonth" data-n="-1">‹</button><button class="btn sm" data-action="calMonth" data-n="0">This month</button><button class="btn sm" data-action="calMonth" data-n="1">›</button></span>`)}
    <div class="cal-month"><div class="cal-mh">Mon</div><div class="cal-mh">Tue</div><div class="cal-mh">Wed</div><div class="cal-mh">Thu</div><div class="cal-mh">Fri</div><div class="cal-mh">Sat</div><div class="cal-mh">Sun</div>
    ${cells.slice(0, rows).map(d => {
      const items = dayItems(d).filter(i => i.cls !== 'rule');
      return `<div class="cal-cell ${dayOf(d).getMonth() !== month ? 'out' : ''} ${d === t ? 'today' : ''}" data-action="calDay" data-day="${d}">
        <div class="cal-num">${dayOf(d).getDate()}</div>${items.slice(0, 3).map(i => calItemHtml({ ...i, act: '' }, true)).join('')}${items.length > 3 ? `<div class="cal-more">+${items.length - 3} more</div>` : ''}</div>`;
    }).join('')}</div>
    <div class="small muted" style="margin-top:8px">Click a day to see everything on it or add something. Weekly things (Friday purchasing, Sunday dispatch) show on the week above.</div></div>`;
}

// Reads a day out of plain words (2026-11-25, owner: things typed to the AI must land on the calendar).
// "wash the cars on thursday" → { date: Thu, text: 'Wash the cars' }. No day found = null.
const CAL_MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const CAL_DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
function calParse(raw) {
  let s = ' ' + raw.trim() + ' ', date = '';
  const t = today(), cut = re => { s = s.replace(re, ' '); };
  let m;
  if ((m = s.match(/\s(on\s+)?(the\s+)?(\d{1,2})\/(\d{1,2})(\/(\d{2,4}))?\s/i))) {
    let y = m[6] ? +m[6] : dayOf(t).getFullYear(); if (y < 100) y += 2000;
    const d = new Date(y, +m[3] - 1, +m[4]); if (!m[6] && ymd(d) < t) d.setFullYear(y + 1);
    date = ymd(d); cut(m[0]);
  } else if ((m = s.match(new RegExp(`\\s(on\\s+)?(${CAL_MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(st|nd|rd|th)?(,?\\s+(\\d{4}))?\\s`, 'i')))) {
    const y = m[6] ? +m[6] : dayOf(t).getFullYear();
    const d = new Date(y, CAL_MONTHS.indexOf(m[2].toLowerCase().slice(0, 3)), +m[3]); if (!m[6] && ymd(d) < t) d.setFullYear(y + 1);
    date = ymd(d); cut(m[0]);
  } else if ((m = s.match(/\s(for\s+|on\s+)?(today|tonight|this evening)\s/i))) { date = t; cut(m[0]); }
  else if ((m = s.match(/\s(for\s+|on\s+)?(tomorrow|tmrw)\s/i))) { date = addDays(t, 1); cut(m[0]); }
  else if ((m = s.match(/\s(on\s+|this\s+|next\s+|for\s+)?(monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)'?s?[.,]?\s/i))) {
    const want = CAL_DAYS.findIndex(d => d.startsWith(m[2].toLowerCase().slice(0, 3)));
    let add = (want - dayOf(t).getDay() + 7) % 7;
    if (/next/i.test(m[1] || '') && add < 7) add += add === 0 ? 7 : 7;
    date = addDays(t, add); cut(m[0]);
  }
  if (!date) return null;
  let text = s.replace(/\s+/g, ' ').trim()
    .replace(/^(please\s+)?(park|remember|remind me|don'?t forget|note|add|put|schedule|set)\b[:\s,-]*/i, '')
    .replace(/\b(to|on|in)\s+(the\s+|my\s+)?(calendar|schedule)\b/gi, '')
    .replace(/^(to|that i need to|i need to|i have to|need to)\s+/i, '')
    .replace(/[\s,.-]+$/, '').replace(/\s+(by|before|until|due|on|for|this|next|at)$/i, '').trim();
  if (!text) return null;
  return { date, text: text[0].toUpperCase() + text.slice(1) };
}
// Asks first, then puts it on the calendar. Returns true when added.
async function calAddParsed(p) {
  const v = await form('📅 Put this on the calendar?', [
    { name: 'text', label: 'What', required: true },
    { name: 'date', label: 'Day', type: 'date', required: true }
  ], p, { saveLabel: '📅 Add to calendar' });
  if (!v) return false;
  db.events ||= []; db.events.push({ id: uid(), text: v.text, date: v.date, at: Date.now() });
  await saveDb(); render(); toast('📅 On the calendar · ' + fmtDay(v.date, true));
  return v;
}

// Put them under the checklist on My Workday
const calWorkday0 = views.workday.html;
views.workday.html = function () { return calWorkday0.apply(this, arguments) + `<div style="margin-top:16px">${weekHtml()}</div>${monthHtml()}`; };

async function calAddTo(day) {
  const v = await form('Add to ' + dayOf(day).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }), [
    { name: 'text', label: 'What', required: true, hint: 'A reminder, an appointment, a follow-up…' },
    { name: 'date', label: 'Day', type: 'date', required: true, value: day }
  ]);
  if (!v) return;
  if (!(await sure('Add this?', [`${esc(v.text)} · ${fmtDay(v.date, true)}`]))) return;
  db.events ||= []; db.events.push({ id: uid(), text: v.text, date: v.date, at: Date.now() });
  await saveDb(); render(); toast('✓ Added');
}
Object.assign(actions, {
  calWeek: el => { calWeek = +el.dataset.n === 0 ? 0 : calWeek + +el.dataset.n; render(); },
  calMonth: el => { calMonth = +el.dataset.n === 0 ? 0 : calMonth + +el.dataset.n; render(); },
  calGo: el => { location.hash = el.dataset.go; },
  calAdd: el => calAddTo(el.dataset.day),
  calDay: async el => {
    const day = el.dataset.day, items = dayItems(day);
    const r = await ask(dayOf(day).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
      `${focusOf(dayOf(day).getDay()) ? `<div class="cal-focus">🎯 Focus: ${esc(focusOf(dayOf(day).getDay()))}</div>` : ''}<div class="cal-list" style="margin-top:8px">${items.map(i => calItemHtml(i)).join('') || '<div class="muted">Nothing on this day.</div>'}</div>`,
      [{ label: 'Close', value: null }, { label: '+ Add to this day', cls: 'pri', value: 'add' }]);
    if (r === 'add') calAddTo(day);
  },
  calEvent: async el => {
    const e = byId(db.events || [], el.dataset.id); if (!e) return;
    document.querySelector('.modal-bg')?.remove();
    const v = await form('Edit item', [
      { name: 'text', label: 'What', required: true },
      { name: 'date', label: 'Day', type: 'date', required: true },
      { name: 'done', label: 'Done', type: 'check', text: 'Done' }
    ], e, { onDelete: async () => { if (await sure('Delete this?', [esc(e.text)], 'Delete')) { db.events = db.events.filter(x => x !== e); await saveDb(); render(); return true; } } });
    if (!v) return;
    if (!(await sure('Save these changes?', [`${esc(v.text)} · ${fmtDay(v.date, true)}${v.done ? ' · done' : ''}`]))) return;
    Object.assign(e, v); await saveDb(); render(); toast('✓ Saved');
  },
  calFocus: async () => {
    const order = [1, 2, 3, 4, 5, 6, 0];
    const names = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };
    const vals = Object.fromEntries(order.map(d => ['d' + d, focusOf(d)]));
    const v = await form('🎯 Focus days', order.map(d => ({ name: 'd' + d, label: names[d], hint: d === 1 ? 'One subject a day, so the rest can wait for its day. Leave empty for none.' : '' })), vals);
    if (!v) return;
    if (!(await sure('Save the focus days?', order.map(d => `${names[d]}: <b>${esc(v['d' + d] || '—')}</b>`)))) return;
    order.forEach(d => { db.settings.focus[d] = v['d' + d]; }); await saveDb(); render(); toast('✓ Saved');
  }
});
// Clicking something inside a month cell opens the day, not the item
