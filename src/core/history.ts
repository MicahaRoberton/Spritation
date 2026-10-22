import { SpriteDoc } from './document';

/** Where the user was working, restored along with an undo step. */
export interface Cursor {
  layer: number;
  frame: number;
}

/** A pixel edit on one cel. Cheap: only that cel is stored. */
export interface CelEntry {
  kind: 'cel';
  label: string;
  layerId: number;
  frame: number;
  before: Uint32Array;
  after: Uint32Array;
}

/** A structural edit (layers, frames, palette, size): whole-document snapshots. */
export interface DocEntry {
  kind: 'doc';
  label: string;
  before: SpriteDoc;
  after: SpriteDoc;
  cursorBefore: Cursor;
  cursorAfter: Cursor;
}

export type HistoryEntry = CelEntry | DocEntry;

export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  constructor(private readonly limit = 256) {}

  push(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  peekUndo(): HistoryEntry | undefined {
    return this.undoStack[this.undoStack.length - 1];
  }

  peekRedo(): HistoryEntry | undefined {
    return this.redoStack[this.redoStack.length - 1];
  }

  /** Pops the entry to revert; the caller applies its `before` state. */
  undo(): HistoryEntry | undefined {
    const e = this.undoStack.pop();
    if (e) this.redoStack.push(e);
    return e;
  }

  /** Pops the entry to re-apply; the caller applies its `after` state. */
  redo(): HistoryEntry | undefined {
    const e = this.redoStack.pop();
    if (e) this.undoStack.push(e);
    return e;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

export function celsEqual(a: Uint32Array, b: Uint32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
