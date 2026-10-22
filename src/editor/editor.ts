import { Color, rgba } from '../core/color';
import { Layer, SpriteDoc, cloneDocument, findLayer } from '../core/document';
import { History, HistoryEntry, celsEqual } from '../core/history';
import { BrushShape, Raster, Rect } from '../core/raster';

export type ToolId = 'pencil' | 'eraser' | 'fill' | 'line' | 'rect' | 'ellipse' | 'eyedropper' | 'select' | 'move' | 'hand';

export interface ToolSettings {
  brushSize: number;
  brushShape: BrushShape;
  pixelPerfect: boolean;
  mirrorX: boolean;
  mirrorY: boolean;
  contiguous: boolean;
  shapeFilled: boolean;
}

/** What changed, so panels only redraw what they show. */
export type Change =
  | 'pixels'
  | 'structure'
  | 'cursor'
  | 'tool'
  | 'color'
  | 'view'
  | 'selection'
  | 'history'
  | 'playback'
  | 'file';

type Listener = (changes: Set<Change>) => void;

/**
 * Editor session state around one SpriteDoc: the active layer and frame,
 * colours, tool settings, view transform, and undo history. UI modules read
 * from it and call its methods; it never touches the DOM.
 */
export class Editor {
  doc: SpriteDoc;
  readonly history = new History();

  layer = 0;
  frame = 0;
  tool: ToolId = 'pencil';
  settings: ToolSettings = {
    brushSize: 1,
    brushShape: 'square',
    pixelPerfect: true,
    mirrorX: false,
    mirrorY: false,
    contiguous: true,
    shapeFilled: false,
  };
  primary: Color = rgba(0, 0, 0);
  secondary: Color = 0;
  selection: Rect | null = null;
  clipboard: Raster | null = null;

  zoom = 16;
  panX = 0;
  panY = 0;
  showGrid = true;
  onion = false;
  onionBefore = 1;
  onionAfter = 1;
  playing = false;
  loop = true;

  projectName = 'Untitled';
  projectPath: string | undefined;
  modified = false;

  private listeners = new Set<Listener>();
  private pending = new Set<Change>();
  private flushQueued = false;

  constructor(doc: SpriteDoc) {
    this.doc = doc;
  }

  // ---- events ---------------------------------------------------------------

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Changes are batched and delivered once per microtask. */
  emit(...changes: Change[]): void {
    for (const c of changes) this.pending.add(c);
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      const batch = this.pending;
      this.pending = new Set();
      for (const fn of this.listeners) fn(batch);
    });
  }

  // ---- accessors ------------------------------------------------------------

  get activeLayer(): Layer {
    return this.doc.layers[this.layer];
  }

  get activeCel(): Uint32Array {
    return this.activeLayer.cels[this.frame];
  }

  setFrame(i: number): void {
    const f = Math.max(0, Math.min(this.doc.frames.length - 1, i));
    if (f === this.frame) return;
    this.frame = f;
    this.emit('cursor');
  }

  setLayer(i: number): void {
    const l = Math.max(0, Math.min(this.doc.layers.length - 1, i));
    if (l === this.layer) return;
    this.layer = l;
    this.emit('cursor');
  }

  setTool(t: ToolId): void {
    this.tool = t;
    this.emit('tool');
  }

  setSettings(patch: Partial<ToolSettings>): void {
    Object.assign(this.settings, patch);
    this.emit('tool');
  }

  setPrimary(c: Color): void {
    this.primary = c;
    this.emit('color');
  }

  setSecondary(c: Color): void {
    this.secondary = c;
    this.emit('color');
  }

  swapColors(): void {
    [this.primary, this.secondary] = [this.secondary, this.primary];
    this.emit('color');
  }

  setSelection(r: Rect | null): void {
    this.selection = r;
    this.emit('selection');
  }

  // ---- editing --------------------------------------------------------------

  private markModified() {
    this.modified = true;
    this.emit('history', 'file');
  }

  /** Records a finished pixel edit on one cel (no-op if nothing changed). */
  commitCel(label: string, layerId: number, frame: number, before: Uint32Array): boolean {
    const layer = findLayer(this.doc, layerId);
    if (!layer) return false;
    const after = layer.cels[frame];
    if (celsEqual(before, after)) return false;
    this.history.push({ kind: 'cel', label, layerId, frame, before, after: after.slice() });
    this.markModified();
    this.emit('pixels');
    return true;
  }

  /** Runs a structural change and records whole-document snapshots for undo. */
  structural(label: string, fn: (doc: SpriteDoc) => void): void {
    const before = cloneDocument(this.doc);
    const cursorBefore = { layer: this.layer, frame: this.frame };
    fn(this.doc);
    this.clampCursor();
    this.history.push({
      kind: 'doc',
      label,
      before,
      after: cloneDocument(this.doc),
      cursorBefore,
      cursorAfter: { layer: this.layer, frame: this.frame },
    });
    this.markModified();
    this.emit('structure', 'pixels', 'cursor');
  }

  undo(): HistoryEntry | undefined {
    const e = this.history.undo();
    if (e) this.apply(e, 'before');
    return e;
  }

  redo(): HistoryEntry | undefined {
    const e = this.history.redo();
    if (e) this.apply(e, 'after');
    return e;
  }

  private apply(e: HistoryEntry, side: 'before' | 'after') {
    if (e.kind === 'cel') {
      const layer = findLayer(this.doc, e.layerId);
      if (layer) {
        layer.cels[e.frame].set(e[side]);
        this.layer = this.doc.layers.indexOf(layer);
        this.frame = e.frame;
      }
    } else {
      const sizeChanged = e[side].width !== this.doc.width || e[side].height !== this.doc.height;
      this.doc = cloneDocument(e[side]);
      const cur = side === 'before' ? e.cursorBefore : e.cursorAfter;
      this.layer = cur.layer;
      this.frame = cur.frame;
      if (sizeChanged) this.selection = null;
    }
    this.clampCursor();
    this.markModified();
    this.emit('pixels', 'structure', 'cursor', 'selection');
  }

  private clampCursor() {
    this.layer = Math.max(0, Math.min(this.doc.layers.length - 1, this.layer));
    this.frame = Math.max(0, Math.min(this.doc.frames.length - 1, this.frame));
  }

  /** Replaces the document, e.g. after New or Open. */
  load(doc: SpriteDoc, name: string, path?: string): void {
    this.doc = doc;
    this.history.clear();
    this.layer = doc.layers.length - 1;
    this.frame = 0;
    this.selection = null;
    this.projectName = name;
    this.projectPath = path;
    this.modified = false;
    this.playing = false;
    this.emit('structure', 'pixels', 'cursor', 'selection', 'history', 'file', 'playback', 'view');
  }
}
