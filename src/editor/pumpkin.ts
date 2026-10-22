import { hexToColor } from '../core/color';
import { SpriteDoc, createDocument, insertFrame, insertLayer } from '../core/document';
import { paletteColors } from '../core/palettes';
import { Rect, ellipsePixels } from '../core/raster';

/**
 * A talking jack-o'-lantern: 10 frames of mouth shapes on its own Face
 * layer, so the Body layer can be redrawn without touching the lip-sync.
 */

type Mouth = { kind: 'closed' } | { kind: 'open'; w: number; h: number } | { kind: 'oo'; size: number } | { kind: 'ee'; w: number };

interface Pose {
  mouth: Mouth;
  /** Body squash: positive makes it taller and narrower. */
  stretch: number;
  lift: number;
  blink?: boolean;
  duration: number;
}

const POSES: Pose[] = [
  { mouth: { kind: 'closed' }, stretch: 0, lift: 0, duration: 140 },
  { mouth: { kind: 'open', w: 6, h: 3 }, stretch: 0, lift: 0, duration: 80 },
  { mouth: { kind: 'open', w: 10, h: 5 }, stretch: 1, lift: 1, duration: 100 },
  { mouth: { kind: 'open', w: 8, h: 4 }, stretch: 0, lift: 0, duration: 80 },
  { mouth: { kind: 'oo', size: 4 }, stretch: 1, lift: 1, duration: 110 },
  { mouth: { kind: 'ee', w: 12 }, stretch: -1, lift: 0, duration: 90 },
  { mouth: { kind: 'open', w: 10, h: 6 }, stretch: 1, lift: 1, duration: 110 },
  { mouth: { kind: 'open', w: 6, h: 3 }, stretch: 0, lift: 0, duration: 80 },
  { mouth: { kind: 'closed' }, stretch: 0, lift: 0, duration: 120 },
  { mouth: { kind: 'closed' }, stretch: 0, lift: 0, blink: true, duration: 120 },
];

export function pumpkinSprite(): SpriteDoc {
  const W = 32;
  const doc = createDocument(W, W, paletteColors('db32'));
  doc.layers[0].name = 'Shadow';
  doc.layers[0].opacity = 120;
  const body = insertLayer(doc, 1, 'Body');
  const face = insertLayer(doc, 2, 'Face');
  for (let i = 1; i < POSES.length; i++) insertFrame(doc, i);
  POSES.forEach((p, i) => (doc.frames[i].duration = p.duration));
  doc.tags.push({ name: 'talk', from: 0, to: POSES.length - 1, direction: 'forward' });

  const c = {
    outline: hexToColor('45283c'),
    rib: hexToColor('8f563b'),
    shade: hexToColor('c0581f'),
    body: hexToColor('df7126'),
    light: hexToColor('d9a066'),
    shine: hexToColor('eec39a'),
    stem: hexToColor('4b692f'),
    stemDark: hexToColor('323c39'),
    leaf: hexToColor('6abe30'),
    glow: hexToColor('fbf236'),
    glowEdge: hexToColor('d9a066'),
    cavity: hexToColor('222034'),
    tongue: hexToColor('ac3232'),
    tooth: hexToColor('eec39a'),
  };

  POSES.forEach((pose, f) => {
    const put = (cel: Uint32Array) => (x: number, y: number, col: number) => {
      if (x >= 0 && y >= 0 && x < W && y < W) cel[y * W + x] = col;
    };
    const B = put(body.cels[f]);
    const F = put(face.cels[f]);
    const S = put(doc.layers[0].cels[f]);

    // Body: a wide ellipse with two rib lines, shaded on the right and bottom.
    const bw = 24 - pose.stretch * 2;
    const bh = 19 + pose.stretch;
    const bottom = 28 - pose.lift;
    const r: Rect = { x: 16 - bw / 2, y: bottom - bh + 1, w: bw, h: bh };
    for (const q of ellipsePixels(r, true)) {
      const dx = (q.x + 0.5 - 16) / (bw / 2);
      const dy = (q.y + 0.5 - (r.y + bh / 2)) / (bh / 2);
      B(q.x, q.y, dx > 0.45 || dy > 0.55 ? c.shade : c.body);
    }
    // Ribs are deep near the stem and the base, and fade across the face.
    for (const ribW of [bw - 8, 8]) {
      const rr: Rect = { x: 16 - ribW / 2, y: r.y, w: ribW, h: bh };
      for (const q of ellipsePixels(rr, false)) {
        if (q.y <= r.y + 1 || q.y >= r.y + bh - 2) continue;
        const ends = q.y < r.y + 5 || q.y > r.y + bh - 5;
        B(q.x, q.y, ends ? c.rib : c.shade);
      }
    }
    for (const q of ellipsePixels(r, false)) B(q.x, q.y, c.outline);
    // Highlight on the upper left.
    const hx = r.x + 3;
    const hy = r.y + 3;
    B(hx, hy + 2, c.light);
    B(hx, hy + 3, c.light);
    B(hx + 1, hy + 1, c.light);
    B(hx + 1, hy, c.shine);
    B(hx + 2, hy, c.light);

    // Stem and leaf, riding on top of the body.
    const top = r.y;
    for (let y = top - 4; y <= top; y++) {
      B(15, y, c.stem);
      B(16, y, c.stem);
      B(14, y, c.stemDark);
      B(17, y, c.stemDark);
    }
    B(15, top - 5, c.stemDark);
    B(16, top - 5, c.stemDark);
    B(17, top - 4, c.stem);
    B(18, top - 5, c.stemDark);
    const leafY = top - 2;
    for (const [x, y] of [
      [18, leafY], [19, leafY], [20, leafY - 1], [21, leafY - 1], [19, leafY - 1], [22, leafY - 2],
    ]) B(x, y, c.leaf);
    for (const [x, y] of [[20, leafY], [21, leafY], [22, leafY - 1], [23, leafY - 2], [18, leafY + 1]]) B(x, y, c.stem);

    // Eyes: carved triangles glowing from inside, or shut for the blink.
    const ey = top + 6;
    for (const cx of [11, 20]) {
      if (pose.blink) {
        for (let x = cx - 2; x <= cx + 2; x++) F(x, ey + 2, c.outline);
        F(cx - 3, ey + 1, c.outline);
        F(cx + 3, ey + 1, c.outline);
        continue;
      }
      for (let row = 0; row < 4; row++) {
        for (let x = cx - row; x <= cx + row; x++) {
          const edge = x === cx - row || x === cx + row || row === 3;
          F(x, ey + row, edge ? c.glowEdge : c.glow);
        }
      }
      F(cx, ey + 2, c.cavity);
    }

    // Mouth.
    const my = top + 12;
    const m = pose.mouth;
    if (m.kind === 'closed') {
      for (let x = 11; x <= 21; x++) F(x, my + 1, c.outline);
      F(10, my, c.outline);
      F(22, my, c.outline);
      F(9, my - 1, c.outline);
      F(23, my - 1, c.outline);
    } else if (m.kind === 'ee') {
      const x0 = 16 - m.w / 2;
      for (let x = x0; x < x0 + m.w; x++) {
        F(x, my, c.glowEdge);
        F(x, my + 1, x % 2 ? c.tooth : c.cavity);
        F(x, my + 2, c.glowEdge);
      }
      F(x0 - 1, my, c.glowEdge);
      F(x0 + m.w, my, c.glowEdge);
    } else {
      const w = m.kind === 'oo' ? m.size : m.w;
      const h = m.kind === 'oo' ? m.size : m.h;
      const mr: Rect = { x: 16 - Math.floor(w / 2), y: my - Math.floor(h / 3), w, h };
      for (const q of ellipsePixels(mr, true)) F(q.x, q.y, c.cavity);
      if (h >= 4) {
        const tongue: Rect = { x: mr.x + 2, y: mr.y + h - 2, w: Math.max(2, w - 4), h: 2 };
        for (const q of ellipsePixels(tongue, true)) F(q.x, q.y, c.tongue);
      }
      for (const q of ellipsePixels(mr, false)) F(q.x, q.y, c.glowEdge);
      if (m.kind === 'open' && w >= 8) {
        // Two carved teeth hanging from the top lip.
        F(mr.x + 2, mr.y + 1, c.tooth);
        F(mr.x + w - 3, mr.y + 1, c.tooth);
      }
    }

    // Ground shadow shrinks as the pumpkin lifts.
    const sw = pose.lift ? 18 : 22;
    for (const q of ellipsePixels({ x: 16 - sw / 2, y: 28, w: sw, h: 3 }, true)) S(q.x, q.y, c.cavity);
  });
  return doc;
}
