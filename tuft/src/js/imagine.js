// ---------- Imagine: generate design candidates in-app via OpenRouter ----------
// The browser calls OpenRouter directly with the user's own key (pasted once,
// kept in localStorage) — no server, works from the published page anywhere.
// Each candidate is pushed through the real quantise pipeline and previewed
// as a mini tufting chart (imagine-chart.js); tapping one adopts it as the
// working image through the same loadFile seam the file input uses.
//
// initImagine(seam) is called from app.js init(); seam = { loadFile,
// onKeyChange } — onKeyChange fires when the user edits the API key, so the
// cloud layer can sync it to their account.
import { tuftPresets, colourOptions, DEFAULT_COLOURS, getPreset, getColourOption } from './imagine-presets.js';
import { renderMiniChart } from './imagine-chart.js';

var API_URL = 'https://openrouter.ai/api/v1/images';
var KEY_STORE = 'tuft-openrouter-key';
var SPEND_STORE = 'tuft-imagine-spend';
var OPTS_STORE = 'tuft-imagine-opts-v1';

var MODELS = [
  { id: 'black-forest-labs/flux.2-klein-4b', label: 'Flux Klein — fast & cheapest' },
  { id: 'black-forest-labs/flux.2-pro', label: 'Flux Pro — stronger, dearer' },
  { id: 'google/gemini-3.1-flash-image', label: 'Gemini Flash Image' },
  { id: 'google/gemini-3-pro-image', label: 'Gemini Pro Image' },
];

// mirrors the sweep rig: only these families accept output_format
function supportsOutputFormat(model) {
  return model.indexOf('black-forest-labs/') === 0 || model.indexOf('sourceful/') === 0;
}

// device-local key store, also driven by the cloud sync (cloud.js) — the
// setter updates the visible field so a pulled key appears in place
var keyElRef = null;
export function getOpenRouterKey() {
  return (localStorage.getItem(KEY_STORE) || '').trim();
}
export function setOpenRouterKey(key) {
  localStorage.setItem(KEY_STORE, key);
  if (keyElRef) keyElRef.value = key;
}

export function initImagine(seam) {
  var $ = function (id) { return document.getElementById(id); };
  var subjectEl = $('imgSubject'), presetEl = $('imgPreset'), presetHint = $('imgPresetHint'),
      coloursEl = $('imgColours'), countEl = $('imgCount'), modelEl = $('imgModel'),
      promptEl = $('imgPrompt'), promptReset = $('imgPromptReset'), keyEl = $('imgKey'),
      goBtn = $('imgGoBtn'), statusEl = $('imgStatus'), grid = $('imgGrid'),
      viewToggle = $('imgViewToggle'), spendEl = $('imgSpend');

  var promptDirty = false;

  // ---------- options: populate + persist ----------
  tuftPresets.forEach(function (p) {
    var o = document.createElement('option');
    o.value = p.id; o.textContent = p.label;
    presetEl.appendChild(o);
  });
  colourOptions.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c.id; o.textContent = c.label;
    coloursEl.appendChild(o);
  });
  MODELS.forEach(function (m) {
    var o = document.createElement('option');
    o.value = m.id; o.textContent = m.label;
    modelEl.appendChild(o);
  });
  coloursEl.value = DEFAULT_COLOURS;

  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(OPTS_STORE) || '{}'); } catch (e) { /* corrupt — defaults */ }
  ['preset', 'colours', 'count', 'model'].forEach(function (k, i) {
    var el = [presetEl, coloursEl, countEl, modelEl][i];
    if (saved[k] && Array.prototype.some.call(el.options, function (o) { return o.value === saved[k]; })) el.value = saved[k];
    el.addEventListener('change', function () {
      saved[k] = el.value;
      localStorage.setItem(OPTS_STORE, JSON.stringify(saved));
    });
  });
  keyElRef = keyEl;
  keyEl.value = localStorage.getItem(KEY_STORE) || '';
  keyEl.addEventListener('change', function () {
    localStorage.setItem(KEY_STORE, keyEl.value.trim());
    if (seam.onKeyChange) seam.onKeyChange(keyEl.value.trim());
  });

  // ---------- prompt assembly (auto until hand-edited) ----------
  function scaffoldPrompt() {
    var subject = subjectEl.value.trim() || 'a friendly sun with a smiling face';
    return getPreset(presetEl.value).build(subject, getColourOption(coloursEl.value));
  }
  function syncPrompt() {
    presetHint.textContent = getPreset(presetEl.value).hint;
    if (!promptDirty) promptEl.value = scaffoldPrompt();
  }
  [subjectEl, presetEl, coloursEl].forEach(function (el) {
    el.addEventListener('input', syncPrompt);
    el.addEventListener('change', syncPrompt);
  });
  promptEl.addEventListener('input', function () {
    promptDirty = promptEl.value !== scaffoldPrompt();
    promptReset.classList.toggle('hidden', !promptDirty);
  });
  promptReset.addEventListener('click', function () {
    promptDirty = false;
    promptReset.classList.add('hidden');
    syncPrompt();
  });
  syncPrompt();

  // ---------- spend ticker ----------
  function showSpend() {
    var total = parseFloat(localStorage.getItem(SPEND_STORE) || '0');
    spendEl.textContent = total > 0 ? '$' + total.toFixed(3) + ' spent all-time' : '';
  }
  function addSpend(cost) {
    if (typeof cost !== 'number') return;
    var total = parseFloat(localStorage.getItem(SPEND_STORE) || '0') + cost;
    localStorage.setItem(SPEND_STORE, String(total));
    showSpend();
  }
  showSpend();

  function status(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle('err', !!isError);
    statusEl.classList.toggle('hidden', !text);
  }

  // ---------- chart / AI image toggle ----------
  var imgView = 'chart';
  Array.prototype.forEach.call(viewToggle.querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () {
      imgView = b.dataset.imgview;
      Array.prototype.forEach.call(viewToggle.querySelectorAll('button'), function (x) {
        x.classList.toggle('on', x === b);
      });
      grid.classList.toggle('show-ai', imgView === 'ai');
    });
  });

  // ---------- generation ----------
  function requireKey() {
    var key = keyEl.value.trim();
    if (key) return key;
    var details = keyEl.closest('details');
    if (details) details.open = true;
    keyEl.focus();
    status('Paste your OpenRouter API key first (openrouter.ai/settings/keys)', true);
    return null;
  }

  function generateOne(prompt, card) {
    var model = modelEl.value;
    var body = { model: model, prompt: prompt, n: 1 };
    if (supportsOutputFormat(model)) body.output_format = 'png';
    return fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + keyEl.value.trim(),
        'Content-Type': 'application/json',
        'X-Title': 'Tuft Pattern Maker',
      },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.text().then(function (text) {
        var payload;
        try { payload = JSON.parse(text); } catch (e) {
          throw new Error('OpenRouter returned non-JSON (' + res.status + '): ' + text.slice(0, 200));
        }
        if (!res.ok || payload.error) {
          throw new Error((payload.error && payload.error.message) || ('OpenRouter error ' + res.status));
        }
        var b64 = payload.data && payload.data[0] && payload.data[0].b64_json;
        if (!b64) throw new Error('No image data in response');
        addSpend(payload.usage && payload.usage.cost);
        return {
          b64: b64,
          mediaType: (payload.data[0].media_type || 'image/png'),
          cost: payload.usage && payload.usage.cost,
        };
      });
    }).then(function (result) {
      return fillCard(card, result, prompt);
    }).catch(function (err) {
      card.className = 'imagine-card failed';
      card.textContent = '';
      var msg = document.createElement('span');
      msg.className = 'imagine-err';
      msg.textContent = '✕ ' + err.message + ' — tap to retry';
      card.appendChild(msg);
      card.onclick = function () {
        card.onclick = null;
        card.className = 'imagine-card pending';
        card.textContent = '…';
        generateOne(prompt, card);
      };
    });
  }

  function fillCard(card, result, prompt) {
    var img = new Image();
    return new Promise(function (resolve) {
      img.onload = function () {
        card.className = 'imagine-card';
        card.textContent = '';
        img.className = 'ai';
        card.appendChild(img);
        var chart = document.createElement('canvas');
        chart.className = 'chart';
        var info = renderMiniChart(img, chart);
        card.appendChild(chart);

        var foot = document.createElement('div');
        foot.className = 'imagine-foot';
        var meta = document.createElement('span');
        meta.textContent = info.k + ' colours' +
          (typeof result.cost === 'number' ? ' · $' + result.cost.toFixed(3) : '');
        foot.appendChild(meta);
        card.appendChild(foot);
        var riff = document.createElement('button');
        riff.type = 'button';
        riff.className = 'imagine-riff';
        riff.title = 'Riff — generate variations of this prompt';
        riff.textContent = '↻';
        riff.addEventListener('click', function (e) {
          e.stopPropagation();
          submitBatch(prompt);
        });
        card.appendChild(riff);

        card.addEventListener('click', function () {
          var bytes = atob(result.b64), arr = new Uint8Array(bytes.length);
          for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
          var name = (subjectEl.value.trim() || 'imagined').replace(/[^\w -]+/g, '').slice(0, 40) || 'imagined';
          seam.loadFile(new File([arr], name + '.png', { type: result.mediaType }));
          document.getElementById('imagineOverlay').classList.remove('open', 'full');
        });
        resolve();
      };
      img.src = 'data:' + result.mediaType + ';base64,' + result.b64;
    });
  }

  function submitBatch(prompt) {
    if (!requireKey()) return;
    status('');
    var count = parseInt(countEl.value, 10);
    for (var i = 0; i < count; i++) {
      var card = document.createElement('div');
      card.className = 'imagine-card pending';
      card.textContent = '…';
      grid.insertBefore(card, grid.firstChild);
      generateOne(prompt, card);
    }
    // results are the point now: fold the config away and bring the grid into
    // view — on a phone the form otherwise fills the screen and a fresh batch
    // arrives invisibly below the fold
    var more = document.querySelector('#imagineOverlay details[data-panel="imagineMore"]');
    if (more) more.open = false;
    grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  goBtn.addEventListener('click', function () {
    if (!subjectEl.value.trim() && !promptDirty) {
      subjectEl.focus();
      status('Give it a subject first', true);
      return;
    }
    submitBatch(promptDirty ? promptEl.value : scaffoldPrompt());
  });
  subjectEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') goBtn.click();
  });
}
