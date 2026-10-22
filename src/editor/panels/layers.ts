import { cloneDocument } from '../../core/document';
import { addLayer, deleteLayer, dupLayer, mergeLayerDown, renameLayer, shiftLayer, toggleLayerVisible } from '../actions';
import { App, paintPixels } from '../app';
import { h, iconButton, panelHeader } from '../dom';
import { ICONS } from '../icons';

export function mountLayers(app: App, root: HTMLElement) {
  const { ed } = app;
  const list = h('ul', { class: 'layer-list', role: 'listbox', 'aria-label': 'Layers' });

  const opacity = h('input', { id: 'layer-opacity', type: 'range', min: 0, max: 255, class: 'range', 'aria-label': 'Layer opacity' }) as HTMLInputElement;
  const opacityVal = h('span', { class: 'mono small' });
  // The slider changes the layer live; one undo step is recorded on release.
  let before: ReturnType<typeof cloneDocument> | null = null;
  opacity.addEventListener('input', () => {
    before ??= cloneDocument(ed.doc);
    ed.activeLayer.opacity = Number(opacity.value);
    opacityVal.textContent = `${Math.round((Number(opacity.value) / 255) * 100)}%`;
    ed.emit('pixels');
  });
  opacity.addEventListener('change', () => {
    if (!before) return;
    const value = Number(opacity.value);
    const snapshot = before;
    before = null;
    ed.doc.layers[ed.layer].opacity = snapshot.layers[ed.layer].opacity;
    ed.structural('Layer opacity', (doc) => (doc.layers[ed.layer].opacity = value));
  });

  root.append(
    panelHeader(
      'Layers',
      iconButton(ICONS.plus, 'New layer (Shift+N)', () => addLayer(ed)),
      iconButton(ICONS.copy, 'Duplicate layer', () => dupLayer(ed)),
      iconButton(ICONS.up, 'Move layer up', () => shiftLayer(ed, 1)),
      iconButton(ICONS.down, 'Move layer down', () => shiftLayer(ed, -1)),
      iconButton(ICONS.merge, 'Merge down (Ctrl+M)', () => mergeLayerDown(ed) || app.toast('There is no layer below to merge into.')),
      iconButton(ICONS.trash, 'Delete layer', () => deleteLayer(ed) || app.toast('A sprite needs at least one layer.')),
    ),
    h('label', { class: 'field field-inline' }, h('span', { class: 'field-label' }, 'Opacity'), opacity, opacityVal),
    list,
  );

  const thumbs: HTMLCanvasElement[] = [];

  const build = () => {
    thumbs.length = 0;
    const rows = ed.doc.layers
      .map((layer, i) => {
        const thumb = h('canvas', { class: 'thumb' }) as HTMLCanvasElement;
        thumbs[i] = thumb;
        const name = h('span', { class: 'layer-name' }, layer.name);
        name.addEventListener('dblclick', () => {
          const input = h('input', { class: 'text-input layer-rename', value: layer.name, 'aria-label': 'Layer name' }) as HTMLInputElement;
          const done = (save: boolean) => {
            if (save) renameLayer(ed, i, input.value);
            else build();
          };
          input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') done(true);
            if (e.key === 'Escape') done(false);
          });
          input.addEventListener('blur', () => done(true));
          name.replaceWith(input);
          input.focus();
          input.select();
        });
        const eye = iconButton(layer.visible ? ICONS.eye : ICONS.eyeOff, layer.visible ? 'Hide layer' : 'Show layer', () => toggleLayerVisible(ed, i), {
          class: `icon-btn eye${layer.visible ? '' : ' is-off'}`,
        });
        const row = h(
          'li',
          {
            class: `layer-row${i === ed.layer ? ' is-active' : ''}${layer.visible ? '' : ' is-hidden'}`,
            role: 'option',
            'aria-selected': String(i === ed.layer),
            title: 'Double-click the name to rename',
          },
          eye,
          thumb,
          name,
        );
        row.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.eye, input')) return;
          ed.setLayer(i);
        });
        return row;
      })
      .reverse();
    list.replaceChildren(...rows);
    paintAll();
    syncOpacity();
  };

  const paint = (i: number) => {
    const t = thumbs[i];
    if (t) paintPixels(t, ed.doc.layers[i].cels[ed.frame], ed.doc.width, ed.doc.height);
  };
  const paintAll = () => ed.doc.layers.forEach((_, i) => paint(i));
  const syncOpacity = () => {
    if (before) return;
    opacity.value = String(ed.activeLayer.opacity);
    opacityVal.textContent = `${Math.round((ed.activeLayer.opacity / 255) * 100)}%`;
  };

  ed.subscribe((c) => {
    if (c.has('structure') || c.has('cursor')) build();
    else if (c.has('pixels') && !app.view.isBusy) paint(ed.layer);
  });
  // Refresh the active thumbnail once a stroke ends.
  app.view.canvas.addEventListener('pointerup', () => requestAnimationFrame(() => paint(ed.layer)));
  build();
}
