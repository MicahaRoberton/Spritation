import { createDocument, insertFrame, MAX_SIZE, SpriteDoc } from '../core/document';
import { PALETTES, paletteColors } from '../core/palettes';
import { Raster } from '../core/raster';
import { deserializeDocument, serializeDocument } from '../core/serialize';
import { SheetLayout, buildGif, buildSpriteSheet, frameRaster } from '../io/export';
import { OpenedFile } from '../platform/platform';
import { App } from './app';
import { field, numberInput, openDialog, readInt, selectInput } from './dialogs';
import { h } from './dom';

const PROJECT_FILTER = { name: 'Spritation sprite', extensions: ['json'] };
const IMAGE_FILTER = { name: 'Images', extensions: ['png', 'gif', 'jpg', 'jpeg', 'webp'] };
export const PROJECT_EXT = '.sprite.json';

const baseName = (name: string) => name.replace(/\.sprite\.json$/i, '').replace(/\.[a-z0-9]+$/i, '') || 'sprite';

export async function rasterToPng(r: Raster): Promise<Uint8Array> {
  const c = document.createElement('canvas');
  c.width = r.width;
  c.height = r.height;
  const bytes = new Uint8ClampedArray(r.data.length * 4);
  bytes.set(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength));
  c.getContext('2d')!.putImageData(new ImageData(bytes, r.width, r.height), 0, 0);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
  if (!blob) throw new Error('The PNG could not be encoded');
  return new Uint8Array(await blob.arrayBuffer());
}

async function decodeImage(data: Uint8Array): Promise<Raster> {
  const bitmap = await createImageBitmap(new Blob([data as BlobPart]));
  if (bitmap.width > MAX_SIZE || bitmap.height > MAX_SIZE) {
    throw new Error(`Images up to ${MAX_SIZE}×${MAX_SIZE} pixels can be opened. This one is ${bitmap.width}×${bitmap.height}.`);
  }
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  return { width: c.width, height: c.height, data: new Uint32Array(img.data.buffer) };
}

/** Builds a document from an image, optionally slicing a sprite sheet into frames. */
export function docFromImage(img: Raster, frameW = img.width, frameH = img.height): SpriteDoc {
  const cols = Math.max(1, Math.floor(img.width / frameW));
  const rows = Math.max(1, Math.floor(img.height / frameH));
  const doc = createDocument(frameW, frameH, paletteColors('db32'));
  doc.layers[0].name = 'Image';
  for (let i = 0; i < cols * rows; i++) {
    if (i > 0) insertFrame(doc, i);
    const cel = doc.layers[0].cels[i];
    const ox = (i % cols) * frameW;
    const oy = Math.floor(i / cols) * frameH;
    for (let y = 0; y < frameH; y++) {
      for (let x = 0; x < frameW; x++) cel[y * frameW + x] = img.data[(oy + y) * img.width + ox + x];
    }
  }
  return doc;
}

export function confirmDiscard(app: App, then: () => void) {
  if (!app.ed.modified) return then();
  openDialog('Discard unsaved changes?', [h('p', {}, `“${app.ed.projectName}” has changes that aren't saved to a file.`)], [
    { label: 'Cancel' },
    { label: 'Discard changes', primary: true, run: then },
  ]);
}

export function newSpriteDialog(app: App) {
  const w = numberInput('new-width', 32, 1, MAX_SIZE);
  const hgt = numberInput('new-height', 32, 1, MAX_SIZE);
  const palette = selectInput('new-palette', PALETTES.map((p) => [p.id, p.name]), 'db32');
  const presets = h(
    'div',
    { class: 'preset-row' },
    ...[
      [16, 16],
      [32, 32],
      [48, 48],
      [64, 64],
      [128, 128],
      [320, 180],
    ].map(([pw, ph]) =>
      h('button', { class: 'chip-btn', type: 'button', onclick: () => ((w.value = String(pw)), (hgt.value = String(ph))) }, `${pw}×${ph}`),
    ),
  );
  openDialog('New sprite', [h('div', { class: 'dlg-grid' }, field('Width', w, 'px'), field('Height', hgt, 'px')), presets, field('Palette', palette)], [
    { label: 'Cancel' },
    {
      label: 'Create',
      primary: true,
      run: () => {
        const doc = createDocument(readInt(w, 1, MAX_SIZE, 'Width'), readInt(hgt, 1, MAX_SIZE, 'Height'), paletteColors(palette.value));
        confirmDiscard(app, () => {
          app.ed.load(doc, 'Untitled');
          app.view.fit();
        });
      },
    },
  ]);
}

export async function openFile(app: App) {
  const file = await app.platform.openFile([{ name: 'Sprites and images', extensions: ['json', ...IMAGE_FILTER.extensions] }, PROJECT_FILTER, IMAGE_FILTER]);
  if (file) await loadFile(app, file);
}

export async function loadFile(app: App, file: OpenedFile) {
  try {
    if (/\.json$/i.test(file.name)) {
      const doc = deserializeDocument(new TextDecoder().decode(file.data));
      confirmDiscard(app, () => {
        app.ed.load(doc, baseName(file.name), file.path);
        app.view.fit();
        app.toast(`Opened ${file.name}`);
      });
      return;
    }
    const img = await decodeImage(file.data);
    importImageDialog(app, img, file.name);
  } catch (e) {
    app.toast((e as Error).message);
  }
}

function importImageDialog(app: App, img: Raster, name: string) {
  const fw = numberInput('import-fw', img.width, 1, img.width);
  const fh = numberInput('import-fh', img.height, 1, img.height);
  const guess = img.width > img.height && img.width % img.height === 0 ? img.height : img.width;
  const sheet = h(
    'button',
    { class: 'chip-btn', type: 'button', onclick: () => ((fw.value = String(guess)), (fh.value = String(img.height))) },
    `Square frames (${guess}×${img.height})`,
  );
  openDialog(
    `Open ${name}`,
    [
      h('p', {}, `This image is ${img.width}×${img.height}. To slice a sprite sheet into animation frames, enter the size of one frame.`),
      h('div', { class: 'dlg-grid' }, field('Frame width', fw, 'px'), field('Frame height', fh, 'px')),
      h('div', { class: 'preset-row' }, sheet),
    ],
    [
      { label: 'Cancel' },
      {
        label: 'Open',
        primary: true,
        run: () => {
          const doc = docFromImage(img, readInt(fw, 1, img.width, 'Frame width'), readInt(fh, 1, img.height, 'Frame height'));
          confirmDiscard(app, () => {
            app.ed.load(doc, baseName(name));
            app.view.fit();
            app.toast(`Opened ${name} as ${doc.frames.length} frame${doc.frames.length === 1 ? '' : 's'}`);
          });
        },
      },
    ],
  );
}

export async function saveProject(app: App, saveAs = false) {
  const { ed, platform } = app;
  try {
    const path = await platform.saveFile(ed.projectName + PROJECT_EXT, serializeDocument(ed.doc), [PROJECT_FILTER], saveAs ? undefined : ed.projectPath);
    if (!path) return;
    if (platform.kind === 'desktop') {
      ed.projectPath = path;
      ed.projectName = baseName(path.split(/[\\/]/).pop() ?? path);
    }
    ed.modified = false;
    ed.emit('file');
    app.toast(`Saved ${ed.projectName}${PROJECT_EXT}`);
  } catch (e) {
    app.toast(`Couldn't save: ${(e as Error).message}`);
  }
}

type ExportKind = 'png' | 'sheet' | 'gif';

export function exportDialog(app: App) {
  const { ed } = app;
  const kind = selectInput(
    'export-kind',
    [
      ['sheet', 'Sprite sheet (PNG + JSON)'],
      ['gif', 'Animated GIF'],
      ['png', 'Current frame (PNG)'],
    ],
    ed.doc.frames.length > 1 ? 'sheet' : 'png',
  );
  const scale = selectInput('export-scale', ['1', '2', '3', '4', '6', '8', '10', '16'].map((s) => [s, `${s}×`]), '1');
  const layout = selectInput(
    'export-layout',
    [
      ['row', 'One row'],
      ['column', 'One column'],
      ['grid', 'Grid'],
    ],
    'row',
  );
  const padding = numberInput('export-padding', 0, 0, 16);
  const json = h('input', { id: 'export-json', type: 'checkbox', checked: true }) as HTMLInputElement;
  const range = selectInput(
    'export-range',
    [['all', 'All frames'], ...ed.doc.tags.map((t, i): [string, string] => [String(i), `Tag: ${t.name} (${t.from + 1}–${t.to + 1})`])],
    'all',
  );
  const sheetOpts = h(
    'div',
    { class: 'dlg-stack' },
    h('div', { class: 'dlg-grid' }, field('Layout', layout), field('Padding', padding, 'px between frames')),
    h('label', { class: 'dlg-check' }, json, h('span', {}, 'Also save frame data (.json) for game engines')),
  );
  const gifOpts = field('Frames', range);
  const size = h('p', { class: 'dlg-note' });
  const sync = () => {
    const k = kind.value as ExportKind;
    sheetOpts.hidden = k !== 'sheet';
    gifOpts.hidden = k !== 'gif';
    const s = Number(scale.value);
    size.textContent = `Each frame exports at ${ed.doc.width * s}×${ed.doc.height * s} px.`;
  };
  kind.addEventListener('change', sync);
  scale.addEventListener('change', sync);
  sync();

  openDialog('Export', [field('Format', kind), field('Scale', scale), size, sheetOpts, gifOpts], [
    { label: 'Cancel' },
    {
      label: 'Export',
      primary: true,
      run: () => {
        runExport(app, kind.value as ExportKind, {
          scale: Number(scale.value),
          layout: layout.value as SheetLayout,
          padding: readInt(padding, 0, 16, 'Padding'),
          json: json.checked,
          range: range.value,
        });
      },
    },
  ]);
}

async function runExport(app: App, kind: ExportKind, o: { scale: number; layout: SheetLayout; padding: number; json: boolean; range: string }) {
  const { ed, platform } = app;
  const name = ed.projectName;
  try {
    if (kind === 'png') {
      const png = await rasterToPng(frameRaster(ed.doc, ed.frame, o.scale));
      const suffix = ed.doc.frames.length > 1 ? `-${ed.frame + 1}` : '';
      if (await platform.saveFile(`${name}${suffix}.png`, png, [{ name: 'PNG image', extensions: ['png'] }])) app.toast('Exported PNG');
    } else if (kind === 'sheet') {
      const imageName = `${name}-sheet.png`;
      const { image, json } = buildSpriteSheet(ed.doc, { layout: o.layout, scale: o.scale, padding: o.padding, imageName });
      const saved = await platform.saveFile(imageName, await rasterToPng(image), [{ name: 'PNG image', extensions: ['png'] }]);
      if (!saved) return;
      if (o.json) {
        const pngName = saved.split(/[\\/]/).pop() ?? imageName;
        (json as { meta: { image: string } }).meta.image = pngName;
        await platform.saveFile(pngName.replace(/\.png$/i, '') + '.json', JSON.stringify(json, null, 2), [{ name: 'JSON', extensions: ['json'] }]);
      }
      app.toast(`Exported ${image.width}×${image.height} sprite sheet`);
    } else {
      const tag = o.range === 'all' ? null : ed.doc.tags[Number(o.range)];
      const gif = buildGif(ed.doc, o.scale, tag?.from ?? 0, tag?.to ?? ed.doc.frames.length - 1);
      const file = tag ? `${name}-${tag.name}.gif` : `${name}.gif`;
      if (await platform.saveFile(file, gif, [{ name: 'GIF animation', extensions: ['gif'] }])) app.toast('Exported GIF');
    }
  } catch (e) {
    app.toast(`Export failed: ${(e as Error).message}`);
  }
}
