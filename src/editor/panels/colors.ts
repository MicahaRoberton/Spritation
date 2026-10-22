import { alphaOf, colorToCss, colorToHex, hexToColor, withAlpha } from '../../core/color';
import { PALETTES } from '../../core/palettes';
import { setPalette, addPaletteColor, removePaletteColor } from '../actions';
import { App } from '../app';
import { h, iconButton, panelHeader } from '../dom';
import { ICONS } from '../icons';

export function mountColors(app: App, root: HTMLElement) {
  const { ed } = app;
  const primary = h('button', { class: 'swatch-big swatch-primary', type: 'button', title: 'Primary colour (left click)' });
  const secondary = h('button', {
    class: 'swatch-big swatch-secondary',
    type: 'button',
    title: 'Secondary colour (right click). Click to swap.',
    onclick: () => ed.swapColors(),
  });
  const picker = h('input', { id: 'color-picker', type: 'color', class: 'color-native', 'aria-label': 'Pick primary colour' }) as HTMLInputElement;
  primary.addEventListener('click', () => picker.click());
  picker.addEventListener('input', () => ed.setPrimary(withAlpha(hexToColor(picker.value), alphaOf(ed.primary) || 255)));

  const hex = h('input', { id: 'color-hex', class: 'text-input mono', maxlength: 9, spellcheck: 'false', 'aria-label': 'Hex colour' }) as HTMLInputElement;
  hex.addEventListener('change', () => {
    try {
      ed.setPrimary(hexToColor(hex.value));
    } catch {
      app.toast('Use a hex colour like #3f3f74 or #3f3f74cc.');
      sync();
    }
  });
  const alpha = h('input', { id: 'color-alpha', type: 'range', min: 0, max: 255, class: 'range', 'aria-label': 'Opacity' }) as HTMLInputElement;
  const alphaVal = h('span', { class: 'mono small' });
  alpha.addEventListener('input', () => ed.setPrimary(withAlpha(ed.primary, Number(alpha.value))));

  root.append(
    panelHeader('Color', iconButton(ICONS.swap, 'Swap colours (X)', () => ed.swapColors())),
    h(
      'div',
      { class: 'color-row' },
      h('div', { class: 'swatch-stack' }, secondary, primary, picker),
      h(
        'div',
        { class: 'color-fields' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Hex'), hex),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Alpha'), alpha, alphaVal),
      ),
    ),
  );

  function sync() {
    primary.style.setProperty('--c', colorToCss(ed.primary));
    secondary.style.setProperty('--c', colorToCss(ed.secondary));
    picker.value = colorToHex(ed.primary);
    if (document.activeElement !== hex) hex.value = alphaOf(ed.primary) === 255 ? colorToHex(ed.primary) : colorToHex(ed.primary, true);
    alpha.value = String(alphaOf(ed.primary));
    alphaVal.textContent = String(alphaOf(ed.primary)).padStart(3, ' ');
  }
  ed.subscribe((c) => c.has('color') && sync());
  sync();
}

export function mountPalette(app: App, root: HTMLElement) {
  const { ed } = app;
  const preset = h('select', { id: 'palette-preset', class: 'select-input', 'aria-label': 'Load a palette' }) as HTMLSelectElement;
  preset.append(h('option', { value: '' }, 'Load palette…'), ...PALETTES.map((p) => h('option', { value: p.id }, `${p.name} (${p.colors.length})`)));
  preset.addEventListener('change', () => {
    const p = PALETTES.find((x) => x.id === preset.value);
    if (p) {
      setPalette(ed, p.colors);
      app.toast(`Loaded ${p.name}. Undo to get the old palette back.`);
    }
    preset.value = '';
  });
  const grid = h('div', { class: 'palette-grid', role: 'listbox', 'aria-label': 'Palette' });
  root.append(
    panelHeader('Palette', preset, iconButton(ICONS.plus, 'Add primary colour to palette', () => addPaletteColor(ed) || app.toast('That colour is already in the palette.'))),
    grid,
    h('p', { class: 'panel-note' }, 'Left click: primary. Right click: secondary. Shift-click: remove.'),
  );

  const build = () => {
    grid.replaceChildren(
      ...ed.doc.palette.map((c, i) => {
        const b = h('button', {
          class: 'swatch',
          type: 'button',
          role: 'option',
          title: colorToHex(c, alphaOf(c) !== 255),
          'aria-label': colorToHex(c),
        });
        b.style.setProperty('--c', colorToCss(c));
        b.dataset.color = String(c);
        b.addEventListener('click', (e) => (e.shiftKey ? removePaletteColor(ed, i) : ed.setPrimary(c)));
        b.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          ed.setSecondary(c);
        });
        return b;
      }),
    );
    mark();
  };
  const mark = () => {
    for (const el of grid.children) {
      const c = Number((el as HTMLElement).dataset.color);
      el.classList.toggle('is-primary', c === ed.primary);
      el.classList.toggle('is-secondary', c === ed.secondary);
      el.setAttribute('aria-selected', String(c === ed.primary));
    }
  };
  ed.subscribe((c) => {
    if (c.has('structure')) build();
    else if (c.has('color')) mark();
  });
  build();
}
