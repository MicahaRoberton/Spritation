import { hexToColor } from '../core/color';
import {
  Anchor,
  TagDirection,
  duplicateLayer,
  insertFrame,
  insertLayer,
  mergeDown,
  moveFrame,
  moveLayer,
  removeFrame,
  removeLayer,
  resizeCanvas,
} from '../core/document';
import { clearRegion, copyRegion, flipRegion, pasteRegion } from '../core/raster';
import { Editor } from './editor';
import { CelEdit, MoveTool } from './tools';

/** Editing operations that don't need a pointer: menus, buttons, shortcuts. */

const fullRect = (ed: Editor) => ed.selection ?? { x: 0, y: 0, w: ed.doc.width, h: ed.doc.height };

export function selectAll(ed: Editor) {
  ed.setSelection({ x: 0, y: 0, w: ed.doc.width, h: ed.doc.height });
}

export function copy(ed: Editor) {
  ed.clipboard = copyRegion({ width: ed.doc.width, height: ed.doc.height, data: ed.activeCel }, fullRect(ed));
}

export function clear(ed: Editor) {
  const e = new CelEdit(ed, 'Clear');
  clearRegion(e.raster, fullRect(ed));
  e.commit();
}

export function cut(ed: Editor) {
  copy(ed);
  clear(ed);
}

export function paste(ed: Editor) {
  const clip = ed.clipboard;
  if (!clip) return false;
  const x = Math.max(0, Math.min(ed.selection?.x ?? 0, ed.doc.width - 1));
  const y = Math.max(0, Math.min(ed.selection?.y ?? 0, ed.doc.height - 1));
  ed.selection = null;
  const e = new CelEdit(ed, 'Paste');
  pasteRegion(e.raster, clip, x, y);
  e.commit();
  ed.setSelection({ x, y, w: clip.width, h: clip.height });
  ed.setTool('move');
  return true;
}

export function flip(ed: Editor, axis: 'h' | 'v') {
  const sel = ed.selection;
  ed.selection = null;
  const e = new CelEdit(ed, axis === 'h' ? 'Flip horizontal' : 'Flip vertical');
  ed.selection = sel;
  flipRegion(e.raster, fullRect(ed), axis);
  e.commit();
}

/** Arrow-key nudge of the selection contents (or the whole cel). */
export function nudge(ed: Editor, dx: number, dy: number) {
  const m = new MoveTool(ed);
  m.begin({ x: 0, y: 0 });
  m.drag(dx, dy);
  m.up();
}

// ---- layers ---------------------------------------------------------------

export function addLayer(ed: Editor) {
  ed.structural('New layer', (doc) => {
    insertLayer(doc, ed.layer + 1);
    ed.layer = ed.layer + 1;
  });
}

export function dupLayer(ed: Editor) {
  ed.structural('Duplicate layer', (doc) => {
    duplicateLayer(doc, ed.layer);
    ed.layer++;
  });
}

export function deleteLayer(ed: Editor) {
  if (ed.doc.layers.length <= 1) return false;
  ed.structural('Delete layer', (doc) => removeLayer(doc, ed.layer));
  return true;
}

export function shiftLayer(ed: Editor, dir: 1 | -1) {
  const to = ed.layer + dir;
  if (to < 0 || to >= ed.doc.layers.length) return;
  ed.structural('Move layer', (doc) => {
    moveLayer(doc, ed.layer, to);
    ed.layer = to;
  });
}

export function mergeLayerDown(ed: Editor) {
  if (ed.layer === 0) return false;
  ed.structural('Merge down', (doc) => {
    mergeDown(doc, ed.layer);
    ed.layer--;
  });
  return true;
}

export function renameLayer(ed: Editor, index: number, name: string) {
  const clean = name.trim();
  if (!clean || clean === ed.doc.layers[index].name) return;
  ed.structural('Rename layer', (doc) => (doc.layers[index].name = clean));
}

export function toggleLayerVisible(ed: Editor, index: number) {
  ed.doc.layers[index].visible = !ed.doc.layers[index].visible;
  ed.modified = true;
  ed.emit('structure', 'pixels', 'file');
}

// ---- frames ---------------------------------------------------------------

export function addFrame(ed: Editor, empty = false) {
  ed.structural(empty ? 'New empty frame' : 'New frame', (doc) => {
    insertFrame(doc, ed.frame + 1, empty ? undefined : ed.frame);
    ed.frame++;
  });
}

export function deleteFrame(ed: Editor) {
  if (ed.doc.frames.length <= 1) return false;
  ed.structural('Delete frame', (doc) => removeFrame(doc, ed.frame));
  return true;
}

export function shiftFrame(ed: Editor, dir: 1 | -1) {
  const to = ed.frame + dir;
  if (to < 0 || to >= ed.doc.frames.length) return;
  ed.structural('Move frame', (doc) => {
    moveFrame(doc, ed.frame, to);
    ed.frame = to;
  });
}

export function setFrameDuration(ed: Editor, ms: number, allFrames = false) {
  const d = Math.max(10, Math.min(10_000, Math.round(ms)));
  ed.structural('Frame duration', (doc) => {
    if (allFrames) doc.frames.forEach((f) => (f.duration = d));
    else doc.frames[ed.frame].duration = d;
  });
}

export function addTag(ed: Editor, name: string, from: number, to: number, direction: TagDirection) {
  ed.structural('New tag', (doc) => {
    doc.tags.push({ name, from: Math.min(from, to), to: Math.max(from, to), direction });
  });
}

export function deleteTag(ed: Editor, index: number) {
  ed.structural('Delete tag', (doc) => doc.tags.splice(index, 1));
}

// ---- sprite ---------------------------------------------------------------

export function canvasSize(ed: Editor, w: number, h: number, anchor: Anchor) {
  ed.structural('Canvas size', (doc) => resizeCanvas(doc, w, h, anchor));
  ed.setSelection(null);
}

// ---- palette --------------------------------------------------------------

export function setPalette(ed: Editor, hexes: string[]) {
  ed.structural('Load palette', (doc) => (doc.palette = hexes.map(hexToColor)));
}

export function addPaletteColor(ed: Editor) {
  if (ed.doc.palette.includes(ed.primary)) return false;
  ed.structural('Add color', (doc) => doc.palette.push(ed.primary));
  return true;
}

export function removePaletteColor(ed: Editor, index: number) {
  ed.structural('Remove color', (doc) => doc.palette.splice(index, 1));
}
