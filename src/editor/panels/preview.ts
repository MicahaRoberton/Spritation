import { compositeFrame } from '../../core/document';
import { App, paintPixels } from '../app';
import { h, iconButton, panelHeader } from '../dom';
import { ICONS } from '../icons';

/**
 * Always-running animation preview at game scale, independent of the frame
 * you're editing, so you can see the loop while you draw.
 */
export function mountPreview(app: App, root: HTMLElement) {
  const { ed } = app;
  const canvas = h('canvas', { class: 'preview-canvas', 'aria-label': 'Animation preview' }) as HTMLCanvasElement;
  const scaleSel = h(
    'select',
    { id: 'preview-scale', class: 'select-input', 'aria-label': 'Preview scale' },
    ...[1, 2, 3, 4].map((s) => h('option', { value: s }, `${s}×`)),
  ) as HTMLSelectElement;
  scaleSel.value = '2';
  let running = true;
  const toggle = iconButton(ICONS.pause, 'Pause preview', () => {
    running = !running;
    toggle.innerHTML = running ? ICONS.pause : ICONS.play;
    toggle.title = running ? 'Pause preview' : 'Play preview';
    if (running) tick();
  });
  const frameLabel = h('span', { class: 'small muted mono' });
  const stage = h('div', { class: 'preview-stage' }, canvas);
  root.append(panelHeader('Preview', frameLabel, scaleSel, toggle), stage);

  let frame = 0;
  let timer = 0;
  let buf = new Uint32Array(0);

  const draw = () => {
    const { doc } = ed;
    if (frame >= doc.frames.length) frame = 0;
    if (buf.length !== doc.width * doc.height) buf = new Uint32Array(doc.width * doc.height);
    paintPixels(canvas, compositeFrame(doc, frame, buf), doc.width, doc.height);
    const s = Number(scaleSel.value);
    // Large sprites shrink to fit the panel; small ones show at true game scale.
    const fit = Math.min(1, 232 / (doc.width * s), 160 / (doc.height * s));
    canvas.style.width = `${doc.width * s * fit}px`;
    canvas.style.height = `${doc.height * s * fit}px`;
    frameLabel.textContent = `${frame + 1}/${doc.frames.length}`;
  };

  const tick = () => {
    clearTimeout(timer);
    draw();
    if (!running || ed.doc.frames.length < 2) return;
    timer = window.setTimeout(() => {
      frame = (frame + 1) % ed.doc.frames.length;
      tick();
    }, ed.doc.frames[frame]?.duration ?? 100);
  };

  scaleSel.addEventListener('change', draw);
  ed.subscribe((c) => {
    if (c.has('structure')) tick();
    else if (c.has('pixels') && (!running || ed.doc.frames.length < 2)) draw();
  });
  tick();
}
