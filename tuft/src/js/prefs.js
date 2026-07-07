// Per-device preferences: the workshop defaults a user wants every session —
// strands, density, buffer, mat size + ratio lock, yarn brand, multi-source
// suppliers/region, export option. Stored in localStorage (guests included),
// applied at startup before any image is loaded. Pattern-specific state
// (image, crop, colours, weights) belongs to cloud projects, not here.
import { els, state } from './state.js';
import { setMsCheckboxesFromKeys, updateShoppingList } from './yarns.js';

var KEY = 'tuft-prefs-v1';

function collect() {
  return {
    strands: els.strands.value,
    density: els.density.value,
    buffer: els.buffer.value,
    matW: els.matW.value,
    matH: els.matH.value,
    matLock: els.matLock.checked,
    yarnBrand: els.yarnBrand.value,
    exportYarnHex: els.exportYarnHex.checked,
    exportMirror: els.exportMirror.checked,
    multiSource: els.multiSource.checked,
    msRegion: state.msRegion,
    allowedSuppliers: state.msAllowed.slice()
  };
}

// setting values then dispatching the real change/input events reuses the
// app's existing handlers (brand hint, ms group visibility, mat-lock sync)
// instead of duplicating them here
function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }

function apply(p) {
  els.strands.value = p.strands; els.strandsVal.textContent = p.strands;
  els.density.value = p.density; els.densityVal.textContent = p.density;
  els.buffer.value = p.buffer; els.bufferVal.textContent = p.buffer;
  els.matW.value = p.matW; els.matWVal.textContent = p.matW;
  els.matH.value = p.matH; els.matHVal.textContent = p.matH;
  els.exportYarnHex.checked = !!p.exportYarnHex;
  // prefs saved before the option existed keep the mirrored default
  els.exportMirror.checked = p.exportMirror !== undefined ? !!p.exportMirror : true;

  els.yarnBrand.value = p.yarnBrand || '';
  fire(els.yarnBrand, 'change');

  if (p.multiSource) {
    els.multiSource.checked = true;
    fire(els.multiSource, 'change'); // shows the group, checks all suppliers
    els.msRegion.value = p.msRegion || 'All';
    state.msRegion = els.msRegion.value;
    setMsCheckboxesFromKeys(p.allowedSuppliers || []);
    updateShoppingList();
  }

  els.matLock.checked = !!p.matLock;
  fire(els.matLock, 'change');
}

function msg(text) {
  els.prefsMsg.textContent = text;
  els.prefsMsg.classList.toggle('hidden', !text);
  if (text) setTimeout(function () { els.prefsMsg.classList.add('hidden'); }, 2500);
}

export function initPrefs() {
  var raw = localStorage.getItem(KEY);
  if (raw) {
    // a malformed blob must not brick startup — clear it and carry on
    try { apply(JSON.parse(raw)); } catch (e) { localStorage.removeItem(KEY); }
  }

  els.prefsSaveBtn.addEventListener('click', function () {
    localStorage.setItem(KEY, JSON.stringify(collect()));
    msg('Saved — applied every time the app opens.');
  });

  els.prefsClearBtn.addEventListener('click', function () {
    localStorage.removeItem(KEY);
    msg('Cleared — app defaults on next open.');
  });
}
