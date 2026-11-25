/* 📝 Scratch pad (2026-11-25, owner: "think of it like a scratch pad to write down a lot of notes and they can all go in the
   right places… she might write a lot of stuff so maybe ask where she wants it to go… like the scan anything section").
   She writes (or talks) everything down in one box; it is cut into separate items, each gets a guess where it goes
   (calendar day, today's list, bill, shop request, ask the owner, renewal, park), she checks / changes them, and
   "File N items" puts each in its place after one "are you sure?". Items it can't place are asked about ("Where should this go?").
   Sorting: the real AI (office-assistant mode "sort") once the CRM is online; until then the CRM's own word rules (spSortLocal). */

const SP_DEST = {
  cal:     { ico: '📅', label: 'Calendar (a day)' },
  today:   { ico: '✅', label: 'Today’s list' },
  bill:    { ico: '🧾', label: 'Bill to pay' },
  shop:    { ico: '🛒', label: 'Shop purchase request' },
  owner:   { ico: '👤', label: 'Ask the owner' },
  renewal: { ico: '🛡️', label: 'Renewal / expiring' },
  park:    { ico: '🅿', label: 'Park it for later' }
};
const SP_MONEY_RE = /\$\s?(\d[\d,]*(\.\d{1,2})?)|\b(\d[\d,]*(\.\d{2})?)\s?(dollars|bucks)\b/i;

// Cut a brain dump into separate items: lines, bullets, ";", sentences, "also".
function spSplit(text) {
  return text.split(/\n+/)
    .flatMap(l => l.split(/;|(?<=[a-z0-9)])[.!]\s+(?=[A-Za-z])|\s+(?:and\s+)?also\s+/i))
    .map(s => s.replace(/^\s*([-*•·]|\d+[.)])\s*/, '').replace(/[.!]+$/, '').trim())
    .filter(s => s.length > 1);
}
function spCap(s) { s = s.trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; }
function spClean(s) {
  return spCap(s.replace(/^(please\s+)?(park|remember|remind me( to)?|don'?t forget( to)?|note|add|put)\b[:\s,-]*/i, '')
    .replace(/\b(to|on|in)\s+(the\s+|my\s+)?(calendar|schedule)\b/gi, '')
    .replace(/^(to|that i need to|i need to|i have to|need to|we need to)\s+/i, '').replace(/\s+/g, ' ').trim());
}
// One item → a guess where it goes. sure = false shows "Check where this goes".
function spGuess(raw) {
  const n = norm(raw), p = calParse(raw), date = p?.date || '';
  const text = spClean(p ? p.text : raw);
  const m = raw.match(SP_MONEY_RE), amount = m ? moneyParse(m[1] || m[3]) : '';
  const it = { text, dest: '', date, amount, vendor: '', sure: true };
  if (/\b(ask|check with|run (it|this|that)? ?by|tell)\s+(the\s+)?(owner|boss)\b|\bowner\b.*\b(approv|ok|sign off)|\bneeds? (owner )?approval/.test(n)) it.dest = 'owner';
  else if (/\b(bill|invoice|statement|payment due|owe|past due|autopay)\b|\bpay (the )?\w+/.test(n) && !/pay later/.test(n)) {
    it.dest = 'bill';
    const v = raw.match(/\b[Pp]ay(?:\s+the)?\s+([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*)*)/) || raw.match(/\b([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*)*)\s+([Bb]ill|[Ii]nvoice|[Ss]tatement)/);
    it.vendor = v ? v[1].replace(/^(Pay\s+)?(The|My|Our)\s+/, '').replace(/^Pay\s+/, '') : '';
    it.text = spCap(it.text.replace(SP_MONEY_RE, '').replace(/^pay\s+(the\s+)?/i, '').replace(/\s+(by|before|due)$/i, '').replace(/\s+/g, ' ').trim());
    if (!it.date || !it.amount || !it.vendor) it.sure = false;
  }
  else if (/\b(renew\w*|expir\w*|license|registration|tabs|policy|coi|certificat\w*)\b/.test(n)) { it.dest = 'renewal'; if (!date) it.sure = false; }
  else if (/\b(order|buy|purchase|restock|running low|out of|need more|get more|pick up more)\b/.test(n)) {
    it.dest = 'shop'; if (/need more|get more/.test(n)) it.sure = false;
    it.text = spCap(text.replace(/^(order|buy|purchase|restock|get|pick up)\s+(more\s+|some\s+|a\s+|an\s+)?/i, '').replace(/^(we('re| are) )?(running low on|out of)\s+/i, '').replace(/^need more\s+/i, ''));
  }
  else if (date) it.dest = 'cal';
  else if (/^(call|email|text|send|follow up|follow-up|check|file|print|update|schedule|book|pick up|drop off|mail|reply|look into|find|clean|wash|fill|sign|scan|enter|do)\b/.test(norm(text))) it.dest = 'today';
  else { it.dest = ''; it.sure = false; }
  if (it.dest === 'cal' && date === today()) it.dest = 'today';
  if (/^\s*park\b/i.test(raw) && (!it.dest || it.dest === 'today')) { it.dest = 'park'; it.sure = true; }
  return it;
}
function spSortLocal(text) { return spSplit(text).map(spGuess); }
async function spSort(text) {
  if (window.officeCloud?.invoke) {
    try {
      const r = await window.officeCloud.invoke('office-assistant', { mode: 'sort', text, today: today() });
      const items = r?.data?.items || r?.items;
      if (Array.isArray(items) && items.length) return { items: items.map(x => ({ text: x.text || '', dest: SP_DEST[x.dest] ? x.dest : '', date: x.date || '', amount: x.amount || '', vendor: x.vendor || '', sure: x.sure !== false })), ai: true };
    } catch (e) { console.warn('Scratch pad AI failed, using the CRM rules', e); }
  }
  return { items: spSortLocal(text), ai: false };
}

let spDraft = '';   // what she wrote, kept while the CRM is open
// opts: { text, parkedIds } (parkedIds = parked thoughts being sorted; they leave the parked list once filed)
function spOpen(opts = {}) {
  document.querySelector('.sp-bg')?.remove();
  const bg = document.createElement('div');
  bg.className = 'modal-bg sp-bg';
  bg.innerHTML = `<div class="modal sp-modal" role="dialog">
    <div class="modal-head"><button class="modal-x" data-sp-back title="Back">‹</button><h3>📝 Scratch pad</h3><button class="modal-x" data-sp-x>✕ Close</button></div>
    <div class="sp-body" data-sp-body></div>
    <div class="modal-foot" data-sp-foot></div></div>`;
  modalRoot().appendChild(bg);
  const st = { text: opts.text ?? spDraft, items: null, ai: false, parkedIds: opts.parkedIds || [] };
  const body = bg.querySelector('[data-sp-body]'), foot = bg.querySelector('[data-sp-foot]');
  const close = async () => {
    const typed = st.items ? st.items.length : (bg.querySelector('[data-sp-text]')?.value || '').trim();
    if (st.items && typed && !(await sure('Leave without filing?', ['Nothing is filed yet. What you wrote stays in the scratch pad.'], 'Leave'))) return;
    if (!st.items) spDraft = bg.querySelector('[data-sp-text]')?.value || '';
    bg.remove();
  };
  const write = () => {
    st.items = null;
    body.innerHTML = `<div class="sp-tip">Write everything that’s on your mind, one thing per line or just in sentences. Talk with the 🎤 if that’s easier. I’ll split it up and show you where each thing goes before anything is saved.</div>
      <textarea class="sp-text" data-sp-text placeholder="Example:&#10;Pay the Comcast bill $189 by Friday&#10;Order more shop towels&#10;Ask the owner about the new dehu&#10;Wash the trucks Thursday&#10;Call the insurance agent">${esc(st.text)}</textarea>`;
    foot.innerHTML = `<button class="btn" data-sp-clear>Clear</button><button class="btn" data-sp-mic>🎤 Talk</button><button class="btn pri" data-sp-sort>✨ Sort it out</button>`;
    const ta = body.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.addEventListener('input', () => { st.text = ta.value; spDraft = ta.value; });
  };
  const rowHtml = (x, i) => {
    const need = x.on && !x.dest;
    const d = x.dest;
    const extra = [];
    if (['cal', 'bill', 'renewal'].includes(d)) extra.push(`<label>${d === 'bill' ? 'Due' : d === 'renewal' ? 'Expires' : 'Day'}<input type="date" data-sp-f="date" value="${esc(x.date)}"></label>`);
    if (d === 'bill') extra.push(`<label>Vendor<input data-sp-f="vendor" value="${esc(x.vendor)}" placeholder="Who"></label>`);
    if (['bill', 'shop', 'owner'].includes(d)) extra.push(`<label>${d === 'shop' ? 'Price each' : 'Amount'}<input data-sp-f="amount" inputmode="decimal" value="${x.amount === '' ? '' : esc(String(x.amount))}" placeholder="$"></label>`);
    return `<div class="sp-row ${x.on ? '' : 'off'} ${need || (!x.sure && x.on) ? 'ask' : ''}" data-i="${i}">
      <input type="checkbox" data-sp-on ${x.on ? 'checked' : ''} title="File this one">
      <div class="sp-main">
        <input class="sp-t" data-sp-f="text" value="${esc(x.text)}">
        <div class="sp-where">
          <select data-sp-f="dest"><option value="">❓ Where should this go?</option>${Object.entries(SP_DEST).map(([k, v]) => `<option value="${k}" ${k === d ? 'selected' : ''}>${v.ico} ${v.label}</option>`).join('')}</select>
          ${extra.join('')}
        </div>
        ${need ? '<div class="sp-q">❓ I wasn’t sure where this goes. Pick a place, or untick it.</div>' : !x.sure && x.on ? '<div class="sp-q">Check this one, I’m not sure.</div>' : ''}
      </div></div>`;
  };
  const review = () => {
    const n = st.items.filter(x => x.on).length, unsure = st.items.filter(x => x.on && (!x.dest || !x.sure)).length;
    body.innerHTML = `${st.ai ? '' : '<div class="alert amb small">Sorted by the CRM’s own word rules for now. The real AI sorts it smarter once the CRM is online.</div>'}
      <div class="sp-sum">I found <b>${st.items.length}</b> thing${st.items.length === 1 ? '' : 's'}.${unsure ? ` <span class="pill amb">${unsure} to check</span>` : ' Everything has a place.'}</div>
      <div class="sp-list">${st.items.map(rowHtml).join('')}</div>`;
    foot.innerHTML = `<button class="btn" data-sp-edit>‹ Change what I wrote</button><button class="btn pri" data-sp-file ${n ? '' : 'disabled'}>File ${n} item${n === 1 ? '' : 's'}</button>`;
  };
  const sortIt = async () => {
    const text = (bg.querySelector('[data-sp-text]')?.value || st.text).trim();
    if (!text) return toast('Write something first');
    st.text = text; spDraft = text;
    foot.querySelector('[data-sp-sort]').textContent = '✨ Sorting…';
    const r = await spSort(text);
    st.ai = r.ai; st.items = r.items.map(x => ({ ...x, on: true }));
    if (!st.items.length) { toast('I couldn’t find anything to sort'); return write(); }
    review();
  };
  const file = async () => {
    const list = st.items.filter(x => x.on);
    for (const x of list) {
      if (!x.text.trim()) return toast('One item has no words');
      if (!x.dest) return toast(`Pick where “${x.text}” goes, or untick it`);
      if (['cal', 'renewal'].includes(x.dest) && !x.date) return toast(`Pick the day for “${x.text}”`);
      if (x.dest === 'bill' && (!x.date || x.amount === '' || !x.vendor)) return toast(`“${x.text}” needs a vendor, amount and due date to be a bill`);
    }
    const lines = list.map(x => `${SP_DEST[x.dest].ico} <b>${esc(x.text)}</b> → ${SP_DEST[x.dest].label}${x.date && x.dest !== 'today' ? ' · ' + fmtDay(x.date, true) : ''}${x.amount !== '' && x.amount != null ? ' · ' + money(+x.amount) : ''}`);
    if (!(await sure(`File ${list.length} item${list.length === 1 ? '' : 's'}?`, lines, 'Yes, file them'))) return;
    const now = Date.now(), wd = workdayToday().d;
    db.events ||= [];
    for (const x of list) {
      const amt = x.amount === '' ? '' : +x.amount;
      if (x.dest === 'cal') db.events.push({ id: uid(), text: x.text, date: x.date, at: now, via: 'scratch pad' });
      if (x.dest === 'today') wd.extra.push({ id: uid(), text: x.text });
      if (x.dest === 'bill') db.bills.push({ id: uid(), vendor: x.vendor, what: x.text, amount: amt, due: x.date, repeat: 'none', note: 'From the scratch pad', at: now });
      if (x.dest === 'shop') db.purchases.push({ id: uid(), item: x.text, qty: 1, price: amt, by: 'Office Manager', note: 'From the scratch pad', status: 'pending', at: now });
      if (x.dest === 'owner') db.approvals.push({ id: uid(), title: x.text, kind: 'Other', amount: amt, detail: '', purchaseId: '', billId: '', status: 'pending', askedAt: now });
      if (x.dest === 'renewal') db.renewals.push({ id: uid(), name: x.text, expires: x.date, note: 'From the scratch pad' });
      if (x.dest === 'park') hp().parked.push({ id: uid(), text: x.text, at: now });
    }
    // Parked thoughts that were sorted leave the parked list (only when every piece of them was filed)
    if (st.parkedIds.length) { const h = hp(); h.parked = h.parked.filter(p => !st.parkedIds.includes(p.id) || st.items.some(x => x.from === p.id && !x.on)); }
    spDraft = '';
    await saveDb(); bg.remove(); render();
    const where = [...new Set(list.map(x => SP_DEST[x.dest].ico))].join(' ');
    toast(`✓ Filed ${list.length} item${list.length === 1 ? '' : 's'} ${where}`);
  };
  bg.addEventListener('click', e => {
    const t = e.target;
    if (t === bg || t.closest('[data-sp-x]')) return close();
    if (t.closest('[data-sp-back]')) return st.items ? write() : close();
    if (t.closest('[data-sp-clear]')) { st.text = ''; spDraft = ''; return write(); }
    if (t.closest('[data-sp-sort]')) return sortIt();
    if (t.closest('[data-sp-edit]')) return write();
    if (t.closest('[data-sp-file]')) return file();
    if (t.closest('[data-sp-mic]')) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition, ta = bg.querySelector('[data-sp-text]');
      if (!SR) { ta.focus(); return toast('Tap the 🎤 on your keyboard to talk'); }
      const rec = new SR(); rec.lang = 'en-US'; rec.continuous = true; const start = ta.value;
      rec.onresult = ev => { ta.value = (start ? start.replace(/\s*$/, '\n') : '') + [...ev.results].map(r => r[0].transcript).join(' '); st.text = spDraft = ta.value; };
      rec.onerror = () => toast('The mic didn’t work. Use the 🎤 on your keyboard.');
      rec.start(); toast('🎤 Listening… tap Sort it out when done');
    }
  });
  bg.addEventListener('change', e => {
    const row = e.target.closest('.sp-row'); if (!row || !st.items) return;
    const x = st.items[+row.dataset.i];
    if (e.target.matches('[data-sp-on]')) { x.on = e.target.checked; return review(); }
    const f = e.target.dataset.spF; if (!f) return;
    x[f] = f === 'amount' ? (e.target.value.trim() === '' ? '' : moneyParse(e.target.value)) : e.target.value;
    if (f === 'dest') { x.sure = true; review(); }
  });
  bg.addEventListener('input', e => {
    const row = e.target.closest('.sp-row'); if (!row || !st.items) return;
    const f = e.target.dataset.spF; if (f === 'text' || f === 'vendor') st.items[+row.dataset.i][f] = e.target.value;
  });
  bg.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  if (opts.items) { st.items = opts.items.map(x => ({ ...x, on: true })); review(); }
  else if (opts.sortNow && st.text.trim()) { write(); sortIt(); } else write();
}

Object.assign(actions, {
  spOpen: () => spOpen(),
  // Her parked thoughts go through the scratch pad, so "wash the cars on thursday" lands on Thursday.
  spSortParked: () => { const p = hp().parked; if (!p.length) return toast('Nothing parked'); spOpen({ text: p.map(x => x.text).join('\n'), parkedIds: p.map(x => x.id), items: p.flatMap(x => spSplit(x.text).map(s => ({ ...spGuess(s), from: x.id }))) }); }
});
