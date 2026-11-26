/* 👤 Contacts (owner 2026-11-25, picked Option 2 "cards by company"): "a contact tab to save email contacts… a company it
   goes to also and a number if it's in there… save the contact info of who's writing us… mark them as important".
   db.contacts = [{ id, name, company, email, phone, notes, important, at, via }]. One box per company (people with no
   company in "No company", last), ⭐ Important people first and their companies first. A card shows email, phone and how
   many emails we have from them (the filed emails, db.docs kind "email"; tap = read them). Tap a card = edit (asks
   before saving); the ⭐ on a card marks / unmarks at once (only a mark, like a bookmark).
   Saving from an email: the email check window shows "👤 Save contact" (name, email, company from the address, phone
   from the signature), or the saved contact when we know them (email.js calls ctMailLine). */

function contacts() { return db.contacts ||= []; }
const CT_FREE_MAIL = /^(gmail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|mac|comcast|proton|protonmail|att|sbcglobal|verizon|frontier|centurylink)$/i;
function ctEmailOf(s) { return ((String(s || '').match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/) || [])[0] || '').toLowerCase(); }
function ctByEmail(email) { email = ctEmailOf(email); return email ? contacts().find(c => ctEmailOf(c.email) === email) : null; }
function ctPhoneFmt(p) { const d = String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(p || '').trim(); }
// Emails we filed from this person
function ctMails(c) {
  const e = ctEmailOf(c.email); if (!e) return [];
  return (db.docs || []).filter(d => d.kind === 'email' && (d.fromEmail || ctEmailOf((String(d.text || '').match(/^From:.*$/m) || [''])[0])) === e).sort((a, b) => b.at - a.at);
}
// What an email tells us about its sender
function ctGuessFromMail(mail) {
  const email = ctEmailOf(mail.from);
  let name = String(mail.from || '').replace(/<[^>]*>/g, '').replace(/["']/g, '').trim();
  if (!name || /@/.test(name)) name = '';
  const dom = (email.split('@')[1] || '').split('.');
  const base = dom.length > 1 ? dom[dom.length - 2] : '';
  let company = base && !CT_FREE_MAIL.test(base) ? spCap(base.replace(/[-_]/g, ' ')) : '';
  // A signature line right under their name often has the company: "Sarah Lane\nLane Policy Agency"
  const lines = String(mail.body || '').split('\n').map(l => l.trim()).filter(Boolean);
  const first = name.split(' ')[0];
  const at = first ? lines.map(l => l.toLowerCase()).lastIndexOf(first.toLowerCase()) : -1;
  const at2 = at < 0 && name ? lines.findIndex(l => l.toLowerCase() === name.toLowerCase()) : at;
  const sig = at2 >= 0 ? lines.slice(at2 + 1, at2 + 4).find(l => !/[\d@]|^(sent from|thanks|thank you)/i.test(l) && l.length < 50) : '';
  if (sig) company = sig;
  const tail = lines.slice(-12).join('\n');
  const ph = (tail.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/) || [])[0] || '';
  if (!name && company) name = company;
  return { name, company, email, phone: ph ? ctPhoneFmt(ph) : '' };
}

function ctFields() {
  const cos = [...new Set(contacts().map(c => c.company).filter(Boolean))].sort();
  return [
    { name: 'name', label: 'Name', required: true },
    { name: 'company', label: 'Company', list: cos, hint: 'Leave empty if they aren’t with a company.' },
    { name: 'email', label: 'Email', type: 'email', half: true },
    { name: 'phone', label: 'Phone', type: 'tel', half: true },
    { name: 'notes', label: 'Notes', type: 'textarea' },
    { name: 'important', label: 'Important', type: 'check', text: '⭐ Mark as important (shows first)' }
  ];
}
function ctLine(v) { return [esc(v.name) + (v.important ? ' ⭐' : ''), v.company ? esc(v.company) : '', v.email ? esc(v.email) : '', v.phone ? esc(ctPhoneFmt(v.phone)) : ''].filter(Boolean).join(' · '); }
function ctCheck(v, self) {
  const e = ctEmailOf(v.email);
  if (v.email && !e) return 'That email doesn’t look right';
  const twin = e && contacts().find(c => c !== self && ctEmailOf(c.email) === e);
  return twin ? `${twin.name} already has that email` : '';
}
async function ctNew(pre = {}) {
  const v = await form('👤 New contact', ctFields(), pre, { check: v => ctCheck(v) }); if (!v) return null;
  if (!(await sure('Save this contact?', [ctLine(v)]))) return null;
  const c = { id: uid(), ...v, phone: ctPhoneFmt(v.phone), at: Date.now(), via: pre.via || '' };
  contacts().push(c); await saveDb(); toast('✓ Contact saved'); render();
  return c;
}
async function ctOpen(id) {
  const c = byId(contacts(), id); if (!c) return;
  const mails = ctMails(c);
  const top = mails.length ? `<div class="ct-mails"><b>📧 ${mails.length} email${mails.length > 1 ? 's' : ''} from them</b>${mails.slice(0, 6).map(d => `<a href="#" data-ct-mail="${d.id}">${esc(d.title || d.name)} <span class="muted">· ${fmtWhen(d.at)}</span></a>`).join('')}</div>` : '';
  const v = await form(c.name, ctFields(), c, { top, check: v => ctCheck(v, c), onDelete: async () => {
    if (!(await sure('Delete this contact?', [ctLine(c), 'Emails filed from them stay in Smart Scan.'], 'Delete'))) return false;
    db.contacts = contacts().filter(x => x !== c); await saveDb(); render(); return true;
  } });
  if (!v) return;
  if (!(await sure('Save these changes?', [ctLine(v)]))) return;
  Object.assign(c, v, { phone: ctPhoneFmt(v.phone) }); await saveDb(); render(); toast('✓ Saved');
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-ct-mail]'); if (!a) return;
  e.preventDefault(); docOpen(a.dataset.ctMail);
});

// ---------- The page ----------
let ctQ = '', ctOnlyStar = false;
views.contacts = {
  html() {
    const q = norm(ctQ), all = contacts();
    const list = all.filter(c => (!ctOnlyStar || c.important) && (!q || norm([c.name, c.company, c.email, c.phone, c.notes].join(' ')).includes(q) || (q.replace(/\D/g, '').length > 2 && String(c.phone || '').replace(/\D/g, '').includes(q.replace(/\D/g, '')))));
    const groups = {};
    list.forEach(c => { const k = (c.company || '').trim() || ''; (groups[k] ||= []).push(c); });
    const keys = Object.keys(groups).sort((a, b) => {
      if (!a !== !b) return a ? -1 : 1;                       // "No company" last
      const sa = groups[a].some(c => c.important), sb = groups[b].some(c => c.important);
      return sa !== sb ? (sa ? -1 : 1) : a.localeCompare(b);
    });
    const stars = all.filter(c => c.important).length;
    const card = c => {
      const n = ctMails(c).length;
      return `<div class="ct-card ${c.important ? 'imp' : ''}" data-action="ctOpen" data-id="${c.id}">
        <div class="ct-top"><b>${esc(c.name)}</b><button class="ct-star ${c.important ? 'on' : ''}" data-ct-star="${c.id}" title="${c.important ? 'Important · tap to unmark' : 'Mark as important'}">⭐ ${c.important ? 'Important' : 'Mark important'}</button></div>
        ${c.email ? `<div class="ct-l">✉️ <a href="mailto:${esc(c.email)}" data-stop>${esc(c.email)}</a></div>` : ''}
        ${c.phone ? `<div class="ct-l">📞 <a href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ''))}" data-stop>${esc(ctPhoneFmt(c.phone))}</a></div>` : ''}
        ${n ? `<div class="ct-l muted">📧 ${n} email${n > 1 ? 's' : ''}</div>` : ''}
        ${c.notes ? `<div class="ct-l muted ct-note">${esc(c.notes)}</div>` : ''}
      </div>`;
    };
    return `<div class="page-head"><h1>👤 Contacts</h1><button class="btn pri" data-action="ctNew">+ Add contact</button></div>
      <div class="ct-bar"><input data-ct-q placeholder="Search name, company, email or phone" value="${esc(ctQ)}">
        <button class="btn sm ${!ctOnlyStar ? 'on' : ''}" data-ct-filter="all">All ${all.length}</button>
        <button class="btn sm ${ctOnlyStar ? 'on' : ''}" data-ct-filter="star">⭐ Important ${stars}</button></div>
      ${keys.length ? keys.map(k => `<div class="card ct-group">${cardHead(k ? '🏢' : '👤', esc(k || 'No company'), `<span class="pill gry">${groups[k].length}</span>`)}
        <div class="ct-grid">${groups[k].sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0) || a.name.localeCompare(b.name)).map(card).join('')}</div></div>`).join('')
        : `<div class="card"><div class="empty">${all.length ? 'No one matches that.' : 'No contacts yet. Add one, or tap “👤 Save contact” when you bring in an email.'}</div></div>`}`;
  },
  after() {
    const q = document.querySelector('[data-ct-q]');
    q?.addEventListener('input', () => { ctQ = q.value; const pos = q.selectionStart; render(); const n = document.querySelector('[data-ct-q]'); n?.focus(); n?.setSelectionRange(pos, pos); });
  }
};
document.addEventListener('click', async e => {
  const f = e.target.closest('[data-ct-filter]');
  if (f) { ctOnlyStar = f.dataset.ctFilter === 'star'; return render(); }
  const s = e.target.closest('[data-ct-star]');
  if (s) {
    e.stopPropagation(); e.preventDefault();
    const c = byId(contacts(), s.dataset.ctStar); if (!c) return;
    c.important = !c.important; await saveDb(); render();
    toast(c.important ? `⭐ ${c.name} marked important` : `${c.name} is no longer marked important`);
  }
}, true);
Object.assign(actions, { ctNew: () => ctNew(), ctOpen: el => ctOpen(el.dataset.id) });

// ---------- In the email check window (email.js) ----------
let ctMailCur = null;
function ctMailLine(mail) {
  ctMailCur = mail;
  const c = ctByEmail(mail.from);
  if (c) return `<div class="ct-mailline" data-ct-mailline>👤 <a href="#" data-ct-mailopen="${c.id}"><b>${esc(c.name)}</b></a>${c.company ? ' · ' + esc(c.company) : ''}${c.important ? ' <span class="pill amb">⭐ Important</span>' : ''} <span class="muted small">· in Contacts</span></div>`;
  if (!ctEmailOf(mail.from)) return '';
  return `<div class="ct-mailline" data-ct-mailline><button class="btn sm" data-ct-mailsave>👤 Save contact</button> <span class="muted small">${esc(ctEmailOf(mail.from))} isn’t in Contacts yet</span></div>`;
}
document.addEventListener('click', async e => {
  const o = e.target.closest('[data-ct-mailopen]');
  if (o) { e.preventDefault(); return ctOpen(o.dataset.ctMailopen); }
  if (!e.target.closest('[data-ct-mailsave]') || !ctMailCur) return;
  e.preventDefault();
  const line = e.target.closest('[data-ct-mailline]');
  const c = await ctNew({ ...ctGuessFromMail(ctMailCur), via: 'email' });
  if (c && line) line.outerHTML = ctMailLine(ctMailCur);
});
