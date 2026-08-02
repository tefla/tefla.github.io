// ---------- C-shell: board views, fit/zoom/pan, overlays, popovers ----------
// The IDE-style chrome around the pipeline: one full-bleed board showing a
// single view (Source crop / Colour chart / B/W chart), floating pills, and
// summonable overlays (shopping list, cloth layout, cloud projects). Owns no
// pattern state — app.js calls imageLoaded/setView/pickSourceView at the
// right moments and everything else is wired here off shell-only element ids.
import { els } from './state.js';

var view = 'colour';       // 'source' | 'colour' | 'bw'
var returnView = null;     // where to go back to after an eyedrop pick
var scale = 1, tx = 0, ty = 0, userZoomed = false;
var $ = function (id) { return document.getElementById(id); };

// ---------- board views ----------
var VIEWS = ['source', 'colour', 'bw'];

export function setView(v) {
  if (VIEWS.indexOf(v) < 0) return;
  view = v;
  VIEWS.forEach(function (k) { document.body.classList.toggle('view-' + k, k === v); });
  Array.prototype.forEach.call(document.querySelectorAll('#viewPill button'), function (b) {
    b.classList.toggle('on', b.dataset.view === v);
  });
  fit();
}

// eyedrop flows sample clicks on the crop canvas, so arming one jumps to the
// Source view and the pick (or Esc) returns to wherever the user was
export function pickSourceView() {
  if (view !== 'source') returnView = view;
  setView('source');
}
export function restorePickView() {
  if (returnView) { setView(returnView); returnView = null; }
}

export function imageLoaded(name) {
  document.body.classList.add('has-image');
  $('fileChip').textContent = name;
}

// ---------- fit / zoom / pan ----------
// #boardPan is centre-anchored; tx/ty offset from centre, then scale. The
// crop canvas keeps its own pointer math working because it reads sizes via
// getBoundingClientRect, which reflects the transform.
function content() {
  if (view === 'source') return els.cropCanvas;
  if (view === 'bw') return els.bwFrame;
  return els.colourFrame;
}

function applyTransform() {
  $('boardPan').style.transform =
    'translate(calc(-50% + ' + tx + 'px), calc(-50% + ' + ty + 'px)) scale(' + scale + ')';
  $('zoomLabel').textContent = Math.round(scale * 100) + '%';
}

// chrome clearance comes from #fitProbe's computed paddings — CSS states the
// real insets per breakpoint (and per phone-sheet state), and computed
// padding always resolves calc()/env() to plain px. Desktop values match the
// old hardcoded constants (120/64/110) exactly.
function fitPad() {
  var cs = getComputedStyle($('fitProbe'));
  return { x: parseFloat(cs.paddingLeft) || 0,
           top: parseFloat(cs.paddingTop) || 0,
           bottom: parseFloat(cs.paddingBottom) || 0 };
}

export function fit() {
  var c = content(), board = $('board');
  var w = c.offsetWidth, h = c.offsetHeight;
  var pad = fitPad();
  if (!w || !h) { scale = 1; ty = 0; } else {
    scale = Math.min((board.clientWidth - pad.x * 2) / w,
                     (board.clientHeight - pad.top - pad.bottom) / h);
    scale = Math.max(0.05, Math.min(scale, 6));
    ty = (pad.top - pad.bottom) / 2; // nudge up out from under the palette pill
  }
  tx = 0;
  userZoomed = false;
  applyTransform();
}

function zoomBy(f, mx, my) {
  var next = Math.max(0.05, Math.min(scale * f, 8));
  f = next / scale;
  if (mx !== undefined) { tx = mx - f * (mx - tx); ty = my - f * (my - ty); }
  scale = next;
  userZoomed = true;
  applyTransform();
}

function initZoom() {
  var board = $('board');
  $('zoomIn').addEventListener('click', function () { zoomBy(1.25); });
  $('zoomOut').addEventListener('click', function () { zoomBy(1 / 1.25); });
  $('zoomFit').addEventListener('click', fit);
  board.addEventListener('dblclick', function (e) {
    if (view === 'source' && e.target === els.cropCanvas) return;
    fit();
  });
  board.addEventListener('wheel', function (e) {
    e.preventDefault();
    var r = board.getBoundingClientRect();
    var mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, mx, my);
  }, { passive: false });

  // drag-pan anywhere on the board — except on the crop canvas, whose drags
  // ARE the crop interaction
  var drag = null;
  board.addEventListener('pointerdown', function (e) {
    if (view === 'source' && e.target === els.cropCanvas) return;
    drag = { x: e.clientX, y: e.clientY };
    board.classList.add('panning');
    board.setPointerCapture(e.pointerId);
  });
  board.addEventListener('pointermove', function (e) {
    if (!drag) return;
    tx += e.clientX - drag.x; ty += e.clientY - drag.y;
    drag = { x: e.clientX, y: e.clientY };
    userZoomed = true;
    applyTransform();
  });
  function endPan() { drag = null; board.classList.remove('panning'); }
  board.addEventListener('pointerup', endPan);
  board.addEventListener('pointercancel', endPan);

  // a re-render resizes the canvases (Detail changes the pixel size) and the
  // window can resize the board — re-fit unless the user has zoomed manually
  var ro = new ResizeObserver(function () { if (!userZoomed) fit(); });
  ro.observe(board);
  ro.observe(els.colourCanvas);
  ro.observe(els.bwCanvas);
  ro.observe(els.cropCanvas);
}

// ---------- overlays (shopping list / cloth / cloud / imagine) ----------
var OVERLAYS = ['shopOverlay', 'clothOverlay', 'cloudOverlay', 'imagineOverlay'];

export function openOverlay(id) {
  OVERLAYS.forEach(function (o) {
    var el = $(o);
    el.classList.toggle('open', o === id);
    if (o !== id) el.classList.remove('full');
  });
  document.dispatchEvent(new CustomEvent('tuft:overlay', { detail: { id: id } }));
}
function closeOverlays() {
  OVERLAYS.forEach(function (o) { $(o).classList.remove('open', 'full'); });
}
function anyOverlayOpen() {
  return OVERLAYS.some(function (o) { return $(o).classList.contains('open'); });
}

// ---------- popovers (Export, ⋯ menu) ----------
function togglePop(id) {
  var el = $(id), was = el.classList.contains('hidden');
  closePops();
  el.classList.toggle('hidden', !was);
}
function closePops() {
  ['exportPop', 'menuPop'].forEach(function (p) { $(p).classList.add('hidden'); });
}

// ---------- phone props sheet: peek (default) ↔ open ----------
// body.sheet-open drives the CSS (sheet height + fit insets); ≤700px only —
// on desktop the grabber is hidden and the class is inert
var PHONE = window.matchMedia('(max-width: 700px)');

function initSheet() {
  $('sheetGrab').addEventListener('click', function () {
    document.body.classList.toggle('sheet-open');
    fit();
  });
  // tapping a tab while peeked opens the sheet on that tab
  Array.prototype.forEach.call(document.querySelectorAll('.proptabs [data-ptab]'), function (b) {
    b.addEventListener('click', function () {
      if (PHONE.matches && !document.body.classList.contains('sheet-open')) {
        document.body.classList.add('sheet-open');
        fit();
      }
    });
  });
  // crossing the breakpoint resets to the peeked default
  PHONE.addEventListener('change', function () {
    document.body.classList.remove('sheet-open');
    fit();
  });
}

export function initShell() {
  // view pill
  Array.prototype.forEach.call(document.querySelectorAll('#viewPill button'), function (b) {
    b.addEventListener('click', function () { setView(b.dataset.view); });
  });

  // props card tabs (Design / Yarn)
  Array.prototype.forEach.call(document.querySelectorAll('.proptabs [data-ptab]'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.proptabs [data-ptab]'), function (x) {
        x.classList.toggle('on', x === b);
      });
      $('ptabDesign').classList.toggle('hidden', b.dataset.ptab !== 'design');
      $('ptabYarn').classList.toggle('hidden', b.dataset.ptab !== 'yarn');
    });
  });

  // overlays
  $('shopOpenBtn').addEventListener('click', function () { openOverlay('shopOverlay'); });
  $('shopExpand').addEventListener('click', function () { $('shopOverlay').classList.toggle('full'); });
  $('miCloth').addEventListener('click', function () { closePops(); openOverlay('clothOverlay'); });
  $('miCloud').addEventListener('click', function () { closePops(); openOverlay('cloudOverlay'); });
  // phone-only replacement for the hidden fileChip (tb-left dies ≤700px)
  $('miOpen').addEventListener('click', function () { closePops(); $('fileInput').click(); });
  $('imagineBtn').addEventListener('click', function () { openOverlay('imagineOverlay'); });
  $('miImagine').addEventListener('click', function () { closePops(); openOverlay('imagineOverlay'); });

  // account chip: the always-visible door to the Account panel. cloud.js
  // broadcasts auth state (tuft:auth) because auth is its domain; the chip
  // is chrome, so it's dressed here.
  $('accountBtn').addEventListener('click', function () { openOverlay('cloudOverlay'); });
  document.addEventListener('tuft:auth', function (e) {
    var chip = $('accountBtn'), user = e.detail.user;
    chip.classList.toggle('authed', !!user);
    chip.textContent = user ? (user.email || '?').charAt(0).toUpperCase() : 'Sign in';
    chip.title = user ? user.email : 'Sign in — cloud projects & synced settings';
  });
  Array.prototype.forEach.call(document.querySelectorAll('.overlay-close'), function (b) {
    b.addEventListener('click', closeOverlays);
  });

  // popovers
  $('exportBtn').addEventListener('click', function (e) { e.stopPropagation(); togglePop('exportPop'); });
  $('menuBtn').addEventListener('click', function (e) { e.stopPropagation(); togglePop('menuPop'); });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.popwrap')) closePops();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    closePops();
    if (anyOverlayOpen()) closeOverlays();
  });

  initSheet();
  initZoom();
  setView('colour');
}
