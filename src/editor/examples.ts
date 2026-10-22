import { SpriteDoc } from '../core/document';
import { App } from './app';
import { openDialog } from './dialogs';
import { h } from './dom';
import { confirmDiscard } from './files';
import { pumpkinSprite } from './pumpkin';
import { sampleSprite } from './sample';

export interface Example {
  id: string;
  name: string;
  about: string;
  create(): SpriteDoc;
}

export const EXAMPLES: Example[] = [
  { id: 'slime', name: 'Bouncing slime', about: '32×32, 4 frames, shadow on its own layer', create: sampleSprite },
  { id: 'pumpkin', name: 'Talking pumpkin', about: '32×32, 10 frames of lip-sync on a Face layer', create: pumpkinSprite },
];

export function findExample(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}

export function openExample(app: App, ex: Example, play = false) {
  confirmDiscard(app, () => {
    app.ed.load(ex.create(), ex.id);
    app.view.fit();
    if (play) app.run('play');
  });
}

export function examplesDialog(app: App) {
  let close = () => {};
  const list = h(
    'div',
    { class: 'example-list' },
    ...EXAMPLES.map((ex) =>
      h(
        'button',
        {
          class: 'example-btn',
          type: 'button',
          onclick: () => {
            close();
            openExample(app, ex, true);
          },
        },
        h('span', { class: 'example-name' }, ex.name),
        h('span', { class: 'dlg-note' }, ex.about),
      ),
    ),
  );
  close = openDialog('Examples', [h('p', {}, 'Open a finished animation to see how it is built, frame by frame and layer by layer.'), list], [{ label: 'Close' }]);
}
