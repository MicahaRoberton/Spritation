import { addFrame, deleteFrame, deleteTag, setFrameDuration, shiftFrame } from '../actions';
import { App, paintPixels } from '../app';
import { compositeFrame } from '../../core/document';
import { h, iconButton } from '../dom';
import { ICONS } from '../icons';

export function mountTimeline(app: App, root: HTMLElement) {
  const { ed } = app;

  const playBtn = iconButton(ICONS.play, 'Play (Enter)', () => app.run('play'), { class: 'icon-btn play-btn' });
  const loopBtn = iconButton(ICONS.loop, 'Loop playback', () => {
    ed.loop = !ed.loop;
    ed.emit('playback');
  });
  const onionBtn = iconButton(ICONS.onion, 'Onion skin (F3)', () => app.run('toggle-onion'));
  const counter = h('span', { class: 'frame-counter mono' });

  const duration = h('input', { id: 'frame-duration', type: 'number', min: 10, max: 10000, step: 10, class: 'num-input' }) as HTMLInputElement;
  duration.addEventListener('change', () => setFrameDuration(ed, Number(duration.value) || 100));
  const applyAll = h('button', {
    class: 'text-btn',
    type: 'button',
    title: 'Use this duration for every frame',
    onclick: () => setFrameDuration(ed, Number(duration.value) || 100, true),
  }, 'All frames');
  const fps = h('span', { class: 'small muted mono' });

  const onionBefore = h('input', { id: 'onion-before', type: 'number', min: 0, max: 5, class: 'num-input tiny', title: 'Onion frames before' }) as HTMLInputElement;
  const onionAfter = h('input', { id: 'onion-after', type: 'number', min: 0, max: 5, class: 'num-input tiny', title: 'Onion frames after' }) as HTMLInputElement;
  const onOnion = () => {
    ed.onionBefore = Math.max(0, Math.min(5, Number(onionBefore.value) || 0));
    ed.onionAfter = Math.max(0, Math.min(5, Number(onionAfter.value) || 0));
    ed.emit('playback');
  };
  onionBefore.addEventListener('change', onOnion);
  onionAfter.addEventListener('change', onOnion);

  const controls = h(
    'div',
    { class: 'timeline-controls' },
    h(
      'div',
      { class: 'tl-group' },
      iconButton(ICONS.first, 'First frame (Home)', () => ed.setFrame(0)),
      iconButton(ICONS.prev, 'Previous frame (,)', () => app.run('prev-frame')),
      playBtn,
      iconButton(ICONS.next, 'Next frame (.)', () => app.run('next-frame')),
      iconButton(ICONS.last, 'Last frame (End)', () => ed.setFrame(ed.doc.frames.length - 1)),
      loopBtn,
      counter,
    ),
    h(
      'div',
      { class: 'tl-group' },
      h('label', { class: 'opt' }, h('span', { class: 'opt-label' }, 'Duration'), duration, h('span', { class: 'small muted' }, 'ms')),
      fps,
      applyAll,
    ),
    h(
      'div',
      { class: 'tl-group' },
      onionBtn,
      h('label', { class: 'opt', title: 'Frames shown before (red) and after (blue)' }, onionBefore, h('span', { class: 'small muted' }, '/'), onionAfter),
    ),
    h(
      'div',
      { class: 'tl-group' },
      iconButton(ICONS.plus, 'New frame, copy of this one (Alt+N)', () => addFrame(ed)),
      iconButton(ICONS.file, 'New empty frame', () => addFrame(ed, true)),
      iconButton(ICONS.left, 'Move frame left', () => shiftFrame(ed, -1)),
      iconButton(ICONS.right, 'Move frame right', () => shiftFrame(ed, 1)),
      iconButton(ICONS.trash, 'Delete frame', () => deleteFrame(ed) || app.toast('A sprite needs at least one frame.')),
      iconButton(ICONS.tag, 'New animation tag', () => app.run('new-tag')),
    ),
  );

  const tags = h('div', { class: 'tag-row' });
  const strip = h('div', { class: 'frame-strip', role: 'listbox', 'aria-label': 'Frames' });
  const scroller = h('div', { class: 'frame-scroller' }, tags, strip);
  root.append(controls, scroller);

  const thumbs: HTMLCanvasElement[] = [];
  let buf = new Uint32Array(0);

  const paint = (i: number) => {
    const t = thumbs[i];
    if (!t) return;
    if (buf.length !== ed.doc.width * ed.doc.height) buf = new Uint32Array(ed.doc.width * ed.doc.height);
    paintPixels(t, compositeFrame(ed.doc, i, buf), ed.doc.width, ed.doc.height);
  };

  const build = () => {
    thumbs.length = 0;
    strip.replaceChildren(
      ...ed.doc.frames.map((f, i) => {
        const thumb = h('canvas', { class: 'thumb' }) as HTMLCanvasElement;
        thumbs[i] = thumb;
        const cell = h(
          'button',
          { class: 'frame-cell', type: 'button', role: 'option', title: `Frame ${i + 1} · ${f.duration} ms` },
          thumb,
          h('span', { class: 'frame-num mono' }, String(i + 1)),
        );
        cell.addEventListener('click', () => ed.setFrame(i));
        return cell;
      }),
    );
    tags.replaceChildren(
      ...ed.doc.tags.map((t, i) => {
        const pill = h(
          'span',
          { class: 'tag-pill', title: `${t.name}: frames ${t.from + 1}–${t.to + 1}, ${t.direction}` },
          h('span', {}, t.name),
          h('button', { class: 'tag-x', type: 'button', 'aria-label': `Delete tag ${t.name}`, onclick: () => deleteTag(ed, i) }, '×'),
        );
        // Each frame cell is 56px plus a 4px gap; tags span their frames.
        pill.style.left = `${t.from * 60}px`;
        pill.style.width = `${(t.to - t.from + 1) * 60 - 4}px`;
        return pill;
      }),
    );
    tags.hidden = ed.doc.tags.length === 0;
    thumbs.forEach((_, i) => paint(i));
    syncCursor();
  };

  const syncCursor = () => {
    [...strip.children].forEach((el, i) => {
      el.classList.toggle('is-active', i === ed.frame);
      el.setAttribute('aria-selected', String(i === ed.frame));
    });
    const active = strip.children[ed.frame] as HTMLElement | undefined;
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    counter.textContent = `${ed.frame + 1} / ${ed.doc.frames.length}`;
    const d = ed.doc.frames[ed.frame].duration;
    if (document.activeElement !== duration) duration.value = String(d);
    fps.textContent = `≈ ${(1000 / d).toFixed(1)} fps`;
  };

  const syncPlayback = () => {
    playBtn.innerHTML = ed.playing ? ICONS.pause : ICONS.play;
    playBtn.title = ed.playing ? 'Stop (Enter)' : 'Play (Enter)';
    playBtn.setAttribute('aria-label', playBtn.title);
    loopBtn.setAttribute('aria-pressed', String(ed.loop));
    onionBtn.setAttribute('aria-pressed', String(ed.onion));
    onionBefore.value = String(ed.onionBefore);
    onionAfter.value = String(ed.onionAfter);
  };

  ed.subscribe((c) => {
    if (c.has('structure')) build();
    else if (c.has('cursor')) syncCursor();
    if (c.has('pixels') && !c.has('structure') && !app.view.isBusy) paint(ed.frame);
    if (c.has('playback')) syncPlayback();
  });
  build();
  syncPlayback();
}
