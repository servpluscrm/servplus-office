/* 📄 Smart Scan (2026-11-25): one place to drop ANY document (picture, phone camera, PDF). The AI reads it and says what it
   is; she checks the boxes and taps Confirm & File; then it becomes a bill, shop purchase, jobsite receipt, renewal, order
   update or a payment that matches a bill. The original is always kept (IndexedDB store "files", list db.docs).
   The AI never pays, orders or approves anything. Until the CRM is online the answers are PRETEND (scanPretend). */

const SCAN_KINDS = {
  bill: { label: 'Vendor bill', ico: '🧾', file: 'Bill' },
  shop_receipt: { label: 'Shop receipt', ico: '🛒', file: 'Shop receipt' },
  jobsite_receipt: { label: 'Jobsite supply receipt', ico: '🏠', file: 'Jobsite receipt' },
  renewal: { label: 'Insurance / license / certificate', ico: '🛡️', file: 'Renewal' },
  coi: { label: 'COI', ico: '📜', file: 'COI' },
  dmv: { label: 'DMV registration', ico: '🚚', file: 'DMV' },
  order: { label: 'Order confirmation / shipping', ico: '📦', file: 'Order' },
  payment: { label: 'Payment confirmation', ico: '✅', file: 'Payment' },
  email: { label: 'Email', ico: '📧', file: 'Email' },
  other: { label: 'Something else', ico: '📁', file: 'Document' }
};

// ---------- Files (originals) ----------
async function fileSave(rec) {
  const d = await idb();
  await new Promise((res, rej) => { const t = d.transaction('files', 'readwrite'); t.objectStore('files').put(rec, rec.id); t.oncomplete = res; t.onerror = () => rej(t.error); });
}
async function fileGet(id) {
  const d = await idb();
  return new Promise(res => { const q = d.transaction('files').objectStore('files').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
}
async function fileDel(id) {
  const d = await idb();
  await new Promise(res => { const t = d.transaction('files', 'readwrite'); t.objectStore('files').delete(id); t.oncomplete = res; t.onerror = res; });
}
async function docOpen(id) {
  const doc = byId(db.docs || [], id);
  if (doc?.kind === 'email') return ask('📧 ' + esc(doc.title || doc.name), `<pre class="doc-prev-mail" style="max-height:60vh">${esc(doc.text || '')}</pre>`, [{ label: 'Close', value: 1 }]);
  const f = await fileGet(id);
  if (!f) return toast('The original isn’t on this computer');
  window.open(URL.createObjectURL(f.blob), '_blank', 'noopener');
}
// The scanned document(s) behind a record (bill, renewal, purchase…): its docId / paidDocId, or a doc pointing at it.
function docsFor(rec) {
  if (!rec) return [];
  const ids = new Set([rec.docId, rec.paidDocId].filter(Boolean));
  (db.docs || []).forEach(d => { if ([d.billId, d.renewalId, d.purchaseId, d.receiptId].includes(rec.id)) ids.add(d.id); });
  return [...ids].map(id => byId(db.docs || [], id)).filter(Boolean);
}
// Top of a record's window: a picture of the scanned document (owner 2026-11-25: "should have a picture of the
// document scanned if there is one"). Filled in after the window opens (fillDocPreviews, called by form()).
function docPreviewHtml(rec) {
  const ds = docsFor(rec); if (!ds.length) return '';
  return `<div class="doc-prevs">${ds.map(d => `<div class="doc-prev" data-doc="${d.id}" title="Open the full document">
    <div class="doc-prev-img">Loading…</div><div class="doc-prev-cap">📄 ${esc(d.name)} · <b>Open full size ›</b></div></div>`).join('')}</div>`;
}
async function fillDocPreviews(root) {
  for (const el of root.querySelectorAll('.doc-prev[data-doc]')) {
    const f = await fileGet(el.dataset.doc), box = el.querySelector('.doc-prev-img');
    const doc = byId(db.docs || [], el.dataset.doc);
    if (doc?.kind === 'email') { box.innerHTML = `<pre class="doc-prev-mail">${esc(doc.text || doc.title || '')}</pre>`; el.title = ''; continue; }
    if (!f) { box.textContent = 'The original isn’t on this computer'; continue; }
    const url = URL.createObjectURL(f.blob);
    box.innerHTML = /pdf/.test(f.type || f.blob.type) ? `<iframe src="${url}#toolbar=0&view=FitH" title="Document"></iframe>` : `<img src="${url}" alt="Scanned document">`;
    el.addEventListener('click', e => { e.preventDefault(); docOpen(el.dataset.doc); });
  }
}

function readBase64(blob) {
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
}

// ---------- The AI ----------
// Real answer: the Office CRM's own Edge Function "office-assistant" (mode "scan"), once the CRM is online (window.officeCloud).
async function scanAsk(file) {
  if (window.officeCloud?.invoke) {
    const data = await readBase64(file);
    const r = await window.officeCloud.invoke('office-assistant', { mode: 'scan', mediaType: file.type || 'application/pdf', data, name: file.name, today: today() });
    if (r?.error) throw new Error(r.error);
    return r;
  }
  await new Promise(r => setTimeout(r, 900));
  return scanPretend(file);
}
// 🧪 Pretend answer from the file name, so the screens can be tried before the real AI is set up.
function scanPretend(file) {
  const n = norm(file.name);
  const base = { pretend: true, vendor: '', title: '', invoice_no: '', amount: '', doc_date: today(), due_date: '', expires: '', items: [], summary: '', confidence: 'medium' };
  if (/home depot|lowes|jobsite/.test(n)) return { ...base, kind: 'jobsite_receipt', vendor: 'Home Depot', title: 'Jobsite supplies', amount: '86.42', summary: 'Plastic sheeting, tape and fans for a job.', confidence: 'high' };
  if (/receipt|grainger|parts/.test(n)) return { ...base, kind: 'shop_receipt', vendor: 'Grainger', title: 'Shop parts', amount: '64.00', items: [{ name: 'Pump seals', qty: '4', price: '9.50' }, { name: 'Hose fittings', qty: '2', price: '13.00' }], summary: 'Parts for the shop.', confidence: 'high' };
  if (/coi|certificate of insurance/.test(n)) return { ...base, kind: 'coi', vendor: 'State Farm', title: 'COI – Action Management', expires: addDays(today(), 330), summary: 'Certificate of insurance for a property manager.' };
  if (/policy|insurance|license|ccb|iicrc/.test(n)) return { ...base, kind: 'renewal', vendor: 'Insurance agent', title: 'General Liability Insurance', expires: addDays(today(), 365), summary: 'Policy renewal.' };
  if (/dmv|registration/.test(n)) return { ...base, kind: 'dmv', vendor: 'Oregon DMV', title: 'Truck 116 registration', expires: addDays(today(), 365), amount: '146.00' };
  if (/shipped|order|tracking/.test(n)) return { ...base, kind: 'order', vendor: 'SupplyHouse', title: 'Coupling – 2" Camlock', due_date: addDays(today(), 3), summary: 'Your order has shipped.' };
  if (/paid|payment|confirmation/.test(n)) return { ...base, kind: 'payment', vendor: 'Pacific Power', amount: '386.72', summary: 'Payment received, thank you.' };
  return { ...base, kind: 'bill', vendor: 'Equipment supplier', title: 'Replacement parts', invoice_no: '10482', amount: '485.00', due_date: addDays(today(), 9), summary: 'Invoice for replacement parts plus shipping.', confidence: 'high' };
}

// ---------- Scan flow ----------
let scanQueue = [];
function scanStart() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.multiple = true; inp.accept = 'image/*,application/pdf,.eml,.msg,message/rfc822';
  inp.onchange = () => scanFiles([...inp.files]);
  inp.click();
}
async function scanFiles(files) {
  files = files.filter(f => /^image\/|pdf$/.test(f.type) || /\.pdf$/i.test(f.name) || emIsEmail(f));
  if (!files.length) return toast('Pick a picture, a PDF or an email');
  scanQueue = files;
  for (let i = 0; i < scanQueue.length; i++) {
    const keepGoing = emIsEmail(scanQueue[i]) ? await emOne(scanQueue[i], i + 1, scanQueue.length) : await scanOne(scanQueue[i], i + 1, scanQueue.length);
    if (keepGoing === 'stop') break;
  }
  scanQueue = [];
  render();
}
function scanReading(file, n, of) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" style="text-align:center;padding:30px"><div style="font-size:34px">📄</div><div style="font-weight:700;margin-top:8px">Reading ${esc(file.name)}…</div><div class="muted small">${of > 1 ? `${n} of ${of}` : ''}</div></div>`;
  modalRoot().appendChild(bg);
  return () => bg.remove();
}
async function scanOne(file, n, of) {
  const done = scanReading(file, n, of);
  let ai;
  try { ai = await scanAsk(file); }
  catch (e) { done(); await ask('Couldn’t read it', `${esc(e.message || 'The assistant didn’t answer.')}<div class="small muted" style="margin-top:6px">You can still file it by hand.</div>`, [{ label: 'OK', value: 1 }]); ai = { kind: 'other', confidence: 'low' }; }
  done();
  return scanConfirm(file, ai, n, of);
}

// The check screen: the picture on the left, what the AI found on the right, tick boxes, Confirm & File.
function scanConfirm(file, ai, n, of) {
  return new Promise(res => {
    const url = URL.createObjectURL(file);
    const isPdf = /pdf/.test(file.type) || /\.pdf$/i.test(file.name);
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal scan-modal" role="dialog">
      <div class="modal-head"><button class="modal-x" data-x title="Back">‹</button><h3>📄 Smart Scan${of > 1 ? ` · ${n} of ${of}` : ''}</h3><button class="modal-x" data-x>✕ Close</button></div>
      <div class="scan-body">
        <div class="scan-doc">${isPdf ? `<iframe src="${url}" title="Document"></iframe>` : `<img src="${url}" alt="Document">`}<div class="small muted" style="margin-top:4px">${esc(file.name)}</div></div>
        <div class="scan-side">
          ${ai.pretend ? '<div class="alert amb small">🧪 Pretend AI answer, so you can try it. The real AI reads the document once the CRM is online.</div>' : ''}
          <div class="scan-found">✓ Document identified${ai.confidence === 'low' ? ' <span class="pill red">Not sure, check it</span>' : ai.confidence === 'medium' ? ' <span class="pill amb">Check it</span>' : ''}</div>
          ${ai.summary ? `<div class="small muted" style="margin-bottom:8px">${esc(ai.summary)}</div>` : ''}
          <div class="fld"><label>Document type</label><select data-sc="kind">${Object.entries(SCAN_KINDS).map(([k, v]) => `<option value="${k}" ${k === ai.kind ? 'selected' : ''}>${v.ico} ${v.label}</option>`).join('')}</select></div>
          <div data-sc-fields></div>
          <div class="scan-acts" data-sc-acts></div>
          <div data-sc-warn></div>
        </div>
      </div>
      <div class="modal-foot"><button class="btn" data-skip>${of > 1 ? 'Skip this one' : 'Cancel'}</button><button class="btn pri" data-file>Confirm & File</button></div></div>`;
    modalRoot().appendChild(bg);
    const st = { ...ai, items: (ai.items || []).map(x => ({ ...x })) };
    const box = sel => bg.querySelector(sel);
    const v = k => (bg.querySelector(`[data-sc="${k}"]`)?.value ?? '').trim();
    const draw = () => {
      const k = v('kind') || 'other';
      st.kind = k;
      const fld = (key, label, type = 'text', half) => `<div class="fld"><label>${label}</label><input data-sc="${key}" type="${type}" value="${esc(st[key] || '')}" autocomplete="off"></div>`;
      const pair = (a, b) => `<div class="fld-2">${a}${b}</div>`;
      const vendorLbl = { bill: 'Supplier', shop_receipt: 'Supplier', jobsite_receipt: 'Store', renewal: 'Insurance company / agency', coi: 'Insurance company', dmv: 'Issued by', order: 'Supplier', payment: 'Paid to', other: 'From' }[k];
      const titleLbl = { bill: 'What it is for', shop_receipt: 'What was bought', jobsite_receipt: 'What was bought', renewal: 'Policy / license name', coi: 'Certificate for', dmv: 'Vehicle', order: 'Item', payment: 'What was paid', other: 'Name' }[k];
      let h = fld('vendor', vendorLbl) + fld('title', titleLbl);
      if (k === 'bill') h += pair(fld('invoice_no', 'Invoice #'), fld('amount', 'Amount ($)')) + fld('due_date', 'Due date', 'date');
      if (k === 'shop_receipt' || k === 'jobsite_receipt') h += pair(fld('amount', 'Total ($)'), fld('doc_date', 'Date', 'date'));
      if (k === 'shop_receipt') h += `<div class="fld"><label>Items (each goes into the shop purchase history)</label>${st.items.map((it, i) => `<div class="scan-item"><input data-it="${i}|name" value="${esc(it.name)}" placeholder="Item"><input data-it="${i}|qty" value="${esc(it.qty || 1)}" placeholder="Qty"><input data-it="${i}|price" value="${esc(it.price || '')}" placeholder="$ each"><button class="btn sm" data-itdel="${i}">✕</button></div>`).join('')}<button class="btn sm" data-itadd>+ Item</button></div>`;
      if (k === 'renewal' || k === 'coi' || k === 'dmv') h += pair(fld('expires', 'Expires', 'date'), fld('amount', 'Cost ($)'));
      if (k === 'order') h += pair(fld('amount', 'Amount ($)'), fld('due_date', 'Expected delivery', 'date'));
      if (k === 'payment') h += pair(fld('amount', 'Amount ($)'), fld('doc_date', 'Paid on', 'date'));
      box('[data-sc-fields]').innerHTML = h;
      drawActs();
    };
    const amount = () => moneyParse(v('amount')) || 0;
    const actsFor = k => {
      const a = amount(), out = [];
      if (k === 'bill') {
        out.push(['bill', 'Create unpaid bill record', true], ['reminder', 'Remind me before it’s due', true]);
        if (a >= 300) out.push(['owner', `Ask the owner to approve it (${money(a)} is over your $300 comfort level)`, false]);
      }
      if (k === 'shop_receipt') out.push(['shop', `Add to this week's shop budget (${money(a)})`, true]);
      if (k === 'jobsite_receipt') out.push(['jobsite', 'Record as jobsite supply spending (for the daily stats)', true]);
      if (k === 'renewal' || k === 'coi' || k === 'dmv') out.push(['renew', 'Track the expiration date with reminders', true]);
      if (k === 'order') { const p = scanMatchPurchase(); out.push(['order', p ? `Mark "${p.item}" as ordered${v('due_date') ? ', arriving ' + fmtDay(v('due_date')) : ''}` : 'Add it to purchasing as ordered', true]); }
      if (k === 'payment') { const b = scanMatchBill(); out.push(b ? ['paid', `Mark ${b.vendor} ${money(b.amount)} (due ${fmtDay(b.due)}) as paid`, true] : ['none', 'No unpaid bill matches; it will just be filed', true]); }
      out.push(['save', 'Save the original document', true]);
      return out;
    };
    const drawActs = () => {
      const prev = {};
      bg.querySelectorAll('[data-act]').forEach(c => { prev[c.dataset.act] = c.checked; });
      box('[data-sc-acts]').innerHTML = `<div class="scan-acts-t">Suggested actions</div>` + actsFor(st.kind).map(([id, label, on]) =>
        `<label class="wd-item"><input type="checkbox" data-act="${id}" ${(id in prev ? prev[id] : on) ? 'checked' : ''} ${id === 'save' ? 'disabled' : ''}><span>${esc(label)}</span></label>`).join('');
      const dup = scanDuplicate();
      box('[data-sc-warn]').innerHTML = dup ? `<div class="alert red small">⚠️ Possible duplicate: ${esc(dup)}</div>` : '';
    };
    const scanMatchBill = () => { const vn = norm(v('vendor')), a = amount(); return db.bills.find(b => !b.paidAt && vn && (norm(b.vendor).includes(vn) || vn.includes(norm(b.vendor))) && (!a || Math.abs(b.amount - a) < 1)); };
    const scanMatchPurchase = () => { const it = norm(v('title')), sup = norm(v('vendor')); return db.purchases.find(p => ['pending', 'approved', 'owner'].includes(p.status) && it && (norm(p.item).includes(it) || it.includes(norm(p.item))) && (!sup || !p.supplier || norm(p.supplier) === sup)); };
    const scanDuplicate = () => {
      const k = st.kind, vn = norm(v('vendor')), inv = norm(v('invoice_no')), a = amount();
      if (k === 'bill') { const b = db.bills.find(b => norm(b.vendor) === vn && ((inv && norm(b.invoiceNo) === inv) || (a && Math.abs(b.amount - a) < 0.01 && b.due === v('due_date')))); if (b) return `${b.vendor} ${money(b.amount)} due ${fmtDay(b.due)} is already in Bills.`; }
      const d = db.docs.find(d => d.name === file.name && d.size === file.size); if (d) return `a file named "${file.name}" was filed ${fmtWhen(d.at)}.`;
      return '';
    };
    // keep typing in st so switching the type doesn't lose it
    bg.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.sc && t.dataset.sc !== 'kind') st[t.dataset.sc] = t.value;
      if (t.dataset.it) { const [i, f] = t.dataset.it.split('|'); st.items[+i][f] = t.value; const tot = st.items.reduce((s, x) => s + (moneyParse(x.price) || 0) * (Number(x.qty) || 1), 0); if (tot) { st.amount = tot.toFixed(2); const am = bg.querySelector('[data-sc="amount"]'); if (am) am.value = st.amount; } }
      if (t.dataset.sc === 'amount' || t.dataset.sc === 'vendor' || t.dataset.sc === 'title' || t.dataset.sc === 'invoice_no' || t.dataset.sc === 'due_date' || t.dataset.it) drawActs();
    });
    bg.addEventListener('change', e => { if (e.target.dataset.sc === 'kind') draw(); });
    const finish = v2 => { URL.revokeObjectURL(url); bg.remove(); document.removeEventListener('keydown', key); res(v2); };
    const key = e => { if (e.key === 'Escape' && modalRoot().lastElementChild === bg) finish(n < of ? 'skip' : 'stop'); };
    document.addEventListener('keydown', key);
    bg.addEventListener('click', async e => {
      if (e.target.closest('[data-x]')) return finish('stop');
      if (e.target.closest('[data-skip]')) return finish('skip');
      const del = e.target.closest('[data-itdel]'); if (del) { st.items.splice(+del.dataset.itdel, 1); return draw(); }
      if (e.target.closest('[data-itadd]')) { st.items.push({ name: '', qty: '1', price: '' }); return draw(); }
      if (e.target.closest('[data-file]')) {
        const need = { bill: ['vendor', 'amount', 'due_date'], shop_receipt: ['vendor', 'amount'], jobsite_receipt: ['amount'], renewal: ['title', 'expires'], coi: ['title', 'expires'], dmv: ['title', 'expires'], order: ['title'], payment: ['vendor', 'amount'], other: [] }[st.kind];
        const miss = need.filter(k => !v(k));
        bg.querySelectorAll('[data-sc]').forEach(i => i.classList.toggle('need', miss.includes(i.dataset.sc)));
        if (miss.length) return toast('Fill in the red boxes first');
        const acts = {}; bg.querySelectorAll('[data-act]').forEach(c => { acts[c.dataset.act] = c.checked; });
        const out = await scanFile(file, st.kind, Object.fromEntries(['vendor', 'title', 'invoice_no', 'amount', 'due_date', 'doc_date', 'expires'].map(k => [k, v(k)])), st.items, acts, scanMatchBill(), scanMatchPurchase(), ai);
        if (out) { finish('ok'); toast('✓ Filed: ' + out); }
      }
    });
    draw();
  });
}

// Make the records, keep the original. Returns a short line of what was done.
async function scanFile(file, kind, f, items, acts, bill, pur, ai) {
  const amt = moneyParse(f.amount) || 0, now = Date.now(), done = [];
  const docId = uid();
  const ext = (file.name.match(/\.[a-z0-9]+$/i) || [/pdf/.test(file.type) ? '.pdf' : '.jpg'])[0];
  const d = f.doc_date || today();
  const name = `${SCAN_KINDS[kind].file} - ${(f.vendor || f.title || 'document').replace(/[\\/:*?"<>|]+/g, ' ').trim()} - ${d.slice(5, 7)}.${d.slice(8, 10)}.${d.slice(2, 4)}${ext}`;
  const link = {};
  if (kind === 'bill' && acts.bill) {
    const b = { id: uid(), vendor: f.vendor, what: f.title, invoiceNo: f.invoice_no, amount: amt, due: f.due_date, repeat: 'none', docId, at: now, via: 'scan' };
    db.bills.push(b); link.billId = b.id; done.push('bill added');
    if (acts.owner) { db.approvals.push({ id: uid(), title: `${f.vendor} bill${f.invoice_no ? ' #' + f.invoice_no : ''}`, kind: 'Bill', detail: `Due ${fmtDay(f.due_date)}${f.title ? ' · ' + f.title : ''}`, amount: amt, billId: b.id, status: 'pending', askedAt: now }); done.push('sent to owner'); }
  }
  if (kind === 'shop_receipt' && acts.shop) {
    const at = dayOf(f.doc_date || today()).getTime() + 12 * 3600e3;
    const list = items.filter(x => x.name.trim()).length ? items.filter(x => x.name.trim()) : [{ name: f.title || 'Shop purchase', qty: 1, price: amt }];
    list.forEach(x => db.purchases.push({ id: uid(), item: x.name.trim(), qty: Number(x.qty) || 1, price: moneyParse(x.price) ?? (list.length === 1 ? amt : 0), supplier: f.vendor, by: 'Receipt', status: 'received', at, orderedAt: at, receivedAt: at, docId, via: 'scan' }));
    done.push(`${list.length} shop item${list.length > 1 ? 's' : ''} recorded`);
  }
  if (kind === 'jobsite_receipt' && acts.jobsite) { db.receipts.push({ id: uid(), store: f.vendor, what: f.title, amount: amt, date: f.doc_date || today(), docId, at: now }); done.push('jobsite spending recorded'); }
  if ((kind === 'renewal' || kind === 'coi' || kind === 'dmv') && acts.renew) {
    const r = { id: uid(), name: kind === 'dmv' ? `DMV registration – ${f.title}` : kind === 'coi' ? `COI – ${f.title}` : f.title, expires: f.expires, cost: amt || '', contact: f.vendor, docId, via: 'scan' };
    db.renewals.push(r); done.push('renewal tracked');
  }
  if (kind === 'order' && acts.order) {
    if (pur) { pur.status = 'ordered'; pur.orderedAt ||= now; if (f.due_date) pur.delivery = f.due_date; pur.docId = docId; done.push(`"${pur.item}" marked ordered`); }
    else { db.purchases.push({ id: uid(), item: f.title, qty: 1, price: amt, supplier: f.vendor, by: 'Order email', status: 'ordered', at: now, orderedAt: now, delivery: f.due_date, docId, via: 'scan' }); done.push('order added'); }
  }
  if (kind === 'payment' && acts.paid && bill) { bill.paidAt = now; bill.paidHow = 'Payment confirmation'; bill.paidDocId = docId; done.push(`${bill.vendor} marked paid`); }
  // the original
  await fileSave({ id: docId, blob: file, name, type: file.type, at: now });
  db.docs.push({ id: docId, name, orig: file.name, size: file.size, type: file.type, kind, vendor: f.vendor, title: f.title, amount: amt || '', at: now, summary: ai.summary || '', pretend: !!ai.pretend, ...link });
  done.push('original saved');
  await saveDb();
  return done.join(' · ');
}

// ---------- Smart Scan page ----------
let scanFilter = '';
views.scan = {
  html() {
    const q = norm(scanFilter);
    const list = db.docs.slice().sort((a, b) => b.at - a.at).filter(d => !q || norm([d.name, d.orig, d.vendor, d.title, SCAN_KINDS[d.kind]?.label].join(' ')).includes(q));
    return `<div class="page-head"><h1>📄 Smart Scan</h1></div>
      <div class="scan-drop" data-action="scanStart"><div style="font-size:40px">📄</div><div style="font-size:18px;font-weight:700">Scan anything</div>
        <div class="muted">Drop pictures or PDFs here, or click to pick them. On a phone it opens the camera.</div>
        <div class="small muted" style="margin-top:6px">Bills · receipts · insurance · COIs · DMV · emails (drag one out of Outlook)</div></div>
      <div class="em-paste-row"><button class="btn" data-action="emPaste">📧 Paste an email</button><span class="small muted">Copy an email in Outlook (Ctrl+A, Ctrl+C) and paste it here. Its to-dos, bills and dates go where they belong after you check them.</span></div>
      <div class="card" style="margin-top:16px">${cardHead('📁', 'Filed documents', `<input data-scan-q placeholder="Search documents" value="${esc(scanFilter)}" style="margin-left:auto;padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px">`)}
        ${list.length ? `<table class="tbl"><tr><th>Document</th><th class="ph-hide">Type</th><th>Amount</th><th class="ph-hide">Filed</th><th></th></tr>${list.map(d => `<tr class="click" data-action="docOpen" data-id="${d.id}">
          <td><b>${esc(d.name)}</b>${d.summary ? `<div class="small muted">${esc(d.summary)}</div>` : ''}</td>
          <td class="ph-hide">${SCAN_KINDS[d.kind]?.ico || ''} ${esc(SCAN_KINDS[d.kind]?.label || '')}</td><td>${d.amount ? money(d.amount) : ''}</td>
          <td class="ph-hide small muted">${fmtWhen(d.at)}</td><td><button class="btn sm" data-action="docDel" data-id="${d.id}">🗑</button></td></tr>`).join('')}</table>` : '<div class="empty">Nothing scanned yet.</div>'}</div>`;
  },
  after() {
    const q = document.querySelector('[data-scan-q]');
    q?.addEventListener('input', () => { scanFilter = q.value; const pos = q.selectionStart; render(); const n = document.querySelector('[data-scan-q]'); n.focus(); n.setSelectionRange(pos, pos); });
  }
};
Object.assign(actions, {
  scanStart: () => scanStart(),
  docOpen: el => docOpen(el.dataset.id),
  docDel: async el => {
    const d = byId(db.docs, el.dataset.id); if (!d) return;
    if (!(await sure('Delete this document?', [esc(d.name), 'The bill / purchase / renewal made from it stays.'], 'Delete'))) return;
    db.docs = db.docs.filter(x => x !== d); await fileDel(d.id); await saveDb(); render();
  }
});
// Drop files anywhere on the page = scan them
document.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); document.body.classList.add('drop-on'); } });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('drop-on'); });
document.addEventListener('drop', e => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault(); document.body.classList.remove('drop-on');
  if (document.querySelector('.modal-bg')) return toast('Finish the open window first');
  scanFiles([...e.dataTransfer.files]);
});
