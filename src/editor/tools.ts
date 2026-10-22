import { Color } from '../core/color';
import { compositePixel } from '../core/document';
import {
  Point,
  Raster,
  Rect,
  brushOffsets,
  bresenham,
  clearRegion,
  clipRect,
  copyRegion,
  ellipsePixels,
  floodFill,
  isLCorner,
  pasteRegion,
  rectContains,
  rectFromPoints,
  rectPixels,
  snapAngle,
  squareFrom,
} from '../core/raster';
import { Editor, ToolId } from './editor';

export interface PointerInfo extends Point {
  button: 'primary' | 'secondary';
  shift: boolean;
  alt: boolean;
}

export interface Tool {
  down(p: PointerInfo): void;
  move(p: PointerInfo): void;
  up(p: PointerInfo): void;
  /** Abandons the gesture, e.g. when a second finger starts a pinch. */
  cancel(): void;
}

export const TOOL_INFO: Record<ToolId, { label: string; key: string }> = {
  pencil: { label: 'Pencil', key: 'B' },
  eraser: { label: 'Eraser', key: 'E' },
  fill: { label: 'Paint bucket', key: 'G' },
  line: { label: 'Line', key: 'L' },
  rect: { label: 'Rectangle', key: 'U' },
  ellipse: { label: 'Ellipse', key: 'O' },
  eyedropper: { label: 'Eyedropper', key: 'I' },
  select: { label: 'Rectangular marquee', key: 'M' },
  move: { label: 'Move', key: 'V' },
  hand: { label: 'Hand', key: 'H' },
};

/**
 * One undoable edit on the active cel. Writes go through `set`, which applies
 * the canvas bounds, the selection mask and the symmetry settings.
 */
export class CelEdit {
  readonly layerId: number;
  readonly frame: number;
  readonly cel: Uint32Array;
  readonly before: Uint32Array;
  readonly w: number;
  readonly h: number;
  private clip: Rect | null;

  constructor(private ed: Editor, private label: string) {
    this.layerId = ed.activeLayer.id;
    this.frame = ed.frame;
    this.cel = ed.activeCel;
    this.before = this.cel.slice();
    this.w = ed.doc.width;
    this.h = ed.doc.height;
    this.clip = ed.selection;
  }

  get raster(): Raster {
    return { width: this.w, height: this.h, data: this.cel };
  }

  private put(x: number, y: number, c: Color) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    if (this.clip && !rectContains(this.clip, x, y)) return;
    this.cel[y * this.w + x] = c;
  }

  /** Each point this pixel maps to under the active symmetry settings. */
  mirrored(x: number, y: number): Point[] {
    const { mirrorX, mirrorY } = this.ed.settings;
    const pts = [{ x, y }];
    if (mirrorX) pts.push({ x: this.w - 1 - x, y });
    if (mirrorY) pts.push({ x, y: this.h - 1 - y });
    if (mirrorX && mirrorY) pts.push({ x: this.w - 1 - x, y: this.h - 1 - y });
    return pts;
  }

  set(x: number, y: number, c: Color) {
    for (const p of this.mirrored(x, y)) this.put(p.x, p.y, c);
  }

  stamp(x: number, y: number, c: Color) {
    const { brushSize, brushShape } = this.ed.settings;
    for (const o of brushOffsets(brushSize, brushShape)) this.set(x + o.x, y + o.y, c);
  }

  /** Puts a pixel (and its mirrors) back to how it was before the edit. */
  revert(x: number, y: number) {
    for (const p of this.mirrored(x, y)) {
      if (p.x < 0 || p.y < 0 || p.x >= this.w || p.y >= this.h) continue;
      const i = p.y * this.w + p.x;
      this.cel[i] = this.before[i];
    }
  }

  restore() {
    this.cel.set(this.before);
  }

  changed() {
    this.ed.emit('pixels');
  }

  commit() {
    this.ed.commitCel(this.label, this.layerId, this.frame, this.before);
  }

  cancel() {
    this.restore();
    this.ed.emit('pixels');
  }
}

const colorFor = (ed: Editor, p: PointerInfo) => (p.button === 'primary' ? ed.primary : ed.secondary);

/** Pencil and eraser: freehand strokes, with optional pixel-perfect corners. */
class FreehandTool implements Tool {
  private edit: CelEdit | null = null;
  private last: Point | null = null;
  private path: Point[] = [];
  private color: Color = 0;

  constructor(private ed: Editor, private erase: boolean) {}

  private plot(x: number, y: number) {
    const e = this.edit!;
    e.stamp(x, y, this.color);
    if (!this.ed.settings.pixelPerfect || this.ed.settings.brushSize !== 1) return;
    this.path.push({ x, y });
    const n = this.path.length;
    if (n >= 3 && isLCorner(this.path[n - 3], this.path[n - 2], this.path[n - 1])) {
      const mid = this.path[n - 2];
      e.revert(mid.x, mid.y);
      this.path.splice(n - 2, 1);
    }
  }

  down(p: PointerInfo) {
    this.edit = new CelEdit(this.ed, this.erase ? 'Erase' : 'Pencil');
    this.color = this.erase ? 0 : colorFor(this.ed, p);
    this.path = [];
    if (p.shift && this.lastStrokeEnd) {
      // Shift-click draws a straight line from the end of the previous stroke.
      const from = this.lastStrokeEnd;
      bresenham(from.x, from.y, p.x, p.y, (x, y) => this.edit!.stamp(x, y, this.color));
    } else {
      this.plot(p.x, p.y);
    }
    this.last = { x: p.x, y: p.y };
    this.edit.changed();
  }

  private lastStrokeEnd: Point | null = null;

  move(p: PointerInfo) {
    if (!this.edit || !this.last) return;
    if (p.x === this.last.x && p.y === this.last.y) return;
    let first = true;
    bresenham(this.last.x, this.last.y, p.x, p.y, (x, y) => {
      if (first) return void (first = false);
      this.plot(x, y);
    });
    this.last = { x: p.x, y: p.y };
    this.edit.changed();
  }

  up() {
    this.edit?.commit();
    this.lastStrokeEnd = this.last;
    this.edit = null;
    this.last = null;
  }

  cancel() {
    this.edit?.cancel();
    this.edit = null;
  }
}

type ShapeKind = 'line' | 'rect' | 'ellipse';

/** Line, rectangle and ellipse: redrawn from scratch on every move. */
class ShapeTool implements Tool {
  private edit: CelEdit | null = null;
  private start: Point = { x: 0, y: 0 };
  private color: Color = 0;

  constructor(private ed: Editor, private kind: ShapeKind) {}

  down(p: PointerInfo) {
    const label = { line: 'Line', rect: 'Rectangle', ellipse: 'Ellipse' }[this.kind];
    this.edit = new CelEdit(this.ed, label);
    this.start = { x: p.x, y: p.y };
    this.color = colorFor(this.ed, p);
    this.draw(p);
  }

  private draw(p: PointerInfo) {
    const e = this.edit!;
    e.restore();
    const filled = this.ed.settings.shapeFilled;
    if (this.kind === 'line') {
      const end = p.shift ? snapAngle(this.start, p) : p;
      bresenham(this.start.x, this.start.y, end.x, end.y, (x, y) => e.stamp(x, y, this.color));
    } else {
      const end = p.shift ? squareFrom(this.start, p) : p;
      const r = rectFromPoints(this.start, end);
      const pts = this.kind === 'rect' ? rectPixels(r, filled) : ellipsePixels(r, filled);
      for (const q of pts) {
        if (filled) e.set(q.x, q.y, this.color);
        else e.stamp(q.x, q.y, this.color);
      }
    }
    e.changed();
  }

  move(p: PointerInfo) {
    if (this.edit) this.draw(p);
  }

  up() {
    this.edit?.commit();
    this.edit = null;
  }

  cancel() {
    this.edit?.cancel();
    this.edit = null;
  }
}

class FillTool implements Tool {
  constructor(private ed: Editor) {}

  down(p: PointerInfo) {
    const e = new CelEdit(this.ed, 'Fill');
    const pts = e.mirrored(p.x, p.y);
    for (const q of pts) floodFill(e.raster, q.x, q.y, colorFor(this.ed, p), this.ed.settings.contiguous, this.ed.selection);
    e.commit();
  }
  move() {}
  up() {}
  cancel() {}
}

class EyedropperTool implements Tool {
  constructor(private ed: Editor) {}

  private pick(p: PointerInfo) {
    const { doc } = this.ed;
    if (p.x < 0 || p.y < 0 || p.x >= doc.width || p.y >= doc.height) return;
    const c = compositePixel(doc, this.ed.frame, p.x, p.y);
    if (p.button === 'primary') this.ed.setPrimary(c);
    else this.ed.setSecondary(c);
  }

  down(p: PointerInfo) {
    this.pick(p);
  }
  move(p: PointerInfo) {
    this.pick(p);
  }
  up() {}
  cancel() {}
}

class SelectTool implements Tool {
  private start: Point | null = null;
  private moved = false;
  constructor(private ed: Editor) {}

  down(p: PointerInfo) {
    this.start = { x: p.x, y: p.y };
    this.moved = false;
  }

  move(p: PointerInfo) {
    if (!this.start) return;
    if (p.x !== this.start.x || p.y !== this.start.y) this.moved = true;
    if (!this.moved) return;
    const end = p.shift ? squareFrom(this.start, p) : p;
    this.ed.setSelection(clipRect(rectFromPoints(this.start, end), this.ed.doc.width, this.ed.doc.height));
  }

  up() {
    if (this.start && !this.moved) this.ed.setSelection(null);
    this.start = null;
  }

  cancel() {
    this.start = null;
  }
}

/** Lifts the selection (or the whole cel) and drags it around. */
export class MoveTool implements Tool {
  private edit: CelEdit | null = null;
  private start: Point = { x: 0, y: 0 };
  private region: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private hadSelection = false;
  private lifted: Raster | null = null;
  private base: Uint32Array | null = null;

  constructor(private ed: Editor) {}

  begin(at: Point) {
    const { doc } = this.ed;
    this.hadSelection = !!this.ed.selection;
    this.region = this.ed.selection ?? { x: 0, y: 0, w: doc.width, h: doc.height };
    // Moving pixels must not be clipped by the selection we're moving.
    const sel = this.ed.selection;
    this.ed.selection = null;
    this.edit = new CelEdit(this.ed, 'Move');
    this.ed.selection = sel;
    this.lifted = copyRegion(this.edit.raster, this.region);
    const base = this.edit.before.slice();
    clearRegion({ width: doc.width, height: doc.height, data: base }, this.region);
    this.base = base;
    this.start = at;
  }

  drag(dx: number, dy: number) {
    const e = this.edit!;
    e.cel.set(this.base!);
    pasteRegion(e.raster, this.lifted!, this.region.x + dx, this.region.y + dy);
    if (this.hadSelection) {
      this.ed.setSelection({ ...this.region, x: this.region.x + dx, y: this.region.y + dy });
    }
    e.changed();
  }

  down(p: PointerInfo) {
    this.begin({ x: p.x, y: p.y });
  }

  move(p: PointerInfo) {
    if (this.edit) this.drag(p.x - this.start.x, p.y - this.start.y);
  }

  up() {
    this.edit?.commit();
    this.edit = null;
  }

  cancel() {
    if (!this.edit) return;
    this.edit.cancel();
    if (this.hadSelection) this.ed.setSelection(this.region);
    this.edit = null;
  }
}

export function createTools(ed: Editor): Record<Exclude<ToolId, 'hand'>, Tool> {
  return {
    pencil: new FreehandTool(ed, false),
    eraser: new FreehandTool(ed, true),
    fill: new FillTool(ed),
    line: new ShapeTool(ed, 'line'),
    rect: new ShapeTool(ed, 'rect'),
    ellipse: new ShapeTool(ed, 'ellipse'),
    eyedropper: new EyedropperTool(ed),
    select: new SelectTool(ed),
    move: new MoveTool(ed),
  };
}
