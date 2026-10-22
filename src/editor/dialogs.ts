import { h } from './dom';

export interface DialogAction {
  label: string;
  primary?: boolean;
  /** Return false to keep the dialog open (e.g. on a validation error). */
  run?: () => boolean | void | Promise<boolean | void>;
}

let openCount = 0;

export function isDialogOpen() {
  return openCount > 0;
}

/** A modal built in the page (native alert/confirm are not used). */
export function openDialog(title: string, body: Node[], actions: DialogAction[]): () => void {
  const error = h('p', { class: 'dialog-error', role: 'alert', hidden: true });
  const close = () => {
    overlay.remove();
    openCount--;
    document.removeEventListener('keydown', onKey, true);
    previousFocus?.focus({ preventScroll: true });
  };
  const runAction = async (a: DialogAction) => {
    try {
      const res = await a.run?.();
      if (res !== false) close();
    } catch (e) {
      error.textContent = (e as Error).message;
      error.hidden = false;
    }
  };
  const buttons = actions.map((a) =>
    h('button', { class: a.primary ? 'btn btn-primary' : 'btn', type: 'button', onclick: () => runAction(a) }, a.label),
  );
  const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
  const box = h(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('h2', { class: 'dialog-title', id: titleId }, title),
    h('div', { class: 'dialog-body' }, ...body),
    error,
    h('div', { class: 'dialog-actions' }, ...buttons),
  );
  const overlay = h('div', { class: 'dialog-overlay' }, box);
  overlay.addEventListener('pointerdown', (e) => e.target === overlay && close());

  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLTextAreaElement)) {
      const primary = actions.find((a) => a.primary);
      if (primary) {
        e.preventDefault();
        runAction(primary);
      }
    }
  };
  const previousFocus = document.activeElement as HTMLElement | null;
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  openCount++;
  const first = box.querySelector<HTMLElement>('input, select, button.btn-primary');
  first?.focus();
  if (first instanceof HTMLInputElement) first.select();
  return close;
}

export function field(label: string, control: HTMLElement, note?: string): HTMLElement {
  return h('label', { class: 'dlg-field' }, h('span', { class: 'field-label' }, label), control, note ? h('span', { class: 'dlg-note' }, note) : null);
}

export function numberInput(id: string, value: number, min: number, max: number): HTMLInputElement {
  return h('input', { id, class: 'num-input', type: 'number', value, min, max }) as HTMLInputElement;
}

export function selectInput(id: string, options: [string, string][], value: string): HTMLSelectElement {
  const s = h('select', { id, class: 'select-input' }, ...options.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
  s.value = value;
  return s;
}

export function readInt(input: HTMLInputElement, min: number, max: number, what: string): number {
  const v = Number(input.value);
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${what} must be a whole number from ${min} to ${max}.`);
  return v;
}
