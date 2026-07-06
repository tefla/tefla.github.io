// ---------- yarn brand matching + shopping list ----------
// yarn brand palettes — static JSON module import (synchronous, no build step)
import YARN_DATA from '../yarns.json' with { type: 'json' };
import { els, state } from './state.js';
import { renderColour } from './render.js';
import { updateRoundHint, updateBorderHint } from './app.js';

export { YARN_DATA };

// nearest-yarn matching runs in CIE Lab, not RGB — perceptual distance is what
// decides whether a substitute yarn "reads" as the pattern colour on the mat
export function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
export function rgbToLab(rgb) {
  function inv(v) { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; }
  var r = inv(rgb[0]), g = inv(rgb[1]), b = inv(rgb[2]);
  var x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  var y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  var z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
  var fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export function deltaE(labA, labB) {
  var dl = labA[0] - labB[0], da = labA[1] - labB[1], db = labA[2] - labB[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

export let activeLine = null; // { brand, currency, line, fiber, coneGrams, price, colors: [{name, hex, lab}] }

export function populateBrandSelect() {
  (YARN_DATA.brands || []).forEach(function (brand, bi) {
    (brand.lines || []).forEach(function (line, li) {
      var opt = document.createElement('option');
      opt.value = bi + ':' + li;
      opt.textContent = brand.brand + ' — ' + line.line + ' (' + line.colors.length + ' colours)';
      els.yarnBrand.appendChild(opt);
    });
  });
}

export function setActiveLine(value) {
  if (!value) { activeLine = null; return; }
  var parts = value.split(':');
  var brand = YARN_DATA.brands[+parts[0]], line = brand.lines[+parts[1]];
  activeLine = {
    brand: brand.brand, url: brand.url, currency: brand.currency,
    line: line.line, fiber: line.fiber, coneGrams: line.coneGrams,
    unit: line.unit || 'cone',
    colors: line.colors.map(function (c) {
      // per-colour price wins over the line price — some suppliers charge more
      // for premium/small-batch dyes (or plain white, oddly)
      var price = typeof c.price === 'number' ? c.price : (typeof line.price === 'number' ? line.price : null);
      return { name: c.name, code: c.code || null, hex: c.hex, source: c.source, price: price, lab: rgbToLab(hexToRgb(c.hex)) };
    })
  };
}

// paletteIdx is optional (existing callers that never override can omit it);
// when Advanced is on and an override exists for this line + palette index,
// return that yarn instead of the nearest match (deltaE still computed
// against it, so the poor-match marker downstream stays honest)
export function matchYarn(rgb, paletteIdx) {
  var lab = rgbToLab(rgb);
  if (state.advanced && paletteIdx != null) {
    var overrideName = state.yarnOverrides[els.yarnBrand.value + ':' + paletteIdx];
    if (overrideName) {
      for (var i = 0; i < activeLine.colors.length; i++) {
        if (activeLine.colors[i].name === overrideName) {
          return { yarn: activeLine.colors[i], deltaE: deltaE(lab, activeLine.colors[i].lab), manual: true };
        }
      }
    }
  }
  var best = null, bestD = Infinity;
  activeLine.colors.forEach(function (c) {
    var d = deltaE(lab, c.lab);
    if (d < bestD) { bestD = d; best = c; }
  });
  return { yarn: best, deltaE: bestD };
}

// compact per-row mapping select: first option clears the override (labelled
// "auto — Name"), the rest list every line colour nearest-ΔE-first
export function buildYarnPickSelect(p, paletteIdx) {
  var lab = rgbToLab(p.rgb);
  var opts = activeLine.colors.map(function (c) { return { name: c.name, code: c.code, d: deltaE(lab, c.lab) }; })
    .sort(function (a, b) { return a.d - b.d; });
  var key = els.yarnBrand.value + ':' + paletteIdx;
  var overrideName = state.yarnOverrides[key] || '';
  var html = '<select class="yarnPick" data-idx="' + paletteIdx + '">' +
    '<option value=""' + (overrideName === '' ? ' selected' : '') + '>auto — ' + escapeHtml(opts[0].name) + '</option>';
  opts.forEach(function (o) {
    html += '<option value="' + escapeHtml(o.name) + '"' + (overrideName === o.name ? ' selected' : '') + '>' +
      escapeHtml(o.name) + (o.code ? ' [' + escapeHtml(o.code) + ']' : '') + ' · ΔE ' + Math.round(o.d) + '</option>';
  });
  return html + '</select>';
}

// palette-indexed matched-yarn hex per colour (override-aware), for the
// yarn-colour preview checkbox
export function computeYarnDisplayHexes() {
  if (!activeLine || !state.palette) return null;
  return state.palette.map(function (p, i) { return p.count ? matchYarn(p.rgb, i).yarn.hex : p.hex; });
}

export function repaintColourIfPreviewing() {
  if (els.yarnPreviewChk.checked && state.grid) {
    renderColour(state.gridCols, state.gridRows, state.grid, state.palette, state.smoothedBlobs, computeYarnDisplayHexes());
  }
}

// ---------- shopping list ----------
export function updateShoppingList() {
  if (!state.palette) return;
  // yarn-colour preview only makes sense with Advanced on and a line active —
  // hide and force it off otherwise, so a stale check can't linger unseen
  var showPreview = state.advanced && !!activeLine;
  els.yarnPreviewField.classList.toggle('hidden', !showPreview);
  if (!showPreview) els.yarnPreviewChk.checked = false;

  var matW = parseFloat(els.matW.value) || 0;
  var matH = parseFloat(els.matH.value) || 0;
  var density = parseFloat(els.density.value) || 0;
  var strands = Math.max(1, parseInt(els.strands.value, 10) || 1);
  var bufferPct = parseFloat(els.buffer.value) || 0;
  var areaM2 = (matW / 100) * (matH / 100);
  var effectiveDensity = density * strands;
  var totalG = areaM2 * effectiveDensity * (1 + bufferPct / 100);

  els.matWVal.textContent = matW; els.matHVal.textContent = matH; els.densityVal.textContent = density; els.strandsVal.textContent = strands; els.bufferVal.textContent = bufferPct;
  updateRoundHint(); updateBorderHint();

  els.shopMeta.innerHTML = 'Grid <b>' + state.gridCols + ' × ' + state.gridRows + '</b> (' + state.totalCells + ' cells) &nbsp;·&nbsp; Mat <b>' +
    matW + ' × ' + matH + ' cm</b> (' + areaM2.toFixed(2) + ' m²) &nbsp;·&nbsp; Density <b>' + density + ' g/m²</b> × <b>' + strands + '</b> strand' + (strands === 1 ? '' : 's') +
    ' = <b>' + effectiveDensity + ' g/m²</b> effective &nbsp;·&nbsp; +<b>' + bufferPct + '%</b> buffer';

  var rows = '';
  var textLines = [];
  textLines.push('TUFT PATTERN SHOPPING LIST');
  textLines.push('Grid: ' + state.gridCols + ' x ' + state.gridRows + ' cells (' + state.totalCells + ' total)');
  textLines.push('Mat: ' + matW + ' x ' + matH + ' cm  (' + areaM2.toFixed(2) + ' m^2)  |  Density: ' + density + ' g/m^2 x ' + strands + ' strand(s) = ' + effectiveDensity + ' g/m^2  |  +' + bufferPct + '% waste buffer');
  textLines.push('');

  // first pass: match each palette colour to a yarn and pool grams per yarn —
  // two pattern colours can map to the same cone, and cones must be counted
  // on the pooled total, not per row
  var matches = null, buy = null, borderMatch = null;
  if (activeLine) {
    // cleanup can empty a palette entry entirely — skip those everywhere
    matches = state.palette.map(function (p, i) { return p.count ? matchYarn(p.rgb, i) : null; });
    buy = {};
    state.palette.forEach(function (p, i) {
      if (!p.count) return;
      var name = matches[i].yarn.name;
      var grams = totalG * (p.count / state.totalCells);
      if (!buy[name]) buy[name] = { yarn: matches[i].yarn, grams: 0, manual: false };
      buy[name].grams += grams;
      if (matches[i].manual) buy[name].manual = true;
    });
    // the border is its own colour row but pools into an existing yarn's
    // buy line if the nearest match happens to coincide with a pattern
    // colour's — matched auto-only, no per-row override (deliberate scope limit)
    if (state.border) {
      borderMatch = matchYarn(hexToRgb(state.border.hex));
      var bName = borderMatch.yarn.name;
      var bGrams = totalG * (state.border.cells / state.totalCells);
      if (!buy[bName]) buy[bName] = { yarn: borderMatch.yarn, grams: 0, manual: false };
      buy[bName].grams += bGrams;
    }
    Object.keys(buy).forEach(function (name) {
      buy[name].cones = activeLine.coneGrams ? Math.max(1, Math.ceil(buy[name].grams / activeLine.coneGrams)) : null;
      buy[name].price = buy[name].yarn.price;
    });
  }

  els.shopHead.innerHTML = '<th>No.</th><th>Colour</th><th class="num">Cells</th><th class="num">Share</th><th class="num">Yarn</th>' +
    (activeLine ? '<th>Buy</th>' : '');
  els.shopTotalLabel.colSpan = activeLine ? 5 : 4;

  state.palette.forEach(function (p, i) {
    if (!p.count) return;
    var pct = (p.count / state.totalCells) * 100;
    var grams = Math.round(totalG * (pct / 100));
    var buyCell = '';
    var buyText = '';
    if (activeLine) {
      var m = matches[i];
      var rough = m.deltaE > 22; // beyond ~22 ΔE the substitute visibly shifts the design
      var warnSpan = rough ? ' <span style="color:var(--warn)" title="No close match in this range — nearest is noticeably different">≉</span>' : '';
      if (state.advanced) {
        buyCell = '<td><div class="swatchcell"><span class="swatch" style="background:' + m.yarn.hex + '"></span>' +
          buildYarnPickSelect(p, i) + warnSpan + '</div></td>';
      } else {
        buyCell = '<td><div class="swatchcell"><span class="swatch" style="background:' + m.yarn.hex + '"></span><span>' +
          escapeHtml(m.yarn.name) + (m.yarn.code ? ' <span class="hex">' + escapeHtml(m.yarn.code) + '</span>' : '') +
          warnSpan + '</span></div></td>';
      }
      buyText = '   -> ' + m.yarn.name + (m.manual ? ' (manual)' : '') + (rough ? ' (poor match)' : '');
    }
    rows += '<tr>' +
      '<td><span class="letter">' + p.label + '</span></td>' +
      '<td><div class="swatchcell"><span class="swatch" style="background:' + p.hex + '"></span><span class="hex">' + p.hex + '</span></div></td>' +
      '<td class="num">' + p.count + '</td>' +
      '<td class="num">' + pct.toFixed(1) + '%</td>' +
      '<td class="num">~' + grams + 'g</td>' +
      buyCell +
      '</tr>';
    textLines.push(p.label + '  ' + p.hex + '   ' + p.count + ' cells   ' + pct.toFixed(1) + '%   ~' + grams + 'g' + buyText);
  });

  if (state.border) {
    var bPct = (state.border.cells / state.totalCells) * 100;
    var bGrams = Math.round(totalG * (bPct / 100));
    var bBuyCell = '', bBuyText = '';
    if (activeLine && borderMatch) {
      var bRough = borderMatch.deltaE > 22;
      var bWarnSpan = bRough ? ' <span style="color:var(--warn)" title="No close match in this range — nearest is noticeably different">≉</span>' : '';
      bBuyCell = '<td><div class="swatchcell"><span class="swatch" style="background:' + borderMatch.yarn.hex + '"></span><span>' +
        escapeHtml(borderMatch.yarn.name) + (borderMatch.yarn.code ? ' <span class="hex">' + escapeHtml(borderMatch.yarn.code) + '</span>' : '') +
        bWarnSpan + '</span></div></td>';
      bBuyText = '   -> ' + borderMatch.yarn.name + (bRough ? ' (poor match)' : '');
    }
    rows += '<tr>' +
      '<td><span class="letter">' + (state.palette.length + 1) + '</span></td>' +
      '<td><div class="swatchcell"><span class="swatch" style="background:' + state.border.hex + '"></span><span class="hex">Border · ' + state.border.hex + '</span></div></td>' +
      '<td class="num">' + state.border.cells + '</td>' +
      '<td class="num">' + bPct.toFixed(1) + '%</td>' +
      '<td class="num">~' + bGrams + 'g</td>' +
      bBuyCell +
      '</tr>';
    textLines.push('Border  ' + state.border.hex + '   ' + state.border.cells + ' cells   ' + bPct.toFixed(1) + '%   ~' + bGrams + 'g' + bBuyText);
  }
  els.shopBody.innerHTML = rows;

  var totalLabel = '~' + Math.round(totalG) + 'g';
  if (activeLine) {
    var totalCones = 0, totalPrice = 0, allPriced = true;
    Object.keys(buy).forEach(function (name) {
      var b = buy[name];
      if (!b.cones) { allPriced = false; return; }
      totalCones += b.cones;
      if (b.price != null) totalPrice += b.cones * b.price; else allPriced = false;
    });
    if (totalCones) totalLabel += ' · ' + totalCones + ' ' + activeLine.unit + (totalCones === 1 ? '' : 's') + (allPriced ? ' ≈ ' + formatPrice(totalPrice, activeLine.currency) : '');
    textLines.push('');
    textLines.push('BUY — ' + activeLine.brand + ' / ' + activeLine.line + ' (' + activeLine.url + ')');
    Object.keys(buy).forEach(function (name) {
      var b = buy[name];
      textLines.push('  ' + name + (b.manual ? ' (manual)' : '') + (b.yarn.code ? ' [' + b.yarn.code + ']' : '') + '  ' + b.yarn.hex + '   ~' + Math.round(b.grams) + 'g' +
        (b.cones ? '   ' + b.cones + ' x ' + activeLine.coneGrams + 'g ' + activeLine.unit + (b.cones === 1 ? '' : 's') : '') +
        (b.price != null && b.cones ? '   ' + formatPrice(b.cones * b.price, activeLine.currency) : ''));
    });
  }
  els.shopTotal.textContent = totalLabel;
  textLines.push('');
  textLines.push('TOTAL: ~' + Math.round(totalG) + 'g');
  els.shopText.value = textLines.join('\n');
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export function formatPrice(v, currency) {
  var sym = { USD: '$', EUR: '€', GBP: '£' }[currency] || (currency + ' ');
  return sym + v.toFixed(2);
}
