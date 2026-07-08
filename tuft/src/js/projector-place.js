// ---------- projector mode: placing cloth items (select / drag / nudge) ----------
// Pointer positions travel screen → un-keystoned view (inverse homography) →
// surface cm (inverse of the render's flip/rotate mapping), so dragging
// works identically whether or not the projection is warped.
import { els } from './state.js';
import { popts, view } from './projector-state.js';
import { screenToView } from './projector-keystone.js';
import { getLayout, saveLayout, refreshClothList, clampItem, itemFootprint } from './cloth.js';
import { renderProjector } from './projector-render.js';

var drag = null; // { item, dx, dy } — pointer offset within the item, in cm

// view px → surface cm (exact inverse of projector-render's mapPt)
function viewToCm(vx, vy) {
  var r = view.rect;
  var W = view.surf.w * view.pxPerCm, H = view.surf.h * view.pxPerCm;
  var x, y;
  if (popts.rotate) { x = vy - r.y; y = (r.x + r.w) - vx; }
  else { x = vx - r.x; y = vy - r.y; }
  if (popts.flipH) x = W - x;
  if (popts.flipV) y = H - y;
  return [x / view.pxPerCm, y / view.pxPerCm];
}

function pointerToCm(e) {
  var p = screenToView(e.clientX, e.clientY);
  return viewToCm(p[0], p[1]);
}

// topmost item under the point (last in the array draws last)
function hitItem(cmX, cmY) {
  var items = getLayout().items;
  for (var i = items.length - 1; i >= 0; i--) {
    var it = items[i], fp = itemFootprint(it);
    if (cmX >= it.x && cmX <= it.x + fp.w && cmY >= it.y && cmY <= it.y + fp.h) return it;
  }
  return null;
}

export function selectedItem() {
  if (!view.selected) return null;
  var items = getLayout().items;
  for (var i = 0; i < items.length; i++) if (items[i].id === view.selected) return items[i];
  return null;
}

export function moveSelected(dxCm, dyCm) {
  var it = selectedItem();
  if (!it) return false;
  it.x += dxCm; it.y += dyCm;
  clampItem(it);
  saveLayout();
  refreshClothList();
  renderProjector();
  return true;
}

export function rotateSelected() {
  var it = selectedItem();
  if (!it) return false;
  it.rot = it.rot ? 0 : 1;
  clampItem(it);
  saveLayout();
  refreshClothList();
  renderProjector();
  return true;
}

export function initPlace() {
  els.projector.addEventListener('pointerdown', function (e) {
    if (!view.cloth || e.target !== els.projCanvas || !view.rect) return;
    var cm = pointerToCm(e);
    var hit = hitItem(cm[0], cm[1]);
    view.selected = hit ? hit.id : null;
    renderProjector();
    if (!hit) return;
    drag = { item: hit, dx: cm[0] - hit.x, dy: cm[1] - hit.y };
    try { els.projector.setPointerCapture(e.pointerId); } catch (err) {} // synthetic events can't capture
  });
  els.projector.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var cm = pointerToCm(e);
    drag.item.x = cm[0] - drag.dx;
    drag.item.y = cm[1] - drag.dy;
    clampItem(drag.item);
    renderProjector();
  });
  function endDrag() {
    if (!drag) return;
    drag = null;
    saveLayout();
    refreshClothList();
  }
  els.projector.addEventListener('pointerup', endDrag);
  els.projector.addEventListener('pointercancel', endDrag);
}
