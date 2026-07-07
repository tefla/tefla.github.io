// ---------- app entry: crop UI, main pipeline, advanced controls, wiring ----------
import { els, state, FULL_CROP, initEls } from './state.js';
import { luminance, rgbToHex, sampleTrainingPixels, seedCentroids, kmeansTrain, labelPixels, detectColourPeaks, autoDetectK, modeFilterPass, despeckle } from './quantise.js';
import { computeGridDims, sampleImage, finishingGeometry, insideRoundRect } from './geometry.js';
import { computeSmoothedBlobs } from './trace.js';
import { computeLineArt } from './lineart.js';
import { renderColour, renderBW, downloadCanvas, downloadSVG } from './render.js';
import { setActiveLine, activeLine, updateShoppingList, repaintColourIfPreviewing, computeYarnDisplayHexes, populateBrandSelect, populateMsRegion, populateMsSuppliers, applyRegionFilter, syncMsAllowedFromCheckboxes, setMsCheckboxesFromKeys, MS_SEP, hexToRgb, rgbToLab, deltaE } from './yarns.js';
import { initCloud } from './cloud.js';
import { initPrefs } from './prefs.js';
import { initPanels } from './panels.js';
import { initPicker, openPicker } from './picker.js';

// ---------- image import ----------
// `onload` (optional) fires after the chart has regenerated — the cloud
// project loader restores saved settings on top of the freshly loaded image
function loadFile(file, onload) {
  if (!file || file.type.indexOf('image/') !== 0) return;
  var reader = new FileReader();
  reader.onload = function (e) {
    var img = new Image();
    img.onload = function () {
      state.img = img;
      state.cropRect = FULL_CROP;
      state.pins = {};           // pins/merges are tied to a specific image
      state.mergeGroups = [];
      state.mergeSource = null;
      state.eyedropOrig = null;
      state.eyedropAdd = false;
      els.thumb.src = e.target.result;
      els.thumb.classList.add('show');
      els.dzTitle.textContent = file.name;
      els.dzSub.textContent = img.naturalWidth + ' × ' + img.naturalHeight + 'px — click to replace';
      els.cropWrap.classList.remove('hidden');
      initCropCanvas();
      autoPickK();
      process();
      if (onload) onload();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ---------- crop ----------
var cropDrag = null;
var CROP_HANDLE_PX = 10;

// null = free; otherwise a numeric width/height ratio. The crop canvas is
// scaled uniformly from the image (one `scale` for both axes in
// initCropCanvas), so display-px ratio == image-px ratio — no conversion needed.
function cropAspectRatio() {
  var v = els.cropAspect.value;
  if (v === 'free') return null;
  if (v === 'mat') return (parseFloat(els.matW.value) || 1) / (parseFloat(els.matH.value) || 1);
  return parseFloat(v);
}

// shared drag geometry for both 'draw' (origin = drag start) and 'resize'
// (origin = the fixed opposite corner): grows the rect from origin toward
// pos, forcing w/h to AR when locked, and clamps within [0,w]x[0,h] by
// capping by the room actually available in the drag direction — pos is
// already clamped to the canvas by cropPointerPos, so this never overshoots.
function rectFromDragOrigin(originX, originY, pos, w, h, AR) {
  var dx = pos.x - originX, dy = pos.y - originY;
  var dirX = dx < 0 ? -1 : 1, dirY = dy < 0 ? -1 : 1;
  var rawW = Math.abs(dx), rawH = Math.abs(dy);
  var maxW = dirX < 0 ? originX : (w - originX);
  var maxH = dirY < 0 ? originY : (h - originY);
  var rw, rh;
  if (AR == null) {
    rw = rawW; rh = rawH;
  } else {
    var dw = rawW, dh = rawH;
    if (dh === 0 || dw / dh > AR) dh = dw / AR; else dw = dh * AR;
    rw = Math.min(dw, maxW, maxH * AR);
    rh = rw / AR;
  }
  return { x: dirX < 0 ? originX - rw : originX, y: dirY < 0 ? originY - rh : originY, w: rw, h: rh };
}

// largest rect of ratio AR, centred at (cx,cy), that fits within
// [0,boundW]x[0,boundH] and does not exceed maxW/maxH (defaults to the
// bounds themselves) — the one routine behind cropAspect change, mat
// relock, and "Use full image" under a lock.
function largestRectOfRatio(cx, cy, boundW, boundH, AR, maxW, maxH) {
  if (maxW == null) maxW = boundW;
  if (maxH == null) maxH = boundH;
  var w = Math.min(maxW, boundW), h = w / AR;
  if (h > Math.min(maxH, boundH)) { h = Math.min(maxH, boundH); w = h * AR; }
  var x = Math.max(0, Math.min(boundW - w, cx - w / 2));
  var y = Math.max(0, Math.min(boundH - h, cy - h / 2));
  return { x: x, y: y, w: w, h: h };
}

// re-fit the CURRENT crop to the active lock ratio, keeping its centre and
// capping the new rect to the old crop's own footprint (never grows past
// what was already selected just because the ratio changed)
function refitCropToAspect() {
  var AR = cropAspectRatio();
  if (AR == null || !state.img) return;
  var w = els.cropCanvas.width, h = els.cropCanvas.height;
  var rect = cropRectDisplayPx();
  var fit = largestRectOfRatio(rect.x + rect.w / 2, rect.y + rect.h / 2, w, h, AR, rect.w, rect.h);
  state.cropRect = { x: fit.x / w, y: fit.y / h, w: fit.w / w, h: fit.h / h };
  drawCropOverlay();
  updateCropDimsLabel();
  process();
}

function initCropCanvas() {
  var maxSide = 480;
  var iw = state.img.naturalWidth, ih = state.img.naturalHeight;
  var scale = Math.min(maxSide / iw, maxSide / ih, 1);
  els.cropCanvas.width = Math.round(iw * scale);
  els.cropCanvas.height = Math.round(ih * scale);
  drawCropOverlay();
  updateCropDimsLabel();
}

function cropRectDisplayPx() {
  var w = els.cropCanvas.width, h = els.cropCanvas.height, r = state.cropRect;
  return { x: r.x * w, y: r.y * h, w: r.w * w, h: r.h * h };
}

function drawCropOverlay() {
  var canvas = els.cropCanvas, ctx = canvas.getContext('2d');
  var w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(state.img, 0, 0, w, h);

  var rect = cropRectDisplayPx();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, w, rect.y);
  ctx.fillRect(0, rect.y + rect.h, w, h - rect.y - rect.h);
  ctx.fillRect(0, rect.y, rect.x, rect.h);
  ctx.fillRect(rect.x + rect.w, rect.y, w - rect.x - rect.w, rect.h);

  ctx.strokeStyle = '#2f6f52';
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x + 1, rect.y + 1, Math.max(0, rect.w - 2), Math.max(0, rect.h - 2));

  ctx.fillStyle = '#2f6f52';
  [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]].forEach(function (p) {
    ctx.fillRect(p[0] - CROP_HANDLE_PX / 2, p[1] - CROP_HANDLE_PX / 2, CROP_HANDLE_PX, CROP_HANDLE_PX);
  });
}

function updateCropDimsLabel() {
  var iw = state.img.naturalWidth, ih = state.img.naturalHeight, r = state.cropRect;
  var full = r.x === 0 && r.y === 0 && r.w === 1 && r.h === 1;
  els.cropDims.textContent = full
    ? 'Using full image (' + iw + ' × ' + ih + 'px)'
    : Math.round(r.w * iw) + ' × ' + Math.round(r.h * ih) + 'px selected';
}

function cropPointerPos(e) {
  var rect = els.cropCanvas.getBoundingClientRect();
  var scaleX = els.cropCanvas.width / rect.width, scaleY = els.cropCanvas.height / rect.height;
  return {
    x: Math.max(0, Math.min(els.cropCanvas.width, (e.clientX - rect.left) * scaleX)),
    y: Math.max(0, Math.min(els.cropCanvas.height, (e.clientY - rect.top) * scaleY))
  };
}

function hitTestHandle(pos, rect) {
  var corners = [
    { key: 'nw', x: rect.x, y: rect.y }, { key: 'ne', x: rect.x + rect.w, y: rect.y },
    { key: 'sw', x: rect.x, y: rect.y + rect.h }, { key: 'se', x: rect.x + rect.w, y: rect.y + rect.h }
  ];
  for (var i = 0; i < corners.length; i++) {
    var c = corners[i];
    if (Math.abs(pos.x - c.x) <= CROP_HANDLE_PX && Math.abs(pos.y - c.y) <= CROP_HANDLE_PX) return c.key;
  }
  return null;
}

function pointInRect(pos, rect) {
  return pos.x >= rect.x && pos.x <= rect.x + rect.w && pos.y >= rect.y && pos.y <= rect.y + rect.h;
}

function endCropDrag() {
  if (!cropDrag) return;
  cropDrag = null;
  var r = state.cropRect;
  if (r.w < 0.05 || r.h < 0.05) { state.cropRect = FULL_CROP; drawCropOverlay(); updateCropDimsLabel(); }
  if (state.img) process();
}

// ---------- main pipeline ----------
// computeCentroids does the expensive part (sampling + k-means training)
// and fixes the luminance order once, from the RAW trained centroids —
// relabelAndRender re-runs on top of this without retraining, so a boundary
// weight drag stays cheap and never reorders/relabels the palette
function computeCentroids() {
  var dims = computeGridDims(state.img, parseInt(els.detailSize.value, 10));
  state.gridCols = dims.cols; state.gridRows = dims.rows;
  els.detailVal.textContent = dims.cols + ' × ' + dims.rows + ' px';

  var k = parseInt(els.kColors.value, 10);
  els.kVal.textContent = k;

  var n = dims.cols * dims.rows;
  var data = sampleImage(state.img, dims.cols, dims.rows);
  var samples = sampleTrainingPixels(data, n, 24000);
  // a pin whose raw index no longer exists at this k is dropped (k shrank);
  // merges are colour-based, so they need no index bookkeeping
  Object.keys(state.pins).forEach(function (i) { if (+i >= k) delete state.pins[+i]; });
  // keep boundary weights sized to k so the reprocess paths that skip
  // resetAdvanced (pin/merge/add-colour) never leave a stale-length array
  if (!state.weights || state.weights.length !== k) {
    var nw = new Float32Array(k); nw.fill(1);
    if (state.weights) for (var wi = 0; wi < Math.min(k, state.weights.length); wi++) nw[wi] = state.weights[wi];
    state.weights = nw;
  }
  var trained = kmeansTrain(samples, k, 16,
    seedCentroids(samples, k, detectColourPeaks(data, n), state.pins), state.pins);

  // order/remap derived from the RAW trained centroids (not the post-cleanup
  // means computed in relabelAndRender) — stable across weight changes, so
  // a weight drag can't flip two similar colours' order and swap slider
  // identities mid-drag
  var order = [];
  for (var oi = 0; oi < k; oi++) order.push(oi);
  order.sort(function (a, b) {
    var ca = [trained.centroids[a * 3], trained.centroids[a * 3 + 1], trained.centroids[a * 3 + 2]];
    var cb = [trained.centroids[b * 3], trained.centroids[b * 3 + 1], trained.centroids[b * 3 + 2]];
    return luminance(cb) - luminance(ca);
  });
  var remap = new Uint8Array(k);
  order.forEach(function (origIdx, newIdx) { remap[origIdx] = newIdx; });

  state.sampled = { data: data, cols: dims.cols, rows: dims.rows, n: n };
  state.trained = { centroids: trained.centroids, k: k };
  state.order = order;
  state.remap = remap;
}

// ---------- advanced: boundary weights ----------
// slider is -100..100, 0 = ×1; log-symmetric so ±100 gives ×0.25/×4
function weightFromSlider(v) { return Math.pow(2, v / 50); }
function sliderFromWeight(w) { return Math.round(50 * Math.log2(w)); }
function formatWeight(w) { return '×' + w.toFixed(2); }

// single reset point for everything a fresh centroid recompute invalidates —
// weights are indexed by RAW (pre-remap) centroid index, matching labelPixels
function resetAdvanced() {
  var k = state.trained.k;
  state.weights = new Float32Array(k);
  for (var i = 0; i < k; i++) state.weights[i] = 1;
  state.yarnOverrides = {};
  buildAdvancedRows();
}

function buildAdvancedRows() {
  var k = state.trained.k;
  state.advRowsK = k;
  var html = '';
  for (var newIdx = 0; newIdx < k; newIdx++) {
    var rawIdx = state.order[newIdx];
    var w = state.weights[rawIdx];
    var p = state.palette && state.palette[newIdx];
    var hex = p ? p.hex : '#888888';
    var empty = !!(p && p.count === 0);
    html += '<div class="advRow' + (empty ? ' empty' : '') + '" data-idx="' + newIdx + '">' +
      '<span class="letter">' + (newIdx + 1) + '</span>' +
      '<span class="swatch" style="background:' + hex + '"></span>' +
      '<input type="range" min="-100" max="100" value="' + sliderFromWeight(w) + '" />' +
      '<span class="val">' + formatWeight(w) + '</span>' +
      '</div>';
  }
  els.advBoundaries.innerHTML = html;
  Array.prototype.forEach.call(els.advBoundaries.querySelectorAll('.advRow'), function (row, newIdx) {
    var input = row.querySelector('input[type="range"]');
    var val = row.querySelector('.val');
    input.addEventListener('input', function () {
      var rawIdx = state.order[newIdx];
      var w2 = weightFromSlider(parseInt(input.value, 10));
      state.weights[rawIdx] = w2;
      val.textContent = formatWeight(w2);
      debouncedRelabel();
    });
  });
}

// cheap per-render update of the existing rows' swatches/empty state —
// does NOT touch the range inputs, so a boundary drag never loses focus
function refreshAdvancedSwatches() {
  if (!state.palette || state.advRowsK !== state.palette.length) { buildAdvancedRows(); return; }
  var rows = els.advBoundaries.children;
  for (var i = 0; i < rows.length; i++) {
    var p = state.palette[i];
    rows[i].classList.toggle('empty', p.count === 0);
    rows[i].querySelector('.swatch').style.background = p.hex;
  }
}

// ---------- palette editor (pinned colours) ----------
// one chip per detected colour under the charts: hex + share%, with actions to
// pin it to an exact colour, eyedrop one from the source image, merge it into
// another slot, or unpin. A trailing "+ Add colour" chip grows k by one.
function buildPaletteStrip() {
  if (!state.palette) { els.paletteStrip.innerHTML = ''; return; }
  var total = state.totalCells || 1;
  var merging = state.mergeSource != null;
  els.paletteStrip.classList.toggle('merging', merging);
  var chips = state.palette.map(function (p, newIdx) {
    if (p.count === 0 && !p.pinned) return '';
    var pct = (p.count / total * 100).toFixed(1);
    var isSrc = merging && state.mergeSource === newIdx;
    var isTarget = merging && !isSrc;
    return '<div class="pal-chip' + (p.pinned ? ' pinned' : '') + (isSrc ? ' merge-src' : '') +
      (isTarget ? ' merge-target' : '') + '" data-new="' + newIdx + '">' +
      '<span class="swatch" style="background:' + p.hex + '"></span>' +
      '<span class="pal-meta"><span class="pal-label">' + (newIdx + 1) +
        (p.pinned ? ' <span class="pal-pin" title="Pinned">📌</span>' : '') + '</span>' +
      '<span class="hex">' + p.hex + '</span><span class="pal-share">' + pct + '%</span></span>' +
      '<span class="pal-acts">' +
        '<label class="pal-act" title="Set exact colour"><input type="color" class="palColor" data-new="' + newIdx + '" value="' + p.hex + '"><span aria-hidden="true">✎</span></label>' +
        '<button type="button" class="pal-act palEyedrop" data-new="' + newIdx + '" title="Pick colour from the image">◎</button>' +
        '<button type="button" class="pal-act palMerge' + (isSrc ? ' active' : '') + '" data-new="' + newIdx + '" title="Merge this colour into another">⤳</button>' +
        (p.pinned ? '<button type="button" class="pal-act palUnpin" data-new="' + newIdx + '" title="Unpin — back to auto">✕</button>' : '') +
      '</span></div>';
  }).join('');
  var hint = merging ? '<span class="pal-merge-hint">Pick a colour to merge into…</span>' : '';
  var addChip = '<button type="button" class="pal-add" id="palAddBtn" title="Add a colour and pin it from the image">＋ Add colour</button>';
  els.paletteStrip.innerHTML = chips + addChip + hint;
}

// re-quantise with the current pins WITHOUT wiping Advanced weights/overrides
// (k is unchanged, so both stay valid) — used by pin/unpin/eyedrop
function reprocessWithPins() {
  if (!state.img) return;
  computeCentroids();
  relabelAndRender();
}

// merges are COLOUR-based, not index-based: each group is a set of colours the
// user declared "one". On every relabel we collapse any cluster within MERGE_DE
// of a group into that group's largest member — so surplus near-identical greys
// stay merged even after a Detail change reshuffles the raw cluster indices.
var MERGE_DE = 20;

// raw-index → survivor-raw-index map for this relabel, from the colour groups
function computeMergeMap(centroidList, counts, k) {
  var map = new Int32Array(k);
  for (var i = 0; i < k; i++) map[i] = i;
  if (!state.mergeGroups || state.mergeGroups.length === 0) return map;
  var labs = centroidList.map(function (c) { return rgbToLab(c); });
  state.mergeGroups.forEach(function (group) {
    var glabs = group.map(function (rgb) { return rgbToLab(rgb); });
    var members = [];
    for (var raw = 0; raw < k; raw++) {
      for (var gi = 0; gi < glabs.length; gi++) {
        if (deltaE(labs[raw], glabs[gi]) < MERGE_DE) { members.push(raw); break; }
      }
    }
    if (members.length > 1) {
      // pinned clusters are never merged AWAY (the user explicitly placed
      // them) — but merging INTO a pin is fine, so a pinned member wins the
      // survivor slot. With several pinned members, the largest pin survives
      // and only the UNPINNED members collapse into it.
      var pinnedMembers = members.filter(function (m) { return !!state.pins[m]; });
      var candidates = pinnedMembers.length ? pinnedMembers : members;
      var survivor = candidates[0], best = counts[candidates[0]] || 0;
      candidates.forEach(function (m) { if ((counts[m] || 0) > best) { best = counts[m]; survivor = m; } });
      members.forEach(function (m) {
        if (state.pins[m] && m !== survivor) return; // other pins stay distinct
        map[m] = survivor;
      });
    }
  });
  return map;
}

// merge display slot srcNew into tgtNew: union their colours into one group,
// then relabel (colour-based, so it survives a later reprocess)
function mergeInto(srcNew, tgtNew) {
  state.mergeSource = null;
  if (srcNew === tgtNew) { buildPaletteStrip(); return; }
  unionMergeGroup(state.palette[srcNew].rgb, state.palette[tgtNew].rgb);
  relabelAndRender();
}

// add colours a,b to a shared group, absorbing any existing groups near either
function unionMergeGroup(a, b) {
  var la = rgbToLab(a), lb = rgbToLab(b);
  var combined = [a.slice(), b.slice()], keep = [];
  state.mergeGroups.forEach(function (grp) {
    var near = grp.some(function (c) { var lc = rgbToLab(c); return deltaE(lc, la) < MERGE_DE || deltaE(lc, lb) < MERGE_DE; });
    if (near) combined = combined.concat(grp); else keep.push(grp);
  });
  keep.push(combined);
  state.mergeGroups = keep;
}

// "+ Add colour": the next image click adds a pinned slot at k+1 (how a tiny
// accent with no histogram peak — a pink ear — gets its own colour at low k)
function armAddColour() {
  if (parseInt(els.kColors.value, 10) >= parseInt(els.kColors.max, 10)) {
    els.cropDims.textContent = 'Colour limit reached — merge or raise Colours first';
    return;
  }
  state.mergeSource = null;
  state.eyedropAdd = true;
  state.eyedropOrig = null;
  els.cropCanvas.classList.add('eyedrop');
  els.cropDims.textContent = 'Click the image to add a new pinned colour (Esc to cancel)';
  buildPaletteStrip();
}

// sample the true source-image pixel under a crop-canvas point (the canvas is
// the image scaled to its own size; a 1×1 draw reads the exact source colour)
function sampleImagePixel(pos) {
  var iw = state.img.naturalWidth, ih = state.img.naturalHeight;
  var sx = Math.max(0, Math.min(iw - 1, Math.round(pos.x / els.cropCanvas.width * iw)));
  var sy = Math.max(0, Math.min(ih - 1, Math.round(pos.y / els.cropCanvas.height * ih)));
  var tmp = document.createElement('canvas'); tmp.width = 1; tmp.height = 1;
  var t = tmp.getContext('2d');
  t.drawImage(state.img, sx, sy, 1, 1, 0, 0, 1, 1);
  var d = t.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

function armEyedropper(newIdx) {
  state.eyedropOrig = state.order[newIdx];
  els.cropCanvas.classList.add('eyedrop');
  els.cropDims.textContent = 'Eyedropper armed — click the image to pin colour ' + (newIdx + 1) + ' (Esc to cancel)';
}

function cancelEyedropper() {
  state.eyedropOrig = null;
  state.eyedropAdd = false;
  els.cropCanvas.classList.remove('eyedrop');
  if (state.img) updateCropDimsLabel();
}

// recompute palette counts + border cell count from state.grid against the
// current finishing geometry — the cheap step re-run by a rounding/border
// slider drag (no retraining, no re-tracing) and also by a full relabel.
// With finishing off this reproduces the old plain tally exactly: every
// cell is interior, no border, totalCells === n.
function recomputeCounts() {
  var cols = state.gridCols, rows = state.gridRows, grid = state.grid, palette = state.palette;
  for (var p = 0; p < palette.length; p++) palette[p].count = 0;
  var geom = finishingGeometry(cols, rows);
  var innerX0 = geom.B, innerY0 = geom.B, innerX1 = cols - geom.B, innerY1 = rows - geom.B;
  var borderCells = 0, interiorCells = 0;
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      var i = r * cols + c;
      if (geom.active) {
        var cx = c + 0.5, cy = r + 0.5;
        if (!insideRoundRect(cx, cy, 0, 0, cols, rows, geom.R)) continue; // corner cut off — excluded entirely
        if (geom.B > 0 && !insideRoundRect(cx, cy, innerX0, innerY0, innerX1, innerY1, geom.Ri)) { borderCells++; continue; }
      }
      palette[grid[i]].count++; interiorCells++;
    }
  }
  state.border = (geom.active && geom.B > 0) ? { hex: state.borderHex, cells: borderCells } : null;
  state.totalCells = interiorCells + borderCells;
}

// relabelAndRender reads state.sampled/state.trained (set by computeCentroids)
// and re-derives everything downstream of labelling — this is what a boundary
// weight slider re-runs, without retraining k-means
function relabelAndRender() {
  var sampled = state.sampled, trained = state.trained;
  var cols = sampled.cols, rows = sampled.rows, n = sampled.n, data = sampled.data, k = trained.k;

  var labels = labelPixels(data, n, trained.centroids, k, state.advanced ? state.weights : null);
  labels = modeFilterPass(labels, cols, rows, k);
  labels = modeFilterPass(labels, cols, rows, k);
  despeckle(labels, cols, rows, Math.max(4, Math.round(n * 0.0001)));

  // recompute each colour as the mean of its pixels AFTER cleanup — the
  // k-means centroids are polluted by the anti-aliasing halo pixels that the
  // mode filter has since reassigned (a small yellow cluster that also caught
  // the beige↔dark blends comes out muddy brown; its surviving pixels don't)
  var colourSums = new Float64Array(k * 4);
  for (var ci = 0; ci < n; ci++) {
    var lab = labels[ci];
    colourSums[lab * 4] += data[ci * 4]; colourSums[lab * 4 + 1] += data[ci * 4 + 1];
    colourSums[lab * 4 + 2] += data[ci * 4 + 2]; colourSums[lab * 4 + 3]++;
  }
  var centroidList = [];
  for (var c = 0; c < k; c++) {
    centroidList.push(colourSums[c * 4 + 3] > 0
      ? [colourSums[c * 4] / colourSums[c * 4 + 3], colourSums[c * 4 + 1] / colourSums[c * 4 + 3], colourSums[c * 4 + 2] / colourSums[c * 4 + 3]]
      : [trained.centroids[c * 3], trained.centroids[c * 3 + 1], trained.centroids[c * 3 + 2]]);
  }

  var palette = state.order.map(function (origIdx, newIdx) {
    // a pinned colour shows EXACTLY what the user set — not the post-cleanup
    // mean of its pixels — so the chip and chart match the pin
    var pin = state.pins[origIdx];
    var rgb = pin ? [pin[0], pin[1], pin[2]] : centroidList[origIdx].map(Math.round);
    return { rgb: rgb, hex: rgbToHex(rgb), label: String(newIdx + 1), count: 0, pinned: !!pin };
  });
  // colour-based merges: route each merged cluster's cells to its survivor, so
  // the merged-away slots end up with zero cells (hidden from the strip)
  var counts = [];
  for (var cc = 0; cc < k; cc++) counts.push(colourSums[cc * 4 + 3]);
  var mergeMap = computeMergeMap(centroidList, counts, k);
  var grid = new Uint8Array(n);
  for (var i = 0; i < n; i++) { grid[i] = state.remap[mergeMap[labels[i]]]; }

  state.palette = palette; state.grid = grid;
  state.roundPct = +els.roundPct.value; state.borderPct = +els.borderPct.value; state.borderHex = els.borderColor.value;
  recomputeCounts();

  els.colourPlaceholder.style.display = 'none';
  els.bwPlaceholder.style.display = 'none';
  // settle the shopping list FIRST — it owns the yarn-preview checkbox and
  // force-unchecks it when Advanced/brand no longer allow previewing, and
  // the canvas paint below must see that final state (painting first left
  // stale yarn colours on the chart after toggling Advanced off)
  refreshAdvancedSwatches();
  buildPaletteStrip();
  updateShoppingList();
  // trace/simplify/smooth once per render, shared by both outputs and the
  // SVG export, rather than duplicating that work in each consumer
  state.smoothedBlobs = computeSmoothedBlobs(cols, rows, grid);
  state.lineArt = state.lineThickness > 0 ? computeLineArtGeom() : null;
  renderColour(cols, rows, grid, palette, state.smoothedBlobs, els.yarnPreviewChk.checked ? computeYarnDisplayHexes() : null);
  renderBW(cols, rows, grid, palette, state.smoothedBlobs);

  els.dlColourPng.disabled = false; els.dlBwPng.disabled = false;
  els.copyBtn.disabled = false;
  els.dlColourSvg.disabled = false;
}

function process() {
  if (!state.img) return;
  applyMatLock('w'); // crop may have changed the image aspect
  computeCentroids();
  resetAdvanced();
  relabelAndRender();
}

// ---------- line-art (adjustable outline thickness) ----------
// geometry only (independent of the thickness VALUE): the darkest colour's
// thin line-work is skeletonised to strokes, its pixels dropped from the
// fills. Recomputed when the pattern changes or thickness crosses 0; a drag
// within the >0 range just re-renders at the new stroke width.
function computeLineArtGeom() {
  var s = state.sampled;
  var la = computeLineArt(s.cols, s.rows, s.data, state.grid);
  return { strokes: la.strokes, hex: la.hex, fillBlobs: computeSmoothedBlobs(s.cols, s.rows, la.fillGrid) };
}

function onLineThickness() {
  state.lineThickness = +els.lineThickness.value;
  els.lineThickVal.textContent = state.lineThickness > 0 ? state.lineThickness : 'off';
  if (!state.grid) return;
  if (state.lineThickness > 0) { if (!state.lineArt) state.lineArt = computeLineArtGeom(); }
  else state.lineArt = null;
  renderColour(state.gridCols, state.gridRows, state.grid, state.palette, state.smoothedBlobs,
    els.yarnPreviewChk.checked ? computeYarnDisplayHexes() : null);
}

// light re-finish path for the rounding/border controls: no retraining, no
// re-tracing — just re-classify cells against the new geometry, repaint,
// and refresh the shopping list. Cheap enough to run straight off a debounce.
function applyFinishing() {
  if (!state.grid) return;
  state.roundPct = +els.roundPct.value;
  state.borderPct = +els.borderPct.value;
  state.borderHex = els.borderColor.value;
  recomputeCounts();
  refreshAdvancedSwatches();
  buildPaletteStrip();
  updateShoppingList();
  renderColour(state.gridCols, state.gridRows, state.grid, state.palette, state.smoothedBlobs,
    els.yarnPreviewChk.checked ? computeYarnDisplayHexes() : null);
  renderBW(state.gridCols, state.gridRows, state.grid, state.palette, state.smoothedBlobs);
}

// ---------- finishing hints (cm-equivalent of the %-of-shorter-side sliders) ----------
function shorterMatCm() {
  return Math.min(parseFloat(els.matW.value) || 0, parseFloat(els.matH.value) || 0);
}
export function updateRoundHint() {
  var pct = +els.roundPct.value;
  els.roundVal.textContent = pct;
  els.roundHint.textContent = pct + '% of the shorter side (~' + (pct / 100 * shorterMatCm()).toFixed(1) + ' cm radius)';
}
export function updateBorderHint() {
  var pct = +els.borderPct.value;
  els.borderVal.textContent = pct;
  els.borderHint.textContent = pct + '% of the shorter side (~' + (pct / 100 * shorterMatCm()).toFixed(1) + ' cm wide)';
  els.borderColorField.style.opacity = pct > 0 ? '1' : '0.5';
}

// ---------- cloud project state (serialize/restore the full settings UI) ----------
// Ported from the pre-rewrite build; multi-source buying fields dropped with
// the feature. Old saves carrying them restore fine (extra fields ignored).
function serializeSettings() {
  return {
    v: 1,
    detailSize: parseInt(els.detailSize.value, 10),
    kColors: parseInt(els.kColors.value, 10),
    lineThickness: parseInt(els.lineThickness.value, 10),
    matW: parseFloat(els.matW.value),
    matH: parseFloat(els.matH.value),
    matLock: els.matLock.checked,
    density: parseFloat(els.density.value),
    strands: parseInt(els.strands.value, 10),
    buffer: parseFloat(els.buffer.value),
    cropRect: { x: state.cropRect.x, y: state.cropRect.y, w: state.cropRect.w, h: state.cropRect.h },
    advanced: state.advanced,
    weights: state.weights ? Array.prototype.slice.call(state.weights) : null,
    yarnOverrides: JSON.parse(JSON.stringify(state.yarnOverrides || {})),
    pins: JSON.parse(JSON.stringify(state.pins || {})),
    mergeGroups: JSON.parse(JSON.stringify(state.mergeGroups || [])),
    yarnBrand: els.yarnBrand.value,
    yarnPreview: els.yarnPreviewChk.checked,
    roundPct: parseInt(els.roundPct.value, 10),
    borderPct: parseInt(els.borderPct.value, 10),
    borderHex: els.borderColor.value,
    cropAspect: els.cropAspect.value,
    exportYarnHex: els.exportYarnHex.checked,
    // multi-source buying (optional mode)
    multiSource: state.multiSource,
    region: state.msRegion,
    allowedSuppliers: state.msAllowed.slice(),
    msOverrides: JSON.parse(JSON.stringify(state.msOverrides || {})),
    includeMulti: state.includeMulti
  };
}

function restoreSettings(s) {
  els.detailSize.value = s.detailSize;
  els.kColors.value = s.kColors;
  els.kVal.textContent = s.kColors;
  // saves from before the modular rewrite predate the line-thickness slider
  var lineThickness = s.lineThickness != null ? s.lineThickness : 0;
  els.lineThickness.value = lineThickness;
  state.lineThickness = lineThickness;
  els.lineThickVal.textContent = lineThickness > 0 ? lineThickness : 'off';
  state.lineArt = null; // relabelAndRender recomputes it when thickness > 0
  els.matW.value = s.matW; els.matH.value = s.matH;
  els.matLock.checked = !!s.matLock;
  els.density.value = s.density; els.strands.value = s.strands; els.buffer.value = s.buffer;
  state.cropRect = s.cropRect ? { x: s.cropRect.x, y: s.cropRect.y, w: s.cropRect.w, h: s.cropRect.h } : FULL_CROP;
  state.advanced = !!s.advanced;
  // pins/merges must be in place before the reprocess below re-seeds/relabels
  state.pins = s.pins ? JSON.parse(JSON.stringify(s.pins)) : {};
  state.mergeGroups = s.mergeGroups ? JSON.parse(JSON.stringify(s.mergeGroups)) : [];
  state.eyedropOrig = null;
  state.eyedropAdd = false;
  state.mergeSource = null;
  els.advToggle.textContent = state.advanced ? 'Hide' : 'Show';
  els.advToggle.setAttribute('aria-expanded', state.advanced ? 'true' : 'false');
  els.advBody.classList.toggle('hidden', !state.advanced);
  els.yarnBrand.value = s.yarnBrand || '';
  setActiveLine(els.yarnBrand.value);
  els.yarnBrandHint.textContent = activeLine
    ? activeLine.fiber + ' · ' + (activeLine.coneGrams ? activeLine.coneGrams + 'g ' + activeLine.unit + 's' : 'unit weight unknown') + ' · ' + activeLine.url
    : 'Pick a supplier to match every pattern colour to the nearest yarn they sell';

  // finishing/crop — older saved settings predate these fields, so fall
  // back to the same defaults the controls ship with
  els.roundPct.value = s.roundPct != null ? s.roundPct : 0;
  els.borderPct.value = s.borderPct != null ? s.borderPct : 0;
  els.borderColor.value = s.borderHex || '#222222';
  els.cropAspect.value = s.cropAspect || 'free';
  updateRoundHint();
  updateBorderHint();
  els.exportYarnHex.checked = !!s.exportYarnHex;

  // multi-source buying (optional mode)
  state.multiSource = !!s.multiSource;
  els.multiSource.checked = state.multiSource;
  els.msGroup.classList.toggle('hidden', !state.multiSource);
  els.yarnBrandField.classList.toggle('hidden', state.multiSource);
  els.msRegion.value = s.region || 'All';
  state.msRegion = els.msRegion.value;
  setMsCheckboxesFromKeys(s.allowedSuppliers || []);
  state.msOverrides = s.msOverrides ? JSON.parse(JSON.stringify(s.msOverrides)) : {};
  state.includeMulti = !!s.includeMulti;
  els.includeMulti.checked = state.includeMulti;
  applyMatLock('w'); // refresh the lock hint against the restored crop

  if (state.img) {
    drawCropOverlay();
    updateCropDimsLabel();
    computeCentroids();
    resetAdvanced();
    if (s.weights && s.weights.length === state.trained.k) {
      state.weights = new Float32Array(s.weights);
    } else if (s.weights) {
      throw new Error('saved weights length ' + s.weights.length + ' does not match k=' + state.trained.k);
    }
    state.yarnOverrides = s.yarnOverrides ? JSON.parse(JSON.stringify(s.yarnOverrides)) : {};
    els.yarnPreviewChk.checked = false; // never inherit a stale preview state
    buildAdvancedRows();
    relabelAndRender();
    if (s.yarnPreview && state.advanced && activeLine) {
      els.yarnPreviewChk.checked = true;
      renderColour(state.gridCols, state.gridRows, state.grid, state.palette, state.smoothedBlobs, computeYarnDisplayHexes());
    }
  } else {
    // no image yet: park the values so they apply when one is loaded
    els.detailVal.textContent = s.detailSize + ' px';
    els.matWVal.textContent = s.matW; els.matHVal.textContent = s.matH;
    els.densityVal.textContent = s.density; els.strandsVal.textContent = s.strands;
    els.bufferVal.textContent = s.buffer;
    state.weights = s.weights ? new Float32Array(s.weights) : null;
    state.yarnOverrides = s.yarnOverrides ? JSON.parse(JSON.stringify(s.yarnOverrides)) : {};
  }
}

// ---------- control wiring ----------
// the trace/simplify/smooth passes make a full recompute heavy — debounce so
// dragging a slider doesn't queue up dozens of recomputes
function debounce(fn, wait) {
  var t;
  return function () {
    clearTimeout(t);
    t = setTimeout(fn, wait);
  };
}
var debouncedProcess = debounce(process, 150);
var debouncedRelabel = debounce(relabelAndRender, 150);
var debouncedFinish = debounce(applyFinishing, 120);

function onMatInput() {
  updateShoppingList();
  if (els.cropAspect.value === 'mat' && state.img) refitCropToAspect();
}

// ---------- mat ratio lock ----------
// the tufted region's aspect = the crop rect applied to the image
function imageAspect() {
  if (!state.img) return null;
  var w = state.cropRect.w * state.img.naturalWidth;
  var h = state.cropRect.h * state.img.naturalHeight;
  return h > 0 ? w / h : null;
}

// keep the other mat dimension in sync while locked; `changed` is the side
// the user edited ('w'|'h') — crop/image-driven refreshes recompute height
function applyMatLock(changed) {
  var AR = els.matLock.checked ? imageAspect() : null;
  els.matLockHint.classList.toggle('hidden', !AR);
  if (!AR) return;
  if (changed === 'h') {
    els.matW.value = Math.max(1, Math.round((parseFloat(els.matH.value) || 0) * AR));
    els.matWVal.textContent = els.matW.value;
  } else {
    els.matH.value = Math.max(1, Math.round((parseFloat(els.matW.value) || 0) / AR));
    els.matHVal.textContent = els.matH.value;
  }
  els.matLockHint.textContent = 'Following the image: ' + els.matW.value + ' × ' + els.matH.value + ' cm (ratio ' + AR.toFixed(2) + ')';
}

// runs on every image load too — a coarse 220px sample is plenty for
// counting distinct colours, so this stays effectively free
function autoPickK() {
  var dims = computeGridDims(state.img, 220);
  var data = sampleImage(state.img, dims.cols, dims.rows);
  var k = autoDetectK(data, dims.cols * dims.rows, 12);
  els.kColors.value = k;
  els.kVal.textContent = k;
}

// every top-level side-effect statement from the original single-file app —
// all event wiring plus the three init calls (populateBrandSelect /
// updateRoundHint / updateBorderHint) — collected here in their ORIGINAL
// order and run once, after initEls() has populated `els`.
function init() {
  els.fileInput.addEventListener('change', function (e) { loadFile(e.target.files[0]); });
  // native label[for] already opens the picker on click — don't also call
  // fileInput.click() here, or the dialog fires twice and needs a second click
  els.dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); }
  });
  ['dragenter', 'dragover'].forEach(function (evt) {
    els.dropzone.addEventListener(evt, function (e) { e.preventDefault(); els.dropzone.classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    els.dropzone.addEventListener(evt, function (e) { e.preventDefault(); els.dropzone.classList.remove('drag'); });
  });
  els.dropzone.addEventListener('drop', function (e) {
    if (e.dataTransfer.files && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });

  els.cropCanvas.addEventListener('pointerdown', function (e) {
    if (!state.img) return;
    e.preventDefault();
    var pos = cropPointerPos(e);
    // "+ Add colour": this click adds a new pinned slot at k+1
    if (state.eyedropAdd) {
      var rgb = sampleImagePixel(pos);
      var k = parseInt(els.kColors.value, 10);
      els.kColors.value = k + 1; els.kVal.textContent = k + 1;
      state.pins[k] = rgb;                 // new raw index = k (now k+1 slots)
      cancelEyedropper();
      reprocessWithPins();
      return;
    }
    // eyedropper mode: this click samples a source pixel and pins the slot,
    // instead of starting a crop drag
    if (state.eyedropOrig != null) {
      state.pins[state.eyedropOrig] = sampleImagePixel(pos);
      cancelEyedropper();
      reprocessWithPins();
      return;
    }
    var rect = cropRectDisplayPx();
    var handle = hitTestHandle(pos, rect);
    if (handle) {
      var anchor = {
        x: handle.indexOf('w') >= 0 ? rect.x + rect.w : rect.x,
        y: handle.indexOf('n') >= 0 ? rect.y + rect.h : rect.y
      };
      cropDrag = { mode: 'resize', anchor: anchor };
    } else if (pointInRect(pos, rect)) {
      cropDrag = { mode: 'move', offsetX: pos.x - rect.x, offsetY: pos.y - rect.y, w: rect.w, h: rect.h };
    } else {
      cropDrag = { mode: 'draw', startX: pos.x, startY: pos.y };
    }
    els.cropCanvas.setPointerCapture(e.pointerId);
  });

  els.cropCanvas.addEventListener('pointermove', function (e) {
    if (!cropDrag || !state.img) return;
    e.preventDefault();
    var pos = cropPointerPos(e);
    var w = els.cropCanvas.width, h = els.cropCanvas.height, rect;
    if (cropDrag.mode === 'draw') {
      rect = rectFromDragOrigin(cropDrag.startX, cropDrag.startY, pos, w, h, cropAspectRatio());
    } else if (cropDrag.mode === 'move') {
      rect = { x: Math.max(0, Math.min(w - cropDrag.w, pos.x - cropDrag.offsetX)), y: Math.max(0, Math.min(h - cropDrag.h, pos.y - cropDrag.offsetY)), w: cropDrag.w, h: cropDrag.h };
    } else {
      rect = rectFromDragOrigin(cropDrag.anchor.x, cropDrag.anchor.y, pos, w, h, cropAspectRatio());
    }
    state.cropRect = { x: rect.x / w, y: rect.y / h, w: rect.w / w, h: rect.h / h };
    drawCropOverlay();
    updateCropDimsLabel();
  });

  els.cropCanvas.addEventListener('pointerup', endCropDrag);
  els.cropCanvas.addEventListener('pointercancel', endCropDrag);

  els.resetCropBtn.addEventListener('click', function () {
    var AR = cropAspectRatio();
    if (AR != null && state.img) {
      var w = els.cropCanvas.width, h = els.cropCanvas.height;
      var fit = largestRectOfRatio(w / 2, h / 2, w, h, AR);
      state.cropRect = { x: fit.x / w, y: fit.y / h, w: fit.w / w, h: fit.h / h };
    } else {
      state.cropRect = FULL_CROP;
    }
    if (state.img) { drawCropOverlay(); updateCropDimsLabel(); process(); }
  });

  els.cropAspect.addEventListener('change', refitCropToAspect);

  // clicking a matched-yarn swatch opens the visual picker for that palette slot
  els.shopBody.addEventListener('click', function (e) {
    var btn = e.target.closest('.yarnSwatchBtn');
    if (!btn) return;
    openPicker(parseInt(btn.dataset.idx, 10));
  });

  els.shopBody.addEventListener('change', function (e) {
    if (!e.target.classList.contains('yarnPick')) return;
    var idx = e.target.dataset.idx;
    if (e.target.classList.contains('msYarnPick')) {
      if (e.target.value) {
        var parts = e.target.value.split(MS_SEP);
        state.msOverrides[idx] = { key: parts[0], name: parts[1] };
      } else {
        delete state.msOverrides[idx];
      }
    } else {
      var key = els.yarnBrand.value + ':' + idx;
      if (e.target.value) state.yarnOverrides[key] = e.target.value; else delete state.yarnOverrides[key];
    }
    updateShoppingList();
    repaintColourIfPreviewing();
  });

  els.yarnPreviewChk.addEventListener('change', function () {
    if (!state.grid) return;
    renderColour(state.gridCols, state.gridRows, state.grid, state.palette, state.smoothedBlobs,
      els.yarnPreviewChk.checked ? computeYarnDisplayHexes() : null);
  });

  els.yarnBrand.addEventListener('change', function () {
    var wasPreviewing = els.yarnPreviewChk.checked;
    setActiveLine(els.yarnBrand.value);
    els.yarnBrandHint.textContent = activeLine
      ? activeLine.fiber + ' · ' + (activeLine.coneGrams ? activeLine.coneGrams + 'g ' + activeLine.unit + 's' : 'unit weight unknown') + ' · ' + activeLine.url
      : 'Pick a supplier to match every pattern colour to the nearest yarn they sell';
    updateShoppingList();
    // the preview canvas shows MATCHED yarn colours, so a brand switch must
    // repaint it (new line's yarns), and a switch that killed the preview
    // (generic selected) must restore the palette colours
    if (els.yarnPreviewChk.checked) repaintColourIfPreviewing();
    else if (wasPreviewing && state.grid) renderColour(state.gridCols, state.gridRows, state.grid, state.palette, state.smoothedBlobs, null);
  });

  els.multiSource.addEventListener('change', function () {
    state.multiSource = els.multiSource.checked;
    els.msGroup.classList.toggle('hidden', !state.multiSource);
    els.yarnBrandField.classList.toggle('hidden', state.multiSource);
    if (state.multiSource) {
      els.msRegion.value = 'All';
      applyRegionFilter('All'); // also runs updateShoppingList
    } else {
      updateShoppingList();
    }
  });

  els.includeMulti.addEventListener('change', function () {
    state.includeMulti = els.includeMulti.checked;
    updateShoppingList();
    repaintColourIfPreviewing();
  });

  // palette editor: set an exact colour, eyedrop one from the image, or unpin
  els.paletteStrip.addEventListener('change', function (e) {
    if (!e.target.classList.contains('palColor')) return;
    state.pins[state.order[+e.target.dataset.new]] = hexToRgb(e.target.value);
    reprocessWithPins();
  });
  els.paletteStrip.addEventListener('click', function (e) {
    if (e.target.closest('#palAddBtn')) { armAddColour(); return; }
    var eye = e.target.closest('.palEyedrop');
    if (eye) { state.mergeSource = null; armEyedropper(+eye.dataset.new); return; }
    var unpin = e.target.closest('.palUnpin');
    if (unpin) { delete state.pins[state.order[+unpin.dataset.new]]; reprocessWithPins(); return; }
    var merge = e.target.closest('.palMerge');
    if (merge) {
      var mi = +merge.dataset.new;
      state.mergeSource = (state.mergeSource === mi) ? null : mi;   // toggle
      buildPaletteStrip();
      return;
    }
    // while a merge source is armed, clicking another chip picks the target
    if (state.mergeSource != null) {
      var chip = e.target.closest('.pal-chip[data-new]');
      if (chip && +chip.dataset.new !== state.mergeSource) { mergeInto(state.mergeSource, +chip.dataset.new); }
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (state.eyedropOrig != null || state.eyedropAdd) cancelEyedropper();
    if (state.mergeSource != null) { state.mergeSource = null; buildPaletteStrip(); }
  });

  els.msRegion.addEventListener('change', function () { applyRegionFilter(els.msRegion.value); });

  els.msSuppliers.addEventListener('change', function (e) {
    if (!e.target.classList.contains('msSupplierChk')) return;
    syncMsAllowedFromCheckboxes();
  });

  populateBrandSelect();
  populateMsRegion();
  populateMsSuppliers();
  updateRoundHint();
  updateBorderHint();

  // matched-yarn hexes for the colour exports when the checkbox is on and a
  // yarn source (brand or multi-supplier selection) exists — else null, and
  // exports use the palette colours exactly as before
  function exportHexes() {
    return els.exportYarnHex.checked ? computeYarnDisplayHexes() : null;
  }

  els.dlColourPng.addEventListener('click', function () {
    var hexes = exportHexes();
    if (hexes && state.grid) {
      // repaint in yarn colours just for the capture, then restore the
      // on-screen state (which may itself be previewing yarn colours)
      renderColour(state.gridCols, state.gridRows, state.grid, state.palette, state.smoothedBlobs, hexes);
      downloadCanvas(els.colourCanvas, 'tuft-pattern-colour.png');
      renderColour(state.gridCols, state.gridRows, state.grid, state.palette, state.smoothedBlobs,
        els.yarnPreviewChk.checked ? computeYarnDisplayHexes() : null);
    } else {
      downloadCanvas(els.colourCanvas, 'tuft-pattern-colour.png');
    }
  });
  els.dlBwPng.addEventListener('click', function () { downloadCanvas(els.bwCanvas, 'tuft-pattern-bw-projector.png'); });
  els.dlColourSvg.addEventListener('click', function () { downloadSVG(exportHexes()); });

  els.copyBtn.addEventListener('click', function () {
    els.shopText.select();
    var ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(els.shopText.value);
        ok = true;
      } else {
        ok = document.execCommand('copy');
      }
    } catch (e) { ok = false; }
    els.copyStatus.textContent = ok ? 'Copied.' : 'Could not auto-copy — text is selected below, use Cmd/Ctrl+C.';
  });

  els.detailSize.addEventListener('input', function () { if (state.img) debouncedProcess(); else els.detailVal.textContent = els.detailSize.value + ' px'; });
  els.kColors.addEventListener('input', function () { els.kVal.textContent = els.kColors.value; if (state.img) debouncedProcess(); });
  els.lineThickness.addEventListener('input', onLineThickness);
  els.matW.addEventListener('input', function () { applyMatLock('w'); onMatInput(); });
  els.matH.addEventListener('input', function () { applyMatLock('h'); onMatInput(); });
  els.matLock.addEventListener('change', function () { applyMatLock('w'); onMatInput(); });
  els.density.addEventListener('input', updateShoppingList);
  els.strands.addEventListener('input', updateShoppingList);
  els.buffer.addEventListener('input', updateShoppingList);
  els.roundPct.addEventListener('input', function () { updateRoundHint(); if (state.grid) debouncedFinish(); });
  els.borderPct.addEventListener('input', function () { updateBorderHint(); if (state.grid) debouncedFinish(); });
  els.borderColor.addEventListener('input', function () { if (state.grid) debouncedFinish(); });

  els.advToggle.addEventListener('click', function () {
    state.advanced = !state.advanced;
    els.advToggle.textContent = state.advanced ? 'Hide' : 'Show';
    els.advToggle.setAttribute('aria-expanded', state.advanced ? 'true' : 'false');
    els.advBody.classList.toggle('hidden', !state.advanced);
    if (state.sampled) relabelAndRender();
  });

  els.advResetBtn.addEventListener('click', function () {
    if (!state.trained) return;
    var k = state.trained.k;
    for (var i = 0; i < k; i++) state.weights[i] = 1;
    buildAdvancedRows();
    if (state.sampled) relabelAndRender();
  });

  els.autoBtn.addEventListener('click', function () {
    if (!state.img) return;
    state.pins = {};           // auto colour detection releases every pin + merge
    state.mergeGroups = [];
    state.mergeSource = null;
    cancelEyedropper();
    autoPickK();
    process();
  });

  initPanels(); // restore which panels the user keeps open
  initPicker(); // wire the visual yarn picker modal
  initPrefs(); // apply device defaults before anything is loaded

  initCloud({
    serialize: serializeSettings,
    restore: restoreSettings,
    hasImage: function () { return !!state.img; },
    getImage: function () { return state.img; },
    loadFile: loadFile
  });

  // read-only test seam: the same serialize/restore the cloud panel uses, so
  // the e2e can round-trip project settings (e.g. pins) without Supabase auth
  window.__tuftTest = { serialize: serializeSettings, restore: restoreSettings, state: state };
}

initEls();
init();
