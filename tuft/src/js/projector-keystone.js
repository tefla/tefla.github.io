// ---------- projector mode: software keystone (4-corner pin) ----------
// Instead of keystoning the projector, drag the chart's four corners until
// the projected witness marks land on marks drawn once on the physical
// canvas. The warp is a full-plane homography applied to the canvas ELEMENT
// as a CSS matrix3d, so the bitmap render itself stays untouched. Persisted
// as the four viewport-corner destinations in viewport fractions —
// design-independent, one saved setup per device/projector.
import { els } from './state.js';
import { popts, view, saveOpts } from './projector-state.js';

var editing = false;
var H = null; // current viewport homography [a..h] (denominator gx + hy + 1), null = identity

// solve the 8 unknowns of the homography mapping src[i] → dst[i] (i = 0..3)
// by Gauss-Jordan with partial pivoting; null for a degenerate quad
function homography(src, dst) {
  var A = [], i, r, c;
  for (i = 0; i < 4; i++) {
    var x = src[i][0], y = src[i][1], X = dst[i][0], Y = dst[i][1];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y, X]);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y, Y]);
  }
  for (c = 0; c < 8; c++) {
    var piv = c;
    for (r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-9) return null;
    var t = A[c]; A[c] = A[piv]; A[piv] = t;
    for (r = 0; r < 8; r++) {
      if (r === c) continue;
      var f = A[r][c] / A[c][c];
      for (i = c; i < 9; i++) A[r][i] -= f * A[c][i];
    }
  }
  var h = [];
  for (i = 0; i < 8; i++) h.push(A[i][8] / A[i][i]);
  return h;
}

function applyH(h, x, y) {
  var d = h[6] * x + h[7] * y + 1;
  return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d];
}

// CSS matrix3d is column-major 4x4; the homography's 3x3 embeds with the
// z row/column as identity and the perspective terms in the 4th row
function matrix3d(h) {
  return 'matrix3d(' + [h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, 1].join(',') + ')';
}

function viewW() { return els.projector.clientWidth; }
function viewH() { return els.projector.clientHeight; }
function vpCorners() { return [[0, 0], [viewW(), 0], [viewW(), viewH()], [0, viewH()]]; }

function chartCorners() {
  var r = view.rect;
  return [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
}

function projectPt(p) { return H ? applyH(H, p[0], p[1]) : p; }

// screen px → un-warped view px (inverse homography, for pointer hit-testing
// on the transformed canvas). Projective inverse = adjugate normalised so
// the bottom-right term is 1 — the determinant cancels.
export function screenToView(x, y) {
  if (!H) return [x, y];
  var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
  var A22 = a * e - b * d;
  if (Math.abs(A22) < 1e-12) return [x, y];
  var inv = [
    (e - f * h) / A22, (c * h - b) / A22, (b * f - c * e) / A22,
    (f * g - d) / A22, (a - c * g) / A22, (c * d - a * f) / A22,
    (d * h - e * g) / A22, (b * g - a * h) / A22
  ];
  return applyH(inv, x, y);
}

export function isEditing() { return editing; }

export function applyKeystone() {
  if (!popts.keystone) {
    H = null;
    els.projCanvas.style.transform = '';
  } else {
    var dst = popts.keystone.map(function (p) { return [p[0] * viewW(), p[1] * viewH()]; });
    H = homography(vpCorners(), dst);
    els.projCanvas.style.transformOrigin = '0 0';
    els.projCanvas.style.transform = H ? matrix3d(H) : '';
  }
  positionHandles();
}

export function positionHandles() {
  if (!editing || !view.rect) return;
  var kids = els.projHandles.children;
  chartCorners().forEach(function (pt, i) {
    var p = projectPt(pt);
    kids[i].style.left = p[0] + 'px';
    kids[i].style.top = p[1] + 'px';
  });
}

export function setKeystoneEditing(on) {
  editing = on;
  els.projHandles.classList.toggle('hidden', !on);
  positionHandles();
}

export function resetKeystone() {
  popts.keystone = null;
  saveOpts();
  applyKeystone();
}

// drag corner i: keep the other three projected chart corners where they
// are, put this one under the pointer, and re-derive the full-plane warp
// (a homography is fixed by exactly these four correspondences)
function dragCorner(i, X, Y) {
  var src = chartCorners();
  var dst = src.map(projectPt);
  dst[i] = [X, Y];
  var Hc = homography(src, dst);
  if (!Hc) return;
  var W = viewW(), Hgt = viewH();
  popts.keystone = vpCorners().map(function (p) {
    var q = applyH(Hc, p[0], p[1]);
    return [q[0] / W, q[1] / Hgt];
  });
  applyKeystone();
}

export function initKeystone() {
  Array.prototype.forEach.call(els.projHandles.children, function (el, i) {
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (err) {} // synthetic events can't capture
      var move = function (ev) { dragCorner(i, ev.clientX, ev.clientY); };
      var up = function () {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        saveOpts();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  });
}
