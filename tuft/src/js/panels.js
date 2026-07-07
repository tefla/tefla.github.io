// Remembers which collapsible panels/sub-groups are open, per device.
// Elements opt in with data-panel="name"; the HTML's open attribute is the
// default for first-time users.
var KEY = 'tuft-panels-v1';

export function initPanels() {
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { /* corrupt — defaults */ }

  document.querySelectorAll('details[data-panel]').forEach(function (d) {
    var name = d.dataset.panel;
    if (name in saved) d.open = !!saved[name];
    d.addEventListener('toggle', function () {
      saved[name] = d.open;
      localStorage.setItem(KEY, JSON.stringify(saved));
    });
  });
}
