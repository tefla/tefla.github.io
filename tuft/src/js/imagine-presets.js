// Tuft-mode prompt scaffolds, ported verbatim from the image-gen-service
// sweep rig (garden/utils/image-gen-service/src/client/presets.ts). These are
// NOT invented — they're the exact prompt structures that produced the
// 333-image ground-truth set (empirically validated: flat fills + thick
// outlines survive the tufting pipeline; texture, gradients, and thin lines
// shatter it). Keep the two copies in sync if either evolves.

export var colourOptions = [
  { id: '2-3', label: '2–3 colours', phrase: '2 to 3', max: 3 },
  { id: '3-5', label: '3–5 colours', phrase: '3 to 5', max: 5 },
  { id: '4-6', label: '4–6 colours', phrase: '4 to 6', max: 6 },
  { id: '6-8', label: '6–8 colours', phrase: '6 to 8', max: 8 },
];

export var DEFAULT_COLOURS = '3-5';

var NEGATIVE_BLOCK =
  'No gradients, no shadows, no highlights, no realistic texture, no hatching, ' +
  'no thin internal strokes, no tiny repeated marks, no hairlines, no small labels, ' +
  'no text, no watermark, no logo, no fabric, no yarn, no rug texture, no drop shadow, ' +
  'no sticker border. If a detail would become a thin line, remove it or turn it into ' +
  'one bold filled shape.';

export var tuftPresets = [
  {
    id: 'folk-patch',
    label: 'Folk-art patch',
    hint: 'Warm rounded folk style — the proven workhorse (300-image batch)',
    build: function (subject, colours) {
      return 'Simple folk-art patch illustration for a tufted rug design. Flat solid colours only, ' +
        'thick black outline, rounded friendly geometry, large closed colour areas, centered ' +
        'single subject on pure white. Use ' + colours.phrase + ' fill colours and keep the design ' +
        'warm, playful, and traceable.\n\n' +
        'Subject: ' + subject + '. ' + NEGATIVE_BLOCK;
    },
  },
  {
    id: 'projector',
    label: 'Projector traceable',
    hint: 'Colouring-book look, maximum-simplicity silhouettes',
    build: function (subject, colours) {
      return 'Projector-traceable flat vector cartoon for a handmade tufting pattern. The image must ' +
        'look like a clean colouring-book design with solid colour fills and thick smooth black ' +
        'outlines. Use large closed regions, simple silhouette, centered subject, plain white ' +
        'background, maximum ' + colours.max + ' fill colours. Make every colour area large enough ' +
        'to cut and tuft. No gradients, no shadows, no highlights, no texture, no hatching, ' +
        'no tiny details, no thin lines, no sticker border, no drop shadow, no yarn, no fabric, ' +
        'no text, no labels, no watermark.\n\n' +
        'Subject: ' + subject + '. Keep the design bold, chunky, and traceable. Do not add extra objects.';
    },
  },
  {
    id: 'sticker',
    label: 'Vector sticker',
    hint: 'Crisp icon/sticker style, higher contrast',
    build: function (subject, colours) {
      return 'Flat vector illustration of ' + subject + ', bold black outlines, limited flat colour palette ' +
        '(' + colours.phrase + ' colours), solid white background, simple bold shapes, sticker/icon ' +
        'style, high contrast, centered single subject, no gradients, no shading, no texture, ' +
        'no photorealism, no background scenery, no text, no watermark, no drop shadow.';
    },
  },
  {
    id: 'mono',
    label: 'Monochrome bold',
    hint: 'Strict black & white — for two-yarn work (palette setting ignored)',
    build: function (subject) {
      return 'Flat vector illustration for a tufted rug design, black and white only, solid fills, ' +
        'thick smooth black outlines, plain white background, centered single subject, ' +
        'colouring-book simplicity, everything bold enough to trace and tuft. No gradients, ' +
        'no shadows, no texture, no hairlines, no text, no watermark.\n\n' +
        'Subject: ' + subject + '.';
    },
  },
  {
    id: 'kawaii',
    label: 'Kawaii chibi',
    hint: 'Oversized head, huge eyes, maximum cute',
    build: function (subject, colours) {
      return 'Kawaii chibi illustration of ' + subject + ': oversized round head, tiny simplified body, ' +
        'huge simple eyes, small dot mouth, flat solid colours, thick black outline, plain white ' +
        'background, centered. Use ' + colours.phrase + ' fill colours.\n\n' + NEGATIVE_BLOCK;
    },
  },
  {
    id: 'scandi',
    label: 'Scandinavian folk',
    hint: 'Symmetric decorative motif with chunky flower/leaf accents',
    build: function (subject, colours) {
      return 'Scandinavian folk-art motif of ' + subject + ': symmetric composition, decorative rounded ' +
        'shapes, flat solid colours, bold dark outline, simple flower and leaf accents drawn as ' +
        'chunky filled shapes, plain white background, centered. ' +
        'Use ' + colours.phrase + ' fill colours.\n\n' + NEGATIVE_BLOCK;
    },
  },
  {
    id: 'midcentury',
    label: 'Mid-century print',
    hint: "Retro 1950s children's-book flat shapes",
    build: function (subject, colours) {
      return 'Mid-century retro print illustration of ' + subject + ': simplified geometric shapes, flat ' +
        'muted colours, bold silhouettes, minimal detail, 1950s children\'s book style, plain ' +
        'white background, centered. Use ' + colours.phrase + ' fill colours.\n\n' + NEGATIVE_BLOCK;
    },
  },
  {
    id: 'bauhaus',
    label: 'Geometric Bauhaus',
    hint: 'Subject built from big circles, triangles, rectangles',
    build: function (subject, colours) {
      return 'Geometric abstraction of ' + subject + ' built from large basic shapes — circles, triangles, ' +
        'rectangles — flat solid colours, bold black outline, Bauhaus poster style, plain white ' +
        'background, centered. Use ' + colours.phrase + ' fill colours.\n\n' + NEGATIVE_BLOCK;
    },
  },
  {
    id: 'popart',
    label: 'Pop-art comic',
    hint: 'Heavy keylines, flat primary colours — NO halftone',
    build: function (subject, colours) {
      return 'Bold pop-art comic illustration of ' + subject + ': heavy black keylines, flat primary ' +
        'colours, simple confident shapes, plain white background, centered. No halftone dots, ' +
        'no screen tone, no speech bubbles. Use ' + colours.phrase + ' fill colours.\n\n' + NEGATIVE_BLOCK;
    },
  },
  {
    id: 'stainedglass',
    label: 'Chunky stained glass',
    hint: 'Few LARGE panes + very thick leading (fine panes killed the sweep)',
    build: function (subject, colours) {
      return 'Simplified stained-glass window design of ' + subject + ': very few LARGE glass panes, each ' +
        'one flat solid colour, separated by very thick black leading lines, plain white ' +
        'background, centered. Maximum ' + colours.max + ' pane colours. Every pane must be large ' +
        'enough to cut and tuft — no small panes.\n\n' + NEGATIVE_BLOCK;
    },
  },
  {
    id: 'tattoo',
    label: 'Tattoo flash',
    hint: 'American-traditional thick lines, flat colour',
    build: function (subject, colours) {
      return 'American traditional tattoo flash of ' + subject + ': very thick black outlines, flat solid ' +
        'colours, bold simple shapes, plain white background, centered, no shading, no stippling, ' +
        'no banner text. Use ' + colours.phrase + ' fill colours.\n\n' + NEGATIVE_BLOCK;
    },
  },
  {
    id: 'matisse',
    label: 'Matisse cut-out',
    hint: 'Organic flat shapes, NO outlines — tests the outline-free path',
    build: function (subject, colours) {
      return 'Matisse-style paper cut-out of ' + subject + ': large organic flat colour shapes with no ' +
        'outlines at all, bold simple silhouette, playful composition, plain white background, ' +
        'centered. Use ' + colours.phrase + ' colours.\n\n' + NEGATIVE_BLOCK;
    },
  },
  {
    id: 'pixel',
    label: 'Chunky pixel art',
    hint: 'Giant pixels ≈ tuftable grid squares',
    build: function (subject, colours) {
      return 'Chunky pixel art of ' + subject + ' made of very large square pixels, as if on a 16 by 16 ' +
        'grid, flat solid colours, plain white background, centered. ' +
        'Use ' + colours.phrase + ' colours.\n\n' + NEGATIVE_BLOCK;
    },
  },
];

export function getPreset(id) {
  return tuftPresets.find(function (p) { return p.id === id; }) || tuftPresets[0];
}

export function getColourOption(id) {
  return colourOptions.find(function (c) { return c.id === id; }) || colourOptions[1];
}
