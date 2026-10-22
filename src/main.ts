import './styles/app.css';
import { deserializeDocument, serializeDocument } from './core/serialize';
import { App } from './editor/app';
import { COMMANDS, bindKeyboard } from './editor/commands';
import { h } from './editor/dom';
import { Editor } from './editor/editor';
import { findExample } from './editor/examples';
import { PROJECT_EXT, loadFile } from './editor/files';
import { ICONS } from './editor/icons';
import { mountColors, mountPalette } from './editor/panels/colors';
import { mountLayers } from './editor/panels/layers';
import { mountOptions } from './editor/panels/options';
import { mountPreview } from './editor/panels/preview';
import { mountTimeline } from './editor/panels/timeline';
import { mountToolbar } from './editor/panels/toolbar';
import { sampleSprite } from './editor/sample';
import { Viewport } from './editor/viewport';
import { detectPlatform } from './platform/platform';

const AUTOSAVE_KEY = 'spritation.autosave.v1';

function restore(): { ed: Editor; restored: boolean; example: boolean } {
  // A link ending in #pumpkin (or another example id) opens that example.
  const linked = findExample(location.hash.slice(1));
  if (linked) {
    const ed = new Editor(linked.create());
    ed.projectName = linked.id;
    ed.layer = ed.doc.layers.length - 1;
    return { ed, restored: false, example: true };
  }
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { name: string; doc: string; modified: boolean };
      const ed = new Editor(deserializeDocument(saved.doc));
      ed.projectName = saved.name || 'Untitled';
      ed.modified = !!saved.modified;
      ed.layer = ed.doc.layers.length - 1;
      return { ed, restored: true, example: false };
    }
  } catch {
    // A corrupt or blocked autosave just means starting fresh.
  }
  const ed = new Editor(sampleSprite());
  ed.projectName = 'slime';
  ed.layer = 1;
  return { ed, restored: false, example: false };
}

function boot() {
  const platform = detectPlatform();
  document.documentElement.dataset.platform = platform.kind;
  const { ed, restored, example } = restore();
  ed.primary = ed.doc.palette[10] ?? ed.primary;
  ed.secondary = 0;

  const stage = document.getElementById('stage')!;
  const view = new Viewport(ed, stage);

  const toastEl = document.getElementById('toast')!;
  let toastTimer = 0;
  const toast = (msg: string) => {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.hidden = true), 2600);
  };
  view.notify = toast;

  const app: App = {
    ed,
    view,
    platform,
    toast,
    run(id) {
      const c = COMMANDS[id];
      if (c) c.run(app);
    },
  };

  mountMenubar(app, document.getElementById('menubar')!);
  mountOptions(app, document.getElementById('options')!);
  mountToolbar(app, document.getElementById('toolbar')!);
  mountColors(app, document.getElementById('colors-panel')!);
  mountPalette(app, document.getElementById('palette-panel')!);
  mountPreview(app, document.getElementById('preview-panel')!);
  mountLayers(app, document.getElementById('layers-panel')!);
  mountTimeline(app, document.getElementById('timeline')!);
  mountStatus(app, document.getElementById('statusbar')!);
  bindKeyboard(app);
  platform.onMenuCommand((id) => app.run(id));

  // Title and autosave follow the document.
  let saveTimer = 0;
  ed.subscribe((c) => {
    if (c.has('file')) platform.setTitle(`${ed.modified ? '• ' : ''}${ed.projectName} — Spritation`);
    if (c.has('history') || c.has('structure') || c.has('file')) {
      clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        try {
          localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ name: ed.projectName, modified: ed.modified, doc: serializeDocument(ed.doc) }));
        } catch {
          // Storage full or unavailable: autosave is a convenience only.
        }
      }, 700);
    }
  });
  ed.emit('file', 'tool', 'color', 'view', 'playback');
  // Fit once the panels have taken their space and the stage has its real size.
  requestAnimationFrame(() => {
    view.fit();
    if (example) app.run('play');
  });

  // Drop a .sprite.json or an image anywhere to open it.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file) await loadFile(app, { name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
  });

  if (restored) toast(`Restored “${ed.projectName}” from your last session`);
}

function mountMenubar(app: App, root: HTMLElement) {
  const btn = (icon: string, label: string, id: string, title: string) =>
    h('button', { class: 'menu-btn', type: 'button', title, onclick: () => app.run(id) }, h('span', { class: 'menu-icon', html: icon }), h('span', { class: 'menu-label' }, label));
  const undo = btn(ICONS.undo, 'Undo', 'undo', 'Undo (Ctrl+Z)');
  const redo = btn(ICONS.redo, 'Redo', 'redo', 'Redo (Ctrl+Shift+Z)');
  const name = h('span', { class: 'doc-name' });
  root.append(
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), h('span', { class: 'brand-name' }, 'Spritation')),
    h(
      'div',
      { class: 'menu-group' },
      btn(ICONS.file, 'New', 'new', 'New sprite (Ctrl+N)'),
      btn(ICONS.open, 'Open', 'open', 'Open a sprite or image (Ctrl+O)'),
      btn(ICONS.save, 'Save', 'save', `Save as ${PROJECT_EXT} (Ctrl+S)`),
      btn(ICONS.export, 'Export', 'export', 'Export PNG, sprite sheet or GIF (Ctrl+E)'),
      btn(ICONS.play, 'Examples', 'examples', 'Open an example animation'),
    ),
    h('div', { class: 'menu-group' }, undo, redo),
    h(
      'div',
      { class: 'menu-group' },
      btn(ICONS.resize, 'Canvas', 'canvas-size', 'Canvas size (Ctrl+Alt+C)'),
      btn(ICONS.help, 'Keys', 'shortcuts', 'Keyboard shortcuts (F1)'),
    ),
    name,
  );
  const sync = () => {
    undo.disabled = !app.ed.history.canUndo;
    redo.disabled = !app.ed.history.canRedo;
    undo.title = app.ed.history.peekUndo() ? `Undo ${app.ed.history.peekUndo()!.label.toLowerCase()} (Ctrl+Z)` : 'Nothing to undo';
    redo.title = app.ed.history.peekRedo() ? `Redo ${app.ed.history.peekRedo()!.label.toLowerCase()} (Ctrl+Shift+Z)` : 'Nothing to redo';
    name.textContent = `${app.ed.projectName}${app.ed.modified ? ' •' : ''}`;
    name.title = app.ed.modified ? 'Unsaved changes' : 'Saved';
  };
  app.ed.subscribe((c) => (c.has('history') || c.has('file')) && sync());
  sync();
}

function mountStatus(app: App, root: HTMLElement) {
  const { ed, view } = app;
  const pos = h('span', { class: 'mono' });
  const size = h('span', { class: 'mono' });
  const frame = h('span', { class: 'mono' });
  const sel = h('span', { class: 'mono' });
  root.append(pos, size, frame, sel);
  const sync = () => {
    const p = view.hover;
    const inside = p && p.x >= 0 && p.y >= 0 && p.x < ed.doc.width && p.y < ed.doc.height;
    pos.textContent = inside ? `x ${p!.x}  y ${p!.y}` : 'x –  y –';
    size.textContent = `${ed.doc.width}×${ed.doc.height}`;
    frame.textContent = `Frame ${ed.frame + 1}/${ed.doc.frames.length} · ${ed.activeLayer.name}`;
    sel.textContent = ed.selection ? `Selection ${ed.selection.w}×${ed.selection.h} at ${ed.selection.x},${ed.selection.y}` : '';
  };
  view.onHover = sync;
  ed.subscribe(sync);
  sync();
}

boot();
