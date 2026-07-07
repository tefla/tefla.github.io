// shared singletons — els (populated by initEls at startup), the mutable app
// state object, the full-crop constant, and the element-id list they derive from
export const els = {};

export const EL_IDS = ['dropzone','fileInput','thumb','dzTitle','dzSub',
 'detailSize','detailVal','kColors','kVal','lineThickness','lineThickVal',
 'autoBtn','matW','matH','matWVal','matHVal','matLock','matLockHint','density','densityVal','strands','strandsVal','buffer','bufferVal',
 'roundPct','roundVal','roundHint','borderPct','borderVal','borderHint','borderColor','borderColorField',
 'colourCanvas','colourFrame','colourPlaceholder','bwCanvas','bwFrame','bwPlaceholder',
 'dlColourPng','dlColourSvg','dlBwPng','shopMeta','shopBody','shopTotal',
 'cropWrap','cropCanvas','cropDims','resetCropBtn','cropAspect',
 'shopHead','shopTotalLabel','yarnBrand','yarnBrandHint','yarnBrandField',
 'copyBtn','copyStatus','shopText',
 'advField','advToggle','advBody','advBoundaries','advResetBtn',
 'yarnPreviewField','yarnPreviewChk','exportYarnHex','exportMirror',
 'multiSource','msGroup','msRegion','msSuppliers','includeMulti',
 'buyLinks','prefsSaveBtn','prefsClearBtn','prefsMsg',
 'yarnPicker','pickerTitle','pickerClose','pickerFilter','pickerGrid','pickerEmpty',
 'paletteStrip'];

// populate els from the DOM — called once at startup, before init() wires
// listeners, so every els.X reference downstream is live
export function initEls() {
  EL_IDS.forEach(function (id) { els[id] = document.getElementById(id); });
}

export const FULL_CROP = { x: 0, y: 0, w: 1, h: 1 };

export const state = {
  img: null, gridCols: 8, gridRows: 8, palette: null, grid: null, smoothedBlobs: null, counts: null, totalCells: 0, cropRect: FULL_CROP,
  advanced: false, weights: null, yarnOverrides: {}, advRowsK: 0,
  // pinned palette colours: {rawCentroidIdx: [r,g,b]} fixed centroids that
  // k-means seeds but never moves; eyedropOrig arms the pick-from-image mode.
  // eyedropAdd arms "+ Add colour" (next image click adds a pinned slot).
  // mergeGroups: [[rgb,rgb,…],…] — colours the user declared "one"; on every
  // relabel, clusters within ΔE of a group collapse into it (survives reprocess,
  // unlike a raw-index map). mergeSource holds the display slot awaiting a target.
  pins: {}, eyedropOrig: null, eyedropAdd: false, mergeGroups: [], mergeSource: null,
  roundPct: 0, borderPct: 0, borderHex: '#222222', border: null,
  lineThickness: 0, lineArt: null,
  // multi-source buying: optional mode, off by default — see setActiveLine/matchYarn
  multiSource: false, msRegion: 'All', msAllowed: [], msOverrides: {},
  // variegated/multicolour yarns are excluded from auto-matching unless this is on
  // (manual overrides can always pick them) — see autoCandidates in yarns.js
  includeMulti: false
};
