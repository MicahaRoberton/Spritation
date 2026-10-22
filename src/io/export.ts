import { SpriteDoc, compositeFrame } from '../core/document';
import { Raster } from '../core/raster';
import { encodeGif } from './gif';

/** Pure export helpers: they produce pixels and metadata, not files. */

export function scaleRaster(src: Raster, scale: number): Raster {
  if (scale === 1) return src;
  const w = src.width * scale;
  const h = src.height * scale;
  const out = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = (y / scale) | 0;
    for (let x = 0; x < w; x++) out[y * w + x] = src.data[sy * src.width + ((x / scale) | 0)];
  }
  return { width: w, height: h, data: out };
}

export function frameRaster(doc: SpriteDoc, frame: number, scale = 1): Raster {
  return scaleRaster({ width: doc.width, height: doc.height, data: compositeFrame(doc, frame) }, scale);
}

export type SheetLayout = 'row' | 'column' | 'grid';

export interface SheetOptions {
  layout: SheetLayout;
  scale: number;
  /** Transparent pixels between frames. */
  padding: number;
  imageName: string;
}

/**
 * Packs every frame into one image and returns Aseprite-style JSON
 * ("hash" format) so existing engine importers (Phaser, Godot, Unity
 * plugins, LÖVE libraries) can read it.
 */
export function buildSpriteSheet(doc: SpriteDoc, opts: SheetOptions): { image: Raster; json: object } {
  const n = doc.frames.length;
  const fw = doc.width * opts.scale;
  const fh = doc.height * opts.scale;
  const cols = opts.layout === 'row' ? n : opts.layout === 'column' ? 1 : Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const pad = opts.padding;
  const width = cols * fw + (cols - 1) * pad;
  const height = rows * fh + (rows - 1) * pad;
  const data = new Uint32Array(width * height);
  const frames: Record<string, unknown> = {};
  const base = opts.imageName.replace(/\.png$/i, '');

  for (let i = 0; i < n; i++) {
    const fr = frameRaster(doc, i, opts.scale);
    const ox = (i % cols) * (fw + pad);
    const oy = Math.floor(i / cols) * (fh + pad);
    for (let y = 0; y < fh; y++) data.set(fr.data.subarray(y * fw, (y + 1) * fw), (oy + y) * width + ox);
    frames[`${base} ${i}.png`] = {
      frame: { x: ox, y: oy, w: fw, h: fh },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: fw, h: fh },
      sourceSize: { w: fw, h: fh },
      duration: doc.frames[i].duration,
    };
  }

  const json = {
    frames,
    meta: {
      app: 'Spritation',
      version: '0.1',
      image: opts.imageName,
      format: 'RGBA8888',
      size: { w: width, h: height },
      scale: String(opts.scale),
      frameTags: doc.tags.map((t) => ({ name: t.name, from: t.from, to: t.to, direction: t.direction })),
      layers: doc.layers.map((l) => ({ name: l.name, opacity: l.opacity, blendMode: 'normal' })),
    },
  };
  return { image: { width, height, data }, json };
}

export function buildGif(doc: SpriteDoc, scale = 1, from = 0, to = doc.frames.length - 1): Uint8Array {
  const frames = [];
  for (let i = from; i <= to; i++) {
    frames.push({ pixels: frameRaster(doc, i, scale).data, delayMs: doc.frames[i].duration });
  }
  return encodeGif(frames, doc.width * scale, doc.height * scale);
}
