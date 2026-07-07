// ---------- colour math + quantisation (k-means, peak detection, cleanup) ----------
import { findBlobs } from './trace.js';

export function luminance(c) { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }

export function rgbToHex(rgb) {
  return '#' + rgb.map(function (v) { return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'); }).join('');
}

// k-means on typed arrays: TRAIN the centroids on a stride-sample of the
// pixels (palette quality saturates after ~20k samples), then LABEL every
// pixel in one pass — that's what keeps a 600–900px sample grid interactive
export function sampleTrainingPixels(data, n, maxSamples) {
  var stride = Math.max(1, Math.ceil(n / maxSamples));
  var out = new Float32Array(Math.ceil(n / stride) * 3);
  var j = 0;
  for (var i = 0; i < n; i += stride) {
    out[j * 3] = data[i * 4]; out[j * 3 + 1] = data[i * 4 + 1]; out[j * 3 + 2] = data[i * 4 + 2];
    j++;
  }
  return out.subarray(0, j * 3);
}

// deterministic seeding: start the centroids at the histogram's distinct
// colour peaks — those are precisely the colours the palette must not lose
// (random k-means++ seeding missed a small accent cluster roughly one run
// in six, silently mapping a tractor's yellow hubs to beige). Slots beyond
// the peak count fill farthest-point-first from the samples. No Math.random
// anywhere → same image + settings = same palette every run, which also
// keeps the Advanced reach-sliders' colour identities stable across drags.
// pins (optional) is a {rawIdx: [r,g,b]} map of fixed centroids — see kmeansTrain.
// They're written last so a pinned slot always starts exactly on its colour,
// regardless of what the peak/farthest seeding would have put there.
export function seedCentroids(samples, k, peaks, pins) {
  var sn = samples.length / 3;
  var centroids = new Float32Array(k * 3);
  var seeded = Math.min(k, peaks.length);
  for (var p = 0; p < seeded; p++) {
    centroids[p * 3] = peaks[p].r; centroids[p * 3 + 1] = peaks[p].g; centroids[p * 3 + 2] = peaks[p].b;
  }
  for (var c = seeded; c < k; c++) {
    var farIdx = 0, farD = -1;
    for (var i = 0; i < sn; i++) {
      var r = samples[i * 3], g = samples[i * 3 + 1], b = samples[i * 3 + 2];
      var best = Infinity;
      for (var cc = 0; cc < c; cc++) {
        var dr = r - centroids[cc * 3], dg = g - centroids[cc * 3 + 1], db = b - centroids[cc * 3 + 2];
        var dd = dr * dr + dg * dg + db * db;
        if (dd < best) best = dd;
      }
      if (best > farD) { farD = best; farIdx = i; }
    }
    centroids[c * 3] = samples[farIdx * 3]; centroids[c * 3 + 1] = samples[farIdx * 3 + 1]; centroids[c * 3 + 2] = samples[farIdx * 3 + 2];
  }
  applyPins(centroids, k, pins);
  return centroids;
}

// overwrite pinned raw-index centroids with their fixed rgb (in place)
function applyPins(centroids, k, pins) {
  if (!pins) return;
  Object.keys(pins).forEach(function (idxStr) {
    var idx = +idxStr, rgb = pins[idxStr];
    if (idx < k && rgb) { centroids[idx * 3] = rgb[0]; centroids[idx * 3 + 1] = rgb[1]; centroids[idx * 3 + 2] = rgb[2]; }
  });
}

// pins (optional {rawIdx: [r,g,b]}) are fixed centroids: pixels still assign to
// them, but the update step never moves them, so a pinned colour stays exactly
// where the user placed it while the rest of the palette clusters around it.
export function kmeansTrain(samples, k, iters, initCentroids, pins) {
  var sn = samples.length / 3;
  var centroids = initCentroids;
  var pinned = {};
  if (pins) Object.keys(pins).forEach(function (i) { if (+i < k) pinned[+i] = true; });
  var sums = new Float64Array(k * 4);
  for (var it = 0; it < iters; it++) {
    sums.fill(0);
    for (var i = 0; i < sn; i++) {
      var r = samples[i * 3], g = samples[i * 3 + 1], b = samples[i * 3 + 2];
      var best = 0, bestD = Infinity;
      for (var c = 0; c < k; c++) {
        var dr = r - centroids[c * 3], dg = g - centroids[c * 3 + 1], db = b - centroids[c * 3 + 2];
        var dd = dr * dr + dg * dg + db * db;
        if (dd < bestD) { bestD = dd; best = c; }
      }
      sums[best * 4] += r; sums[best * 4 + 1] += g; sums[best * 4 + 2] += b; sums[best * 4 + 3]++;
    }
    for (var c2 = 0; c2 < k; c2++) {
      if (pinned[c2]) continue;   // fixed centroid — never moved by iteration
      if (sums[c2 * 4 + 3] > 0) {
        centroids[c2 * 3] = sums[c2 * 4] / sums[c2 * 4 + 3];
        centroids[c2 * 3 + 1] = sums[c2 * 4 + 1] / sums[c2 * 4 + 3];
        centroids[c2 * 3 + 2] = sums[c2 * 4 + 2] / sums[c2 * 4 + 3];
      }
    }
  }
  return { centroids: centroids };
}

// weights (when given) implement a multiplicatively weighted Voronoi
// assignment: dividing dd by w*w before comparing grows a colour's
// territory for w>1 and shrinks it for w<1. Omitting weights entirely
// (the Advanced-off / default path) keeps this loop identical to the
// unweighted version — no stray division, no behaviour change.
export function labelPixels(data, n, centroids, k, weights) {
  var labels = new Uint8Array(n);
  for (var i = 0; i < n; i++) {
    var r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    var best = 0, bestD = Infinity;
    for (var c = 0; c < k; c++) {
      var dr = r - centroids[c * 3], dg = g - centroids[c * 3 + 1], db = b - centroids[c * 3 + 2];
      var dd = dr * dr + dg * dg + db * db;
      if (weights) dd /= weights[c] * weights[c];
      if (dd < bestD) { bestD = dd; best = c; }
    }
    labels[i] = best;
  }
  return labels;
}

// count the visually DISTINCT colours rather than running an elbow test —
// variance-based elbow methods are area-weighted, so a big flat background
// swallows small accents (the yellow wheel hubs on a mostly-beige tractor
// score as noise). Instead: histogram at 4 bits/channel, keep bins holding
// >0.15% of pixels, then count the LOCAL MAXIMA: a bin is a colour only if
// no stronger bin sits within PEAK_R of it. Anti-aliasing between two flat
// regions populates a thin chain of bins bridging them, but every link in
// that chain is weaker than the true colours at its ends, so a chain can
// suppress nothing and never counts as a peak itself. A soft gradient is
// one monotonic slope of bins — one maximum, counted once.
export function detectColourPeaks(data, n) {
  var counts = new Int32Array(4096);
  for (var i = 0; i < n; i++) {
    counts[((data[i * 4] >> 4) << 8) | ((data[i * 4 + 1] >> 4) << 4) | (data[i * 4 + 2] >> 4)]++;
  }
  var minCount = Math.max(6, n * 0.0015);
  var cand = [];
  for (var bin = 0; bin < 4096; bin++) {
    if (counts[bin] < minCount) continue;
    cand.push({ r: ((bin >> 8) & 15) * 16 + 8, g: ((bin >> 4) & 15) * 16 + 8, b: (bin & 15) * 16 + 8, count: counts[bin] });
  }
  var PEAK_R2 = 56 * 56;
  var peaks = [];
  for (var a = 0; a < cand.length; a++) {
    var isPeak = true;
    for (var bIdx = 0; bIdx < cand.length && isPeak; bIdx++) {
      if (bIdx === a) continue;
      var other = cand[bIdx];
      if (other.count < cand[a].count || (other.count === cand[a].count && bIdx > a)) continue;
      var dr = other.r - cand[a].r, dg = other.g - cand[a].g, db = other.b - cand[a].b;
      if (dr * dr + dg * dg + db * db <= PEAK_R2) isPeak = false;
    }
    if (isPeak) peaks.push(cand[a]);
  }
  peaks.sort(function (a, b) { return b.count - a.count; });
  // betweenness test: an anti-aliasing halo between two flat regions sits ON
  // the straight RGB segment joining them (blending is linear), so a weak
  // peak within BLEND_DIST of the segment between two stronger peaks is a
  // blend artefact, not a design colour. A real accent (yellow hubs) sits
  // far from every such segment even when its pixel share is smaller than
  // the halo's, which is why a share threshold can't make this call.
  var BLEND_DIST2 = 32 * 32;
  var real = peaks.filter(function (p, i) {
    for (var x = 0; x < i; x++) {
      for (var y = x + 1; y < i; y++) {
        var A = peaks[x], B = peaks[y];
        var dx = B.r - A.r, dy = B.g - A.g, dz = B.b - A.b;
        var lenSq = dx * dx + dy * dy + dz * dz;
        if (lenSq === 0) continue;
        var t = Math.max(0, Math.min(1, ((p.r - A.r) * dx + (p.g - A.g) * dy + (p.b - A.b) * dz) / lenSq));
        var er = p.r - (A.r + t * dx), eg = p.g - (A.g + t * dy), eb = p.b - (A.b + t * dz);
        if (er * er + eg * eg + eb * eb <= BLEND_DIST2) return false;
      }
    }
    return true;
  });
  return real;
}

export function autoDetectK(data, n, maxK) {
  return Math.max(2, Math.min(maxK, detectColourPeaks(data, n).length));
}

// ---------- label cleanup ----------
// one 3×3 majority vote per pass — downsampling smears a 1–2 cell halo of
// blend colour along every edge between two flat regions, and k-means then
// hands those halos whichever cluster is nearest; majority voting erases
// them without disturbing features 2+ cells wide (ties keep the current
// label, so it never invents churn on a stable region)
export function modeFilterPass(labels, cols, rows, k) {
  var out = new Uint8Array(labels.length);
  var counts = new Int32Array(k);
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      counts.fill(0);
      for (var dr = -1; dr <= 1; dr++) {
        var nr = r + dr;
        if (nr < 0 || nr >= rows) continue;
        for (var dc = -1; dc <= 1; dc++) {
          var nc = c + dc;
          if (nc < 0 || nc >= cols) continue;
          counts[labels[nr * cols + nc]]++;
        }
      }
      var i = r * cols + c, best = labels[i];
      for (var lab = 0; lab < k; lab++) if (counts[lab] > counts[best]) best = lab;
      out[i] = best;
    }
  }
  return out;
}

// merge regions smaller than minArea into their dominant neighbour — noisy
// sources otherwise shed hundreds of speckle regions that are unworkable
// with a tufting gun and clutter the projector chart with stray outlines
export function despeckle(labels, cols, rows, minArea) {
  findBlobs(cols, rows, labels).forEach(function (blob) {
    if (blob.cells.length >= minArea) return;
    var tally = {};
    blob.cells.forEach(function (i) {
      var r = (i / cols) | 0, c = i % cols;
      [r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1, c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1]
        .forEach(function (ni) {
          if (ni < 0) return;
          var lab = labels[ni];
          if (lab !== blob.idx) tally[lab] = (tally[lab] || 0) + 1;
        });
    });
    var best = -1, bestN = 0;
    Object.keys(tally).forEach(function (lab) { if (tally[lab] > bestN) { bestN = tally[lab]; best = +lab; } });
    if (best >= 0) blob.cells.forEach(function (i) { labels[i] = best; });
  });
}
