// ---------- render + export (colour canvas, B/W projector chart, PNG/SVG) ----------
import { els, state } from './state.js';
import { finishingGeometry, cellPxFor, roundRectPath, roundRectPathD, insideRoundRect } from './geometry.js';
import { matchAnyYarnHex, hexToRgb } from './yarns.js';

export function strokeSmoothedLoops(ctx, smoothedBlobs, cellPx) {
  ctx.beginPath();
  smoothedBlobs.forEach(function (b) {
    b.loops.forEach(function (loop) {
      ctx.moveTo(loop[0][0] * cellPx, loop[0][1] * cellPx);
      for (var i = 1; i < loop.length; i++) ctx.lineTo(loop[i][0] * cellPx, loop[i][1] * cellPx);
      ctx.closePath();
    });
  });
}

// overlay the adjustable-width outline strokes (line-art mode). Width scales
// with resolution so the visual weight is constant across Detail settings.
function strokeLineArt(ctx, cols, rows, cellPx) {
  var la = state.lineArt;
  if (!la) return;
  ctx.strokeStyle = la.hex;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = state.lineThickness * Math.max(cols, rows) / 512 * cellPx;
  ctx.beginPath();
  la.strokes.forEach(function (pl) {
    ctx.moveTo(pl[0][0] * cellPx, pl[0][1] * cellPx);
    for (var i = 1; i < pl.length; i++) ctx.lineTo(pl[i][0] * cellPx, pl[i][1] * cellPx);
  });
  ctx.stroke();
}

// displayHexes (optional, palette-indexed) overrides the fill colour per
// blob — used by the yarn-colour preview checkbox and the export-in-yarn-
// colours option (which passes the same hexes to downloadSVG). The BW
// projector chart keeps painting outlines only and is unaffected.
export function renderColour(cols, rows, grid, palette, smoothedBlobs, displayHexes) {
  var cellPx = cellPxFor(cols, rows);
  var w = Math.round(cols * cellPx), h = Math.round(rows * cellPx);
  var canvas = els.colourCanvas;
  canvas.width = w; canvas.height = h;
  els.colourFrame.style.aspectRatio = cols + ' / ' + rows;
  var vctx = canvas.getContext('2d');
  var geom = finishingGeometry(cols, rows);
  // line-art mode swaps the fills for the outline-removed blobs; strokes overlay after
  var blobs = state.lineArt ? state.lineArt.fillBlobs : smoothedBlobs;
  if (!geom.active) {
    vctx.fillStyle = displayHexes ? displayHexes[0] : 'rgb(' + palette[0].rgb.join(',') + ')';
    vctx.fillRect(0, 0, w, h); // fallback base so any seam shows a plausible colour, not a gap
    blobs.forEach(function (b) {
      vctx.fillStyle = displayHexes ? displayHexes[b.idx] : 'rgb(' + palette[b.idx].rgb.join(',') + ')';
      strokeSmoothedLoops(vctx, [b], cellPx);
      vctx.fill('evenodd'); // evenodd so a blob with a hole in it renders correctly
    });
    strokeLineArt(vctx, cols, rows, cellPx);
    return;
  }
  // finishing active: transparent outside the rug, a rounded border ring
  // (if any) painted first, an inner rounded base, then blobs clipped to
  // the interior so corner-cut/border overspill never shows through
  vctx.clearRect(0, 0, w, h);
  var Bpx = geom.B * cellPx, Rpx = geom.R * cellPx, RiPx = geom.Ri * cellPx;
  var baseHex = displayHexes ? displayHexes[0] : palette[0].hex;
  var borderHex = geom.B > 0 ? (displayHexes ? (matchAnyYarnHex(hexToRgb(state.borderHex)) || state.borderHex) : state.borderHex) : baseHex;
  vctx.fillStyle = borderHex;
  roundRectPath(vctx, 0, 0, w, h, Rpx);
  vctx.fill();
  vctx.fillStyle = baseHex;
  roundRectPath(vctx, Bpx, Bpx, w - 2 * Bpx, h - 2 * Bpx, RiPx);
  vctx.fill();
  vctx.save();
  roundRectPath(vctx, Bpx, Bpx, w - 2 * Bpx, h - 2 * Bpx, RiPx);
  vctx.clip();
  blobs.forEach(function (b) {
    vctx.fillStyle = displayHexes ? displayHexes[b.idx] : palette[b.idx].hex;
    strokeSmoothedLoops(vctx, [b], cellPx);
    vctx.fill('evenodd');
  });
  strokeLineArt(vctx, cols, rows, cellPx); // clipped to the rug interior
  vctx.restore();
}

// pick the cell closest to the blob's centroid, so the label always lands inside it;
// also return the blob's bounding box, used to skip labelling blobs too small to fit a number
export function blobLabelInfo(cells, cols) {
  var sumR = 0, sumC = 0, minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  cells.forEach(function (i) {
    var r = (i / cols) | 0, c = i % cols;
    sumR += r; sumC += c;
    if (r < minR) minR = r; if (r > maxR) maxR = r;
    if (c < minC) minC = c; if (c > maxC) maxC = c;
  });
  var cr = sumR / cells.length, cc = sumC / cells.length;
  var bestR = 0, bestC = 0, bestD = Infinity;
  cells.forEach(function (i) {
    var r = (i / cols) | 0, c = i % cols;
    var d = (r - cr) * (r - cr) + (c - cc) * (c - cc);
    if (d < bestD) { bestD = d; bestR = r; bestC = c; }
  });
  return { r: bestR, c: bestC, wCells: maxC - minC + 1, hCells: maxR - minR + 1 };
}

export function renderBW(cols, rows, grid, palette, smoothedBlobs) {
  var cellPx = cellPxFor(cols, rows);
  var w = Math.round(cols * cellPx), h = Math.round(rows * cellPx);
  var canvas = els.bwCanvas;
  canvas.width = w; canvas.height = h;
  els.bwFrame.style.aspectRatio = cols + ' / ' + rows;
  var fctx = canvas.getContext('2d');
  fctx.fillStyle = '#ffffff';
  fctx.fillRect(0, 0, w, h);
  fctx.strokeStyle = '#000000';
  fctx.lineJoin = 'round';
  fctx.lineCap = 'round';
  fctx.lineWidth = Math.max(1.25, Math.max(w, h) * 0.0025);
  strokeSmoothedLoops(fctx, smoothedBlobs, cellPx);
  fctx.stroke();

  var geom = finishingGeometry(cols, rows);
  var Bpx = geom.B * cellPx;
  if (geom.active) {
    roundRectPath(fctx, 0, 0, w, h, geom.R * cellPx); // rug cut line
    fctx.stroke();
    if (geom.B > 0) {
      roundRectPath(fctx, Bpx, Bpx, w - 2 * Bpx, h - 2 * Bpx, geom.Ri * cellPx); // border seam
      fctx.stroke();
    }
  }

  var fontPx = Math.max(14, Math.max(w, h) / 45);
  fctx.font = '700 ' + Math.round(fontPx) + 'px JBM, ui-monospace, monospace';
  fctx.textAlign = 'center';
  fctx.textBaseline = 'middle';
  fctx.fillStyle = '#000000';
  var innerX0 = geom.B, innerY0 = geom.B, innerX1 = cols - geom.B, innerY1 = rows - geom.B;
  smoothedBlobs.forEach(function (blob) {
    var info = blobLabelInfo(blob.cells, cols);
    var label = palette[blob.idx].label;
    // two-digit labels (10+, once k > 9) need roughly double the width of
    // one digit — widen the fit test per extra digit so "10"-"16" skip
    // blobs too small to hold them instead of clipping
    var wThresh = fontPx * (1.4 + 0.8 * (label.length - 1));
    if (info.wCells * cellPx < wThresh || info.hCells * cellPx < fontPx * 1.4) return;
    if (geom.active && !insideRoundRect(info.c + 0.5, info.r + 0.5, innerX0, innerY0, innerX1, innerY1, geom.Ri)) return;
    var x = info.c * cellPx + cellPx / 2, y = info.r * cellPx + cellPx / 2;
    fctx.fillText(label, x, y + 1);
  });
  if (geom.active && geom.B > 0) {
    fctx.fillText(String(palette.length + 1), cols * cellPx / 2, Bpx / 2 + 1);
  }
}

// ---------- downloads ----------
export function downloadCanvas(canvas, filename) {
  var a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// displayHexes (optional): palette-indexed override colours — used by the
// export-in-yarn-colours option to write matched yarn hexes into the SVG.
// mirror (optional): flip the whole drawing horizontally — tufting is worked
// from the back, so the mirrored export's finished front matches the preview.
export function downloadSVG(displayHexes, mirror) {
  if (!state.smoothedBlobs) return;
  var hex = function (i) { return displayHexes ? displayHexes[i] : state.palette[i].hex; };
  var cols = state.gridCols, rows = state.gridRows, unit = 10;
  var W = cols * unit, H = rows * unit;
  var parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
    '" viewBox="0 0 ' + W + ' ' + H + '">'];
  if (mirror) parts.push('<g transform="translate(' + W + ' 0) scale(-1 1)">');
  // same painter's algorithm as the canvas render: base fill in the first
  // palette colour, then each blob as an evenodd path (holes stay holes)
  var geom = finishingGeometry(cols, rows);
  if (geom.active) {
    var Bpx = geom.B * unit, Rpx = geom.R * unit, RiPx = geom.Ri * unit;
    if (geom.B > 0) {
      var svgBorderHex = displayHexes ? (matchAnyYarnHex(hexToRgb(state.borderHex)) || state.borderHex) : state.borderHex;
      parts.push('<path d="' + roundRectPathD(0, 0, W, H, Rpx) + '" fill="' + svgBorderHex + '"/>');
      parts.push('<path d="' + roundRectPathD(Bpx, Bpx, W - 2 * Bpx, H - 2 * Bpx, RiPx) + '" fill="' + hex(0) + '"/>');
      parts.push('<clipPath id="rug"><path d="' + roundRectPathD(Bpx, Bpx, W - 2 * Bpx, H - 2 * Bpx, RiPx) + '"/></clipPath>');
    } else {
      parts.push('<path d="' + roundRectPathD(0, 0, W, H, Rpx) + '" fill="' + hex(0) + '"/>');
      parts.push('<clipPath id="rug"><path d="' + roundRectPathD(0, 0, W, H, Rpx) + '"/></clipPath>');
    }
    parts.push('<g clip-path="url(#rug)">');
  } else {
    parts.push('<rect width="' + W + '" height="' + H + '" fill="' + hex(0) + '"/>');
  }
  var blobs = state.lineArt ? state.lineArt.fillBlobs : state.smoothedBlobs;
  blobs.forEach(function (b) {
    var d = b.loops.map(function (loop) {
      return 'M' + loop.map(function (p) {
        return (p[0] * unit).toFixed(2) + ' ' + (p[1] * unit).toFixed(2);
      }).join('L') + 'Z';
    }).join('');
    parts.push('<path d="' + d + '" fill="' + hex(b.idx) + '" fill-rule="evenodd"/>');
  });
  if (state.lineArt) {
    var sw = (state.lineThickness * Math.max(cols, rows) / 512 * unit).toFixed(2);
    var sp = state.lineArt.strokes.map(function (pl) {
      return 'M' + pl.map(function (p) { return (p[0] * unit).toFixed(2) + ' ' + (p[1] * unit).toFixed(2); }).join('L');
    }).join('');
    parts.push('<g fill="none" stroke="' + state.lineArt.hex + '" stroke-width="' + sw +
      '" stroke-linecap="round" stroke-linejoin="round"><path d="' + sp + '"/></g>');
  }
  if (geom.active) parts.push('</g>');
  if (mirror) parts.push('</g>');
  parts.push('</svg>');
  var blob = new Blob([parts.join('\n')], { type: 'image/svg+xml' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tuft-pattern-colour.svg';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}
