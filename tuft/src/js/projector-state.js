// ---------- projector mode: shared state (persisted options + session view) ----------
// popts is persisted per device (localStorage): the projector's physical
// setup — keystone, brightness, orientation — outlives any one design.
// view is session-only: the chart's on-screen box (set by each render) and
// the currently isolated colour.

var KEY = 'tuft-projector-v1';

export var popts = {
  flipH: true, flipV: false, rotate: false,
  numbers: true, marks: true, grid: true, invert: false,
  lineScale: 1, dim: 1,
  keystone: null   // [[nx,ny]×4] viewport-corner destinations in viewport fractions, null = off
};

// rect/pxPerCm/surf are set by every render (surf = the projected surface in
// cm — the mat in single view, the cloth in cloth view). cloth toggles the
// cloth view; single is the frozen snapshot of the current design; selected
// is the cloth item being moved.
export var view = { rect: null, focus: null, pxPerCm: 0, surf: null, cloth: false, single: null, selected: null };

function num(v, lo, hi, dflt) {
  return (typeof v === 'number' && isFinite(v)) ? Math.min(hi, Math.max(lo, v)) : dflt;
}

// merge a stored blob into popts; returns false when nothing was stored yet
// (first run — the caller seeds flipH from the "mirror exports" checkbox)
export function loadOpts() {
  var raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  if (!raw || typeof raw !== 'object') return false;
  popts.flipH = !!raw.flipH;
  popts.flipV = !!raw.flipV;
  popts.rotate = !!raw.rotate;
  popts.numbers = raw.numbers === undefined ? true : !!raw.numbers;
  popts.marks = raw.marks === undefined ? true : !!raw.marks;
  // saves that predate the marks/grid split had one combined toggle
  popts.grid = raw.grid !== undefined ? !!raw.grid : popts.marks;
  popts.invert = !!raw.invert;
  popts.lineScale = num(raw.lineScale, 0.5, 4, 1);
  popts.dim = num(raw.dim, 0.2, 1, 1);
  popts.keystone = (Array.isArray(raw.keystone) && raw.keystone.length === 4) ? raw.keystone : null;
  return true;
}

export function saveOpts() { localStorage.setItem(KEY, JSON.stringify(popts)); }
