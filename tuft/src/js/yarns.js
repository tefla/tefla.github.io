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

// ---------- multi-source buying (optional mode) ----------
// every brand+line is a "supplier" candidate, keyed the same way as the
// single-brand select ('bi:li'); region is a country shortcut over the
// same checklist, not a separate filter the user can't override per-row
function supplierEntries() {
  var list = [];
  (YARN_DATA.brands || []).forEach(function (brand, bi) {
    (brand.lines || []).forEach(function (line, li) {
      list.push({ key: bi + ':' + li, brand: brand.brand, line: line.line,
        country: brand.country || '?', currency: brand.currency, count: line.colors.length });
    });
  });
  return list;
}

export function populateMsRegion() {
  var countries = {};
  supplierEntries().forEach(function (s) { countries[s.country] = true; });
  var html = '<option value="All">All</option>';
  Object.keys(countries).sort().forEach(function (c) { html += '<option value="' + c + '">' + c + '</option>'; });
  els.msRegion.innerHTML = html;
}

export function populateMsSuppliers() {
  els.msSuppliers.innerHTML = supplierEntries().map(function (s) {
    return '<label class="ms-supplier-row"><input type="checkbox" class="msSupplierChk" data-key="' + s.key +
      '" data-country="' + s.country + '" />' + escapeHtml(s.brand) + ' — ' + escapeHtml(s.line) +
      ' <span class="supplier-tag">[' + s.country + '] · ' + s.count + ' colours</span></label>';
  }).join('');
}

// region change forcibly re-checks the checklist to match; individual rows
// can then be hand-toggled until the next region change (per the issue)
export function applyRegionFilter(region) {
  state.msRegion = region;
  Array.prototype.forEach.call(els.msSuppliers.querySelectorAll('.msSupplierChk'), function (chk) {
    chk.checked = (region === 'All') || (chk.dataset.country === region);
  });
  syncMsAllowedFromCheckboxes();
}

export function syncMsAllowedFromCheckboxes() {
  state.msAllowed = Array.prototype.map.call(
    els.msSuppliers.querySelectorAll('.msSupplierChk:checked'), function (chk) { return chk.dataset.key; });
  updateShoppingList();
}

// used by restoreSettings: apply a saved key list directly, bypassing the
// region-driven bulk-check (a restored selection may span several regions
// if the user hand-toggled after filtering)
export function setMsCheckboxesFromKeys(keys) {
  var allowed = {};
  (keys || []).forEach(function (k) { allowed[k] = true; });
  Array.prototype.forEach.call(els.msSuppliers.querySelectorAll('.msSupplierChk'), function (chk) {
    chk.checked = !!allowed[chk.dataset.key];
  });
  state.msAllowed = (keys || []).slice();
}

export function setActiveLine(value) {
  if (!value) { activeLine = null; return; }
  var parts = value.split(':');
  var brand = YARN_DATA.brands[+parts[0]], line = brand.lines[+parts[1]];
  activeLine = {
    brand: brand.brand, url: brand.url, currency: brand.currency,
    searchUrl: brand.searchUrl || null,
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

// multi-source: a flat pool of every colour across every allowed supplier
// line, each entry tagged with its own supplier so matches/grouping can
// work across brands with different currencies/cone weights
function buildYarnPool(allowedKeys) {
  var allowed = {};
  (allowedKeys || []).forEach(function (k) { allowed[k] = true; });
  var pool = [];
  (YARN_DATA.brands || []).forEach(function (brand, bi) {
    (brand.lines || []).forEach(function (line, li) {
      var key = bi + ':' + li;
      if (!allowed[key]) return;
      line.colors.forEach(function (c) {
        var price = typeof c.price === 'number' ? c.price : (typeof line.price === 'number' ? line.price : null);
        pool.push({
          key: key, brand: brand.brand, line: line.line, url: brand.url, currency: brand.currency,
          coneGrams: line.coneGrams, unit: line.unit || 'cone',
          name: c.name, code: c.code || null, hex: c.hex, price: price, lab: rgbToLab(hexToRgb(c.hex))
        });
      });
    });
  });
  return pool;
}

// supplier-aware override: {key: 'bi:li', name} identifies both the
// supplier line and the colour within it (names collide across suppliers)
function matchYarnMulti(rgb, paletteIdx, pool) {
  var lab = rgbToLab(rgb);
  if (state.advanced && paletteIdx != null) {
    var ov = state.msOverrides[paletteIdx];
    if (ov) {
      for (var i = 0; i < pool.length; i++) {
        if (pool[i].key === ov.key && pool[i].name === ov.name) {
          return { yarn: pool[i], deltaE: deltaE(lab, pool[i].lab), manual: true };
        }
      }
    }
  }
  var best = null, bestD = Infinity;
  pool.forEach(function (c) {
    var d = deltaE(lab, c.lab);
    if (d < bestD) { bestD = d; best = c; }
  });
  return { yarn: best, deltaE: bestD };
}

// multi-source per-row select: same shape as buildYarnPickSelect but the
// candidate list spans the whole pool and each option is labelled with its
// supplier; option values pack key+name behind a control character (\x1f)
// since colour names collide across suppliers and can contain any text
export var MS_SEP = '\x1f';
function buildYarnPickSelectMulti(p, paletteIdx, pool) {
  var lab = rgbToLab(p.rgb);
  var opts = pool.map(function (c) { return { key: c.key, brand: c.brand, name: c.name, code: c.code, d: deltaE(lab, c.lab) }; })
    .sort(function (a, b) { return a.d - b.d; });
  var ov = state.msOverrides[paletteIdx];
  var ovValue = ov ? ov.key + MS_SEP + ov.name : '';
  var html = '<select class="yarnPick msYarnPick" data-idx="' + paletteIdx + '">' +
    '<option value=""' + (ovValue === '' ? ' selected' : '') + '>auto — ' + escapeHtml(opts[0].brand) + ' · ' + escapeHtml(opts[0].name) + '</option>';
  opts.forEach(function (o) {
    var value = o.key + MS_SEP + o.name;
    html += '<option value="' + escapeHtml(value) + '"' + (ovValue === value ? ' selected' : '') + '>' +
      escapeHtml(o.brand) + ' · ' + escapeHtml(o.name) + (o.code ? ' [' + escapeHtml(o.code) + ']' : '') + ' · ΔE ' + Math.round(o.d) + '</option>';
  });
  return html + '</select>';
}

// pools grams for one matched multi-source colour into its supplier's buy
// group, keyed by supplier line then by yarn name (mirrors the single-mode
// pooling in updateShoppingList, one level deeper)
function addToMultiBuy(buyMulti, match, grams) {
  var key = match.yarn.key;
  if (!buyMulti[key]) {
    buyMulti[key] = { brand: match.yarn.brand, line: match.yarn.line, url: match.yarn.url,
      currency: match.yarn.currency, coneGrams: match.yarn.coneGrams, unit: match.yarn.unit, items: {} };
  }
  var items = buyMulti[key].items;
  if (!items[match.yarn.name]) items[match.yarn.name] = { yarn: match.yarn, grams: 0, manual: false };
  items[match.yarn.name].grams += grams;
  if (match.manual) items[match.yarn.name].manual = true;
}

// palette-indexed matched-yarn hex per colour (override-aware), for the
// yarn-colour preview checkbox and the export-in-yarn-colours option; in
// multi-source mode it matches against the pooled suppliers instead
export function computeYarnDisplayHexes() {
  if (!state.palette) return null;
  if (state.multiSource && state.msAllowed && state.msAllowed.length > 0) {
    var pool = buildYarnPool(state.msAllowed);
    if (!pool.length) return null;
    return state.palette.map(function (p, i) { return p.count ? matchYarnMulti(p.rgb, i, pool).yarn.hex : p.hex; });
  }
  if (!activeLine) return null;
  return state.palette.map(function (p, i) { return p.count ? matchYarn(p.rgb, i).yarn.hex : p.hex; });
}

// nearest-yarn hex for a single colour (no override), across whichever
// matching mode is active — used to recolour the border in yarn-colour
// renders/exports. Returns null when no yarn source is selected.
export function matchAnyYarnHex(rgb) {
  if (state.multiSource && state.msAllowed && state.msAllowed.length > 0) {
    var pool = buildYarnPool(state.msAllowed);
    if (pool.length) return matchYarnMulti(rgb, null, pool).yarn.hex;
  }
  if (activeLine) return matchYarn(rgb).yarn.hex;
  return null;
}

export function repaintColourIfPreviewing() {
  if (els.yarnPreviewChk.checked && state.grid) {
    renderColour(state.gridCols, state.gridRows, state.grid, state.palette, state.smoothedBlobs, computeYarnDisplayHexes());
  }
}

// ---------- buy links ----------
// deep-link a colour into the shop's search where the shop supports it
// (searchUrl template with {q}); otherwise fall back to the shop front page
function yarnFindUrl(searchUrl, shopUrl, yarn) {
  if (!searchUrl) return shopUrl;
  return searchUrl.replace('{q}', encodeURIComponent(yarn.name + (yarn.code ? ' ' + yarn.code : '')));
}

// clickable per-supplier buy list under the table; groups = null clears it
function renderBuyLinks(groups) {
  if (!groups || !groups.length) { els.buyLinks.innerHTML = ''; return; }
  els.buyLinks.innerHTML = groups.map(function (g) {
    var head = '<div class="buy-group-head"><strong>' + escapeHtml(g.brand) + ' — ' + escapeHtml(g.line) + '</strong>' +
      '<a href="' + escapeHtml(g.url) + '" target="_blank" rel="noopener">Open shop ↗</a></div>';
    var rows = g.items.map(function (b) {
      var qty = '~' + Math.round(b.grams) + 'g' +
        (b.cones ? ' · ' + b.cones + ' × ' + g.coneGrams + 'g ' + g.unit + (b.cones === 1 ? '' : 's') : '');
      var price = (b.price != null && b.cones) ? ' · ' + formatPrice(b.cones * b.price, g.currency) : '';
      return '<li><span class="swatch" style="background:' + b.yarn.hex + '"></span>' +
        '<a href="' + escapeHtml(yarnFindUrl(g.searchUrl, g.url, b.yarn)) + '" target="_blank" rel="noopener">' +
        escapeHtml(b.yarn.name) + (b.yarn.code ? ' [' + escapeHtml(b.yarn.code) + ']' : '') + ' ↗</a>' +
        '<span class="buy-qty">' + qty + price + (b.manual ? ' · manual' : '') + '</span></li>';
    }).join('');
    var sub = g.subtotal ? '<div class="buy-subtotal">Subtotal ≈ ' + g.subtotal + '</div>' : '';
    return '<div class="buy-group">' + head + '<ul>' + rows + '</ul>' + sub + '</div>';
  }).join('');
}

// ---------- shopping list ----------
export function updateShoppingList() {
  if (!state.palette) return;
  // multi-source is an alternate matching path over the SAME palette/mat
  // maths below; when it's off (the default) every line here behaves
  // exactly as before — activeLine/matchYarn/buildYarnPickSelect untouched
  var multi = state.multiSource && state.msAllowed && state.msAllowed.length > 0;
  var pool = multi ? buildYarnPool(state.msAllowed) : null;

  // yarn-colour preview only makes sense with Advanced on, a line active,
  // and single-supplier mode — hide and force it off otherwise, so a stale
  // check can't linger unseen
  var showPreview = state.advanced && !!activeLine && !state.multiSource;
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
  var matches = null, buy = null, borderMatch = null, buyMulti = null;
  if (multi) {
    matches = state.palette.map(function (p, i) { return p.count ? matchYarnMulti(p.rgb, i, pool) : null; });
    buyMulti = {};
    state.palette.forEach(function (p, i) {
      if (!p.count) return;
      addToMultiBuy(buyMulti, matches[i], totalG * (p.count / state.totalCells));
    });
    if (state.border) {
      borderMatch = matchYarnMulti(hexToRgb(state.border.hex), null, pool);
      addToMultiBuy(buyMulti, borderMatch, totalG * (state.border.cells / state.totalCells));
    }
  } else if (activeLine) {
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
    (multi ? '<th>Supplier</th><th>Buy</th>' : (activeLine ? '<th>Buy</th>' : ''));
  els.shopTotalLabel.colSpan = multi ? 6 : (activeLine ? 5 : 4);

  state.palette.forEach(function (p, i) {
    if (!p.count) return;
    var pct = (p.count / state.totalCells) * 100;
    var grams = Math.round(totalG * (pct / 100));
    var supplierCell = '';
    var buyCell = '';
    var buyText = '';
    if (multi) {
      var mm = matches[i];
      var mrough = mm.deltaE > 22; // beyond ~22 ΔE the substitute visibly shifts the design
      var mwarnSpan = mrough ? ' <span style="color:var(--warn)" title="No close match in this range — nearest is noticeably different">≉</span>' : '';
      supplierCell = '<td><span class="supplier-tag">' + escapeHtml(mm.yarn.brand) + '</span></td>';
      if (state.advanced) {
        buyCell = '<td><div class="swatchcell"><span class="swatch" style="background:' + mm.yarn.hex + '"></span>' +
          buildYarnPickSelectMulti(p, i, pool) + mwarnSpan + '</div></td>';
      } else {
        buyCell = '<td><div class="swatchcell"><span class="swatch" style="background:' + mm.yarn.hex + '"></span><span>' +
          escapeHtml(mm.yarn.name) + (mm.yarn.code ? ' <span class="hex">' + escapeHtml(mm.yarn.code) + '</span>' : '') +
          mwarnSpan + '</span></div></td>';
      }
      buyText = '   -> ' + mm.yarn.brand + ' / ' + mm.yarn.name + (mm.manual ? ' (manual)' : '') + (mrough ? ' (poor match)' : '');
    } else if (activeLine) {
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
      supplierCell +
      buyCell +
      '</tr>';
    textLines.push(p.label + '  ' + p.hex + '   ' + p.count + ' cells   ' + pct.toFixed(1) + '%   ~' + grams + 'g' + buyText);
  });

  if (state.border) {
    var bPct = (state.border.cells / state.totalCells) * 100;
    var bGrams = Math.round(totalG * (bPct / 100));
    var bSupplierCell = '', bBuyCell = '', bBuyText = '';
    if (multi && borderMatch) {
      var mbRough = borderMatch.deltaE > 22;
      var mbWarnSpan = mbRough ? ' <span style="color:var(--warn)" title="No close match in this range — nearest is noticeably different">≉</span>' : '';
      bSupplierCell = '<td><span class="supplier-tag">' + escapeHtml(borderMatch.yarn.brand) + '</span></td>';
      bBuyCell = '<td><div class="swatchcell"><span class="swatch" style="background:' + borderMatch.yarn.hex + '"></span><span>' +
        escapeHtml(borderMatch.yarn.name) + (borderMatch.yarn.code ? ' <span class="hex">' + escapeHtml(borderMatch.yarn.code) + '</span>' : '') +
        mbWarnSpan + '</span></div></td>';
      bBuyText = '   -> ' + borderMatch.yarn.brand + ' / ' + borderMatch.yarn.name + (mbRough ? ' (poor match)' : '');
    } else if (activeLine && borderMatch) {
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
      bSupplierCell +
      bBuyCell +
      '</tr>';
    textLines.push('Border  ' + state.border.hex + '   ' + state.border.cells + ' cells   ' + bPct.toFixed(1) + '%   ~' + bGrams + 'g' + bBuyText);
  }
  els.shopBody.innerHTML = rows;

  var totalLabel = '~' + Math.round(totalG) + 'g';
  if (multi) {
    // per-supplier cones/price, then grand totals PER CURRENCY — no
    // cross-currency conversion, so £/€/$ subtotals never get summed together
    var currencyTotals = {}; // currency -> { price, complete }
    var supplierKeys = Object.keys(buyMulti);
    supplierKeys.forEach(function (key) {
      var sup = buyMulti[key];
      var supCones = 0, supPrice = 0, supAllPriced = true;
      Object.keys(sup.items).forEach(function (name) {
        var b = sup.items[name];
        b.cones = sup.coneGrams ? Math.max(1, Math.ceil(b.grams / sup.coneGrams)) : null;
        b.price = b.yarn.price;
        if (!b.cones) { supAllPriced = false; return; }
        supCones += b.cones;
        if (b.price != null) supPrice += b.cones * b.price; else supAllPriced = false;
      });
      sup.cones = supCones; sup.price = supPrice; sup.allPriced = supAllPriced;
      if (!currencyTotals[sup.currency]) currencyTotals[sup.currency] = { price: 0, complete: true };
      if (supAllPriced) currencyTotals[sup.currency].price += supPrice; else currencyTotals[sup.currency].complete = false;
    });
    var currencyParts = Object.keys(currencyTotals).sort().map(function (cur) {
      var ct = currencyTotals[cur];
      return '≈ ' + formatPrice(ct.price, cur) + (ct.complete ? '' : '*');
    });
    if (currencyParts.length) totalLabel += ' · ' + currencyParts.join(' + ');
    textLines.push('');
    supplierKeys.forEach(function (key) {
      var sup = buyMulti[key];
      textLines.push('BUY — ' + sup.brand + ' / ' + sup.line + ' (' + sup.url + ')');
      Object.keys(sup.items).forEach(function (name) {
        var b = sup.items[name];
        textLines.push('  ' + name + (b.manual ? ' (manual)' : '') + (b.yarn.code ? ' [' + b.yarn.code + ']' : '') + '  ' + b.yarn.hex + '   ~' + Math.round(b.grams) + 'g' +
          (b.cones ? '   ' + b.cones + ' x ' + sup.coneGrams + 'g ' + sup.unit + (b.cones === 1 ? '' : 's') : '') +
          (b.price != null && b.cones ? '   ' + formatPrice(b.cones * b.price, sup.currency) : ''));
      });
      textLines.push('  Subtotal: ' + (sup.allPriced ? formatPrice(sup.price, sup.currency) : '(incomplete pricing)'));
    });
    renderBuyLinks(supplierKeys.map(function (key) {
      var sup = buyMulti[key];
      var srcBrand = YARN_DATA.brands[+key.split(':')[0]];
      return {
        brand: sup.brand, line: sup.line, url: sup.url, searchUrl: srcBrand.searchUrl || null,
        currency: sup.currency, coneGrams: sup.coneGrams, unit: sup.unit,
        items: Object.keys(sup.items).map(function (n) { return sup.items[n]; }),
        subtotal: sup.allPriced ? formatPrice(sup.price, sup.currency) : null
      };
    }));
  } else if (activeLine) {
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
    renderBuyLinks([{
      brand: activeLine.brand, line: activeLine.line, url: activeLine.url, searchUrl: activeLine.searchUrl,
      currency: activeLine.currency, coneGrams: activeLine.coneGrams, unit: activeLine.unit,
      items: Object.keys(buy).map(function (n) { return buy[n]; }),
      subtotal: totalCones && allPriced ? formatPrice(totalPrice, activeLine.currency) : null
    }]);
  } else {
    renderBuyLinks(null);
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
