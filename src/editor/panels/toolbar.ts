import { App } from '../app';
import { h } from '../dom';
import { ToolId } from '../editor';
import { ICONS } from '../icons';
import { TOOL_INFO } from '../tools';

const GROUPS: ToolId[][] = [
  ['select', 'move'],
  ['pencil', 'eraser', 'fill', 'eyedropper'],
  ['line', 'rect', 'ellipse'],
  ['hand'],
];

export function mountToolbar(app: App, root: HTMLElement) {
  const buttons = new Map<ToolId, HTMLButtonElement>();
  for (const group of GROUPS) {
    const g = h('div', { class: 'tool-group' });
    for (const id of group) {
      const info = TOOL_INFO[id];
      const b = h('button', {
        class: 'tool-btn',
        type: 'button',
        title: `${info.label} (${info.key})`,
        'aria-label': info.label,
        'aria-pressed': 'false',
        html: ICONS[id],
        onclick: () => app.ed.setTool(id),
      });
      buttons.set(id, b);
      g.append(b);
    }
    root.append(g);
  }

  const sync = () => {
    for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(app.ed.tool === id));
    app.view.canvas.dataset.tool = app.ed.tool;
  };
  app.ed.subscribe((c) => c.has('tool') && sync());
  sync();
}
