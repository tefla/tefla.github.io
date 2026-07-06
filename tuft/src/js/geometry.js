// ---------- sampling + output geometry (grid dims, finishing shapes) ----------
import { state } from './state.js';

// ---------- sampling ----------
export function cropRectPx(img) {
  var r = state.cropRect;
  return { sx: r.x * img.naturalWidth, sy: r.y * img.naturalHeight, sw: r.w * img.naturalWidth, sh: r.h * img.naturalHeight };
}

// Detail is the LONGER side of the sample grid, and never upsamples past the
// source pixels — sampling finer than the image has detail is pure waste
export function computeGridDims(img, longSide) {
  var crop = cropRectPx(img);
  var sw = Math.max(1, Math.round(crop.sw)), sh = Math.max(1, Math.round(crop.sh));
  if (sw >= sh) {
    var cols = Math.min(longSide, sw);
    return { cols: cols, rows: Math.max(1, Math.round(cols * sh / sw)) };
  }
  var rows = Math.min(longSide, sh);
  return { cols: Math.max(1, Math.round(rows * sw / sh)), rows: rows };
}

export function sampleImage(img, cols, rows) {
  var c = document.createElement('canvas');
  c.width = cols; c.height = rows;
  var ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  var crop = cropRectPx(img);
  ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, cols, rows);
  return ctx.getImageData(0, 0, cols, rows).data;
}

// ---------- render geometry ----------
// output canvases are at least OUTPUT_LONG_SIDE px on the longer side; the
// 2px-per-cell floor means fine sample grids render at 2× their cell count,
// which keeps the smoothed boundaries crisp when the PNG is projected
export var OUTPUT_LONG_SIDE = 760;

export function cellPxFor(cols, rows) {
  return Math.max(2, OUTPUT_LONG_SIDE / Math.max(cols, rows));
}

// ---- finishing geometry (corner rounding + border) — cell units ----
// signed-distance rounded-rect inside test: a point is inside if it clears
// the straight edges and, within `rr` of a corner, falls inside the corner's
// quarter-circle
export function insideRoundRect(x, y, x0, y0, x1, y1, rr) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  var qx = Math.max(x0 + rr - x, 0, x - (x1 - rr));
  var qy = Math.max(y0 + rr - y, 0, y - (y1 - rr));
  return qx * qx + qy * qy <= rr * rr;
}

// R = outer corner radius, B = border width, Ri = inner corner radius —
// all in cell units, all capped so an aggressive slider can't invert the
// shape (radius/border can never exceed half the shorter side)
export function finishingGeometry(cols, rows) {
  var shorter = Math.min(cols, rows);
  var R = Math.min(shorter / 2, state.roundPct / 100 * shorter);
  var B = Math.min(shorter / 2, state.borderPct / 100 * shorter);
  return { R: R, B: B, Ri: Math.max(0, R - B), active: state.roundPct > 0 || state.borderPct > 0 };
}

// rounded-rect path via arcTo (safe cross-browser, no ctx.roundRect dependency)
export function roundRectPath(ctx, x, y, w, h, rr) {
  rr = Math.max(0, Math.min(rr, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// same shape as an SVG path `d` string, for the vector export
export function roundRectPathD(x, y, w, h, rr) {
  rr = Math.max(0, Math.min(rr, w / 2, h / 2));
  return 'M' + (x + rr) + ' ' + y +
    'L' + (x + w - rr) + ' ' + y + 'A' + rr + ' ' + rr + ' 0 0 1 ' + (x + w) + ' ' + (y + rr) +
    'L' + (x + w) + ' ' + (y + h - rr) + 'A' + rr + ' ' + rr + ' 0 0 1 ' + (x + w - rr) + ' ' + (y + h) +
    'L' + (x + rr) + ' ' + (y + h) + 'A' + rr + ' ' + rr + ' 0 0 1 ' + x + ' ' + (y + h - rr) +
    'L' + x + ' ' + (y + rr) + 'A' + rr + ' ' + rr + ' 0 0 1 ' + (x + rr) + ' ' + y + 'Z';
}
