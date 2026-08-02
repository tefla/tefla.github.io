// Mini tufting-chart preview for Imagine candidates: the real quantise
// pipeline (sample → auto-K → k-means → label → mode-filter → despeckle →
// post-cleanup colour means) at thumbnail resolution, painted as flat cells.
// No tracing/smoothing — chunky cells are the honest preview of tuftability.
// Colours go through the CURRENT yarn matching (brand / multi-supplier) when
// one is selected, so candidates are compared in the yarns Tim would buy.
import { computeGridDims, sampleImage } from './geometry.js';
import { sampleTrainingPixels, seedCentroids, kmeansTrain, labelPixels, detectColourPeaks, autoDetectK, modeFilterPass, despeckle } from './quantise.js';
import { matchAnyYarnHex, hexToRgb } from './yarns.js';

var PREVIEW_LONG_SIDE = 220; // matches app.js autoPickK's sampling resolution

// Renders the chart preview into `canvas` (sized to the grid, CSS-scaled by
// the caller) and returns { k } — the auto-detected colour count.
export function renderMiniChart(img, canvas) {
  var dims = computeGridDims(img, PREVIEW_LONG_SIDE);
  var cols = dims.cols, rows = dims.rows, n = cols * rows;
  var data = sampleImage(img, cols, rows);
  var k = autoDetectK(data, n, 12);
  var samples = sampleTrainingPixels(data, n, 12000);
  var trained = kmeansTrain(samples, k, 12,
    seedCentroids(samples, k, detectColourPeaks(data, n), {}), {});

  var labels = labelPixels(data, n, trained.centroids, k, null);
  labels = modeFilterPass(labels, cols, rows, k);
  labels = modeFilterPass(labels, cols, rows, k);
  despeckle(labels, cols, rows, Math.max(4, Math.round(n * 0.0001)));

  // post-cleanup means, same rationale as app.js relabelAndRender: raw
  // k-means centroids are polluted by anti-aliasing halo pixels
  var sums = new Float64Array(k * 4);
  for (var i = 0; i < n; i++) {
    var l = labels[i];
    sums[l * 4] += data[i * 4]; sums[l * 4 + 1] += data[i * 4 + 1];
    sums[l * 4 + 2] += data[i * 4 + 2]; sums[l * 4 + 3]++;
  }
  var display = []; // per-label [r,g,b] after optional yarn matching
  for (var c = 0; c < k; c++) {
    var rgb = sums[c * 4 + 3] > 0
      ? [sums[c * 4] / sums[c * 4 + 3], sums[c * 4 + 1] / sums[c * 4 + 3], sums[c * 4 + 2] / sums[c * 4 + 3]].map(Math.round)
      : [trained.centroids[c * 3], trained.centroids[c * 3 + 1], trained.centroids[c * 3 + 2]].map(Math.round);
    var yarnHex = matchAnyYarnHex(rgb);
    display.push(yarnHex ? hexToRgb(yarnHex) : rgb);
  }

  canvas.width = cols; canvas.height = rows;
  var ctx = canvas.getContext('2d');
  var out = ctx.createImageData(cols, rows);
  for (var p = 0; p < n; p++) {
    var rgb2 = display[labels[p]];
    out.data[p * 4] = rgb2[0]; out.data[p * 4 + 1] = rgb2[1];
    out.data[p * 4 + 2] = rgb2[2]; out.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return { k: k };
}
