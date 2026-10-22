import { describe, expect, it } from 'vitest';
import { rgba } from '../src/core/color';
import { createDocument, insertFrame } from '../src/core/document';
import { buildSpriteSheet, scaleRaster } from '../src/io/export';
import { encodeGif, lzwEncode } from '../src/io/gif';

/** Reference GIF LZW decoder, used to check the encoder round-trips. */
function lzwDecode(data: Uint8Array, minCode: number, count: number): number[] {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let size = minCode + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    dict[clear] = [];
    dict[eoi] = [];
    size = minCode + 1;
  };
  reset();
  const out: number[] = [];
  let pos = 0;
  const read = () => {
    let v = 0;
    for (let i = 0; i < size; i++) {
      const bit = (data[pos >> 3] >> (pos & 7)) & 1;
      v |= bit << i;
      pos++;
    }
    return v;
  };
  let prev: number[] | null = null;
  while (out.length < count) {
    const code = read();
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code];
    else entry = [...prev!, prev![0]];
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === 1 << size && size < 12) size++;
  }
  return out;
}

describe('gif', () => {
  it('LZW round-trips, including table resets', () => {
    const n = 40_000;
    const input = new Uint8Array(n);
    let seed = 7;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      input[i] = (seed >> 16) & 15;
    }
    const enc = lzwEncode(input, 4);
    expect(lzwDecode(enc, 4, n)).toEqual([...input]);
  });

  it('writes a looping GIF89a with one image per frame', () => {
    const px = new Uint32Array([rgba(255, 0, 0), 0, rgba(0, 0, 255), rgba(255, 0, 0)]);
    const gif = encodeGif([{ pixels: px, delayMs: 100 }, { pixels: px, delayMs: 200 }], 2, 2);
    const ascii = String.fromCharCode(...gif);
    expect(ascii.startsWith('GIF89a')).toBe(true);
    expect(ascii).toContain('NETSCAPE2.0');
    expect(gif[gif.length - 1]).toBe(0x3b);
    expect(gif[6] | (gif[7] << 8)).toBe(2);
  });
});

describe('sprite sheet', () => {
  it('packs frames in a row with Aseprite-style JSON', () => {
    const doc = createDocument(2, 2, []);
    insertFrame(doc, 1);
    insertFrame(doc, 2);
    doc.layers[0].cels[2][0] = rgba(1, 2, 3);
    doc.tags.push({ name: 'walk', from: 0, to: 2, direction: 'forward' });
    const { image, json } = buildSpriteSheet(doc, { layout: 'row', scale: 1, padding: 1, imageName: 'hero.png' });
    expect(image.width).toBe(2 * 3 + 2);
    expect(image.height).toBe(2);
    expect(image.data[6]).toBe(rgba(1, 2, 3));
    const j = json as { frames: Record<string, { frame: { x: number } }>; meta: { frameTags: unknown[] } };
    expect(j.frames['hero 2.png'].frame.x).toBe(6);
    expect(j.meta.frameTags).toHaveLength(1);
  });

  it('grid layout and scaling', () => {
    const doc = createDocument(1, 1, []);
    for (let i = 1; i < 5; i++) insertFrame(doc, i);
    const { image } = buildSpriteSheet(doc, { layout: 'grid', scale: 2, padding: 0, imageName: 'a.png' });
    expect([image.width, image.height]).toEqual([6, 4]);
    const s = scaleRaster({ width: 1, height: 1, data: new Uint32Array([5]) }, 3);
    expect([...s.data]).toEqual(Array(9).fill(5));
  });
});
