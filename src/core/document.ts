import { Color, blend } from './color';

/**
 * The sprite document. Everything the editor shows is derived from this, and
 * it has no DOM dependencies so later modules (tilemaps, scenes, the game
 * runtime) can load and render sprites the same way.
 */
export interface Layer {
  id: number;
  name: string;
  visible: boolean;
  /** 0..255 */
  opacity: number;
  /** One cel per frame, each `width * height` packed RGBA pixels. */
  cels: Uint32Array[];
}

export interface Frame {
  /** Milliseconds this frame is shown during playback. */
  duration: number;
}

export type TagDirection = 'forward' | 'reverse' | 'pingpong';

/** A named frame range, e.g. "idle" or "walk", used by game export. */
export interface Tag {
  name: string;
  from: number;
  to: number;
  direction: TagDirection;
}

export interface SpriteDoc {
  width: number;
  height: number;
  palette: Color[];
  frames: Frame[];
  /** Bottom to top. */
  layers: Layer[];
  tags: Tag[];
}

export const MAX_SIZE = 2048;

let nextLayerId = 1;

export function newLayerId(): number {
  return nextLayerId++;
}

/** Keeps generated ids unique after loading a document from disk. */
export function reserveLayerIds(doc: SpriteDoc): void {
  for (const l of doc.layers) nextLayerId = Math.max(nextLayerId, l.id + 1);
}

export function createLayer(name: string, width: number, height: number, frameCount: number): Layer {
  return {
    id: newLayerId(),
    name,
    visible: true,
    opacity: 255,
    cels: Array.from({ length: frameCount }, () => new Uint32Array(width * height)),
  };
}

export function createDocument(width: number, height: number, palette: Color[]): SpriteDoc {
  if (width < 1 || height < 1 || width > MAX_SIZE || height > MAX_SIZE) {
    throw new Error(`Sprite size must be between 1 and ${MAX_SIZE} pixels`);
  }
  return {
    width,
    height,
    palette: palette.slice(),
    frames: [{ duration: 100 }],
    layers: [createLayer('Layer 1', width, height, 1)],
    tags: [],
  };
}

export function cloneDocument(doc: SpriteDoc): SpriteDoc {
  return {
    width: doc.width,
    height: doc.height,
    palette: doc.palette.slice(),
    frames: doc.frames.map((f) => ({ ...f })),
    layers: doc.layers.map((l) => ({ ...l, cels: l.cels.map((c) => c.slice()) })),
    tags: doc.tags.map((t) => ({ ...t })),
  };
}

export function findLayer(doc: SpriteDoc, id: number): Layer | undefined {
  return doc.layers.find((l) => l.id === id);
}

// ---- Frames ---------------------------------------------------------------

/** Inserts a frame at `index`, copying `copyFrom` (or blank when omitted). */
export function insertFrame(doc: SpriteDoc, index: number, copyFrom?: number): void {
  const size = doc.width * doc.height;
  const src = copyFrom !== undefined ? doc.frames[copyFrom] : undefined;
  doc.frames.splice(index, 0, { duration: src?.duration ?? doc.frames[Math.max(0, index - 1)]?.duration ?? 100 });
  for (const l of doc.layers) {
    const cel = copyFrom !== undefined ? l.cels[copyFrom].slice() : new Uint32Array(size);
    l.cels.splice(index, 0, cel);
  }
  for (const t of doc.tags) {
    if (t.from >= index) t.from++;
    if (t.to >= index) t.to++;
  }
}

export function removeFrame(doc: SpriteDoc, index: number): void {
  if (doc.frames.length <= 1) return;
  doc.frames.splice(index, 1);
  for (const l of doc.layers) l.cels.splice(index, 1);
  doc.tags = doc.tags
    .map((t) => ({
      ...t,
      from: t.from > index ? t.from - 1 : t.from,
      to: t.to >= index ? t.to - 1 : t.to,
    }))
    .filter((t) => t.to >= t.from && t.from < doc.frames.length);
}

export function moveFrame(doc: SpriteDoc, from: number, to: number): void {
  if (to < 0 || to >= doc.frames.length || from === to) return;
  const [f] = doc.frames.splice(from, 1);
  doc.frames.splice(to, 0, f);
  for (const l of doc.layers) {
    const [c] = l.cels.splice(from, 1);
    l.cels.splice(to, 0, c);
  }
}

// ---- Layers ---------------------------------------------------------------

export function insertLayer(doc: SpriteDoc, index: number, name?: string): Layer {
  const layer = createLayer(name ?? `Layer ${doc.layers.length + 1}`, doc.width, doc.height, doc.frames.length);
  doc.layers.splice(index, 0, layer);
  return layer;
}

export function duplicateLayer(doc: SpriteDoc, index: number): Layer {
  const src = doc.layers[index];
  const copy: Layer = { ...src, id: newLayerId(), name: `${src.name} copy`, cels: src.cels.map((c) => c.slice()) };
  doc.layers.splice(index + 1, 0, copy);
  return copy;
}

export function removeLayer(doc: SpriteDoc, index: number): void {
  if (doc.layers.length <= 1) return;
  doc.layers.splice(index, 1);
}

export function moveLayer(doc: SpriteDoc, from: number, to: number): void {
  if (to < 0 || to >= doc.layers.length || from === to) return;
  const [l] = doc.layers.splice(from, 1);
  doc.layers.splice(to, 0, l);
}

/** Flattens layer `index` into the layer below it. */
export function mergeDown(doc: SpriteDoc, index: number): void {
  if (index <= 0) return;
  const top = doc.layers[index];
  const below = doc.layers[index - 1];
  for (let f = 0; f < doc.frames.length; f++) {
    const dst = below.cels[f];
    const src = top.cels[f];
    if (!top.visible) continue;
    for (let i = 0; i < dst.length; i++) {
      if (src[i] >>> 24) dst[i] = blend(dst[i], src[i], top.opacity);
    }
  }
  doc.layers.splice(index, 1);
}

// ---- Canvas ---------------------------------------------------------------

export type Anchor = 'center' | 'top-left';

export function resizeCanvas(doc: SpriteDoc, width: number, height: number, anchor: Anchor = 'center'): void {
  if (width < 1 || height < 1 || width > MAX_SIZE || height > MAX_SIZE) {
    throw new Error(`Sprite size must be between 1 and ${MAX_SIZE} pixels`);
  }
  const dx = anchor === 'center' ? Math.floor((width - doc.width) / 2) : 0;
  const dy = anchor === 'center' ? Math.floor((height - doc.height) / 2) : 0;
  for (const l of doc.layers) {
    l.cels = l.cels.map((cel) => {
      const out = new Uint32Array(width * height);
      for (let y = 0; y < doc.height; y++) {
        const ty = y + dy;
        if (ty < 0 || ty >= height) continue;
        for (let x = 0; x < doc.width; x++) {
          const tx = x + dx;
          if (tx < 0 || tx >= width) continue;
          out[ty * width + tx] = cel[y * doc.width + x];
        }
      }
      return out;
    });
  }
  doc.width = width;
  doc.height = height;
}

// ---- Compositing ----------------------------------------------------------

/** Flattens all visible layers of `frame` into `out` (allocated if omitted). */
export function compositeFrame(doc: SpriteDoc, frame: number, out?: Uint32Array, onlyVisible = true): Uint32Array {
  const n = doc.width * doc.height;
  const dst = out && out.length === n ? out : new Uint32Array(n);
  dst.fill(0);
  for (const l of doc.layers) {
    if (onlyVisible && !l.visible) continue;
    const src = l.cels[frame];
    if (!src) continue;
    const op = l.opacity;
    for (let i = 0; i < n; i++) {
      const s = src[i];
      if (s === 0) continue;
      if (op === 255 && s >>> 24 === 255) dst[i] = s;
      else dst[i] = blend(dst[i], s, op);
    }
  }
  return dst;
}

/** The colour you see at a pixel, used by the eyedropper. */
export function compositePixel(doc: SpriteDoc, frame: number, x: number, y: number): Color {
  const i = y * doc.width + x;
  let c: Color = 0;
  for (const l of doc.layers) {
    if (!l.visible) continue;
    const s = l.cels[frame][i];
    if (s) c = blend(c, s, l.opacity);
  }
  return c;
}

export function isCelEmpty(cel: Uint32Array): boolean {
  for (let i = 0; i < cel.length; i++) if (cel[i] !== 0) return false;
  return true;
}
