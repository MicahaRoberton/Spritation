import { describe, expect, it } from 'vitest';
import { rgba } from '../src/core/color';
import { createDocument } from '../src/core/document';
import * as A from '../src/editor/actions';
import { Editor } from '../src/editor/editor';
import { createTools, PointerInfo } from '../src/editor/tools';

const RED = rgba(255, 0, 0);
const p = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo => ({ x, y, button: 'primary', shift: false, alt: false, ...extra });

function setup(w = 8, h = 8) {
  const ed = new Editor(createDocument(w, h, []));
  ed.primary = RED;
  return { ed, tools: createTools(ed) };
}

describe('tools', () => {
  it('pencil strokes are one undo step', () => {
    const { ed, tools } = setup();
    tools.pencil.down(p(0, 0));
    tools.pencil.move(p(3, 0));
    tools.pencil.up(p(3, 0));
    expect([...ed.activeCel.slice(0, 4)]).toEqual([RED, RED, RED, RED]);
    ed.undo();
    expect(ed.activeCel.every((c) => c === 0)).toBe(true);
    ed.redo();
    expect(ed.activeCel[3]).toBe(RED);
  });

  it('pixel-perfect mode removes L-corner pixels', () => {
    const { ed, tools } = setup();
    tools.pencil.down(p(0, 0));
    tools.pencil.move(p(1, 0));
    tools.pencil.move(p(1, 1));
    tools.pencil.up(p(1, 1));
    expect(ed.activeCel[1]).toBe(0);
    expect(ed.activeCel[0]).toBe(RED);
    expect(ed.activeCel[9]).toBe(RED);
  });

  it('mirror X paints the opposite side', () => {
    const { ed, tools } = setup();
    ed.settings.mirrorX = true;
    tools.pencil.down(p(1, 2));
    tools.pencil.up(p(1, 2));
    expect(ed.activeCel[2 * 8 + 6]).toBe(RED);
  });

  it('drawing is clipped to the selection', () => {
    const { ed, tools } = setup();
    ed.selection = { x: 0, y: 0, w: 2, h: 8 };
    tools.rect.down(p(0, 0));
    tools.rect.move(p(5, 5, {}));
    tools.rect.up(p(5, 5));
    expect(ed.activeCel[1]).toBe(RED);
    expect(ed.activeCel[3]).toBe(0);
  });

  it('shape tools redraw from the original pixels while dragging', () => {
    const { ed, tools } = setup();
    tools.line.down(p(0, 0));
    tools.line.move(p(7, 0));
    tools.line.move(p(0, 7));
    tools.line.up(p(0, 7));
    expect(ed.activeCel[7]).toBe(0);
    expect(ed.activeCel[7 * 8]).toBe(RED);
  });

  it('move tool drags the selection contents', () => {
    const { ed, tools } = setup();
    ed.activeCel[0] = RED;
    ed.selection = { x: 0, y: 0, w: 1, h: 1 };
    tools.move.down(p(0, 0));
    tools.move.move(p(2, 3));
    tools.move.up(p(2, 3));
    expect(ed.activeCel[0]).toBe(0);
    expect(ed.activeCel[3 * 8 + 2]).toBe(RED);
    expect(ed.selection).toEqual({ x: 2, y: 3, w: 1, h: 1 });
  });

  it('eyedropper picks the composited colour', () => {
    const { ed, tools } = setup();
    ed.activeCel[5] = rgba(9, 8, 7);
    tools.eyedropper.down(p(5, 0, { button: 'secondary' }));
    expect(ed.secondary).toBe(rgba(9, 8, 7));
  });
});

describe('structural actions', () => {
  it('layer and frame changes are undoable', () => {
    const { ed } = setup();
    A.addLayer(ed);
    A.addFrame(ed);
    expect(ed.doc.layers.length).toBe(2);
    expect(ed.doc.frames.length).toBe(2);
    expect(ed.frame).toBe(1);
    ed.undo();
    expect(ed.doc.frames.length).toBe(1);
    expect(ed.frame).toBe(0);
    ed.undo();
    expect(ed.doc.layers.length).toBe(1);
  });

  it('copy, paste and flip', () => {
    const { ed } = setup(4, 1);
    ed.activeCel[0] = RED;
    A.flip(ed, 'h');
    expect(ed.activeCel[3]).toBe(RED);
    ed.selection = { x: 3, y: 0, w: 1, h: 1 };
    A.copy(ed);
    ed.selection = { x: 1, y: 0, w: 1, h: 1 };
    A.paste(ed);
    expect(ed.activeCel[1]).toBe(RED);
    expect(ed.tool).toBe('move');
  });
});

describe('examples', () => {
  it('every example is a valid, saveable document', async () => {
    const { EXAMPLES } = await import('../src/editor/examples');
    const { serializeDocument, deserializeDocument } = await import('../src/core/serialize');
    for (const ex of EXAMPLES) {
      const doc = ex.create();
      expect(doc.layers.every((l) => l.cels.length === doc.frames.length)).toBe(true);
      expect(doc.tags.every((t) => t.to < doc.frames.length)).toBe(true);
      expect(deserializeDocument(serializeDocument(doc)).frames.length).toBe(doc.frames.length);
    }
    expect(EXAMPLES.find((e) => e.id === 'pumpkin')!.create().frames.length).toBe(10);
    const bruiser = EXAMPLES.find((e) => e.id === 'bruiser')!.create();
    expect([bruiser.width, bruiser.height]).toEqual([180, 320]);
  });
});
