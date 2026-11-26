/* 📧 Emails into the CRM (owner 2026-11-25, Option 1: "she can scan emails also and have them show up in her to-do list
   and put the things in the right places"). She drags an email out of Outlook (.msg / .eml) onto Scan anything (or
   anywhere on the page), or copies it and taps "📧 Paste an email". The CRM reads who it's from, the subject and the
   words, splits out what needs doing (bill to pay, renewal, delivery day, something for the owner, a shop request,
   a to-do for today) and shows the scratch pad's check list (spOpen) with the email on top. Nothing is saved until she
   taps File. The email itself is kept as a document (db.docs kind "email") and every record made from it points at it
   (docId), so the bill / renewal window shows the email.
   AI: office-assistant mode "email" once the CRM is online; until then the CRM's own word rules (emGuess).
   Later (go-live): Option 2 = her Outlook linked, an "Emails to sort" box on the Dashboard. */

// ---------- Reading the email ----------
function emIsEmail(f) { return /\.(eml|msg)$/i.test(f.name) || /rfc822|ms-outlook/i.test(f.type || ''); }

function emDecodeWords(s) {
  return String(s || '').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (all, cs, enc, txt) => {
    try {
      const bytes = enc.toUpperCase() === 'B'
        ? Uint8Array.from(atob(txt), c => c.charCodeAt(0))
        : Uint8Array.from(txt.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))), c => c.charCodeAt(0));
      return new TextDecoder(/utf-?8/i.test(cs) ? 'utf-8' : 'latin1').decode(bytes);
    } catch { return txt; }
  }).replace(/\?=\s+=\?/g, '');
}
function emHtmlText(h) {
  const d = new DOMParser().parseFromString(h.replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, '$&\n'), 'text/html');
  d.querySelectorAll('style,script,head').forEach(x => x.remove());
  return (d.body?.textContent || '').replace(/ /g, ' ');
}
function emQP(s) { return s.replace(/=\r?\n/g, '').replace(/(=[0-9a-f]{2})+/gi, m => { try { return new TextDecoder().decode(Uint8Array.from(m.match(/=([0-9a-f]{2})/gi).map(x => parseInt(x.slice(1), 16)))); } catch { return m; } }); }
function emSplitHead(raw) {
  const i = raw.search(/\r?\n\r?\n/);
  const head = (i < 0 ? raw : raw.slice(0, i)).replace(/\r?\n[ \t]+/g, ' ');
  const body = i < 0 ? '' : raw.slice(i).replace(/^\r?\n\r?\n/, '');
  const h = {};
  head.split(/\r?\n/).forEach(l => { const m = l.match(/^([\w-]+):\s*(.*)$/); if (m) h[m[1].toLowerCase()] ||= m[2]; });
  return { h, body };
}
// One MIME part → its readable text ({ plain, html })
function emPart(raw, out) {
  const { h, body } = emSplitHead(raw);
  const ct = h['content-type'] || 'text/plain', enc = (h['content-transfer-encoding'] || '').toLowerCase();
  const b = ct.match(/boundary="?([^";]+)"?/i);
  if (/multipart\//i.test(ct) && b) {
    body.split('--' + b[1]).slice(1).forEach(p => { if (!/^--/.test(p)) emPart(p.replace(/^\r?\n/, ''), out); });
    return out;
  }
  if (/attachment/i.test(h['content-disposition'] || '')) return out;
  let txt = body;
  if (enc === 'base64') { try { const cs = (ct.match(/charset="?([^";]+)/i) || [])[1] || 'utf-8'; txt = new TextDecoder(cs).decode(Uint8Array.from(atob(body.replace(/\s+/g, '')), c => c.charCodeAt(0))); } catch { txt = ''; } }
  else if (enc === 'quoted-printable') txt = emQP(body);
  if (/text\/plain/i.test(ct) && !out.plain) out.plain = txt;
  else if (/text\/html/i.test(ct) && !out.html) out.html = txt;
  return out;
}
function emParseEml(raw) {
  const { h } = emSplitHead(raw);
  const parts = emPart(raw, {});
  return { from: emDecodeWords(h.from), subject: emDecodeWords(h.subject), date: h.date || '', body: parts.plain || (parts.html ? emHtmlText(parts.html) : '') };
}
// Outlook's .msg is a packed file: pull out the readable text (Outlook keeps it as UTF-16). The file name is the subject.
function emParseMsg(buf, name) {
  const u8 = new Uint8Array(buf), runs = [];
  let cur = '';
  for (let i = 0; i + 1 < u8.length; i += 2) {
    const c = u8[i] | (u8[i + 1] << 8);
    if ((c >= 32 && c < 0xd800) || c === 10 || c === 13 || c === 9) cur += String.fromCharCode(c);
    else { if (cur.trim().length >= 4) runs.push(cur); cur = ''; }
  }
  if (cur.trim().length >= 4) runs.push(cur);
  const words = runs.filter(r => /[a-z]{3,}/i.test(r) && !/^[\x20-\x7e]*[\\/]{2}|^__substg/.test(r));
  const body = words.slice().sort((a, b) => b.length - a.length)[0] || '';
  const from = (words.find(r => /^[^\n<]{2,60}$/.test(r.trim()) && runs.some(x => /@/.test(x))) || '');
  const mail = (runs.join(' ').match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [''])[0];
  return { from: mail ? `${from.trim() && !/@/.test(from) ? from.trim() + ' ' : ''}<${mail}>` : '', subject: name.replace(/\.msg$/i, ''), date: '', body };
}
// Copied out of Outlook: "From: … Sent: … To: … Subject: …" lines at the top
function emParsePasted(t) {
  const take = re => { const m = t.match(re); return m ? m[1].trim() : ''; };
  const from = take(/^\s*From:\s*(.+)$/im), subject = take(/^\s*Subject:\s*(.+)$/im), date = take(/^\s*(?:Sent|Date):\s*(.+)$/im);
  const body = t.replace(/^\s*(From|Sent|Date|To|Cc|Subject|Importance):.*$/gim, '').trim();
  return { from, subject: subject || (body.split('\n').find(l => l.trim()) || '').slice(0, 80), date, body };
}
// Only the newest message: drop older replies quoted under it, links and long footers
function emTidy(body) {
  let b = String(body || '').replace(/\r/g, '');
  const cut = b.search(/^\s*(On .{6,120} wrote:|-{2,}\s*Original Message\s*-{2,}|From:\s.+\n\s*(Sent|Date):)/im);
  if (cut > 40) b = b.slice(0, cut);
  return b.split('\n').filter(l => !/^\s*>/.test(l)).join('\n').replace(/<https?:[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000);
}
async function emRead(file) {
  let m;
  if (/\.msg$/i.test(file.name) || /ms-outlook/i.test(file.type)) m = emParseMsg(await file.arrayBuffer(), file.name);
  else { const t = await file.text(); m = /^[\w-]+:\s/m.test(t.slice(0, 2000)) && /\n\r?\n/.test(t) && /^(from|subject|received|return-path|mime-version|date|to):/im.test(t.slice(0, 3000)) ? emParseEml(t) : emParsePasted(t); }
  m.body = emTidy(m.body);
  return m;
}
function emWho(from) {
  const name = String(from || '').replace(/<[^>]*>/g, '').replace(/["']/g, '').trim();
  if (name && !/@/.test(name)) return name;
  const mail = (String(from).match(/[\w.+-]+@([\w-]+)\./) || [])[1];
  return mail ? spCap(mail.replace(/[-_]/g, ' ')) : '';
}

// ---------- Sorting it (the CRM's own rules until the AI is online) ----------
function emDateNear(text, re) {
  const m = text.match(re); if (!m) return '';
  return calParse(' ' + text.slice(m.index + m[0].length, m.index + m[0].length + 40).replace(/[,:]/g, ' ') + ' ')?.date || '';
}
function emGuess(mail) {
  const who = emWho(mail.from), subj = (mail.subject || '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').trim();
  const all = `${subj}\n${mail.body}`, n = norm(all), items = [];
  const amtM = all.match(/(?:amount due|total due|balance due|new balance|amount|total|balance|payment of)[^$\d\n]{0,25}\$\s?([\d,]+(?:\.\d{2})?)/i) || all.match(/\$\s?([\d,]+\.\d{2})/);
  const amount = amtM ? moneyParse(amtM[1]) : '';
  const due = emDateNear(all, /\b(due date|payment due|due on|due by|due|pay by|by)\b[:\s]*/i);
  if (/\b(payment (received|confirmation|processed|successful)|thank you for your payment|we received your payment|autopay (was|has been) (processed|scheduled)|receipt for your payment)\b/.test(n)) {
    items.push({ text: `Mark the ${who || 'vendor'} bill paid${amount !== '' ? ' (' + money(+amount) + ')' : ''}`, dest: 'today', date: '', amount: '', vendor: '', sure: false });
  } else if (/\b(invoice|statement|bill is ready|your bill|amount due|payment due|past due|balance due|new balance)\b/.test(n)) {
    const inv = (all.match(/invoice\s*(?:#|no\.?|number)?\s*:?\s*([A-Z0-9-]{3,})/i) || [])[1];
    items.push({ text: inv ? `${who} invoice #${inv}` : `${who || 'Vendor'} bill`, dest: 'bill', date: due, amount, vendor: who, sure: !!(due && amount !== '' && who) });
  }
  if (/\b(renew\w*|expir\w*|policy|certificate of insurance|registration|license)\b/.test(n) && !items.some(x => x.dest === 'bill')) {
    const exp = emDateNear(all, /\b(expires?( on)?|expiration( date)?|renewal date|renews?( on)?|due for renewal( on)?)\b[:\s]*/i);
    items.push({ text: subj || `${who} renewal`, dest: 'renewal', date: exp, amount: '', vendor: '', sure: !!exp });
  }
  if (/\b(shipped|has shipped|out for delivery|tracking number|order (confirm\w*|#|number)|estimated delivery|arriving|delivered)\b/.test(n)) {
    const d = emDateNear(all, /\b(estimated delivery|arriving|arrives|delivery( date)?|expected)\b[:\s]*/i);
    items.push(d ? { text: `Delivery: ${subj || who}`, dest: 'cal', date: d, amount: '', vendor: '', sure: true }
      : { text: `Check the order: ${subj || who}`, dest: 'today', date: '', amount: '', vendor: '', sure: false });
  }
  const ownerLine = (mail.body.match(/[^.\n!?]*\b(owner|boss|approv\w*|sign off)\b[^.\n!?]*[.!?]?/i) || [])[0];
  if (ownerLine || (/\b(quote|estimate|proposal)\b/.test(n) && !items.length)) items.push({ text: `Ask the owner: ${(ownerLine || subj || who).trim().replace(/^(and|also|so)\s+/i, '')}`, dest: 'owner', date: '', amount: ownerLine ? '' : amount, vendor: '', sure: false });
  if (/\b(need more|running low|out of|please order|can you order|can we get)\b/.test(n) && !items.some(x => x.dest === 'shop')) {
    const m = all.match(/\b(?:need more|running low on|out of|please order|can you order|can we get)\s+([^.\n!?]{2,80})/i);
    (m ? m[1] : subj).split(/\s*(?:,|\band\b)\s*(?:(?:we\s+)?(?:also\s+)?(?:need more|need|more|some)\s+)?/i).map(s => s.trim()).filter(s => s.length > 1)
      .forEach(s => items.push({ text: spCap(s), dest: 'shop', date: '', amount: '', vendor: '', sure: false }));
  }
  if (/\b(meeting|appointment|inspection|walk-?through|scheduled for|see you on)\b/.test(n) && !items.some(x => x.dest === 'cal')) {
    const d = emDateNear(all, /\b(meeting|appointment|inspection|walk-?through|scheduled for|see you|on)\b[:\s]*/i);
    if (d) items.push({ text: subj || `Meet ${who}`, dest: d === today() ? 'today' : 'cal', date: d, amount: '', vendor: '', sure: true });
  }
  // Always offer an answer back; ticked when the email asks something or nothing else was found
  items.push({ text: `Reply to ${who || 'them'}${subj ? ': ' + subj : ''}`, dest: 'today', date: '', amount: '', vendor: '', sure: true, off: items.length > 0 && !/\?/.test(mail.body) });
  return items;
}
async function emSort(mail) {
  if (window.officeCloud?.invoke) {
    try {
      const r = await window.officeCloud.invoke('office-assistant', { mode: 'email', from: mail.from, subject: mail.subject, date: mail.date, text: mail.body, today: today() });
      const items = r?.data?.items || r?.items;
      if (Array.isArray(items) && items.length) return { items: items.map(x => ({ text: x.text || '', dest: SP_DEST[x.dest] ? x.dest : '', date: x.date || '', amount: x.amount ?? '', vendor: x.vendor || '', sure: x.sure !== false })), ai: true };
    } catch (e) { console.warn('Email AI failed, using the CRM rules', e); }
  }
  await new Promise(r => setTimeout(r, 400));
  return { items: emGuess(mail), ai: false };
}

// ---------- The check window + filing ----------
async function emOne(file, n, of) {
  const done = scanReading(file, n, of);
  let mail;
  try { mail = await emRead(file); } catch (e) { done(); console.warn('Email read failed', e); await ask('Couldn’t read that email', 'Try copying the email in Outlook and tapping 📧 Paste an email instead.', [{ label: 'OK', value: 1 }]); return; }
  if (!mail.body && !mail.subject) { done(); await ask('That email looks empty', 'Try copying the email in Outlook and tapping 📧 Paste an email instead.', [{ label: 'OK', value: 1 }]); return; }
  const r = await emSort(mail);
  done();
  return emCheck(mail, r, file, n, of);
}
function emCheck(mail, r, file, n, of) {
  return new Promise(res => {
    const docId = uid(), who = emWho(mail.from);
    const headHtml = `<div class="em-card">
      <div class="em-top"><span class="em-ico">📧</span><div><b>${esc(mail.subject || '(no subject)')}</b>
        <div class="small muted">${who ? 'From ' + esc(who) : ''}${mail.date ? ' · ' + esc(mail.date.replace(/\s*[+-]\d{4}.*$/, '').replace(/:\d\d$/, '')) : ''}${of > 1 ? ` · email ${n} of ${of}` : ''}</div></div></div>
      <details class="em-body"><summary>Read the email</summary><pre>${esc(mail.body || '')}</pre></details></div>`;
    spOpen({
      title: '📧 Email', headHtml, via: 'email', stamp: { docId },
      leaveLine: 'Nothing from this email is filed.',
      items: r.items.map(x => ({ ...x })),
      onFiled: async list => {
        const d = today(), blob = file || new Blob([`From: ${mail.from}\nSubject: ${mail.subject}\nDate: ${mail.date}\n\n${mail.body}`], { type: 'text/plain' });
        const ext = file ? (file.name.match(/\.[a-z0-9]+$/i) || ['.eml'])[0] : '.txt';
        const name = `Email - ${(who || mail.subject || 'email').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 50)} - ${d.slice(5, 7)}.${d.slice(8, 10)}.${d.slice(2, 4)}${ext}`;
        await fileSave({ id: docId, blob, name, type: blob.type || 'message/rfc822', at: Date.now() });
        db.docs.push({ id: docId, name, orig: file?.name || 'Pasted email', size: blob.size, type: blob.type, kind: 'email', vendor: who, title: mail.subject, amount: '', at: Date.now(),
          summary: list.map(x => SP_DEST[x.dest].ico + ' ' + x.text).join(' · '), text: `From: ${mail.from}\nSubject: ${mail.subject}\n${mail.date ? 'Date: ' + mail.date + '\n' : ''}\n${mail.body}`.slice(0, 5000) });
        await saveDb();
        res('filed');
      }
    });
    // Closing the window without filing → done with this email
    const bg = document.querySelector('.sp-bg');
    new MutationObserver((ms, ob) => { if (!bg.isConnected) { ob.disconnect(); res('closed'); } }).observe(modalRoot(), { childList: true });
  });
}

// Copied email → paste window
function emPaste() {
  form('📧 Paste an email', [
    { name: 'text', label: 'The email', type: 'textarea', required: true, hint: 'In Outlook: open the email, Ctrl+A then Ctrl+C, and paste it here with Ctrl+V. Include the From and Subject lines if you can.' }
  ], {}, { saveLabel: '✨ Sort it out' }).then(async v => {
    if (!v?.text?.trim()) return;
    const mail = emParsePasted(v.text); mail.body = emTidy(mail.body);
    const r = await emSort(mail);
    await emCheck(mail, r, null, 1, 1);
    render();
  });
}
Object.assign(actions, { emPaste: () => emPaste() });

// Text dragged straight out of an email onto the Smart Scan box = the same as pasting it
document.addEventListener('drop', e => {
  if (e.dataTransfer?.files?.length || !e.target.closest?.('.scan-drop')) return;
  const t = e.dataTransfer?.getData('text/plain') || '';
  if (t.trim().length < 20) return;
  e.preventDefault();
  const mail = emParsePasted(t); mail.body = emTidy(mail.body);
  emSort(mail).then(r => emCheck(mail, r, null, 1, 1)).then(() => render());
});
document.addEventListener('dragover', e => { if (e.target.closest?.('.scan-drop') && [...(e.dataTransfer?.types || [])].includes('text/plain')) e.preventDefault(); });
