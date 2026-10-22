/**
 * Minimal animated GIF89a encoder. Pixel art rarely exceeds 255 colours, so
 * we build an exact palette from the frames (index 0 is transparent) and only
 * fall back to nearest-colour mapping when there are more.
 */

export interface GifFrame {
  /** Packed RGBA pixels, `width * height`. */
  pixels: Uint32Array;
  delayMs: number;
}

export function encodeGif(frames: GifFrame[], width: number, height: number, loop = true): Uint8Array {
  const { palette, indexOf } = buildPalette(frames);

  let bits = 1;
  while (1 << bits < palette.length) bits++;
  const tableSize = 1 << bits;

  const out = new ByteWriter();
  out.str('GIF89a');
  out.u16(width);
  out.u16(height);
  out.u8(0x80 | 0x70 | (bits - 1)); // global table, 8-bit resolution, size
  out.u8(0); // background index
  out.u8(0); // aspect ratio
  for (let i = 0; i < tableSize; i++) {
    const c = palette[i] ?? 0;
    out.u8(c & 255);
    out.u8((c >>> 8) & 255);
    out.u8((c >>> 16) & 255);
  }

  if (loop && frames.length > 1) {
    out.u8(0x21);
    out.u8(0xff);
    out.u8(11);
    out.str('NETSCAPE2.0');
    out.u8(3);
    out.u8(1);
    out.u16(0); // loop forever
    out.u8(0);
  }

  const minCode = Math.max(2, bits);
  const indices = new Uint8Array(width * height);
  for (const frame of frames) {
    // Graphic control: dispose to background so transparent areas don't smear.
    out.u8(0x21);
    out.u8(0xf9);
    out.u8(4);
    out.u8((2 << 2) | 1);
    out.u16(Math.max(2, Math.round(frame.delayMs / 10)));
    out.u8(0);
    out.u8(0);

    out.u8(0x2c);
    out.u16(0);
    out.u16(0);
    out.u16(width);
    out.u16(height);
    out.u8(0);

    for (let i = 0; i < indices.length; i++) indices[i] = indexOf(frame.pixels[i]);
    out.u8(minCode);
    const data = lzwEncode(indices, minCode);
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      out.u8(n);
      out.bytes(data.subarray(i, i + n));
    }
    out.u8(0);
  }
  out.u8(0x3b);
  return out.finish();
}

function buildPalette(frames: GifFrame[]) {
  const counts = new Map<number, number>();
  for (const f of frames) {
    for (let i = 0; i < f.pixels.length; i++) {
      const c = f.pixels[i];
      if (c >>> 24 < 128) continue;
      const rgb = c & 0xffffff;
      counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const palette = [0, ...sorted.slice(0, 255)];
  const exact = new Map<number, number>();
  palette.forEach((c, i) => i > 0 && exact.set(c, i));
  const indexOf = (c: number): number => {
    if (c >>> 24 < 128) return 0;
    const rgb = c & 0xffffff;
    const hit = exact.get(rgb);
    if (hit !== undefined) return hit;
    let best = 1;
    let bestD = Infinity;
    for (let i = 1; i < palette.length; i++) {
      const p = palette[i];
      const dr = (p & 255) - (rgb & 255);
      const dg = ((p >>> 8) & 255) - ((rgb >>> 8) & 255);
      const db = ((p >>> 16) & 255) - ((rgb >>> 16) & 255);
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    exact.set(rgb, best);
    return best;
  };
  return { palette, indexOf };
}

export function lzwEncode(indices: Uint8Array, minCode: number): Uint8Array {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let codeSize = minCode + 1;
  let next = eoi + 1;
  let dict = new Map<number, number>();
  const out = new ByteWriter();
  let acc = 0;
  let accBits = 0;
  const emit = (code: number) => {
    acc |= code << accBits;
    accBits += codeSize;
    while (accBits >= 8) {
      out.u8(acc & 255);
      acc >>>= 8;
      accBits -= 8;
    }
  };

  emit(clear);
  if (indices.length === 0) {
    emit(eoi);
    if (accBits > 0) out.u8(acc & 255);
    return out.finish();
  }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      dict = new Map();
      codeSize = minCode + 1;
      next = eoi + 1;
    } else {
      if (next >= 1 << codeSize) codeSize++;
      dict.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (accBits > 0) out.u8(acc & 255);
  return out.finish();
}

class ByteWriter {
  private buf = new Uint8Array(4096);
  private len = 0;

  private grow(n: number) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const b = new Uint8Array(cap);
    b.set(this.buf.subarray(0, this.len));
    this.buf = b;
  }

  u8(v: number) {
    this.grow(1);
    this.buf[this.len++] = v & 255;
  }

  u16(v: number) {
    this.u8(v);
    this.u8(v >> 8);
  }

  str(s: string) {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  }

  bytes(b: Uint8Array) {
    this.grow(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}
