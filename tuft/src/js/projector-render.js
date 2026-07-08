// ---------- projector mode: surface render (single design OR cloth layout) ----------
// Everything is drawn on a "surface" measured in cm: the mat (one design at
// 0,0) or the cloth (many placed items). Items are frozen snapshots (see
// cloth.js) drawn at true physical scale, so the cm grid, witness marks and
// keystone all mean the same thing in both views.
import { els } from './state.js';
import { popts, view } from './projector-state.js';
import { getLayout, itemFootprint } from './cloth.js';

var MARGIN = 36;           // css px kept clear around the surface for ruler numbers
var MARK = '#ff2d55';      // witness marks/grid — red reads on both backgrounds
var SELECT = '#2f80ff';    // selected cloth item highlight
var DIM_ALPHA = 0.15;      // non-isolated colours when one colour is focused

function ink() { return popts.invert ? '#ffffff' : '#000000'; }

// view-space position of a surface-space point (surface px, origin top-left)
// after flips + rotation — labels and hit-testing use this so text stays
// upright whatever the orientation. Must match the ctx chain in render().
function mapPt(x, y) {
  var W = view.surf.w * view.pxPerCm, H = view.surf.h * view.pxPerCm;
  if (popts.flipH) x = W - x;
  if (popts.flipV) y = H - y;
  var r = view.rect;
  if (popts.rotate) return [r.x + r.w - y, r.y + x];
  return [r.x + x, r.y + y];
}

// design-cell point → view px, through the item's placement (position +
// optional 90° rotation on the cloth) and the global surface transform
export function itemToView(item, cellX, cellY) {
  var sx = item.w * view.pxPerCm / item.cols, sy = item.h * view.pxPerCm / item.rows;
  var px = cellX * sx, py = cellY * sy;
  var cx, cy;
  if (item.rot) { cx = item.h * view.pxPerCm - py; cy = px; } else { cx = px; cy = py; }
  return mapPt(item.x * view.pxPerCm + cx, item.y * view.pxPerCm + cy);
}

// a rounded rect as a point polygon (cell units) — the finishing lines go
// through itemToView like everything else, so corners stay circular under
// the item's non-uniform cell scale only to the extent the design itself is
function roundRectPts(x, y, w, h, rr) {
  rr = Math.max(0, Math.min(rr, w / 2, h / 2));
  var pts = [];
  var SEG = 10;
  [[x + w - rr, y + rr, -Math.PI / 2], [x + w - rr, y + h - rr, 0],
   [x + rr, y + h - rr, Math.PI / 2], [x + rr, y + rr, Math.PI]].forEach(function (c) {
    for (var s = 0; s <= SEG; s++) {
      var a = c[2] + (Math.PI / 2) * (s / SEG);
      pts.push([c[0] + rr * Math.cos(a), c[1] + rr * Math.sin(a)]);
    }
  });
  return pts;
}

function addLoop(ctx, item, pts) {
  var p = itemToView(item, pts[0][0], pts[0][1]);
  ctx.moveTo(p[0], p[1]);
  for (var i = 1; i < pts.length; i++) {
    p = itemToView(item, pts[i][0], pts[i][1]);
    ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
}

// stroke the item's outlines: every point is mapped to view px in JS
// (itemToView — same path the labels take), so we never rely on canvas
// path/CTM baking semantics, which WebKit and Blink implement differently.
// filter (optional) picks which blobs; withFin adds the rug cut/seam lines.
function strokeItem(ctx, item, filter, alpha, withFin) {
  var any = false;
  ctx.beginPath();
  item.blobs.forEach(function (b) {
    if (filter && !filter(b)) return;
    any = true;
    b.loops.forEach(function (loop) { addLoop(ctx, item, loop); });
  });
  if (withFin && item.fin.active) {
    any = true;
    addLoop(ctx, item, roundRectPts(0, 0, item.cols, item.rows, item.fin.R));
    if (item.fin.B > 0) {
      addLoop(ctx, item, roundRectPts(item.fin.B, item.fin.B, item.cols - 2 * item.fin.B, item.rows - 2 * item.fin.B, item.fin.Ri));
    }
  }
  if (!any) return;
  ctx.globalAlpha = alpha;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawItemLabels(ctx, item) {
  var longPx = Math.max(item.w, item.h) * view.pxPerCm;
  var fontPx = Math.max(10, longPx / 45); // same ratio as the B/W chart labels
  var cellPx = Math.min(item.w * view.pxPerCm / item.cols, item.h * view.pxPerCm / item.rows);
  ctx.font = '700 ' + Math.round(fontPx) + 'px JBM, ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink();
  item.labels.forEach(function (l) {
    var wThresh = fontPx * (1.4 + 0.8 * (l.t.length - 1));
    if (l.wc * cellPx < wThresh || l.hc * cellPx < fontPx * 1.4) return;
    var p = itemToView(item, l.x, l.y);
    ctx.globalAlpha = (view.focus == null || l.i === view.focus || l.i === -1) ? 1 : DIM_ALPHA;
    ctx.fillText(l.t, p[0], p[1] + 1);
  });
  ctx.globalAlpha = 1;
}

// dashed footprint outline around the selected cloth item, in view space
function drawSelection(ctx, item) {
  var fp = itemFootprint(item);
  var pxc = view.pxPerCm;
  var corners = [[item.x, item.y], [item.x + fp.w, item.y], [item.x + fp.w, item.y + fp.h], [item.x, item.y + fp.h]]
    .map(function (c) { return mapPt(c[0] * pxc, c[1] * pxc); });
  ctx.strokeStyle = SELECT;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(corners[0][0], corners[0][1]);
  for (var i = 1; i < 4; i++) ctx.lineTo(corners[i][0], corners[i][1]);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
}

function crosshair(ctx, x, y, r) {
  ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
}

// witness marks + cm grid, in VIEW space (never flipped/rotated — they
// measure the physical projection). Marks: surface-edge rectangle plus
// corner and centre crosshairs — draw them once on the cloth with a ruler,
// then each session drag the keystone corners onto the drawn marks. Grid:
// square cm grid with tick numbers for the tape-measure calibration.
function drawMarks(ctx, rect) {
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
  var pxPerCm = view.pxPerCm;
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
  if (els.projector.classList.contains('hidden')) return;
  var items = view.cloth ? getLayout().items : (view.single ? [view.single] : []);
  var surf = view.cloth ? { w: getLayout().w, h: getLayout().h }
                        : (view.single ? { w: view.single.w, h: view.single.h } : null);
  if (!surf) return;
  view.surf = surf;

  var vw = els.projector.clientWidth, vh = els.projector.clientHeight;
  var dpr = window.devicePixelRatio || 1;
  var canvas = els.projCanvas;
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // rotate 90° = the surface's width runs down the screen (portrait cloth on
  // a landscape projector uses the full panel instead of letterboxing)
  var fitW = popts.rotate ? surf.h : surf.w, fitH = popts.rotate ? surf.w : surf.h;
  var pxPerCm = Math.min((vw - 2 * MARGIN) / fitW, (vh - 2 * MARGIN) / fitH);
  view.pxPerCm = pxPerCm;
  var rect = { x: (vw - fitW * pxPerCm) / 2, y: (vh - fitH * pxPerCm) / 2, w: fitW * pxPerCm, h: fitH * pxPerCm };
  view.rect = rect;

  // dim: brightness filter on the canvas; the overlay behind it is painted
  // to the matching shade so keystone-warped edges don't leave glare bands
  canvas.style.filter = popts.dim < 1 ? 'brightness(' + popts.dim + ')' : '';
  var v = Math.round(255 * popts.dim);
  els.projector.style.background = popts.invert ? '#000000' : 'rgb(' + v + ',' + v + ',' + v + ')';
  ctx.fillStyle = popts.invert ? '#000000' : '#ffffff';
  ctx.fillRect(0, 0, vw, vh);

  var W = surf.w * pxPerCm, H = surf.h * pxPerCm;
  ctx.strokeStyle = ink();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.25, Math.max(W, H) * 0.0025) * popts.lineScale;
  items.forEach(function (item) {
    if (!view.cloth && view.focus != null) {
      strokeItem(ctx, item, function (b) { return b.i !== view.focus; }, DIM_ALPHA, false);
      // finishing outlines stay full strength while a colour is isolated
      strokeItem(ctx, item, function (b) { return b.i === view.focus; }, 1, true);
    } else {
      strokeItem(ctx, item, null, 1, true);
    }
  });

  if (popts.numbers) items.forEach(function (item) { drawItemLabels(ctx, item); });
  if (view.cloth && view.selected) {
    items.forEach(function (item) { if (item.id === view.selected) drawSelection(ctx, item); });
  }
  if (popts.marks || popts.grid) drawMarks(ctx, rect);
}
