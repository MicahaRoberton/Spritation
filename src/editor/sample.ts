import { hexToColor } from '../core/color';
import { SpriteDoc, createDocument, insertFrame, insertLayer } from '../core/document';
import { paletteColors } from '../core/palettes';
import { ellipsePixels, rectContains } from '../core/raster';

/** The bouncing slime that opens on first launch, so every panel has something in it. */
export function sampleSprite(): SpriteDoc {
  const W = 32;
  const doc = createDocument(W, W, paletteColors('db32'));
  doc.layers[0].name = 'Shadow';
  doc.layers[0].opacity = 110;
  const body = insertLayer(doc, 1, 'Slime');
  for (let i = 1; i < 4; i++) insertFrame(doc, i);
  doc.frames.forEach((f) => (f.duration = 140));
  doc.tags.push({ name: 'bounce', from: 0, to: 3, direction: 'forward' });

  const c = {
    outline: hexToColor('323c39'),
    shade: hexToColor('37946e'),
    body: hexToColor('6abe30'),
    light: hexToColor('99e550'),
    eye: hexToColor('222034'),
    white: hexToColor('ffffff'),
  };
  const poses = [
    { w: 18, h: 13, lift: 0 },
    { w: 21, h: 11, lift: 0 },
    { w: 18, h: 13, lift: 0 },
    { w: 15, h: 15, lift: 3 },
  ];

  poses.forEach((p, f) => {
    const cel = body.cels[f];
    const set = (x: number, y: number, col: number) => {
      if (x >= 0 && y >= 0 && x < W && y < W) cel[y * W + x] = col;
    };
    const bottom = 27 - p.lift;
    const rect = { x: 16 - Math.floor(p.w / 2), y: bottom - p.h + 1, w: p.w, h: p.h };
    for (const q of ellipsePixels(rect, true)) {
      const shaded = q.y > rect.y + rect.h * 0.68 || q.x > rect.x + rect.w * 0.8;
      set(q.x, q.y, shaded ? c.shade : c.body);
    }
    for (const q of ellipsePixels(rect, false)) set(q.x, q.y, c.outline);
    // Flatten the bottom where it sits on the ground.
    if (!p.lift) for (let x = rect.x + 3; x < rect.x + rect.w - 3; x++) set(x, bottom, c.outline);

    const hl = { x: rect.x + 3, y: rect.y + 2 };
    set(hl.x, hl.y + 1, c.light);
    set(hl.x + 1, hl.y, c.light);
    set(hl.x + 1, hl.y + 1, c.white);

    const ey = rect.y + Math.round(p.h * 0.38);
    for (const ex of [16 - 4, 16 + 2]) {
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 2; dx++) set(ex + dx, ey + dy, c.eye);
      set(ex, ey, c.white);
    }

    const shadow = doc.layers[0].cels[f];
    const sw = p.lift ? p.w - 4 : p.w + 2;
    const srect = { x: 16 - Math.floor(sw / 2), y: 27, w: sw, h: 3 };
    for (const q of ellipsePixels(srect, true)) {
      if (rectContains(srect, q.x, q.y)) shadow[q.y * W + q.x] = c.eye;
    }
  });
  return doc;
}
