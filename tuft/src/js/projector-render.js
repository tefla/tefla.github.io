// ---------- projector mode: chart render (flips, rotation, isolation, marks) ----------
import { els, state } from './state.js';
import { finishingGeometry, roundRectPath, insideRoundRect } from './geometry.js';
import { strokeSmoothedLoops, blobLabelInfo } from './render.js';
import { popts, view } from './projector-state.js';

var MARGIN = 36;           // css px kept clear around the chart for ruler numbers
var MARK = '#ff2d55';      // witness marks/grid — red reads on both backgrounds
var DIM_ALPHA = 0.15;      // non-isolated colours when one colour is focused

function ink() { return popts.invert ? '#ffffff' : '#000000'; }

// view-space position of a design-space point (design px, origin chart
// top-left) after flips + rotation — labels use this so text stays upright
// whatever the orientation. Must match the ctx transform chain in render().
function mapPt(x, y, w, h, rect) {
  if (popts.flipH) x = w - x;
  if (popts.flipV) y = h - y;
  if (popts.rotate) return [rect.x + rect.w - y, rect.y + x];
  return [rect.x + x, rect.y + y];
}

function strokeSet(ctx, blobs, scale, alpha) {
  if (!blobs.length) return;
  ctx.globalAlpha = alpha;
  strokeSmoothedLoops(ctx, blobs, scale);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawLabels(ctx, w, h, scale, rect, geom) {
  var cols = state.gridCols;
  var fontPx = Math.max(14, Math.max(w, h) / 45);
  ctx.font = '700 ' + Math.round(fontPx) + 'px JBM, ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink();
  var innerX0 = geom.B, innerY0 = geom.B, innerX1 = cols - geom.B, innerY1 = state.gridRows - geom.B;
  state.smoothedBlobs.forEach(function (blob) {
    var info = blobLabelInfo(blob.cells, cols);
    var label = state.palette[blob.idx].label;
    var wThresh = fontPx * (1.4 + 0.8 * (label.length - 1));
    if (info.wCells * scale < wThresh || info.hCells * scale < fontPx * 1.4) return;
    if (geom.active && !insideRoundRect(info.c + 0.5, info.r + 0.5, innerX0, innerY0, innerX1, innerY1, geom.Ri)) return;
    var p = mapPt(info.c * scale + scale / 2, info.r * scale + scale / 2, w, h, rect);
    ctx.globalAlpha = (view.focus == null || blob.idx === view.focus) ? 1 : DIM_ALPHA;
    ctx.fillText(label, p[0], p[1] + 1);
  });
  ctx.globalAlpha = 1;
  if (geom.active && geom.B > 0) {
    var p2 = mapPt(w / 2, geom.B * scale / 2, w, h, rect);
    ctx.fillText(String(state.palette.length + 1), p2[0], p2[1] + 1);
  }
}

function crosshair(ctx, x, y, r) {
  ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
}

// witness marks + cm grid, in VIEW space (never flipped/rotated — they
// measure the physical projection). Marks: chart-edge rectangle plus corner
// and centre crosshairs — draw them once on the cloth with a ruler, then
// each session align the projection to the drawn marks (or drag the
// keystone corners onto them). Grid: square cm grid with tick numbers,
// pitch from the mat width, for the first-time tape-measure calibration.
function drawMarks(ctx, rect, designW) {
  ctx.strokeStyle = MARK;
  ctx.fillStyle = MARK;
  ctx.lineWidth = 1;
  if (popts.marks) {
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.beginPath();
    crosshair(ctx, rect.x + rect.w / 2, rect.y + rect.h / 2, 16);
    crosshair(ctx, rect.x, rect.y, 10); crosshair(ctx, rect.x + rect.w, rect.y, 10);
    crosshair(ctx, rect.x, rect.y + rect.h, 10); crosshair(ctx, rect.x + rect.w, rect.y + rect.h, 10);
    ctx.stroke();
  }
  if (!popts.grid) return;
  var matW = parseFloat(els.matW.value) || 0;
  if (matW <= 0) return;
  // the design's width always spans matW cm; rotation preserves lengths, so
  // one px-per-cm figure holds in both view axes and the grid stays square
  var pxPerCm = designW / matW;
  var steps = [1, 2, 5, 10, 20, 25, 50], step = 100;
  for (var si = 0; si < steps.length; si++) {
    if (steps[si] * pxPerCm >= 60) { step = steps[si]; break; }
  }
  ctx.beginPath();
  var cm;
  for (cm = step; cm * pxPerCm < rect.w - 1; cm += step) {
    ctx.moveTo(rect.x + cm * pxPerCm, rect.y); ctx.lineTo(rect.x + cm * pxPerCm, rect.y + rect.h);
  }
  for (cm = step; cm * pxPerCm < rect.h - 1; cm += step) {
    ctx.moveTo(rect.x, rect.y + cm * pxPerCm); ctx.lineTo(rect.x + rect.w, rect.y + cm * pxPerCm);
  }
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.font = '11px JBM, ui-monospace, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  for (cm = step; cm * pxPerCm < rect.w - 1; cm += step) ctx.fillText(String(cm), rect.x + cm * pxPerCm, rect.y - 6);
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (cm = step; cm * pxPerCm < rect.h - 1; cm += step) ctx.fillText(String(cm), rect.x - 6, rect.y + cm * pxPerCm);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('grid ' + step + ' cm — squares should measure true on the canvas', rect.x, rect.y + rect.h + 16);
}

export function renderProjector() {
  if (!state.smoothedBlobs || els.projector.classList.contains('hidden')) return;
  var vw = els.projector.clientWidth, vh = els.projector.clientHeight;
  var dpr = window.devicePixelRatio || 1;
  var canvas = els.projCanvas;
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  var cols = state.gridCols, rows = state.gridRows;
  // rotate 90° = the design's columns run down the screen (portrait mat on a
  // landscape projector uses the full panel instead of letterboxing)
  var fitC = popts.rotate ? rows : cols, fitR = popts.rotate ? cols : rows;
  var scale = Math.min((vw - 2 * MARGIN) / fitC, (vh - 2 * MARGIN) / fitR);
  var w = cols * scale, h = rows * scale;                    // design px
  var rect = { x: (vw - fitC * scale) / 2, y: (vh - fitR * scale) / 2, w: fitC * scale, h: fitR * scale };
  view.rect = rect;

  // dim: brightness filter on the canvas; the overlay behind it is painted
  // to the matching shade so keystone-warped edges don't leave glare bands
  canvas.style.filter = popts.dim < 1 ? 'brightness(' + popts.dim + ')' : '';
  var v = Math.round(255 * popts.dim);
  els.projector.style.background = popts.invert ? '#000000' : 'rgb(' + v + ',' + v + ',' + v + ')';
  ctx.fillStyle = popts.invert ? '#000000' : '#ffffff';
  ctx.fillRect(0, 0, vw, vh);

  ctx.save();
  ctx.translate(rect.x, rect.y);
  if (popts.rotate) { ctx.translate(rect.w, 0); ctx.rotate(Math.PI / 2); }
  if (popts.flipH) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  if (popts.flipV) { ctx.translate(0, h); ctx.scale(1, -1); }
  ctx.strokeStyle = ink();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.25, Math.max(w, h) * 0.0025) * popts.lineScale;
  if (view.focus == null) {
    strokeSet(ctx, state.smoothedBlobs, scale, 1);
  } else {
    strokeSet(ctx, state.smoothedBlobs.filter(function (b) { return b.idx !== view.focus; }), scale, DIM_ALPHA);
    strokeSet(ctx, state.smoothedBlobs.filter(function (b) { return b.idx === view.focus; }), scale, 1);
  }
  var geom = finishingGeometry(cols, rows);
  if (geom.active) {
    roundRectPath(ctx, 0, 0, w, h, geom.R * scale); // rug cut line
    ctx.stroke();
    if (geom.B > 0) {
      var Bpx = geom.B * scale;
      roundRectPath(ctx, Bpx, Bpx, w - 2 * Bpx, h - 2 * Bpx, geom.Ri * scale); // border seam
      ctx.stroke();
    }
  }
  ctx.restore();

  if (popts.numbers) drawLabels(ctx, w, h, scale, rect, geom);
  if (popts.marks || popts.grid) drawMarks(ctx, rect, w);
}
