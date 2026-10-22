type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

/** Small element builder: `h('button', { class: 'x', onclick: fn }, 'Label')`. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function iconButton(icon: string, title: string, onclick: () => void, extra: Attrs = {}): HTMLButtonElement {
  return h('button', { class: 'icon-btn', type: 'button', title, 'aria-label': title, html: icon, onclick, ...extra });
}

export function panelHeader(title: string, ...actions: Child[]): HTMLElement {
  return h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, title), h('div', { class: 'panel-actions' }, ...actions));
}
