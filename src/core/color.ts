/**
 * Colors are packed 32-bit RGBA integers in the platform's (little-endian)
 * byte order, i.e. 0xAABBGGRR. This lets a cel's Uint32Array share its buffer
 * with an ImageData's Uint8ClampedArray without conversion.
 */
export type Color = number;

export const TRANSPARENT: Color = 0;

export function rgba(r: number, g: number, b: number, a = 255): Color {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export function unpack(c: Color): [number, number, number, number] {
  return [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, c >>> 24];
}

export function alphaOf(c: Color): number {
  return c >>> 24;
}

export function withAlpha(c: Color, a: number): Color {
  return ((c & 0x00ffffff) | ((a & 255) << 24)) >>> 0;
}

export function hexToColor(hex: string): Color {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = [...h].map((ch) => ch + ch).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) throw new Error(`Invalid hex color: ${hex}`);
  const n = parseInt(h.slice(0, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return rgba((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
}

export function colorToHex(c: Color, includeAlpha = false): string {
  const [r, g, b, a] = unpack(c);
  const parts = includeAlpha ? [r, g, b, a] : [r, g, b];
  return '#' + parts.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function colorToCss(c: Color): string {
  const [r, g, b, a] = unpack(c);
  return `rgba(${r},${g},${b},${+(a / 255).toFixed(3)})`;
}

/** Source-over blend of `src` (scaled by `opacity` 0..255) onto `dst`. */
export function blend(dst: Color, src: Color, opacity = 255): Color {
  const sa8 = ((src >>> 24) * opacity) / 255;
  if (sa8 <= 0) return dst;
  if (sa8 >= 255) return (src | 0xff000000) >>> 0;
  const da8 = dst >>> 24;
  if (da8 === 0) return withAlpha(src, Math.round(sa8));
  const sa = sa8 / 255;
  const da = da8 / 255;
  const oa = sa + da * (1 - sa);
  const k = da * (1 - sa);
  const r = ((src & 255) * sa + (dst & 255) * k) / oa;
  const g = (((src >>> 8) & 255) * sa + ((dst >>> 8) & 255) * k) / oa;
  const b = (((src >>> 16) & 255) * sa + ((dst >>> 16) & 255) * k) / oa;
  return rgba(Math.round(r), Math.round(g), Math.round(b), Math.round(oa * 255));
}
