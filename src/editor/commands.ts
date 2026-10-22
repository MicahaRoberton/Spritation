import { MAX_SIZE, TagDirection } from '../core/document';
import * as A from './actions';
import { App } from './app';
import { field, isDialogOpen, numberInput, openDialog, readInt, selectInput } from './dialogs';
import { h } from './dom';
import { ToolId } from './editor';
import { confirmDiscard, exportDialog, newSpriteDialog, openFile, saveProject } from './files';
import { TOOL_INFO } from './tools';

export interface Command {
  label: string;
  /** Shortcut in display form, e.g. "Ctrl+Z". Ctrl means Cmd on macOS. */
  keys?: string[];
  run(app: App): void;
}

let playTimer = 0;

function setPlaying(app: App, playing: boolean) {
  const { ed } = app;
  clearTimeout(playTimer);
  ed.playing = playing && ed.doc.frames.length > 1;
  ed.emit('playback');
  if (!ed.playing) return;
  const step = () => {
    playTimer = window.setTimeout(() => {
      if (!ed.playing) return;
      let next = ed.frame + 1;
      if (next >= ed.doc.frames.length) {
        if (!ed.loop) return setPlaying(app, false);
        next = 0;
      }
      ed.setFrame(next);
      step();
    }, ed.doc.frames[ed.frame].duration);
  };
  step();
}

function canvasSizeDialog(app: App) {
  const { ed } = app;
  const w = numberInput('cs-width', ed.doc.width, 1, MAX_SIZE);
  const hh = numberInput('cs-height', ed.doc.height, 1, MAX_SIZE);
  const anchor = selectInput('cs-anchor', [['center', 'Centre'], ['top-left', 'Top left']], 'center');
  openDialog(
    'Canvas size',
    [
      h('p', {}, `Currently ${ed.doc.width}×${ed.doc.height}. Pixels outside the new size are cropped; new space is transparent.`),
      h('div', { class: 'dlg-grid' }, field('Width', w, 'px'), field('Height', hh, 'px')),
      field('Anchor', anchor),
    ],
    [
      { label: 'Cancel' },
      {
        label: 'Resize',
        primary: true,
        run: () => {
          A.canvasSize(ed, readInt(w, 1, MAX_SIZE, 'Width'), readInt(hh, 1, MAX_SIZE, 'Height'), anchor.value as 'center' | 'top-left');
          app.view.fit();
        },
      },
    ],
  );
}

function tagDialog(app: App) {
  const { ed } = app;
  const n = ed.doc.frames.length;
  const name = h('input', { id: 'tag-name', class: 'text-input', value: ed.doc.tags.length ? `anim${ed.doc.tags.length + 1}` : 'idle' }) as HTMLInputElement;
  const from = numberInput('tag-from', 1, 1, n);
  const to = numberInput('tag-to', n, 1, n);
  const dir = selectInput('tag-dir', [['forward', 'Forward'], ['reverse', 'Reverse'], ['pingpong', 'Ping-pong']], 'forward');
  openDialog(
    'New animation tag',
    [
      h('p', {}, 'Tags name a range of frames, like “idle” or “walk”. They are written to the sprite sheet JSON so a game can play each animation by name.'),
      field('Name', name),
      h('div', { class: 'dlg-grid' }, field('From frame', from), field('To frame', to)),
      field('Direction', dir),
    ],
    [
      { label: 'Cancel' },
      {
        label: 'Add tag',
        primary: true,
        run: () => {
          const label = name.value.trim();
          if (!label) throw new Error('Give the tag a name.');
          A.addTag(ed, label, readInt(from, 1, n, 'From frame') - 1, readInt(to, 1, n, 'To frame') - 1, dir.value as TagDirection);
        },
      },
    ],
  );
}

function shortcutsDialog() {
  const rows = Object.entries(COMMANDS)
    .filter(([, c]) => c.keys?.length)
    .map(([, c]) => h('tr', {}, h('td', {}, c.label), h('td', { class: 'mono' }, c.keys!.join('  or  '))));
  const toolRows = (Object.keys(TOOL_INFO) as ToolId[]).map((t) => h('tr', {}, h('td', {}, TOOL_INFO[t].label), h('td', { class: 'mono' }, TOOL_INFO[t].key)));
  const extra = [
    ['Pan', 'Space + drag, middle mouse, two fingers'],
    ['Zoom', 'Mouse wheel, pinch'],
    ['Temporary eyedropper', 'Alt + click'],
    ['Brush size', '[  and  ]'],
    ['Nudge selection', 'Arrow keys (Move tool)'],
  ].map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', { class: 'mono' }, b)));
  openDialog('Keyboard shortcuts', [h('div', { class: 'shortcut-table' }, h('table', {}, h('tbody', {}, ...toolRows, ...extra, ...rows)))], [{ label: 'Close', primary: true }]);
}

const zoomAtCursor = (app: App, dir: 1 | -1) => {
  const hover = app.view.hover;
  if (!hover) return app.view.zoomStep(dir);
  const { ed } = app;
  app.view.zoomStep(dir, ed.panX + (hover.x + 0.5) * ed.zoom, ed.panY + (hover.y + 0.5) * ed.zoom);
};

export const COMMANDS: Record<string, Command> = {
  new: { label: 'New sprite', keys: ['Ctrl+N'], run: (app) => newSpriteDialog(app) },
  open: { label: 'Open', keys: ['Ctrl+O'], run: (app) => confirmDiscard(app, () => void openFile(app)) },
  save: { label: 'Save', keys: ['Ctrl+S'], run: (app) => void saveProject(app) },
  'save-as': { label: 'Save as', keys: ['Ctrl+Shift+S'], run: (app) => void saveProject(app, true) },
  export: { label: 'Export', keys: ['Ctrl+E'], run: (app) => exportDialog(app) },
  undo: {
    label: 'Undo',
    keys: ['Ctrl+Z'],
    run: (app) => {
      const e = app.ed.undo();
      app.toast(e ? `Undid ${e.label.toLowerCase()}` : 'Nothing to undo');
    },
  },
  redo: {
    label: 'Redo',
    keys: ['Ctrl+Shift+Z', 'Ctrl+Y'],
    run: (app) => {
      const e = app.ed.redo();
      app.toast(e ? `Redid ${e.label.toLowerCase()}` : 'Nothing to redo');
    },
  },
  cut: { label: 'Cut', keys: ['Ctrl+X'], run: (app) => A.cut(app.ed) },
  copy: { label: 'Copy', keys: ['Ctrl+C'], run: (app) => (A.copy(app.ed), app.toast('Copied')) },
  paste: { label: 'Paste', keys: ['Ctrl+V'], run: (app) => A.paste(app.ed) || app.toast('Copy something first.') },
  clear: { label: 'Clear selection', keys: ['Delete', 'Backspace'], run: (app) => A.clear(app.ed) },
  'select-all': { label: 'Select all', keys: ['Ctrl+A'], run: (app) => A.selectAll(app.ed) },
  deselect: { label: 'Deselect', keys: ['Ctrl+D', 'Escape'], run: (app) => app.ed.setSelection(null) },
  'flip-h': { label: 'Flip horizontal', keys: ['Shift+H'], run: (app) => A.flip(app.ed, 'h') },
  'flip-v': { label: 'Flip vertical', keys: ['Shift+V'], run: (app) => A.flip(app.ed, 'v') },
  'canvas-size': { label: 'Canvas size', keys: ['Ctrl+Alt+C'], run: canvasSizeDialog },
  'new-layer': { label: 'New layer', keys: ['Shift+N'], run: (app) => A.addLayer(app.ed) },
  'duplicate-layer': { label: 'Duplicate layer', run: (app) => A.dupLayer(app.ed) },
  'delete-layer': { label: 'Delete layer', run: (app) => A.deleteLayer(app.ed) || app.toast('A sprite needs at least one layer.') },
  'merge-down': { label: 'Merge down', keys: ['Ctrl+M'], run: (app) => A.mergeLayerDown(app.ed) || app.toast('There is no layer below to merge into.') },
  'new-frame': { label: 'New frame', keys: ['Alt+N'], run: (app) => A.addFrame(app.ed) },
  'new-empty-frame': { label: 'New empty frame', run: (app) => A.addFrame(app.ed, true) },
  'delete-frame': { label: 'Delete frame', run: (app) => A.deleteFrame(app.ed) || app.toast('A sprite needs at least one frame.') },
  'new-tag': { label: 'New animation tag', run: tagDialog },
  play: { label: 'Play / stop', keys: ['Enter'], run: (app) => setPlaying(app, !app.ed.playing) },
  'prev-frame': {
    label: 'Previous frame',
    keys: [','],
    run: (app) => {
      const n = app.ed.doc.frames.length;
      app.ed.setFrame((app.ed.frame - 1 + n) % n);
    },
  },
  'next-frame': { label: 'Next frame', keys: ['.'], run: (app) => app.ed.setFrame((app.ed.frame + 1) % app.ed.doc.frames.length) },
  'first-frame': { label: 'First frame', keys: ['Home'], run: (app) => app.ed.setFrame(0) },
  'last-frame': { label: 'Last frame', keys: ['End'], run: (app) => app.ed.setFrame(app.ed.doc.frames.length - 1) },
  'layer-up': { label: 'Layer above', keys: ['Alt+ArrowUp'], run: (app) => app.ed.setLayer(app.ed.layer + 1) },
  'layer-down': { label: 'Layer below', keys: ['Alt+ArrowDown'], run: (app) => app.ed.setLayer(app.ed.layer - 1) },
  'zoom-in': { label: 'Zoom in', keys: ['=', '+'], run: (app) => zoomAtCursor(app, 1) },
  'zoom-out': { label: 'Zoom out', keys: ['-'], run: (app) => zoomAtCursor(app, -1) },
  'zoom-fit': { label: 'Fit to window', keys: ['0'], run: (app) => app.view.fit() },
  'toggle-grid': {
    label: 'Pixel grid',
    keys: ["Ctrl+'"],
    run: (app) => {
      app.ed.showGrid = !app.ed.showGrid;
      app.ed.emit('view');
    },
  },
  'toggle-onion': {
    label: 'Onion skin',
    keys: ['F3'],
    run: (app) => {
      app.ed.onion = !app.ed.onion;
      app.ed.emit('playback');
    },
  },
  'swap-colors': { label: 'Swap colours', keys: ['X'], run: (app) => app.ed.swapColors() },
  shortcuts: { label: 'Keyboard shortcuts', keys: ['F1', '?'], run: () => shortcutsDialog() },
};

/** Normalises a keyboard event to the "Ctrl+Shift+Z" form used above. */
function chord(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  let key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (e.altKey && e.code.startsWith('Key')) key = e.code.slice(3); // Alt+N gives "ñ" on macOS
  // Shift is implied for symbols like "?" and "+".
  if (e.shiftKey && (e.key.length > 1 || /[A-Z]/.test(key))) parts.push('Shift');
  parts.push(key === ' ' ? 'Space' : key);
  return parts.join('+');
}

const KEYMAP = new Map<string, string>();
for (const [id, c] of Object.entries(COMMANDS)) for (const k of c.keys ?? []) KEYMAP.set(k.toUpperCase(), id);

export function bindKeyboard(app: App) {
  const { ed, view } = app;
  const toolKeys = new Map((Object.keys(TOOL_INFO) as ToolId[]).map((t) => [TOOL_INFO[t].key, t]));

  window.addEventListener('keydown', (e) => {
    if (isDialogOpen()) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, select, textarea')) return;

    if (e.key === ' ') {
      view.spaceDown = true;
      view.canvas.classList.add('is-pan-ready');
      e.preventDefault();
      return;
    }
    const c = chord(e);
    const id = KEYMAP.get(c.toUpperCase());
    if (id) {
      e.preventDefault();
      if (id === 'deselect' && e.key === 'Escape' && !ed.selection) return;
      app.run(id);
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const tool = toolKeys.get(c);
      if (tool) {
        ed.setTool(tool);
        return;
      }
      if (e.key === '[' || e.key === ']') {
        const s = ed.settings.brushSize + (e.key === ']' ? 1 : -1);
        ed.setSettings({ brushSize: Math.max(1, Math.min(64, s)) });
        return;
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.key] && (ed.tool === 'move' || ed.selection)) {
        e.preventDefault();
        A.nudge(ed, ...arrows[e.key]);
      }
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') {
      view.spaceDown = false;
      view.canvas.classList.remove('is-pan-ready');
    }
  });
  window.addEventListener('blur', () => {
    view.spaceDown = false;
    view.canvas.classList.remove('is-pan-ready');
  });
}
