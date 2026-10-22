import { colorToHex, hexToColor } from './color';
import { Layer, SpriteDoc, TagDirection, isCelEmpty, newLayerId, reserveLayerIds, MAX_SIZE } from './document';

/**
 * Project file format (`.sprite.json`). Cels are raw RGBA bytes, base64
 * encoded; empty cels are stored as null. Versioned so later toolkit modules
 * can extend it without breaking old files.
 */
export const FORMAT_ID = 'spritation.sprite';
export const FORMAT_VERSION = 1;

interface ProjectFileV1 {
  format: typeof FORMAT_ID;
  version: 1;
  width: number;
  height: number;
  palette: string[];
  frames: { duration: number }[];
  layers: { name: string; visible: boolean; opacity: number; cels: (string | null)[] }[];
  tags: { name: string; from: number; to: number; direction: TagDirection }[];
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function celToBase64(cel: Uint32Array): string | null {
  if (isCelEmpty(cel)) return null;
  return bytesToBase64(new Uint8Array(cel.buffer, cel.byteOffset, cel.byteLength));
}

function base64ToCel(b64: string | null, size: number): Uint32Array {
  const cel = new Uint32Array(size);
  if (!b64) return cel;
  const bytes = base64ToBytes(b64);
  if (bytes.length !== size * 4) throw new Error('A cel in this file has the wrong size');
  new Uint8Array(cel.buffer).set(bytes);
  return cel;
}

export function serializeDocument(doc: SpriteDoc): string {
  const file: ProjectFileV1 = {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    width: doc.width,
    height: doc.height,
    palette: doc.palette.map((c) => colorToHex(c, true)),
    frames: doc.frames.map((f) => ({ duration: f.duration })),
    layers: doc.layers.map((l) => ({
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      cels: l.cels.map(celToBase64),
    })),
    tags: doc.tags.map((t) => ({ ...t })),
  };
  return JSON.stringify(file);
}

export function deserializeDocument(text: string): SpriteDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not a Spritation project (it is not valid JSON)');
  }
  const f = raw as Partial<ProjectFileV1>;
  if (f.format !== FORMAT_ID) throw new Error('This file is not a Spritation project');
  if (f.version !== 1) throw new Error(`This project was saved by a newer version of Spritation (format ${f.version})`);
  const { width, height } = f;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width! < 1 || height! < 1 || width! > MAX_SIZE || height! > MAX_SIZE) {
    throw new Error('This project has an invalid canvas size');
  }
  const frames = (f.frames ?? []).map((fr) => ({ duration: Math.max(1, Number(fr.duration) || 100) }));
  if (!frames.length) throw new Error('This project has no frames');
  const size = width! * height!;
  const layers: Layer[] = (f.layers ?? []).map((l) => ({
    id: newLayerId(),
    name: String(l.name ?? 'Layer'),
    visible: l.visible !== false,
    opacity: Math.max(0, Math.min(255, Number(l.opacity ?? 255))),
    cels: frames.map((_, i) => base64ToCel(l.cels?.[i] ?? null, size)),
  }));
  if (!layers.length) throw new Error('This project has no layers');
  const doc: SpriteDoc = {
    width: width!,
    height: height!,
    palette: (f.palette ?? []).map(hexToColor),
    frames,
    layers,
    tags: (f.tags ?? [])
      .filter((t) => t.from >= 0 && t.to < frames.length && t.from <= t.to)
      .map((t) => ({ name: String(t.name), from: t.from, to: t.to, direction: t.direction ?? 'forward' })),
  };
  reserveLayerIds(doc);
  return doc;
}
