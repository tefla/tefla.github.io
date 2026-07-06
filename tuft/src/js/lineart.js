'use strict';
// Standalone port of the notebook's Route 3/4 line-art extraction to vanilla JS.
// Pure typed-array functions (no DOM) so they unit-test in node and inline into the app.

// ---- distance transform (chamfer/propagation) with nearest-feature index ----
// propagates each pixel's nearest TRUE source, then reports the exact squared
// distance to that propagated source — a close approximation of the EDT, enough
// for small-radius morphology and nearest-label fill.
function featureTransform(mask, cols, rows) {
  var n = cols * rows;
  var near = new Int32Array(n); near.fill(-1);
  var d2 = new Float64Array(n); d2.fill(Infinity);
  for (var i = 0; i < n; i++) if (mask[i]) { near[i] = i; d2[i] = 0; }
  function up(i, j) {
    var nj = near[j]; if (nj < 0) return;
    var r = (i / cols) | 0, c = i % cols, nr = (nj / cols) | 0, nc = nj % cols;
    var dd = (r - nr) * (r - nr) + (c - nc) * (c - nc);
    if (dd < d2[i]) { d2[i] = dd; near[i] = nj; }
  }
  var r, c, i;
  for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
    i = r * cols + c;
    if (c > 0) up(i, i - 1);
    if (r > 0) { up(i, i - cols); if (c > 0) up(i, i - cols - 1); if (c < cols - 1) up(i, i - cols + 1); }
  }
  for (r = rows - 1; r >= 0; r--) for (c = cols - 1; c >= 0; c--) {
    i = r * cols + c;
    if (c < cols - 1) up(i, i + 1);
    if (r < rows - 1) { up(i, i + cols); if (c < cols - 1) up(i, i + cols + 1); if (c > 0) up(i, i + cols - 1); }
  }
  return { d2: d2, near: near };
}

function dilateMask(mask, cols, rows, r) {
  var ft = featureTransform(mask, cols, rows), r2 = r * r, out = new Uint8Array(mask.length);
  for (var i = 0; i < out.length; i++) out[i] = ft.d2[i] <= r2 ? 1 : 0;
  return out;
}
function erodeMask(mask, cols, rows, r) {
  var inv = new Uint8Array(mask.length);
  for (var i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  var ft = featureTransform(inv, cols, rows), r2 = r * r, out = new Uint8Array(mask.length);
  for (i = 0; i < out.length; i++) out[i] = (mask[i] && ft.d2[i] > r2) ? 1 : 0;
  return out;
}
function openMask(mask, cols, rows, r) { return dilateMask(erodeMask(mask, cols, rows, r), cols, rows, r); }

function fillRemoved(labels, removeMask, cols, rows) {
  var keep = new Uint8Array(labels.length);
  for (var i = 0; i < keep.length; i++) keep[i] = removeMask[i] ? 0 : 1;
  var ft = featureTransform(keep, cols, rows), out = labels.slice();
  for (i = 0; i < out.length; i++) if (removeMask[i] && ft.near[i] >= 0) out[i] = labels[ft.near[i]];
  return out;
}

// ---- separable gaussian on a binary mask, re-thresholded (smooths band edges
// so thinning doesn't spawn spurs) ----
function smoothMask(mask, cols, rows, sigma) {
  var rad = Math.max(1, Math.ceil(sigma * 3)), k = new Float64Array(2 * rad + 1), sum = 0, x;
  for (x = -rad; x <= rad; x++) { var v = Math.exp(-(x * x) / (2 * sigma * sigma)); k[x + rad] = v; sum += v; }
  for (x = 0; x < k.length; x++) k[x] /= sum;
  var tmp = new Float64Array(mask.length), out = new Uint8Array(mask.length), r, c, i, t, acc;
  for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {          // horizontal
    acc = 0; for (t = -rad; t <= rad; t++) { var cc = Math.min(cols - 1, Math.max(0, c + t)); acc += mask[r * cols + cc] * k[t + rad]; }
    tmp[r * cols + c] = acc;
  }
  for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {          // vertical
    acc = 0; for (t = -rad; t <= rad; t++) { var rr = Math.min(rows - 1, Math.max(0, r + t)); acc += tmp[rr * cols + c] * k[t + rad]; }
    i = r * cols + c; out[i] = acc > 0.5 ? 1 : 0;
  }
  return out;
}

// ---- Zhang-Suen thinning -> 1px skeleton (matches skimage.skeletonize 'zhang') ----
function skeletonize(mask, cols, rows) {
  var img = mask.slice();
  function idx(r, c) { return r * cols + c; }
  function get(r, c) { return (r < 0 || c < 0 || r >= rows || c >= cols) ? 0 : img[idx(r, c)]; }
  var changed = true, toDel = [];
  while (changed) {
    changed = false;
    for (var step = 0; step < 2; step++) {
      toDel.length = 0;
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        if (!img[idx(r, c)]) continue;
        var p2 = get(r - 1, c), p3 = get(r - 1, c + 1), p4 = get(r, c + 1), p5 = get(r + 1, c + 1),
            p6 = get(r + 1, c), p7 = get(r + 1, c - 1), p8 = get(r, c - 1), p9 = get(r - 1, c - 1);
        var B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        var seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2], A = 0;
        for (var s = 0; s < 8; s++) if (seq[s] === 0 && seq[s + 1] === 1) A++;
        if (A !== 1) continue;
        if (step === 0) { if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue; }
        else { if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue; }
        toDel.push(idx(r, c));
      }
      if (toDel.length) { changed = true; for (var d = 0; d < toDel.length; d++) img[toDel[d]] = 0; }
    }
  }
  return img;
}

// ---- skeleton image -> pruned polylines (list of [x,y] in cell-centre units) ----
function skeletonToPolylines(skel, cols, rows, minBranch) {
  var isS = skel, n = cols * rows;
  function nbrs(i) {
    var r = (i / cols) | 0, c = i % cols, out = [];
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      var nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      var j = nr * cols + nc; if (isS[j]) out.push(j);
    }
    return out;
  }
  var deg = new Int8Array(n), pts = [];
  for (var i = 0; i < n; i++) if (isS[i]) { deg[i] = nbrs(i).length; pts.push(i); }
  var isNode = function (i) { return deg[i] === 1 || deg[i] >= 3; };
  var seen = new Set(), branches = [];
  function edge(a, b) { return a < b ? a * n + b : b * n + a; }
  function walk(a, b) {
    var path = [a], prev = a, cur = b; seen.add(edge(a, b));
    while (true) {
      path.push(cur);
      if (isNode(cur) || cur === a) break;
      var nx = nbrs(cur), nextP = -1;
      for (var t = 0; t < nx.length; t++) if (nx[t] !== prev) { nextP = nx[t]; break; }
      if (nextP < 0) break;
      seen.add(edge(cur, nextP)); prev = cur; cur = nextP;
    }
    return path;
  }
  for (var p = 0; p < pts.length; p++) if (isNode(pts[p])) {
    var nb = nbrs(pts[p]);
    for (var q = 0; q < nb.length; q++) if (!seen.has(edge(pts[p], nb[q]))) branches.push(walk(pts[p], nb[q]));
  }
  for (p = 0; p < pts.length; p++) if (deg[pts[p]] === 2) {         // isolated loops
    var nb2 = nbrs(pts[p]);
    for (q = 0; q < nb2.length; q++) if (!seen.has(edge(pts[p], nb2[q]))) branches.push(walk(pts[p], nb2[q]));
  }
  function arclen(path) {
    var L = 0; for (var t = 1; t < path.length; t++) {
      var ar = (path[t] / cols) | 0, ac = path[t] % cols, br = (path[t - 1] / cols) | 0, bc = path[t - 1] % cols;
      L += Math.hypot(ar - br, ac - bc);
    }
    return L;
  }
  var out = [];
  for (var b = 0; b < branches.length; b++) {
    var pa = branches[b];
    var dangling = deg[pa[0]] === 1 || deg[pa[pa.length - 1]] === 1;
    if (dangling && arclen(pa) < minBranch) continue;             // prune short spurs
    out.push(pa.map(function (fi) { return [(fi % cols) + 0.5, ((fi / cols) | 0) + 0.5]; }));
  }
  return out;
}

// ---- open-polyline RDP (the app already ships this; duplicated for the node test) ----
function rdp(points, epsilon) {
  if (points.length < 3) return points.slice();
  var dmax = 0, index = 0, end = points.length - 1;
  var ax = points[0][0], ay = points[0][1], bx = points[end][0], by = points[end][1];
  var dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  for (var i = 1; i < end; i++) {
    var d = Math.abs((points[i][0] - ax) * dy - (points[i][1] - ay) * dx) / len;
    if (d > dmax) { dmax = d; index = i; }
  }
  if (dmax > epsilon) {
    var l = rdp(points.slice(0, index + 1), epsilon), r = rdp(points.slice(index), epsilon);
    return l.slice(0, -1).concat(r);
  }
  return [points[0], points[end]];
}

// ---- top-level: raw pixel data -> { fillGrid, strokes, hex } ----
// data: RGBA Uint8 at grid res; grid/palette optional (only for fillGrid).
export function computeLineArt(cols, rows, data, grid, palette) {
  var n = cols * rows, LINE_LUM = 70, s = Math.max(cols, rows) / 512;
  var blobR = Math.max(3, Math.round(12 * s)), halo = Math.max(1, Math.round(2 * s)),
      minBranch = Math.max(4, Math.round(8 * s)), sigma = Math.max(0.8, 1.5 * s), eps = 1.2 * s;
  var lineMask = new Uint8Array(n), sr = 0, sg = 0, sb = 0, cnt = 0;
  for (var i = 0; i < n; i++) {
    var R = data[i * 4], G = data[i * 4 + 1], Bc = data[i * 4 + 2];
    if (0.2126 * R + 0.7152 * G + 0.0722 * Bc < LINE_LUM) { lineMask[i] = 1; sr += R; sg += G; sb += Bc; cnt++; }
  }
  var blob = openMask(lineMask, cols, rows, blobR), blobD = dilateMask(blob, cols, rows, 1);
  var line = new Uint8Array(n);
  for (i = 0; i < n; i++) line[i] = (lineMask[i] && !blobD[i]) ? 1 : 0;
  var lineD = dilateMask(line, cols, rows, halo), remove = new Uint8Array(n);
  for (i = 0; i < n; i++) remove[i] = (lineD[i] && !blob[i]) ? 1 : 0;
  var fillGrid = grid ? fillRemoved(grid, remove, cols, rows) : null;
  var skel = skeletonize(smoothMask(line, cols, rows, sigma), cols, rows);
  var strokes = skeletonToPolylines(skel, cols, rows, minBranch)
    .map(function (pl) { return rdp(pl, eps); }).filter(function (pl) { return pl.length >= 2; });
  var hex = cnt ? '#' + [Math.round(sr / cnt), Math.round(sg / cnt), Math.round(sb / cnt)]
    .map(function (v) { return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'); }).join('') : '#000000';
  return { fillGrid: fillGrid, strokes: strokes, hex: hex };
}
