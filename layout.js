/* 🧩 Move + resize the boxes (owner 2026-11-25: "make everything resizable… vertically smaller and also horizontally
   smaller to find out which ones are important. Also make them movable."). Works on every page: after a page draws, its
   cards are put in one 12-column grid (.lay). Each card gets a ⠿ handle (top right, on hover) to drag it to another spot,
   and a corner grip (bottom right) to make it narrower / wider (snaps to columns) and shorter / taller. Double-click the
   corner = that box back to normal. Saved per page in db.settings.layout[page] = { order: [keys], w: {key: columns},
   h: {key: px} } (no "are you sure?": it's only how the page looks). "↺ Reset boxes" at the bottom puts the page back.
   Phone / narrow screens (under 1000px) ignore it and stack the boxes. */

const LAY_COLS = 12, LAY_GAP = 16, LAY_MIN_H = 90;
function layStore(page, make) {
  db.settings.layout ||= {};
  if (!db.settings.layout[page] && make) db.settings.layout[page] = { order: [], w: {}, h: {} };
  return db.settings.layout[page] || { order: [], w: {}, h: {} };
}
function layKeyOf(c) { return (c.querySelector('.card-head h2, h2, h3')?.textContent || 'Box').replace(/\s+/g, ' ').trim().slice(0, 60); }

function layApply() {
  const main = document.getElementById('main'); if (!main || !db) return;
  if (innerWidth < 1000) return;
  const page = route(), st = layStore(page);
  const cards = [...main.querySelectorAll('.card')].filter(c => !c.parentElement.closest('.card'));
  if (!cards.length) return;
  // Measure how wide each box is drawn now, so "normal" looks just like before
  const cs = getComputedStyle(main);
  const W = main.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const colW = (W - (LAY_COLS - 1) * LAY_GAP) / LAY_COLS;
  const seen = {};
  const info = cards.map(c => {
    let k = c.dataset.lay;
    if (!k) { const t = layKeyOf(c); seen[t] = (seen[t] || 0) + 1; k = seen[t] > 1 ? `${t} ${seen[t]}` : t; c.dataset.lay = k; }
    const span = c.dataset.layDef ? +c.dataset.layDef : Math.max(2, Math.min(LAY_COLS, Math.round((c.getBoundingClientRect().width + LAY_GAP) / (colW + LAY_GAP))));
    c.dataset.layDef = span;
    return { c, k, span };
  });
  let lay = main.querySelector(':scope > .lay');
  if (!lay) {
    lay = document.createElement('div'); lay.className = 'lay';
    let top = cards[0]; while (top.parentElement !== main) top = top.parentElement;
    main.insertBefore(lay, top);
  }
  const order = st.order || [];
  info.sort((a, b) => {
    const ia = order.indexOf(a.k), ib = order.indexOf(b.k);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1; if (ib === -1) return -1;
    return ia - ib;
  });
  info.forEach(({ c, k, span }) => {
    lay.appendChild(c);
    c.classList.add('lay-box');
    c.style.marginTop = '0';
    c.style.gridColumn = `span ${st.w?.[k] || span}`;
    if (st.h?.[k]) { c.style.height = st.h[k] + 'px'; c.classList.add('lay-fixed'); } else { c.style.height = ''; c.classList.remove('lay-fixed'); }
    if (!c.querySelector(':scope > .lay-grip')) c.insertAdjacentHTML('beforeend', `<button class="lay-grip" title="Drag to move this box" tabindex="-1">⠿</button><div class="lay-size" title="Drag to make this box smaller or bigger · double-click = normal size"></div>`);
  });
  // Wrappers left empty after the boxes moved out
  [...main.children].forEach(el => { if (el !== lay && !el.children.length && !el.textContent.trim()) el.remove(); });
  [...main.querySelectorAll(':scope > .grid')].forEach(g => { if (!g.children.length) g.remove(); });
  let foot = main.querySelector(':scope > .lay-foot');
  const custom = (st.order?.length || Object.keys(st.w || {}).length || Object.keys(st.h || {}).length);
  if (custom && !foot) { main.insertAdjacentHTML('beforeend', `<div class="lay-foot"><button class="btn sm" data-lay-reset>↺ Reset boxes on this page</button></div>`); }
  if (!custom && foot) foot.remove();
}

function laySave(page, lay) {
  const st = layStore(page, true);
  st.order = [...lay.children].map(c => c.dataset.lay).filter(Boolean);
  saveDb();
}

// ---------- Moving ----------
document.addEventListener('pointerdown', e => {
  const grip = e.target.closest('.lay-grip'); if (!grip) return;
  const card = grip.closest('.lay-box'), lay = card?.parentElement; if (!lay) return;
  e.preventDefault();
  card.classList.add('lay-moving'); document.body.classList.add('lay-dragging');
  let last = '', scrollT = 0;
  const move = ev => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.lay > .lay-box');
    if (el && el !== card) {
      const r = el.getBoundingClientRect();
      const before = ev.clientX < r.left + r.width / 2;
      const sig = el.dataset.lay + before;
      if (sig !== last) { last = sig; lay.insertBefore(card, before ? el : el.nextSibling); }
    }
    clearInterval(scrollT);
    if (ev.clientY < 70) scrollT = setInterval(() => scrollBy(0, -14), 16);
    else if (ev.clientY > innerHeight - 70) scrollT = setInterval(() => scrollBy(0, 14), 16);
  };
  const up = () => {
    clearInterval(scrollT);
    card.classList.remove('lay-moving'); document.body.classList.remove('lay-dragging');
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    laySave(route(), lay); layApply();
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
});

// ---------- Resizing ----------
document.addEventListener('pointerdown', e => {
  const grip = e.target.closest('.lay-size'); if (!grip) return;
  const card = grip.closest('.lay-box'), lay = card?.parentElement; if (!lay) return;
  e.preventDefault();
  const r = card.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
  const colW = (lay.clientWidth - (LAY_COLS - 1) * LAY_GAP) / LAY_COLS;
  let span = Math.round((r.width + LAY_GAP) / (colW + LAY_GAP)), h = r.height, hChanged = false;
  document.body.classList.add('lay-sizing'); card.classList.add('lay-resizing');
  const move = ev => {
    span = Math.max(2, Math.min(LAY_COLS, Math.round((r.width + ev.clientX - x0 + LAY_GAP) / (colW + LAY_GAP))));
    card.style.gridColumn = `span ${span}`;
    if (Math.abs(ev.clientY - y0) > 4) { hChanged = true; h = Math.max(LAY_MIN_H, Math.round(r.height + ev.clientY - y0)); card.style.height = h + 'px'; card.classList.add('lay-fixed'); }
  };
  const up = () => {
    document.body.classList.remove('lay-sizing'); card.classList.remove('lay-resizing');
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    const st = layStore(route(), true), k = card.dataset.lay;
    st.w ||= {}; st.h ||= {};
    if (span === +card.dataset.layDef) delete st.w[k]; else st.w[k] = span;
    if (hChanged) st.h[k] = h;
    laySave(route(), lay); layApply();
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
});
document.addEventListener('dblclick', e => {
  const grip = e.target.closest('.lay-size'); if (!grip) return;
  const card = grip.closest('.lay-box'), st = layStore(route(), true), k = card.dataset.lay;
  delete st.w?.[k]; delete st.h?.[k]; saveDb(); layApply();
});
document.addEventListener('click', async e => {
  if (!e.target.closest('[data-lay-reset]')) return;
  if (!(await sure('Put the boxes back?', ['Every box on this page goes back to its normal spot and size.'], 'Yes, put them back'))) return;
  delete db.settings.layout?.[route()]; await saveDb(); render();
});

const layRender0 = render;
render = function () { const r = layRender0.apply(this, arguments); layApply(); return r; };
window.addEventListener('hashchange', () => setTimeout(layApply, 0));
let layResizeT = 0;
window.addEventListener('resize', () => { clearTimeout(layResizeT); layResizeT = setTimeout(() => { if (innerWidth >= 1000) render(); }, 250); });

// ---------- The right column: 📝 Scratch pad box + ✨ AI box (owner 2026-11-25: "two separate things"). ----------
// db.settings.layout.side = { w: column px, padH: scratch pad px, padLast: AI box on top }
function sideStore() { db.settings.layout ||= {}; return db.settings.layout.side ||= {}; }
function sideApply() {
  const el = document.getElementById('helper'); if (!el || !db) return;
  const s = sideStore();
  el.style.width = s.w && innerWidth > 760 ? s.w + 'px' : '';
  el.style.setProperty('--pad-h', (s.padH || 300) + 'px');
  el.classList.toggle('pad-last', !!s.padLast);
}
document.addEventListener('pointerdown', e => {
  const wGrip = e.target.closest('.side-w'), split = e.target.closest('.side-split');
  if ((!wGrip && !split) || e.target.closest('[data-side-swap]')) return;
  e.preventDefault();
  const el = document.getElementById('helper'), s = sideStore();
  const x0 = e.clientX, y0 = e.clientY, w0 = el.getBoundingClientRect().width;
  const pad = el.querySelector('.pad-sbox'), h0 = pad.getBoundingClientRect().height;
  document.body.classList.add(wGrip ? 'side-wing' : 'side-splitting');
  const move = ev => {
    if (wGrip) { s.w = Math.max(260, Math.min(640, Math.round(w0 - (ev.clientX - x0)))); }
    else { const dy = ev.clientY - y0; s.padH = Math.max(110, Math.min(innerHeight - 260, Math.round(h0 + (s.padLast ? -dy : dy)))); }
    sideApply();
  };
  const up = () => {
    document.body.classList.remove('side-wing', 'side-splitting');
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    saveDb(); if (wGrip) render();
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
});
document.addEventListener('dblclick', e => {
  const wGrip = e.target.closest('.side-w'), split = e.target.closest('.side-split'); if (!wGrip && !split) return;
  const s = sideStore(); if (wGrip) delete s.w; else delete s.padH;
  saveDb(); sideApply(); if (wGrip) render();
});
document.addEventListener('click', e => {
  if (!e.target.closest('[data-side-swap]')) return;
  const s = sideStore(); s.padLast = !s.padLast; saveDb(); sideApply();
});
