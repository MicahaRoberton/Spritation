import { App } from '../app';
import { h, iconButton } from '../dom';
import { ICONS } from '../icons';
import { TOOL_INFO } from '../tools';

/** Context bar: settings for the active tool, then view controls. */
export function mountOptions(app: App, root: HTMLElement) {
  const { ed } = app;
  const toolName = h('span', { class: 'opt-tool' });

  const size = h('input', { id: 'opt-brush-size', type: 'number', min: 1, max: 64, class: 'num-input' }) as HTMLInputElement;
  size.addEventListener('input', () => {
    const v = Math.max(1, Math.min(64, Math.round(Number(size.value) || 1)));
    ed.setSettings({ brushSize: v });
  });
  const shape = h(
    'select',
    { id: 'opt-brush-shape', class: 'select-input', title: 'Brush shape' },
    h('option', { value: 'square' }, 'Square'),
    h('option', { value: 'circle' }, 'Round'),
  ) as HTMLSelectElement;
  shape.addEventListener('change', () => ed.setSettings({ brushShape: shape.value as 'square' | 'circle' }));
  const brushGroup = h('label', { class: 'opt' }, h('span', { class: 'opt-label' }, 'Size'), size, shape);

  const toggle = (id: string, label: string, title: string, key: 'pixelPerfect' | 'contiguous' | 'shapeFilled' | 'mirrorX' | 'mirrorY') => {
    const input = h('input', { id, type: 'checkbox' }) as HTMLInputElement;
    input.addEventListener('change', () => ed.setSettings({ [key]: input.checked }));
    const el = h('label', { class: 'opt chip', title }, input, h('span', {}, label));
    return { el, sync: () => (input.checked = ed.settings[key]) };
  };
  const pixelPerfect = toggle('opt-pixel-perfect', 'Pixel perfect', 'Removes doubled pixels on 1px freehand corners', 'pixelPerfect');
  const contiguous = toggle('opt-contiguous', 'Contiguous', 'Off: replace this colour everywhere on the layer', 'contiguous');
  const filled = toggle('opt-filled', 'Filled', 'Draw filled shapes', 'shapeFilled');
  const mirrorX = toggle('opt-mirror-x', 'Mirror X', 'Symmetry across the vertical centre line', 'mirrorX');
  const mirrorY = toggle('opt-mirror-y', 'Mirror Y', 'Symmetry across the horizontal centre line', 'mirrorY');

  const hint = h('span', { class: 'opt-hint' });

  const left = h('div', { class: 'opt-row' }, toolName, brushGroup, pixelPerfect.el, contiguous.el, filled.el, mirrorX.el, mirrorY.el, hint);

  const zoomLabel = h('button', { class: 'zoom-label', type: 'button', title: 'Fit to window (0)', onclick: () => app.view.fit() });
  const gridBtn = iconButton(ICONS.grid, 'Pixel grid (Ctrl+\')', () => app.run('toggle-grid'));
  const right = h(
    'div',
    { class: 'opt-row opt-right' },
    iconButton(ICONS.flipH, 'Flip horizontal (Shift+H)', () => app.run('flip-h')),
    iconButton(ICONS.flipV, 'Flip vertical (Shift+V)', () => app.run('flip-v')),
    h('span', { class: 'divider' }),
    gridBtn,
    iconButton(ICONS.zoomOut, 'Zoom out (-)', () => app.view.zoomStep(-1)),
    zoomLabel,
    iconButton(ICONS.zoomIn, 'Zoom in (=)', () => app.view.zoomStep(1)),
    iconButton(ICONS.fit, 'Fit to window (0)', () => app.view.fit()),
  );
  root.append(left, right);

  const hints: Partial<Record<string, string>> = {
    pencil: 'Right-click paints the secondary colour. Shift-click draws a line from the last point.',
    eraser: 'Erases to transparent.',
    fill: 'Fills the area of matching colour.',
    line: 'Hold Shift to snap to 45°.',
    rect: 'Hold Shift for a square.',
    ellipse: 'Hold Shift for a circle.',
    eyedropper: 'Left-click picks primary, right-click picks secondary. Alt works with any tool.',
    select: 'Drag to select. Click to deselect. Drawing stays inside the selection.',
    move: 'Drag to move the selection, or the whole layer. Arrow keys nudge by 1px.',
    hand: 'Drag to pan. Space or middle mouse also pans.',
  };

  const sync = () => {
    const t = ed.tool;
    toolName.textContent = TOOL_INFO[t].label;
    const brush = ['pencil', 'eraser', 'line', 'rect', 'ellipse'].includes(t);
    brushGroup.hidden = !brush;
    pixelPerfect.el.hidden = !(t === 'pencil' || t === 'eraser');
    contiguous.el.hidden = t !== 'fill';
    filled.el.hidden = !(t === 'rect' || t === 'ellipse');
    const symmetric = ['pencil', 'eraser', 'line', 'rect', 'ellipse', 'fill'].includes(t);
    mirrorX.el.hidden = mirrorY.el.hidden = !symmetric;
    if (document.activeElement !== size) size.value = String(ed.settings.brushSize);
    shape.value = ed.settings.brushShape;
    [pixelPerfect, contiguous, filled, mirrorX, mirrorY].forEach((x) => x.sync());
    hint.textContent = hints[t] ?? '';
  };
  const syncView = () => {
    zoomLabel.textContent = `${Math.round(ed.zoom * 100)}%`;
    gridBtn.setAttribute('aria-pressed', String(ed.showGrid));
  };
  ed.subscribe((c) => {
    if (c.has('tool')) sync();
    if (c.has('view')) syncView();
  });
  sync();
  syncView();
}
