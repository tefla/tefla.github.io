// ---------- Projector mode: full-screen tracing view (lifecycle + menu) ----------
// Paints the same outline chart as the B/W export live at screen size, over
// the whole app (plus browser fullscreen where allowed). The menu (and the
// cursor) fade after a few idle seconds and come back on pointer movement.
// Rendering lives in projector-render.js, the software keystone in
// projector-keystone.js, options/persistence in projector-state.js.
import { els, state } from './state.js';
import { popts, view, loadOpts, saveOpts } from './projector-state.js';
import { renderProjector } from './projector-render.js';
import { initKeystone, applyKeystone, setKeystoneEditing, isEditing, resetKeystone } from './projector-keystone.js';

var IDLE_MS = 2500;
var hideTimer = null;
var isOpen = false;
var overMenu = false;  // the menu never fades while the pointer is on it
var loaded = false;
var wakeLock = null;

function wake() {
  els.projector.classList.remove('idle');
  clearTimeout(hideTimer);
  if (overMenu || isEditing()) return; // corner-dragging needs the handles visible
  hideTimer = setTimeout(function () { els.projector.classList.add('idle'); }, IDLE_MS);
}

// render sets view.rect, which the keystone transform's handles hang off —
// always refresh in this order
function refresh() {
  renderProjector();
  applyKeystone();
}

function syncMenu() {
  els.projFlipH.checked = popts.flipH;
  els.projFlipV.checked = popts.flipV;
  els.projRotate.checked = popts.rotate;
  els.projNumbers.checked = popts.numbers;
  els.projMarks.checked = popts.marks;
  els.projGrid.checked = popts.grid;
  els.projInvert.checked = popts.invert;
  els.projLines.value = Math.round(popts.lineScale * 10);
  els.projDim.value = Math.round(popts.dim * 100);
}

// colour isolation: one option per palette colour that actually has cells
function populateFocus() {
  var html = '<option value="">All colours</option>';
  state.palette.forEach(function (p, i) {
    if (p.count > 0) html += '<option value="' + i + '">' + p.label + ' · ' + p.hex + '</option>';
  });
  els.projFocus.innerHTML = html;
  view.focus = null;
}

// ←/→ (and PgUp/PgDn, for presentation remotes) cycle All → 1 → 2 → … → All
function cycleFocus(dir) {
  var order = [null];
  state.palette.forEach(function (p, i) { if (p.count > 0) order.push(i); });
  var next = order[(order.indexOf(view.focus) + dir + order.length) % order.length];
  view.focus = next;
  els.projFocus.value = next == null ? '' : String(next);
  renderProjector();
}

function toggleCorners(on) {
  setKeystoneEditing(on);
  els.projCorners.textContent = on ? 'Done' : 'Adjust corners';
  els.projCornersReset.classList.toggle('hidden', !on);
  wake();
}

// keep the screen awake while tracing — a display that sleeps mid-outline
// loses the alignment. Best effort: unsupported browsers just skip it.
function acquireWakeLock() {
  if (!isOpen || !navigator.wakeLock) return;
  navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () {});
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
}

function openProjector() {
  if (!state.smoothedBlobs) return;
  if (!loaded) {
    // first run on this device: mirror-by-default follows the export option
    if (!loadOpts()) popts.flipH = els.exportMirror.checked;
    loaded = true;
  }
  populateFocus();
  syncMenu();
  toggleCorners(false);
  isOpen = true;
  els.projector.classList.remove('hidden');
  // best effort — headless/iframe contexts reject, and the fixed overlay
  // already covers the viewport, so a rejection needs no fallback handling
  if (els.projector.requestFullscreen) els.projector.requestFullscreen().catch(function () {});
  refresh();
  wake();
  acquireWakeLock();
}

function closeProjector() {
  if (!isOpen) return;
  isOpen = false;
  toggleCorners(false);
  releaseWakeLock();
  clearTimeout(hideTimer);
  els.projector.classList.add('hidden');
  if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
}

export function initProjector() {
  els.projOpenBtn.addEventListener('click', openProjector);
  els.projClose.addEventListener('click', closeProjector);

  [['projFlipH', 'flipH'], ['projFlipV', 'flipV'], ['projRotate', 'rotate'],
   ['projNumbers', 'numbers'], ['projMarks', 'marks'], ['projGrid', 'grid'],
   ['projInvert', 'invert']].forEach(function (pair) {
    els[pair[0]].addEventListener('change', function () {
      popts[pair[1]] = els[pair[0]].checked;
      saveOpts();
      refresh();
    });
  });
  els.projLines.addEventListener('input', function () {
    popts.lineScale = els.projLines.value / 10;
    saveOpts();
    renderProjector();
  });
  els.projDim.addEventListener('input', function () {
    popts.dim = els.projDim.value / 100;
    saveOpts();
    renderProjector();
  });
  els.projFocus.addEventListener('change', function () {
    view.focus = els.projFocus.value === '' ? null : +els.projFocus.value;
    renderProjector();
  });
  els.projCorners.addEventListener('click', function () { toggleCorners(!isEditing()); });
  els.projCornersReset.addEventListener('click', resetKeystone);

  els.projector.addEventListener('pointermove', function () { if (isOpen) wake(); });
  els.projector.addEventListener('pointerdown', function () { if (isOpen) wake(); });
  els.projMenu.addEventListener('pointerenter', function () { overMenu = true; if (isOpen) wake(); });
  els.projMenu.addEventListener('pointerleave', function () { overMenu = false; if (isOpen) wake(); });
  window.addEventListener('resize', function () { if (isOpen) refresh(); });
  // leaving browser fullscreen (Esc) closes the mode; the keydown handler
  // covers the fallback case where fullscreen was never granted
  document.addEventListener('fullscreenchange', function () {
    if (isOpen && !document.fullscreenElement) closeProjector();
  });
  document.addEventListener('visibilitychange', function () {
    if (isOpen && document.visibilityState === 'visible') acquireWakeLock();
  });
  document.addEventListener('keydown', function (e) {
    if (!isOpen) return;
    if (e.key === 'Escape') {
      if (isEditing()) toggleCorners(false);
      else closeProjector();
      return;
    }
    var t = e.target.tagName;
    if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); cycleFocus(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); cycleFocus(-1); }
  });

  initKeystone();
}
