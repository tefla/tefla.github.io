// ---------- visual yarn picker (modal) ----------
// A touch-friendly sheet for choosing which yarn fills one palette slot. Opens
// from the matched-yarn swatch button in the shopping table (in ANY mode — no
// Advanced required), lists candidate yarns nearest-ΔE first with real swatch
// photos where we have them, filters by text, and writes the chosen yarn into
// the existing override state via applyPickerChoice. No new persistence model.
import { els } from './state.js';
import { pickerCandidates, applyPickerChoice, swatchBg, escapeHtml, formatPrice } from './yarns.js';

var current = null;   // palette index the sheet is currently editing

function chipHtml(c) {
  // real shop swatch photo (local catalog thumbnail, lazy-loaded) when we have
  // one; otherwise the hex/split colour chip
  var swatch = c.img
    ? '<img class="pick-swatch" loading="lazy" alt="" src="' + escapeHtml(c.img) + '">'
    : '<span class="pick-swatch" style="background:' + swatchBg(c) + '"></span>';
  var meta = [];
  if (c.code) meta.push('<span class="pick-code">' + escapeHtml(c.code) + '</span>');
  if (c.price != null && c.currency) meta.push(formatPrice(c.price, c.currency));
  meta.push('ΔE ' + Math.round(c.deltaE));
  var badge = c.multi ? '<span class="pick-badge">multi</span>' : '';
  var brand = c.brand ? '<span class="pick-brand">' + escapeHtml(c.brand) + '</span>' : '';
  return '<button type="button" class="pick-chip' + (c.selected ? ' selected' : '') +
    '" data-ref="' + escapeHtml(c.ref) + '">' + swatch +
    '<span class="pick-info"><span class="pick-name">' + escapeHtml(c.name) + badge + '</span>' +
    brand + '<span class="pick-meta">' + meta.join(' · ') + '</span></span></button>';
}

function render(filter) {
  var ctx = pickerCandidates(current);
  if (!ctx) { close(); return; }
  var q = (filter || '').trim().toLowerCase();
  var list = q
    ? ctx.list.filter(function (c) {
        return c.name.toLowerCase().indexOf(q) >= 0 ||
          (c.code && String(c.code).toLowerCase().indexOf(q) >= 0);
      })
    : ctx.list;
  // an "Auto (nearest)" chip clears the override
  var autoSelected = !ctx.list.some(function (c) { return c.selected; });
  var auto = '<button type="button" class="pick-chip pick-auto' + (autoSelected ? ' selected' : '') +
    '" data-ref=""><span class="pick-swatch pick-auto-swatch">A</span>' +
    '<span class="pick-info"><span class="pick-name">Auto — nearest match</span></span></button>';
  els.pickerGrid.innerHTML = auto + list.map(chipHtml).join('');
  els.pickerEmpty.classList.toggle('hidden', list.length > 0);
}

export function openPicker(paletteIdx) {
  current = paletteIdx;
  els.pickerFilter.value = '';
  els.pickerTitle.textContent = 'Yarn for colour ' + (paletteIdx + 1);
  render('');
  els.yarnPicker.classList.remove('hidden');
  els.pickerFilter.focus();
}

export function closePicker() { close(); }

function close() {
  current = null;
  els.yarnPicker.classList.add('hidden');
}

export function initPicker() {
  els.pickerFilter.addEventListener('input', function () { render(els.pickerFilter.value); });
  els.pickerClose.addEventListener('click', close);
  els.yarnPicker.addEventListener('click', function (e) {
    if (e.target === els.yarnPicker) close();      // backdrop click
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !els.yarnPicker.classList.contains('hidden')) close();
  });
  els.pickerGrid.addEventListener('click', function (e) {
    var chip = e.target.closest('.pick-chip');
    if (!chip || current == null) return;
    applyPickerChoice(current, chip.dataset.ref || null);
    close();
  });
}
