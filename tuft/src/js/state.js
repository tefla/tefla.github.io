// shared singletons — els (populated by initEls at startup), the mutable app
// state object, the full-crop constant, and the element-id list they derive from
export const els = {};

export const EL_IDS = ['dropzone','fileInput','thumb','dzTitle','dzSub',
 'detailSize','detailVal','kColors','kVal','lineThickness','lineThickVal',
 'autoBtn','matW','matH','matWVal','matHVal','density','densityVal','strands','strandsVal','buffer','bufferVal',
 'roundPct','roundVal','roundHint','borderPct','borderVal','borderHint','borderColor','borderColorField',
 'colourCanvas','colourFrame','colourPlaceholder','bwCanvas','bwFrame','bwPlaceholder',
 'dlColourPng','dlColourSvg','dlBwPng','shopMeta','shopBody','shopTotal',
 'cropWrap','cropCanvas','cropDims','resetCropBtn','cropAspect',
 'shopHead','shopTotalLabel','yarnBrand','yarnBrandHint',
 'copyBtn','copyStatus','shopText',
 'advField','advToggle','advBody','advBoundaries','advResetBtn',
 'yarnPreviewField','yarnPreviewChk'];

// populate els from the DOM — called once at startup, before init() wires
// listeners, so every els.X reference downstream is live
export function initEls() {
  EL_IDS.forEach(function (id) { els[id] = document.getElementById(id); });
}

export const FULL_CROP = { x: 0, y: 0, w: 1, h: 1 };

export const state = {
  img: null, gridCols: 8, gridRows: 8, palette: null, grid: null, smoothedBlobs: null, counts: null, totalCells: 0, cropRect: FULL_CROP,
  advanced: false, weights: null, yarnOverrides: {}, advRowsK: 0,
  roundPct: 0, borderPct: 0, borderHex: '#222222', border: null,
  lineThickness: 0, lineArt: null
};
