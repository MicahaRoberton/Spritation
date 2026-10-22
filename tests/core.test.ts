import { describe, expect, it } from 'vitest';
import { blend, colorToHex, hexToColor, rgba, unpack } from '../src/core/color';
import {
  cloneDocument,
  compositeFrame,
  createDocument,
  insertFrame,
  insertLayer,
  mergeDown,
  moveFrame,
  removeFrame,
  resizeCanvas,
} from '../src/core/document';
import { History } from '../src/core/history';
import { bresenham, ellipsePixels, floodFill, isLCorner, rectPixels, snapAngle } from '../src/core/raster';
import { deserializeDocument, serializeDocument } from '../src/core/serialize';

const RED = rgba(255, 0, 0);
const BLUE = rgba(0, 0, 255);

describe('color', () => {
  it('round-trips hex', () => {
    expect(colorToHex(hexToColor('#3f3f74'))).toBe('#3f3f74');
    expect(colorToHex(hexToColor('3f3f7480'), true)).toBe('#3f3f7480');
    expect(unpack(hexToColor('#abc'))).toEqual([0xaa, 0xbb, 0xcc, 255]);
    expect(() => hexToColor('nope')).toThrow();
  });

  it('blends source-over', () => {
    expect(blend(RED, BLUE)).toBe(BLUE);
    expect(blend(RED, 0)).toBe(RED);
    expect(blend(0, BLUE, 128)).toBe(rgba(0, 0, 255, 128));
    const [r, , b, a] = unpack(blend(RED, rgba(0, 0, 255, 128)));
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(120);
    expect(b).toBeGreaterThan(120);
  });
});

describe('document', () => {
  it('composites visible layers bottom to top with opacity', () => {
    const doc = createDocument(2, 1, []);
    insertLayer(doc, 1);
    doc.layers[0].cels[0][0] = RED;
    doc.layers[1].cels[0][0] = BLUE;
    doc.layers[0].cels[0][1] = RED;
    expect([...compositeFrame(doc, 0)]).toEqual([BLUE, RED]);
    doc.layers[1].visible = false;
    expect(compositeFrame(doc, 0)[0]).toBe(RED);
  });

  it('inserts, moves and removes frames, keeping tags in range', () => {
    const doc = createDocument(1, 1, []);
    doc.layers[0].cels[0][0] = RED;
    insertFrame(doc, 1, 0);
    insertFrame(doc, 2);
    expect(doc.frames.length).toBe(3);
    expect(doc.layers[0].cels[1][0]).toBe(RED);
    expect(doc.layers[0].cels[2][0]).toBe(0);
    doc.tags.push({ name: 'walk', from: 1, to: 2, direction: 'forward' });
    moveFrame(doc, 0, 2);
    expect(doc.layers[0].cels[2][0]).toBe(RED);
    removeFrame(doc, 0);
    expect(doc.frames.length).toBe(2);
    expect(doc.tags[0]).toMatchObject({ from: 0, to: 1 });
  });

  it('merges down and resizes around the centre', () => {
    const doc = createDocument(2, 2, []);
    insertLayer(doc, 1);
    doc.layers[1].cels[0][3] = BLUE;
    mergeDown(doc, 1);
    expect(doc.layers.length).toBe(1);
    expect(doc.layers[0].cels[0][3]).toBe(BLUE);
    resizeCanvas(doc, 4, 4);
    expect(doc.layers[0].cels[0][2 * 4 + 2]).toBe(BLUE);
  });

  it('clones deeply', () => {
    const doc = createDocument(1, 1, []);
    const copy = cloneDocument(doc);
    copy.layers[0].cels[0][0] = RED;
    expect(doc.layers[0].cels[0][0]).toBe(0);
  });
});

describe('raster', () => {
  it('draws Bresenham lines including endpoints', () => {
    const pts: string[] = [];
    bresenham(0, 0, 3, 1, (x, y) => pts.push(`${x},${y}`));
    expect(pts[0]).toBe('0,0');
    expect(pts[pts.length - 1]).toBe('3,1');
    expect(pts.length).toBe(4);
  });

  it('snaps lines to 45 degrees', () => {
    expect(snapAngle({ x: 0, y: 0 }, { x: 10, y: 1 })).toEqual({ x: 10, y: 0 });
    expect(snapAngle({ x: 0, y: 0 }, { x: 5, y: 4 })).toEqual({ x: 5, y: 5 });
  });

  it('builds rect outlines and ellipses', () => {
    expect(rectPixels({ x: 0, y: 0, w: 3, h: 3 }, false).length).toBe(8);
    expect(rectPixels({ x: 0, y: 0, w: 3, h: 3 }, true).length).toBe(9);
    const filled = ellipsePixels({ x: 0, y: 0, w: 9, h: 9 }, true);
    const outline = ellipsePixels({ x: 0, y: 0, w: 9, h: 9 }, false);
    expect(outline.length).toBeLessThan(filled.length);
    expect(filled.some((p) => p.x === 4 && p.y === 4)).toBe(true);
    expect(outline.some((p) => p.x === 4 && p.y === 4)).toBe(false);
    expect(filled.some((p) => p.x === 0 && p.y === 0)).toBe(false);
  });

  it('flood fills contiguous regions and respects the clip rect', () => {
    const data = new Uint32Array(9);
    data[1] = data[4] = data[7] = RED; // vertical wall in the middle column
    const r = { width: 3, height: 3, data };
    floodFill(r, 0, 0, BLUE, true);
    expect([data[0], data[3], data[6], data[2]]).toEqual([BLUE, BLUE, BLUE, 0]);
    floodFill(r, 2, 0, BLUE, true, { x: 2, y: 0, w: 1, h: 2 });
    expect([data[2], data[5], data[8]]).toEqual([BLUE, BLUE, 0]);
    floodFill(r, 1, 1, rgba(0, 255, 0), false);
    expect(data[1]).toBe(rgba(0, 255, 0));
  });

  it('detects pixel-perfect L corners', () => {
    expect(isLCorner({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 })).toBe(true);
    expect(isLCorner({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toBe(false);
  });
});

describe('history', () => {
  it('undoes and redoes in order and clears redo on push', () => {
    const h = new History(2);
    const e = (label: string) => ({ kind: 'cel' as const, label, layerId: 1, frame: 0, before: new Uint32Array(), after: new Uint32Array() });
    h.push(e('a'));
    h.push(e('b'));
    h.push(e('c'));
    expect(h.undo()?.label).toBe('c');
    expect(h.undo()?.label).toBe('b');
    expect(h.undo()).toBeUndefined();
    expect(h.redo()?.label).toBe('b');
    h.push(e('d'));
    expect(h.canRedo).toBe(false);
  });
});

describe('serialize', () => {
  it('round-trips a document', () => {
    const doc = createDocument(3, 2, [RED, BLUE]);
    insertLayer(doc, 1, 'Top');
    insertFrame(doc, 1);
    doc.layers[1].cels[1][5] = BLUE;
    doc.layers[0].opacity = 100;
    doc.layers[1].visible = false;
    doc.frames[1].duration = 250;
    doc.tags.push({ name: 'idle', from: 0, to: 1, direction: 'pingpong' });
    const back = deserializeDocument(serializeDocument(doc));
    expect(back.width).toBe(3);
    expect(back.palette).toEqual([RED, BLUE]);
    expect(back.layers.map((l) => l.name)).toEqual(['Layer 1', 'Top']);
    expect(back.layers[1].cels[1][5]).toBe(BLUE);
    expect(back.layers[0].opacity).toBe(100);
    expect(back.layers[1].visible).toBe(false);
    expect(back.frames[1].duration).toBe(250);
    expect(back.tags).toEqual(doc.tags);
  });

  it('rejects files that are not projects', () => {
    expect(() => deserializeDocument('{"hello":1}')).toThrow(/not a Spritation project/);
    expect(() => deserializeDocument('not json')).toThrow();
  });
});
