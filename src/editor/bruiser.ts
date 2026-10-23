import { Color, hexToColor } from '../core/color';
import { SpriteDoc, createDocument, insertFrame, insertLayer } from '../core/document';

/**
 * A full-height 180×320 character built from Micah's pencil sketch: a
 * bean-headed bruiser with an antenna, sleepy eyes behind square glasses,
 * gloves, boots and a big belt buckle.
 *
 * The body is described as regions (head, pecs, delts, abs, thighs...) that
 * each get rim shading lit from the upper left, so every muscle reads as its
 * own rounded form. Regions of the same material are split by a soft dark
 * line; the silhouette gets a hard outline. The face sits on its own layer
 * so the blink frame only redraws the eyes.
 */

const W = 180;
const H = 320;

/** Ramps run outline, dark, mid, light, highlight. */
type Ramp = [Color, Color, Color, Color, Color];
const ramp = (...hex: string[]) => hex.map(hexToColor) as Ramp;

const SKIN = ramp('1d3b33', '3f7f58', '62a967', '8fcf78', 'c3eaa0');
const GLOVE = ramp('0f0b19', '1d1630', '2e2448', '473a6c', '6c5d98');
const BRIEFS = ramp('3a0d1c', '7c1f2e', 'b4343c', 'dc5a48', 'f28c6a');
const BELT = ramp('2a1712', '4d2c1f', '7a4630', 'a0663f', 'c48c5c');
const GOLD = ramp('4a2c0c', '94621a', 'd6a12a', 'f5d35a', 'fff2b0');
const BULB = ramp('4a1414', 'a8341e', 'ee6a2a', 'ffa548', 'ffe08a');

const FACE = {
  frame: hexToColor('17142a'),
  white: hexToColor('f4f1e6'),
  whiteShade: hexToColor('c9c6c0'),
  pupil: hexToColor('17142a'),
  glint: hexToColor('ffffff'),
  lens: hexToColor('b9e6ee'),
};
const SHADOW = hexToColor('17142a');

type Pt = [number, number];

/** The jagged collar line, left half, where the head meets the traps. */
const COLLAR: Pt[] = [[62, 87], [66, 93], [72, 88], [78, 92], [83, 87], [90, 91]];

interface Region {
  ramp: Ramp;
  /** Rim shading: how far the light and shadow reach in from the edge. */
  soft?: boolean;
}

/** A tiny scanline rasterizer that paints region ids. */
class RegionMap {
  ids = new Int16Array(W * H).fill(-1);
  regions: Region[] = [];

  add(r: Region): number {
    this.regions.push(r);
    return this.regions.length - 1;
  }

  set(x: number, y: number, id: number) {
    if (x >= 0 && y >= 0 && x < W && y < H) this.ids[y * W + x] = id;
  }

  get(x: number, y: number): number {
    return x >= 0 && y >= 0 && x < W && y < H ? this.ids[y * W + x] : -1;
  }

  poly(pts: Pt[], id: number, clip?: number) {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [, y] of pts) {
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      const cy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.round(xs[i]); x < Math.round(xs[i + 1]); x++) {
          if (clip === undefined || this.get(x, y) === clip) this.set(x, y, id);
        }
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, id: number, clip?: number) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1 && (clip === undefined || this.get(x, y) === clip)) this.set(x, y, id);
      }
    }
  }
}

/** Mirror a left-side shape across the body's center line. */
const mirror = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [W - x, y] as Pt).reverse();

/** Sample a cubic Bézier, for the antenna and other curved strokes. */
function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, steps = 60): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

function buildBody(): Uint32Array {
  const m = new RegionMap();
  const both = (pts: Pt[], r: Region) => {
    const id = m.add(r);
    m.poly(pts, id);
    m.poly(mirror(pts), id);
    return id;
  };
  const each = (pts: Pt[], r: Region) => {
    m.poly(pts, m.add(r));
    m.poly(mirror(pts), m.add(r));
  };

  // Antenna stalk: a thick curve from the crown, leaning right, with a bulb.
  const stalk = m.add({ ramp: SKIN });
  for (const [x, y] of bezier([93, 25], [93, 14], [97, 7], [106, 6])) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 0; dy++) m.set(Math.round(x + dx), Math.round(y + dy), stalk);
  }
  for (const [x, y] of bezier([97, 9], [99, 4], [104, 2], [109, 3], 30)) m.set(Math.round(x), Math.round(y), stalk);
  m.ellipse(115, 5, 7, 4, m.add({ ramp: BULB }));

  // Arms first so the shoulders and torso sit in front of them.
  each(
    [[24, 120], [36, 112], [50, 118], [52, 140], [50, 165], [48, 192], [24, 192], [21, 170], [21, 140]],
    { ramp: SKIN },
  );
  // Gloves: forearm, palm, a thumb on the inside and curled fingers.
  each(
    [[24, 191], [48, 191], [48, 214], [50, 227], [54, 236], [55, 246], [52, 251], [48, 245], [45, 240], [44, 250], [41, 259], [37, 265], [31, 266], [26, 262], [23, 252], [20, 238], [20, 222], [22, 205]],
    { ramp: GLOVE },
  );
  each([[22, 181], [49, 181], [50, 192], [21, 192]], { ramp: GLOVE });

  // Legs: thighs, shins, then boots and splayed pointed feet.
  each([[64, 190], [90, 196], [90, 247], [70, 247], [65, 225]], { ramp: SKIN });
  each([[69, 247], [90, 247], [90, 268], [71, 268]], { ramp: SKIN });
  each([[72, 278], [90, 278], [90, 304], [80, 312], [70, 314], [58, 316], [55, 313], [72, 302]], { ramp: GLOVE });
  each([[69, 266], [90, 266], [90, 279], [70, 279]], { ramp: GLOVE });

  // Torso: one big chest and shoulder mass with a narrower waist.
  const torso = both(
    [[90, 84], [70, 86], [56, 90], [42, 97], [30, 106], [22, 124], [24, 136], [36, 142], [48, 140], [50, 160], [56, 178], [58, 186], [90, 186]],
    { ramp: SKIN },
  );
  // Deltoids: round caps over the shoulders.
  for (const flip of [false, true]) {
    const id = m.add({ ramp: SKIN });
    m.ellipse(flip ? W - 35 : 35, 122, 15, 20, id, torso);
  }
  // Pecs.
  each([[89, 103], [62, 102], [50, 114], [50, 132], [62, 140], [80, 141], [89, 137]], { ramp: SKIN });
  // Abs: three rows of blocks, plus obliques along the sides.
  each([[56, 141], [62, 141], [62, 175], [58, 182], [54, 165]], { ramp: SKIN });
  each([[63, 142], [88, 142], [88, 152], [64, 153]], { ramp: SKIN });
  each([[64, 154], [88, 153], [88, 163], [65, 164]], { ramp: SKIN });
  each([[65, 165], [88, 164], [88, 174], [66, 175]], { ramp: SKIN });

  // Head: a pear-shaped bean that flares into the neck and traps.
  const head: Pt[] = [];
  for (const [x, y] of bezier([90, 23], [80, 23], [71, 30], [70, 42])) head.push([x, y]);
  for (const [x, y] of bezier([70, 42], [69, 60], [70, 78], [56, 90], 24)) head.push([x, y]);
  head.push([56, 90], ...COLLAR);
  both(head, { ramp: SKIN });

  // Belt, buckle and briefs.
  const belt = m.add({ ramp: BELT });
  m.poly([[57, 174], [123, 174], [124, 185], [56, 185]], belt);
  const briefs = m.add({ ramp: BRIEFS });
  m.poly([[58, 186], [122, 186], [116, 196], [100, 202], [90, 205], [80, 202], [64, 196]], briefs);
  m.ellipse(90, 180, 8, 7.5, m.add({ ramp: GOLD }));

  const out = new Uint32Array(W * H);
  const lx = -1;
  const ly = -0.55;
  const reach = (x: number, y: number, id: number, dx: number, dy: number) => {
    for (let k = 1; k < 60; k++) if (m.get(Math.round(x + dx * k), Math.round(y + dy * k)) !== id) return k;
    return 60;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const id = m.get(x, y);
      if (id < 0) continue;
      const r = m.regions[id].ramp;
      const lit = reach(x, y, id, lx, ly);
      const dark = reach(x, y, id, -lx, -ly);
      const t = lit / (lit + dark);
      const span = lit + dark;
      let c = r[2];
      if (t > 0.8 || dark <= 2) c = r[1];
      else if (t < 0.13 && span > 14) c = r[4];
      else if (t < 0.42) c = r[3];
      out[y * W + x] = c;
    }
  }
  // Lines: hard outline on the silhouette, soft dark lines between regions.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const id = m.get(x, y);
      if (id < 0) continue;
      const r = m.regions[id].ramp;
      const n = [m.get(x - 1, y), m.get(x + 1, y), m.get(x, y - 1), m.get(x, y + 1)];
      if (n.includes(-1)) out[y * W + x] = r[0];
      else {
        // Only one side of a seam draws, so lines stay 1px.
        const right = m.get(x + 1, y);
        const below = m.get(x, y + 1);
        const seam = right !== id ? right : below !== id ? below : id;
        if (seam !== id) out[y * W + x] = m.regions[seam].ramp === r ? r[1] : r[0];
      }
    }
  }

  const px = (x: number, y: number, c: Color) => {
    if (x >= 0 && y >= 0 && x < W && y < H && m.get(x, y) >= 0) out[y * W + x] = c;
  };
  const line = (pts: Pt[], c: Color) => pts.forEach(([x, y]) => px(Math.round(x), Math.round(y), c));
  const sym = (fn: (s: (x: number) => number) => void) => {
    fn((x) => x);
    fn((x) => W - 1 - x);
  };

  // Jagged collar where the head meets the shoulders.
  const collar: Pt[] = [[56, 90], ...COLLAR];
  sym((s) => {
    for (let i = 0; i + 1 < collar.length; i++) {
      const [a, b] = [collar[i], collar[i + 1]];
      for (let k = 0; k <= 8; k++) {
        const x = a[0] + ((b[0] - a[0]) * k) / 8;
        const y = a[1] + ((b[1] - a[1]) * k) / 8;
        px(s(Math.round(x)), Math.round(y), SKIN[0]);
        px(s(Math.round(x)), Math.round(y) + 1, SKIN[1]);
      }
    }
  });
  // Belt holes and buckle prong.
  for (const x of [64, 71, 108, 115]) {
    px(x, 179, BELT[0]);
    px(x + 1, 179, BELT[0]);
    px(x, 180, BELT[0]);
    px(x + 1, 180, BELT[4]);
  }
  line(bezier([90, 174], [88, 178], [92, 182], [89, 187], 12), GOLD[0]);
  // Knee creases and the line between the thighs.
  sym((s) => {
    for (let x = 75; x <= 83; x++) px(s(x), x < 79 ? 245 : 244, SKIN[1]);
    for (let x = 68; x <= 72; x++) px(s(x), 233 + (x - 68), SKIN[1]);
  });
  // Navel and sternum.
  px(89, 170, SKIN[1]);
  px(90, 170, SKIN[1]);
  px(89, 171, SKIN[0]);
  px(90, 171, SKIN[0]);
  // Finger gaps in the gloves.
  sym((s) => {
    line(bezier([s(45), 239], [s(46), 243], [s(45), 246], [s(44), 249], 12), GLOVE[0]);
    line(bezier([s(30), 249], [s(31), 254], [s(33), 258], [s(33), 263], 16), GLOVE[0]);
    line(bezier([s(37), 247], [s(38), 251], [s(39), 255], [s(38), 259], 16), GLOVE[0]);
  });

  // Ground shadow under the feet.
  for (let y = 312; y < 319; y++) {
    for (let x = 30; x < 150; x++) {
      const nx = (x + 0.5 - 90) / 58;
      const ny = (y + 0.5 - 315.5) / 3.5;
      if (nx * nx + ny * ny <= 1 && !out[y * W + x]) out[y * W + x] = (SHADOW & 0x00ffffff) | (110 << 24);
    }
  }
  return out;
}

function drawFace(cel: Uint32Array, blink: boolean) {
  const px = (x: number, y: number, c: Color) => {
    if (x >= 0 && y >= 0 && x < W && y < H) cel[y * W + x] = c;
  };
  const hline = (x0: number, x1: number, y: number, c: Color) => {
    for (let x = x0; x <= x1; x++) px(x, y, c);
  };
  const vline = (x: number, y0: number, y1: number, c: Color) => {
    for (let y = y0; y <= y1; y++) px(x, y, c);
  };

  // Square glasses: two rounded frames and a bridge.
  for (const [x0, x1] of [[70, 88], [92, 110]]) {
    for (let y = 42; y <= 52; y++) for (let x = x0 + 1; x < x1; x++) px(x, y, FACE.lens);
    hline(x0 + 1, x1 - 1, 41, FACE.frame);
    hline(x0 + 1, x1 - 1, 53, FACE.frame);
    vline(x0, 42, 52, FACE.frame);
    vline(x1, 42, 52, FACE.frame);

    // Sleepy eyes: a heavy lid over the top half, pupil resting low.
    const cx = (x0 + x1) / 2;
    if (blink) {
      hline(cx - 6, cx + 5, 48, SKIN[0]);
      px(cx - 7, 47, SKIN[0]);
      px(cx + 6, 47, SKIN[0]);
      continue;
    }
    for (let y = 44; y <= 51; y++) {
      for (let x = x0 + 2; x <= x1 - 2; x++) {
        const nx = (x + 0.5 - (cx + 0.5)) / 7;
        const ny = (y + 0.5 - 47.5) / 4;
        if (nx * nx + ny * ny <= 1) px(x, y, y > 49 ? FACE.whiteShade : FACE.white);
      }
    }
    for (let y = 43; y <= 46; y++) {
      for (let x = x0 + 2; x <= x1 - 2; x++) {
        const nx = (x + 0.5 - (cx + 0.5)) / 7.5;
        const ny = (y + 0.5 - 47.5) / 4.5;
        if (nx * nx + ny * ny <= 1) px(x, y, y === 46 ? SKIN[1] : SKIN[2]);
      }
    }
    hline(cx - 6, cx + 6, 47, SKIN[0]);
    for (let y = 48; y <= 50; y++) hline(cx - 1, cx + 2, y, FACE.pupil);
    px(cx - 1, 48, FACE.glint);
  }
  hline(89, 91, 44, FACE.frame);
  // Glasses arms run back to the sides of the head.
  hline(67, 69, 44, FACE.frame);
  hline(111, 113, 44, FACE.frame);

  // Long nose: a lit ridge with a shadowed right side and a round tip.
  for (let y = 53; y <= 64; y++) {
    px(86, y, SKIN[0]);
    hline(87, 89, y, SKIN[3]);
    hline(90, 91, y, SKIN[2]);
    px(92, y, SKIN[1]);
    px(93, y, SKIN[0]);
  }
  for (let y = 62; y <= 71; y++) {
    for (let x = 82; x <= 98; x++) {
      const nx = (x + 0.5 - 90) / 7;
      const ny = (y + 0.5 - 67) / 4.5;
      const d = nx * nx + ny * ny;
      if (d > 1 || (y < 64 && Math.abs(x + 0.5 - 90) > 3.5)) continue;
      const lit = x < 89 && y < 67;
      px(x, y, d > 0.72 ? SKIN[0] : lit ? SKIN[4] : x > 92 || y > 68 ? SKIN[1] : SKIN[2]);
    }
  }
  px(86, 69, SKIN[0]);
  px(87, 69, SKIN[0]);
  px(93, 69, SKIN[0]);
  px(94, 69, SKIN[0]);

  // Flat mouth with little ticks at the corners, tucked behind the nose.
  hline(72, 82, 67, SKIN[0]);
  hline(98, 108, 67, SKIN[0]);
  vline(71, 65, 69, SKIN[0]);
  vline(109, 65, 69, SKIN[0]);
  hline(72, 82, 68, SKIN[1]);
  hline(98, 108, 68, SKIN[1]);
}

export function bruiserSprite(): SpriteDoc {
  const palette = new Set([...[SKIN, GLOVE, BRIEFS, BELT, GOLD, BULB].flat(), ...Object.values(FACE), SHADOW]);
  const doc = createDocument(W, H, [...palette]);
  doc.layers[0].name = 'Body';
  const face = insertLayer(doc, 1, 'Face');
  insertFrame(doc, 1);
  doc.frames[0].duration = 2200;
  doc.frames[1].duration = 140;
  doc.tags.push({ name: 'idle', from: 0, to: 1, direction: 'forward' });

  const body = buildBody();
  doc.layers[0].cels[0].set(body);
  doc.layers[0].cels[1].set(body);
  drawFace(face.cels[0], false);
  drawFace(face.cels[1], true);
  return doc;
}
