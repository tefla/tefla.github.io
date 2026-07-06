// ---- freeform boundary vectorising + blob grouping ----
// traceBlobLoops walks ONE colour region's cell edges into ordered closed
// loops (outer boundary + any hole boundaries), in grid-corner coordinates.
// Tracing per-region (not the whole multi-colour grid at once) means every
// vertex has degree 0, 2, or 4 (a rare diagonal-touch saddle) — never the
// degree-3 "Y junction" that a shared 3-colour meeting point would produce
// in a single combined graph, which is what made whole-grid tracing messy.
export function traceBlobLoops(cellSet, cols, rows) {
  function inBlob(r, c) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
    return cellSet.has(r * cols + c);
  }
  function vKey(x, y) { return x + ',' + y; }
  var adjacency = {};
  function addEdge(a, b) {
    var ak = vKey(a[0], a[1]), bk = vKey(b[0], b[1]);
    var eAB = { to: bk, point: b, used: false };
    var eBA = { to: ak, point: a, used: false };
    eAB.pair = eBA; eBA.pair = eAB;
    (adjacency[ak] = adjacency[ak] || []).push(eAB);
    (adjacency[bk] = adjacency[bk] || []).push(eBA);
  }
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      if (!inBlob(r, c)) continue;
      if (!inBlob(r - 1, c)) addEdge([c, r], [c + 1, r]);
      if (!inBlob(r + 1, c)) addEdge([c, r + 1], [c + 1, r + 1]);
      if (!inBlob(r, c - 1)) addEdge([c, r], [c, r + 1]);
      if (!inBlob(r, c + 1)) addEdge([c + 1, r], [c + 1, r + 1]);
    }
  }
  var loops = [];
  Object.keys(adjacency).forEach(function (startVk) {
    var list = adjacency[startVk];
    for (var i = 0; i < list.length; i++) {
      var startEdge = list[i];
      if (startEdge.used) continue;
      var loop = [];
      var curVk = startVk, curEdge = startEdge, guard = 0;
      while (true) {
        curEdge.used = true; curEdge.pair.used = true;
        loop.push(curEdge.point);
        curVk = curEdge.to;
        if (curVk === startVk) break;
        var options = adjacency[curVk].filter(function (e) { return !e.used; });
        if (!options.length) break;
        curEdge = options[0];
        if (++guard > 200000) break; // safety net, should never trip on a well-formed mask
      }
      loops.push(loop);
    }
  });
  return loops;
}

export function pointLineDist(p, a, b) {
  var dx = b[0] - a[0], dy = b[1] - a[1];
  var lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  var t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
export function rdp(points, epsilon) {
  if (points.length < 3) return points.slice();
  var dmax = 0, index = 0, a = points[0], b = points[points.length - 1];
  for (var i = 1; i < points.length - 1; i++) {
    var d = pointLineDist(points[i], a, b);
    if (d > dmax) { dmax = d; index = i; }
  }
  if (dmax > epsilon) {
    var left = rdp(points.slice(0, index + 1), epsilon);
    var right = rdp(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}
export function rdpClosed(points, epsilon) {
  if (points.length < 4) return points.slice();
  var simplified = rdp(points.concat([points[0]]), epsilon);
  simplified.pop();
  return simplified;
}

// windowed (triangular-kernel) smoothing along the closed loop: flattens the
// ±1-cell terraces that a shallow-sloped edge quantizes into, while following
// any curve whose radius is much larger than the window (a radius-35-cell
// wheel rim shrinks by ~0.03 cell). Real corners round by a few cells — the
// price of removing terrace noise; invisible at tufting-gun scale.
export function smoothClosed(points, passes) {
  var n = points.length;
  if (n < 8) return points.slice();
  var pts = points;
  for (var pass = 0; pass < passes; pass++) {
    var out = new Array(n);
    for (var i = 0; i < n; i++) {
      var sx = 0, sy = 0, W = 0;
      for (var o = -3; o <= 3; o++) {
        var w = 4 - Math.abs(o);
        var p = pts[(i + o + n) % n];
        sx += p[0] * w; sy += p[1] * w; W += w;
      }
      out[i] = [sx / W, sy / W];
    }
    pts = out;
  }
  return pts;
}

// trace + simplify + smooth every blob once, shared by both the colour fill
// and the B/W outline so the work isn't done twice per render
export function computeSmoothedBlobs(cols, rows, grid) {
  return findBlobs(cols, rows, grid).map(function (blob) {
    var cellSet = new Set(blob.cells);
    // smooth FIRST, on the raw 1-cell-segment loop, then simplify only to
    // thin the point count. Simplifying first is tempting but wrong in both
    // directions: a coarse epsilon flattens shallow arcs into long chords
    // (polygonal wheels), a fine one keeps every quantization terrace
    // (wobbly diagonals) — smoothing the dense loop suffers neither.
    var loops = traceBlobLoops(cellSet, cols, rows).map(function (loop) {
      return rdpClosed(smoothClosed(loop, 2), 0.4);
    });
    return { idx: blob.idx, cells: blob.cells, loops: loops };
  });
}

// group same-colour cells into contiguous blobs (4-connectivity) so the
// projector chart only draws a line where the colour actually changes,
// and gets one number per blob instead of one per cell. cells are flat
// r*cols+c indices — at fine Detail settings a blob can hold 100k+ cells
export function findBlobs(cols, rows, grid) {
  var visited = new Uint8Array(grid.length);
  var blobs = [];
  var stack = [];
  for (var i0 = 0; i0 < grid.length; i0++) {
    if (visited[i0]) continue;
    var idx = grid[i0];
    stack.length = 0; stack.push(i0);
    visited[i0] = 1;
    var cells = [];
    while (stack.length) {
      var i = stack.pop();
      cells.push(i);
      var r = (i / cols) | 0, c = i % cols;
      if (r > 0 && !visited[i - cols] && grid[i - cols] === idx) { visited[i - cols] = 1; stack.push(i - cols); }
      if (r < rows - 1 && !visited[i + cols] && grid[i + cols] === idx) { visited[i + cols] = 1; stack.push(i + cols); }
      if (c > 0 && !visited[i - 1] && grid[i - 1] === idx) { visited[i - 1] = 1; stack.push(i - 1); }
      if (c < cols - 1 && !visited[i + 1] && grid[i + 1] === idx) { visited[i + 1] = 1; stack.push(i + 1); }
    }
    blobs.push({ idx: idx, cells: cells });
  }
  return blobs;
}
