// ---------- Cloth layout: several designs on one cloth for the projector ----------
// A cloth is W×H cm; each item is a frozen snapshot of a processed design
// (outline loops + label positions + finishing, in cell units) with its
// physical size, position, and 0/90° rotation in cm on the cloth. The
// projector's cloth view draws every item at true scale, so one keystone
// session covers many small designs. Stored per device (localStorage) —
// like the projector setup, the cloth on the frame is a physical-world
// concern, not cloud-project state.
import { els, state } from './state.js';
import { finishingGeometry, insideRoundRect } from './geometry.js';
import { blobLabelInfo } from './render.js';
import { escapeHtml } from './yarns.js';

var KEY = 'tuft-cloth-v1';
var layout = { w: 100, h: 100, items: [] };
var onChange = null; // projector re-render hook, set by initCloth

export function getLayout() { return layout; }

function round2(v) { return Math.round(v * 100) / 100; }

function msg(text) {
  els.clothMsg.textContent = text;
  els.clothMsg.classList.toggle('hidden', !text);
}

export function saveLayout() {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
    msg('');
  } catch (e) {
    msg('Too big to store — this cloth works now but will not survive a reload.');
  }
  els.clothProjectBtn.disabled = layout.items.length === 0;
}

function loadLayout() {
  try {
    var raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw.w === 'number' && typeof raw.h === 'number' && Array.isArray(raw.items)) layout = raw;
  } catch (e) {}
  els.clothW.value = layout.w;
  els.clothH.value = layout.h;
  els.clothProjectBtn.disabled = layout.items.length === 0;
}

// freeze the CURRENT pattern into a projector-drawable snapshot: outline
// loops per blob (cell units, rounded — 0.01 cell is far below tufting
// precision), label anchors precomputed from the blob cells, finishing
// geometry. Everything the projector needs, nothing the editor needs.
export function snapshotDesign() {
  var cols = state.gridCols, rows = state.gridRows;
  var geom = finishingGeometry(cols, rows);
  var blobs = state.smoothedBlobs.map(function (b) {
    return { i: b.idx, loops: b.loops.map(function (loop) {
      return loop.map(function (p) { return [round2(p[0]), round2(p[1])]; });
    }) };
  });
  var labels = [];
  var innerX0 = geom.B, innerY0 = geom.B, innerX1 = cols - geom.B, innerY1 = rows - geom.B;
  state.smoothedBlobs.forEach(function (blob) {
    var info = blobLabelInfo(blob.cells, cols);
    if (geom.active && !insideRoundRect(info.c + 0.5, info.r + 0.5, innerX0, innerY0, innerX1, innerY1, geom.Ri)) return;
    labels.push({ t: state.palette[blob.idx].label, i: blob.idx, x: info.c + 0.5, y: info.r + 0.5, wc: info.wCells, hc: info.hCells });
  });
  if (geom.active && geom.B > 0) {
    labels.push({ t: String(state.palette.length + 1), i: -1, x: cols / 2, y: geom.B / 2, wc: 1e6, hc: 1e6 });
  }
  return { cols: cols, rows: rows, blobs: blobs, labels: labels,
           fin: { active: geom.active, R: geom.R, B: geom.B, Ri: geom.Ri } };
}

// footprint on the cloth in cm — rotation swaps the sides
export function itemFootprint(item) {
  return item.rot ? { w: item.h, h: item.w } : { w: item.w, h: item.h };
}

export function clampItem(item) {
  var fp = itemFootprint(item);
  item.x = round2(Math.max(0, Math.min(layout.w - fp.w, item.x)));
  item.y = round2(Math.max(0, Math.min(layout.h - fp.h, item.y)));
}

function addCurrentDesign() {
  if (!state.smoothedBlobs) return;
  var item = snapshotDesign();
  item.id = 'd' + Date.now().toString(36) + '-' + layout.items.length;
  item.name = (els.dzTitle.textContent || 'design').replace(/\.(png|jpe?g|webp)$/i, '').slice(0, 40);
  item.w = parseFloat(els.matW.value) || 50;
  item.h = parseFloat(els.matH.value) || 50;
  item.rot = 0;
  var off = 1 + layout.items.length * 2; // cascade; final placement is a drag in the projector
  item.x = off; item.y = off;
  clampItem(item);
  layout.items.push(item);
  saveLayout();
  refreshClothList();
}

export function refreshClothList() {
  if (!layout.items.length) {
    els.clothList.innerHTML = '<tr><td colspan="4" style="color:var(--ink-soft)">Nothing on the cloth yet</td></tr>';
    return;
  }
  els.clothList.innerHTML = layout.items.map(function (it) {
    return '<tr data-id="' + it.id + '"><td>' + escapeHtml(it.name) + (it.rot ? ' <span class="hint">⟳90°</span>' : '') + '</td>' +
      '<td class="num">' + it.w + ' × ' + it.h + ' cm</td>' +
      '<td class="num">' + it.x + ', ' + it.y + ' cm</td>' +
      '<td class="num"><button type="button" class="autobtn" data-rot="' + it.id + '" title="Rotate 90° on the cloth">⟳</button> ' +
      '<button type="button" class="autobtn" data-del="' + it.id + '" title="Remove from cloth">✕</button></td></tr>';
  }).join('');
}

function findItem(id) {
  for (var i = 0; i < layout.items.length; i++) if (layout.items[i].id === id) return layout.items[i];
  return null;
}

export function initCloth(projectCloth, rerender) {
  onChange = rerender;
  loadLayout();
  refreshClothList();
  els.clothAddBtn.addEventListener('click', addCurrentDesign);
  els.clothProjectBtn.addEventListener('click', projectCloth);
  els.clothList.addEventListener('click', function (e) {
    var del = e.target.closest('button[data-del]');
    if (del) {
      layout.items = layout.items.filter(function (it) { return it.id !== del.dataset.del; });
      saveLayout();
      refreshClothList();
      onChange();
      return;
    }
    var rot = e.target.closest('button[data-rot]');
    if (rot) {
      var it = findItem(rot.dataset.rot);
      if (!it) return;
      it.rot = it.rot ? 0 : 1;
      clampItem(it);
      saveLayout();
      refreshClothList();
      onChange();
    }
  });
  ['clothW', 'clothH'].forEach(function (id) {
    els[id].addEventListener('input', function () {
      var v = parseFloat(els[id].value);
      if (!isFinite(v) || v < 10) return; // mid-typing values; keep last good size
      layout[id === 'clothW' ? 'w' : 'h'] = v;
      layout.items.forEach(clampItem);
      saveLayout();
      refreshClothList();
      onChange();
    });
  });
}
