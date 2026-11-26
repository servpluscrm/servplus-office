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
  renewal: { ico: '🛡️', label: 'Renewal / expiring' }
};
const SP_MONEY_RE = /\$\s?(\d[\d,]*(\.\d{1,2})?)|\b(\d[\d,]*(\.\d{2})?)\s?(dollars|bucks)\b/i;

// Cut a brain dump into separate items: lines, bullets, ";", sentences, "also".
// Run-on typing ("remind me to cash checks on friday ask the owner about comcast bill") is also cut before words that
// start a new thing (remind me, ask the owner, pay the, order…); a piece left hanging ("remind me to") joins the next one.
const SP_STARTERS = /\s*,?\s+(?:and\s+|then\s+)?(?=(?:remind me|don'?t forget|remember to|ask (?:the )?(?:owner|boss)|check with (?:the )?(?:owner|boss)|tell (?:the )?(?:owner|boss)|pay (?:the )?|order (?:more |some )?|buy (?:more |some )?|park:|approve|talk to|call|email|text|check on|follow up with|set up|look into|send)\b)/i;
function spSplit(text) {
  const parts = text.split(/\n+/)
    .flatMap(l => l.split(/;|(?<=[a-z0-9)])[.!]\s+(?=[A-Za-z])|\s+(?:and\s+)?also\s+/i))
    .flatMap(l => l.split(SP_STARTERS))
    .map(s => s.replace(/^\s*([-*•·]|\d+[.)])\s*/, '').replace(/[.!,]+$/, '').trim())
    .filter(s => s.length > 1);
  const out = [];
  for (const p of parts) {
    if (out.length && /\b(to|me|about|and|the|for|with)$/i.test(out[out.length - 1])) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out;
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
  if (/\b(ask|check with|run (it|this|that)? ?by|tell)\s+(the\s+)?(owner|boss)\b|\bowner\b.*\b(approv|ok|sign off)|\bapprov\w*\b.*\b(owner|boss)\b|\bneeds? (owner )?approval/.test(n)) it.dest = 'owner';
  else if (/\b(bill|invoice|statement|payment due|owe|past due|autopay)\b|\bpay (the )?\w+/.test(n) && !/pay later/.test(n)) {
    it.dest = 'bill';
    const v = raw.match(/\b[Pp]ay(?:\s+the)?\s+([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*)*)/) || raw.match(/\b([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*)*)\s+([Bb]ill|[Ii]nvoice|[Ss]tatement)/);
    it.vendor = v ? v[1].replace(/^(Pay\s+)?(The|My|Our)\s+/, '').replace(/^Pay\s+/, '') : '';
    if (!it.vendor) { const w = raw.match(/\bpay\s+(?:the\s+)?([a-z][\w&'.-]*)/i); if (w && !/^(for|bill|invoice|it|them|him|her)$/i.test(w[1])) it.vendor = spCap(w[1]); }
    it.text = spCap(it.text.replace(SP_MONEY_RE, '').replace(/^pay\s+(the\s+)?/i, '').replace(/\s+(by|before|due)$/i, '').replace(/\s+/g, ' ').trim());
    if (it.vendor && norm(it.text) === norm(it.vendor)) it.text = 'Pay ' + it.vendor;
    if (!it.date || !it.amount || !it.vendor) it.sure = false;
  }
  else if (/\b(renew\w*|expir\w*|license|registration|tabs|policy|coi|certificat\w*)\b/.test(n)) { it.dest = 'renewal'; if (!date) it.sure = false; }
  else if (/\b(order|buy|purchase|restock|running low|out of|need more|get more|pick up more)\b/.test(n)) {
    it.dest = 'shop'; if (/need more|get more/.test(n)) it.sure = false;
    it.text = spCap(text.replace(/^(order|buy|purchase|restock|get|pick up)\s+(more\s+|some\s+|a\s+|an\s+)?/i, '').replace(/^(we('re| are) )?(running low on|out of)\s+/i, '').replace(/^need more\s+/i, ''));
  }
  else if (date) it.dest = 'cal';
  else if (/^(talk to|meet|call|email|text|send|follow up|follow-up|check|file|print|update|schedule|book|pick up|drop off|mail|reply|look into|find|clean|wash|fill|sign|scan|enter|do)\b/.test(norm(text))) it.dest = 'today';
  else { it.dest = ''; it.sure = false; }
  if (it.dest === 'cal' && date === today()) it.dest = 'today';
  if (/^\s*park\b/i.test(raw) && (!it.dest || it.dest === 'today')) { it.dest = 'today'; it.sure = true; }
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

// Checks, asks once ("File N items?"), then puts each ticked item in its place. Returns the filed list, or null.
function spLine(x) { return `${SP_DEST[x.dest].ico} <b>${esc(x.text)}</b> → ${SP_DEST[x.dest].label}${x.date && x.dest !== 'today' && x.dest !== 'shop' && x.dest !== 'owner' && x.dest !== 'park' ? ' · ' + fmtDay(x.date, true) : ''}${x.amount !== '' && x.amount != null ? ' · ' + money(+x.amount) : ''}`; }
async function spFileItems(items, parkedIds = [], via = 'scratch pad', stamp = {}) {
  const list = items.filter(x => x.on);
  if (!list.length) { toast('Nothing is ticked'); return null; }
  for (const x of list) {
    if (!x.text.trim()) { toast('One item has no words'); return null; }
    if (!x.dest) { toast(`Pick where “${x.text}” goes, or untick it`); return null; }
    if (['cal', 'renewal'].includes(x.dest) && !x.date) { toast(`Pick the day for “${x.text}”`); return null; }
    if (x.dest === 'bill' && (!x.date || x.amount === '' || !x.vendor)) { toast(`“${x.text}” needs who, how much and the due date to be a bill`); return null; }
  }
  if (!(await sure(`File ${list.length} item${list.length === 1 ? '' : 's'}?`, list.map(spLine), 'Yes, file them'))) return null;
  const now = Date.now(), wd = workdayToday().d;
  db.events ||= [];
  for (const x of list) {
    const amt = x.amount === '' ? '' : +x.amount;
    if (x.dest === 'cal') db.events.push({ id: uid(), text: x.text, date: x.date, at: now, via, ...stamp });
    if (x.dest === 'today') wd.extra.push({ id: uid(), text: x.text, ...stamp });
    if (x.dest === 'bill') db.bills.push({ id: uid(), vendor: x.vendor, what: x.text, amount: amt, due: x.date, repeat: 'none', note: `From the ${via}`, at: now, ...stamp });
    if (x.dest === 'shop') db.purchases.push({ id: uid(), item: x.text, qty: 1, price: amt, by: 'Office Manager', note: `From the ${via}`, status: 'pending', at: now, ...stamp });
    if (x.dest === 'owner') db.approvals.push({ id: uid(), title: x.text, kind: 'Other', amount: amt, detail: `From the ${via}`, purchaseId: '', billId: '', status: 'pending', askedAt: now, ...stamp });
    if (x.dest === 'renewal') db.renewals.push({ id: uid(), name: x.text, expires: x.date, note: `From the ${via}`, ...stamp });
    if (x.dest === 'park') hp().parked.push({ id: uid(), text: x.text, at: now });
  }
  // Parked thoughts that were sorted leave the parked list (only when every piece of them was filed)
  if (parkedIds.length) { const h = hp(); h.parked = h.parked.filter(p => !parkedIds.includes(p.id) || items.some(x => x.from === p.id && !x.on)); }
  await saveDb();
  toast(`✓ Filed ${list.length} item${list.length === 1 ? '' : 's'} ${[...new Set(list.map(x => SP_DEST[x.dest].ico))].join(' ')}`);
  return list;
}

// ---------- The helper's chat IS the scratch pad (owner 2026-11-25: "remind me to cash checks on friday ask the owner
// about comcast bill… then it will go into the right places after asking her"). The sorted items show as an answer in
// the chat: each with a tick, its words, where it goes (+ day / amount); "✓ File these" asks once, then files. ----------
function spChatHtml(m, mi) {
  const s = m.sp;
  if (s.sorting) return `📝 Sorting that out…`;
  if (s.done) return `✓ Done. I put ${s.done.length === 1 ? 'it' : 'them'} away:<div class="spc-done">${s.done.map(x => `<div>${spLine(x)}</div>`).join('')}</div>`;
  if (s.cancel) return `<span class="muted">Okay, I didn’t save ${s.items.length === 1 ? 'it' : 'those'}.</span>`;
  const n = s.items.filter(x => x.on).length;
  const ask = s.items.filter(x => x.on && (!x.dest || !x.sure)).length;
  return `${s.items.length === 1 ? 'Here’s where I’d put it.' : `I found <b>${s.items.length}</b> things. Here’s where I’d put them.`}${ask ? ` <b>${ask === 1 ? 'One needs' : ask + ' need'} your help</b> (yellow).` : ''}
    <div class="spc-list">${s.items.map((x, i) => {
      const d = x.dest, extra = [];
      if (['cal', 'bill', 'renewal'].includes(d)) extra.push(`<input type="date" data-spc-f="date" value="${esc(x.date)}" title="${d === 'bill' ? 'Due' : d === 'renewal' ? 'Expires' : 'Day'}">`);
      if (d === 'bill') extra.push(`<input data-spc-f="vendor" value="${esc(x.vendor)}" placeholder="Who to pay">`);
      if (['bill', 'shop', 'owner'].includes(d)) extra.push(`<input data-spc-f="amount" inputmode="decimal" value="${x.amount === '' || x.amount == null ? '' : esc(String(x.amount))}" placeholder="$ amount">`);
      return `<div class="spc-row ${x.on ? '' : 'off'} ${x.on && (!d || !x.sure) ? 'ask' : ''}" data-i="${i}">
        <label class="spc-top"><input type="checkbox" data-spc-on ${x.on ? 'checked' : ''}><input class="spc-t" data-spc-f="text" value="${esc(x.text)}"></label>
        <select data-spc-f="dest"><option value="">❓ Where should this go?</option>${Object.entries(SP_DEST).map(([k, v]) => `<option value="${k}" ${k === d ? 'selected' : ''}>${v.ico} ${v.label}</option>`).join('')}</select>
        ${extra.length ? `<div class="spc-extra">${extra.join('')}</div>` : ''}
        ${x.on && !d ? '<div class="spc-q">Where should this go?</div>' : x.on && !x.sure ? '<div class="spc-q">I’m not sure on this one, check it.</div>' : ''}
      </div>`;
    }).join('')}</div>
    <div class="spc-btns"><button class="spc-no" data-spc-cancel>Never mind</button><button class="spc-yes" data-spc-file ${n ? '' : 'disabled'}>✓ File ${n === 1 ? 'it' : 'these ' + n}</button></div>
    ${s.ai ? '' : '<div class="spc-note">Sorted by simple word rules for now; the real AI sorts once the CRM is online.</div>'}`;
}
// She typed notes in the chat
async function spChatAdd(text) {
  const m = { who: 'ai', sp: { sorting: true, items: [] } };
  hpChat.push({ who: 'me', html: esc(text) }, m);
  hpView = 'chat'; drawHelperBody();
  const r = await spSort(text);
  m.sp = { items: r.items.map(x => ({ ...x, on: true })), ai: r.ai };
  if (!m.sp.items.length) { delete m.sp; m.html = 'I couldn’t find anything to put away in that. Try “remind me to … on Friday”.'; }
  drawHelperBody();
}
function spChatMsg(el) { const w = el.closest('[data-spm]'); return w ? hpChat[+w.dataset.spm] : null; }
document.addEventListener('change', e => {
  const m = spChatMsg(e.target), row = e.target.closest('.spc-row'); if (!m?.sp || !row) return;
  const x = m.sp.items[+row.dataset.i];
  if (e.target.matches('[data-spc-on]')) { x.on = e.target.checked; return drawHelperBody(); }
  const f = e.target.dataset.spcF; if (!f) return;
  x[f] = f === 'amount' ? (e.target.value.trim() === '' ? '' : moneyParse(e.target.value)) : e.target.value;
  if (f === 'dest') { x.sure = true; drawHelperBody(); }
});
document.addEventListener('input', e => {
  const m = spChatMsg(e.target), row = e.target.closest('.spc-row'); if (!m?.sp || !row) return;
  const f = e.target.dataset.spcF; if (f === 'text' || f === 'vendor') m.sp.items[+row.dataset.i][f] = e.target.value;
});
document.addEventListener('click', async e => {
  const m = spChatMsg(e.target); if (!m?.sp) return;
  if (e.target.closest('[data-spc-cancel]')) { m.sp.cancel = true; return drawHelperBody(); }
  if (e.target.closest('[data-spc-file]')) { const done = await spFileItems(m.sp.items, m.sp.parkedIds || []); if (done) { m.sp.done = done; render(); } }
});

let spDraft = '';   // what she wrote, kept while the CRM is open
// opts: { text, parkedIds } (parkedIds = parked thoughts being sorted; they leave the parked list once filed)
function spOpen(opts = {}) {
  document.querySelector('.sp-bg')?.remove();
  const bg = document.createElement('div');
  bg.className = 'modal-bg sp-bg';
  bg.innerHTML = `<div class="modal sp-modal" role="dialog">
    <div class="modal-head"><button class="modal-x" data-sp-back title="Back">‹</button><h3>${opts.title || '📝 Scratch pad'}</h3><button class="modal-x" data-sp-x>✕ Close</button></div>
    <div class="sp-body" data-sp-body></div>
    <div class="modal-foot" data-sp-foot></div></div>`;
  modalRoot().appendChild(bg);
  const st = { text: opts.text ?? spDraft, items: null, ai: false, parkedIds: opts.parkedIds || [] };
  const body = bg.querySelector('[data-sp-body]'), foot = bg.querySelector('[data-sp-foot]');
  const close = async () => {
    const typed = st.items ? st.items.length : (bg.querySelector('[data-sp-text]')?.value || '').trim();
    if (st.items && typed && !(await sure('Leave without filing?', [opts.leaveLine || 'Nothing is filed yet. What you wrote stays in the scratch pad.'], 'Leave'))) return;
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
      ${opts.headHtml || ''}<div class="sp-sum">I found <b>${st.items.length}</b> thing${st.items.length === 1 ? '' : 's'}.${unsure ? ` <span class="pill amb">${unsure} to check</span>` : ' Everything has a place.'}</div>
      <div class="sp-list">${st.items.map(rowHtml).join('')}</div>`;
    foot.innerHTML = `${opts.headHtml ? '<button class="btn" data-sp-x>Cancel</button>' : '<button class="btn" data-sp-edit>‹ Change what I wrote</button>'}<button class="btn pri" data-sp-file ${n ? '' : 'disabled'}>File ${n} item${n === 1 ? '' : 's'}</button>`;
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
    const list = await spFileItems(st.items, st.parkedIds, opts.via, opts.stamp); if (!list) return;
    if (opts.onFiled) await opts.onFiled(list);
    spDraft = ''; bg.remove(); render();
  };
  bg.addEventListener('click', e => {
    const t = e.target;
    if (t === bg || t.closest('[data-sp-x]')) return close();
    if (t.closest('[data-sp-back]')) return st.items && !opts.headHtml ? write() : close();
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
  if (opts.items) { st.items = opts.items.map(x => ({ ...x, on: !x.off })); review(); }
  else if (opts.sortNow && st.text.trim()) { write(); sortIt(); } else write();
}

Object.assign(actions, {
  spOpen: () => spOpen(),
  // Her parked thoughts go through the scratch pad, so "wash the cars on thursday" lands on Thursday.
  spSortParked: () => { const p = hp().parked; if (!p.length) return toast('Nothing parked'); spOpen({ text: p.map(x => x.text).join('\n'), parkedIds: p.map(x => x.id), items: p.flatMap(x => spSplit(x.text).map(s => ({ ...spGuess(s), from: x.id }))) }); }
});

// ---------- 📝 The Scratch Pad (owner 2026-11-25): always at the top of the helper, which is always open. She scribbles
// anything (leaving the office, interrupted); it saves by itself (db.helper.pad). Next day ✨ Clean up turns it into a
// clean list (db.helper.padItems), each item showing where it would go; tapping one asks where + the few details it needs,
// then files it. Old parked thoughts (that feature is gone) are moved into the pad once. ----------
let padSaveT = 0, padBusy = false;
function padItems() { const h = hp(); h.padItems ||= []; return h.padItems; }
function padDraw() {
  const box = document.getElementById('hpPadBox'); if (!box || !db) return;
  const h = hp(), items = padItems();
  if (h.parked?.length) { h.pad = [h.pad, ...h.parked.map(p => p.text)].filter(Boolean).join('\n'); h.parked = []; saveDb(); }
  if (!box.firstChild) {
    box.innerHTML = `<div class="pad-head"><b>📝 Scratch pad</b><span class="pad-saved" id="padSaved"></span></div>
      <textarea id="hpPad" placeholder="Jot anything down here: on your way out, when you get interrupted… It saves by itself. Tomorrow tap ✨ Clean up."></textarea>
      <div class="pad-btns"><button class="pad-clean" data-pad-clean>✨ Clean up</button></div>
      <div class="pad-items" id="padItems"></div>`;
  }
  const ta = document.getElementById('hpPad');
  if (document.activeElement !== ta && ta.value !== (h.pad || '')) ta.value = h.pad || '';
  const cb = box.querySelector('[data-pad-clean]');
  cb.disabled = padBusy; cb.textContent = padBusy ? '✨ Cleaning up…' : '✨ Clean up';
  document.getElementById('padItems').innerHTML = items.length ? `<div class="pad-ih">Cleaned up · tap one to put it where it goes${items.length > 2 ? ' <button class="pad-clearall" data-pad-clearall>Clear all</button>' : ''}</div>${items.map(x => `<div class="pad-it ${x.dest ? '' : 'ask'}">
      <button class="pad-go" data-pad-go="${x.id}"><span class="pad-ico">${x.dest ? SP_DEST[x.dest].ico : '❓'}</span><span class="pad-tx"><b>${esc(x.text)}</b><small>${x.dest ? SP_DEST[x.dest].label + (x.date && ['cal', 'bill', 'renewal'].includes(x.dest) ? ' · ' + fmtDay(x.date) : '') : 'Needs a place'}</small></span><span class="pad-chev">›</span></button>
      <button class="pad-x" data-pad-del="${x.id}" title="Not needed">✕</button></div>`).join('')}` : '';
}
const padDrawHelper0 = drawHelper;
drawHelper = function () { const r = padDrawHelper0.apply(this, arguments); padDraw(); return r; };

document.addEventListener('input', e => {
  if (e.target.id !== 'hpPad') return;
  hp().pad = e.target.value; document.getElementById('padSaved').textContent = 'saving…';
  clearTimeout(padSaveT); padSaveT = setTimeout(async () => { await saveDb(); const s = document.getElementById('padSaved'); if (s) s.textContent = '✓ saved'; }, 700);
});
document.addEventListener('click', async e => {
  if (e.target.closest('[data-pad-clean]')) return padClean();
  const go = e.target.closest('[data-pad-go]'); if (go) return padMove(go.dataset.padGo);
  const del = e.target.closest('[data-pad-del]');
  if (del) {
    const x = byId(padItems(), del.dataset.padDel); if (!x) return;
    if (!(await sure('Remove this from the scratch pad?', [esc(x.text)], 'Yes, remove'))) return;
    hp().padItems = padItems().filter(i => i !== x); await saveDb(); padDraw();
  }
});

async function padClean() {
  const h = hp(), text = (document.getElementById('hpPad')?.value ?? h.pad ?? '').trim();
  if (!text) return toast('The scratch pad is empty');
  padBusy = true; padDraw();
  const r = await spSort(text);
  padBusy = false;
  if (!r.items.length) { padDraw(); return toast('I couldn’t find anything to clean up'); }
  const now = Date.now();
  padItems().push(...r.items.map(x => ({ id: uid(), text: x.text, dest: x.dest, date: x.date, amount: x.amount, vendor: x.vendor, at: now })));
  h.pad = ''; h.padOld = text;   // what she wrote is kept once, just in case
  const ta = document.getElementById('hpPad'); if (ta) ta.value = '';
  await saveDb(); padDraw();
  toast(`✨ Cleaned up into ${r.items.length} item${r.items.length > 1 ? 's' : ''}`);
}

// Step 1: pick a place (her guess already picked), then Next › (owner 2026-11-25: "should be a next button here").
function padPickDest(x) {
  return new Promise(res => {
    let pick = x.dest || '';
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog">
      <div class="modal-head"><button class="modal-x" data-x title="Back">‹</button><h3>Where should this go?</h3><button class="modal-x" data-x>✕ Close</button></div>
      <div class="modal-body"><div class="pad-ask-t">“${esc(x.text)}”</div>${x.dest ? `<div class="small muted" style="margin-bottom:10px">I think it goes on: ${SP_DEST[x.dest].ico} ${SP_DEST[x.dest].label}</div>` : '<div class="small muted" style="margin-bottom:10px">Pick where it goes.</div>'}
        <div class="pad-dests">${Object.entries(SP_DEST).map(([k, v]) => `<button class="pad-dest ${k === pick ? 'on' : ''}" data-d="${k}"><span>${v.ico}</span>${v.label}</button>`).join('')}</div></div>
      <div class="modal-foot"><button class="btn" data-x>Cancel</button><button class="btn pri" data-next ${pick ? '' : 'disabled'}>Next ›</button></div></div>`;
    const done = v => { bg.remove(); document.removeEventListener('keydown', key); res(v); };
    const key = e => { if (e.key === 'Escape') done(null); };
    bg.addEventListener('click', e => {
      if (e.target === bg || e.target.closest('[data-x]')) return done(null);
      const d = e.target.closest('[data-d]');
      if (d) {
        pick = d.dataset.d;
        bg.querySelectorAll('.pad-dest').forEach(b => b.classList.toggle('on', b === d));
        bg.querySelector('[data-next]').disabled = false;
        if (e.detail === 2) done(pick);   // a double-click goes straight on
        return;
      }
      if (e.target.closest('[data-next]') && pick) done(pick);
    });
    document.addEventListener('keydown', key);
    modalRoot().appendChild(bg);
  });
}

// Tap an item: where does it go? → the few details for that place → are you sure? → filed and off the pad.
async function padMove(id) {
  const x = byId(padItems(), id); if (!x) return;
  const dest = await padPickDest(x);
  if (!dest) return;
  const amt = x.amount === '' || x.amount == null ? '' : +x.amount, now = Date.now();
  let v, line, add;
  if (dest === 'cal') {
    v = await form('📅 Put it on the calendar', [{ name: 'text', label: 'What', required: true }, { name: 'date', label: 'Which day?', type: 'date', required: true }], { text: x.text, date: x.date });
    if (v) { line = `📅 ${esc(v.text)} · ${fmtDay(v.date, true)}`; add = () => { db.events ||= []; db.events.push({ id: uid(), text: v.text, date: v.date, at: now, via: 'scratch pad' }); }; }
  } else if (dest === 'today') {
    v = await form('✅ Add to today’s list', [{ name: 'text', label: 'What', required: true }], { text: x.text });
    if (v) { line = `✅ ${esc(v.text)} · today`; add = () => workdayToday().d.extra.push({ id: uid(), text: v.text }); }
  } else if (dest === 'bill') {
    v = await form('🧾 Add the bill', billFields(), { vendor: x.vendor, what: x.text, amount: amt, due: x.date, repeat: 'none' });
    if (v) { line = `🧾 ${esc(v.vendor)} · ${money(v.amount)} · due ${fmtDay(v.due, true)}`; add = () => db.bills.push({ id: uid(), ...v, at: now }); }
  } else if (dest === 'shop') {
    v = await form('🛒 Shop purchase request', purFields(), { item: x.text, qty: 1, price: amt, by: 'Office Manager' });
    if (v) { v.qty = Number(v.qty) || 1; line = `🛒 ${esc(v.item)}${v.qty > 1 ? ' × ' + v.qty : ''}${v.price ? ' · ' + money(v.price * v.qty) : ''}`; add = () => db.purchases.push({ id: uid(), ...v, status: 'pending', at: now }); }
  } else if (dest === 'owner') {
    v = await form('👤 Ask the owner', [
      { name: 'title', label: 'What do you need from the owner?', required: true },
      { name: 'kind', label: 'Kind', type: 'select', options: ['Purchase', 'Bill', 'Equipment', 'Insurance', 'Other'], half: true },
      { name: 'amount', label: 'Amount', type: 'money', half: true },
      { name: 'detail', label: 'Details', type: 'textarea' }], { title: x.text, kind: 'Other', amount: amt });
    if (v) { line = `👤 ${esc(v.title)}${v.amount ? ' · ' + money(v.amount) : ''}`; add = () => db.approvals.push({ id: uid(), ...v, purchaseId: '', billId: '', status: 'pending', askedAt: now, ...stamp }); }
  } else if (dest === 'renewal') {
    v = await form('🛡️ Renewal', rnFields(), { name: x.text, expires: x.date });
    if (v) { line = `🛡️ ${esc(v.name)} · expires ${fmtDay(v.expires, true)}`; add = () => db.renewals.push({ id: uid(), ...v }); }
  }
  if (!v) return;
  if (!(await sure('Put it here?', [line], 'Yes, put it there'))) return;
  add(); hp().padItems = padItems().filter(i => i !== x);
  await saveDb(); render(); toast('✓ Put away');
}

// "Clear all" on the cleaned-up list (owner 2026-11-25: an email got chopped into a dozen lines)
document.addEventListener('click', async e => {
  if (!e.target.closest('[data-pad-clearall]')) return;
  const n = padItems().length;
  if (!(await sure(`Remove all ${n} items?`, ['Everything in the cleaned-up list goes away. Nothing already filed is touched.'], 'Yes, remove them'))) return;
  hp().padItems = []; await saveDb(); padDraw();
});
