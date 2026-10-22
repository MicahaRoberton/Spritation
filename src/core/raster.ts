import { Color } from './color';

/** Pixel algorithms shared by the drawing tools. All coordinates are integers. */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Raster {
  width: number;
  height: number;
  data: Uint32Array;
}

export function rectFromPoints(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}

export function clipRect(r: Rect, width: number, height: number): Rect | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(width, r.x + r.w);
  const y1 = Math.min(height, r.y + r.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

/** Calls `plot` for every pixel on the line, endpoints included. */
export function bresenham(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number) => void): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** Snaps `to` so the line from `from` is horizontal, vertical or 45 degrees. */
export function snapAngle(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx > ady * 2) return { x: to.x, y: from.y };
  if (ady > adx * 2) return { x: from.x, y: to.y };
  const d = Math.max(adx, ady);
  return { x: from.x + Math.sign(dx) * d, y: from.y + Math.sign(dy) * d };
}

/** Makes the box from `from` to `to` square, keeping the drag direction. */
export function squareFrom(from: Point, to: Point): Point {
  const d = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  return { x: from.x + (to.x >= from.x ? d : -d), y: from.y + (to.y >= from.y ? d : -d) };
}

export type BrushShape = 'square' | 'circle';

const brushCache = new Map<string, Point[]>();

/** Offsets covered by a brush of `size`, centred on the cursor pixel. */
export function brushOffsets(size: number, shape: BrushShape): Point[] {
  const key = `${size}:${shape}`;
  const cached = brushCache.get(key);
  if (cached) return cached;
  const out: Point[] = [];
  const start = -Math.floor((size - 1) / 2);
  const c = (size - 1) / 2;
  const r2 = (size / 2 - 0.25) ** 2;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      if (shape === 'circle' && size > 2 && (dx - c) ** 2 + (dy - c) ** 2 > r2) continue;
      out.push({ x: start + dx, y: start + dy });
    }
  }
  brushCache.set(key, out);
  return out;
}

export function rectPixels(r: Rect, filled: boolean): Point[] {
  const out: Point[] = [];
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (filled || y === r.y || y === r.y + r.h - 1 || x === r.x || x === r.x + r.w - 1) out.push({ x, y });
    }
  }
  return out;
}

/** Pixels of the ellipse inscribed in `r`; the outline is 1px and 4-connected-safe. */
export function ellipsePixels(r: Rect, filled: boolean): Point[] {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rx = r.w / 2;
  const ry = r.h / 2;
  const inside = (x: number, y: number) => {
    if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) return false;
    const nx = (x + 0.5 - cx) / rx;
    const ny = (y + 0.5 - cy) / ry;
    return nx * nx + ny * ny <= 1.0001;
  };
  const out: Point[] = [];
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (!inside(x, y)) continue;
      if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) {
        out.push({ x, y });
      }
    }
  }
  return out;
}

/**
 * Pixel-perfect strokes drop the middle pixel of an L-shaped corner so
 * freehand 1px lines don't get doubled-up "stairs".
 */
export function isLCorner(a: Point, b: Point, c: Point): boolean {
  return (
    Math.abs(a.x - c.x) === 1 &&
    Math.abs(a.y - c.y) === 1 &&
    (a.x === b.x || a.y === b.y) &&
    (b.x === c.x || b.y === c.y)
  );
}

/**
 * Fills from (x, y). Contiguous fills spread to 4-connected neighbours of the
 * same colour; otherwise every pixel of that colour changes. Pixels outside
 * `clip` are left alone. Returns false if nothing changed.
 */
export function floodFill(r: Raster, x: number, y: number, color: Color, contiguous: boolean, clip?: Rect | null): boolean {
  const { width: w, height: h, data } = r;
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  if (clip && !rectContains(clip, x, y)) return false;
  const target = data[y * w + x];
  if (target === color) return false;
  const ok = (px: number, py: number) => !clip || rectContains(clip, px, py);
  if (!contiguous) {
    for (let i = 0; i < data.length; i++) {
      if (data[i] === target && ok(i % w, (i / w) | 0)) data[i] = color;
    }
    return true;
  }
  const stack = [x, y];
  while (stack.length) {
    const py = stack.pop()!;
    let px = stack.pop()!;
    while (px >= 0 && data[py * w + px] === target && ok(px, py)) px--;
    px++;
    let up = false;
    let down = false;
    while (px < w && data[py * w + px] === target && ok(px, py)) {
      data[py * w + px] = color;
      if (py > 0) {
        const m = data[(py - 1) * w + px] === target && ok(px, py - 1);
        if (m && !up) stack.push(px, py - 1);
        up = m;
      }
      if (py < h - 1) {
        const m = data[(py + 1) * w + px] === target && ok(px, py + 1);
        if (m && !down) stack.push(px, py + 1);
        down = m;
      }
      px++;
    }
  }
  return true;
}

export function copyRegion(r: Raster, rect: Rect): Raster {
  const out = new Uint32Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const sx = rect.x + x;
      const sy = rect.y + y;
      if (sx >= 0 && sy >= 0 && sx < r.width && sy < r.height) out[y * rect.w + x] = r.data[sy * r.width + sx];
    }
  }
  return { width: rect.w, height: rect.h, data: out };
}

export function clearRegion(r: Raster, rect: Rect): void {
  const c = clipRect(rect, r.width, r.height);
  if (!c) return;
  for (let y = c.y; y < c.y + c.h; y++) r.data.fill(0, y * r.width + c.x, y * r.width + c.x + c.w);
}

/** Pastes `src` at (dx, dy); transparent source pixels keep what's underneath. */
export function pasteRegion(dst: Raster, src: Raster, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= dst.width) continue;
      const c = src.data[y * src.width + x];
      if (c >>> 24) dst.data[ty * dst.width + tx] = c;
    }
  }
}

export function flipRegion(r: Raster, rect: Rect, axis: 'h' | 'v'): void {
  const c = clipRect(rect, r.width, r.height);
  if (!c) return;
  const copy = copyRegion(r, c);
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const sx = axis === 'h' ? c.w - 1 - x : x;
      const sy = axis === 'v' ? c.h - 1 - y : y;
      r.data[(c.y + y) * r.width + c.x + x] = copy.data[sy * c.w + sx];
    }
  }
}

/** Replaces every pixel of colour `from` with `to`; used for palette swaps. */
export function replaceColor(r: Raster, from: Color, to: Color): number {
  let n = 0;
  for (let i = 0; i < r.data.length; i++) {
    if (r.data[i] === from) {
      r.data[i] = to;
      n++;
    }
  }
  return n;
}
