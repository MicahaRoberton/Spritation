# Spritation

A pixel art sprite editor and animation tool, built as the first module of a
toolkit for making 2D games end to end. It runs as a desktop app (Electron) and
in the browser.

## What's in 0.1

**Drawing**
- Pencil, eraser, paint bucket (contiguous or global), line, rectangle, ellipse, eyedropper
- Rectangular marquee, move (drag or arrow-key nudge), cut/copy/paste, flip
- Brush size 1–64, square or round brush, pixel-perfect freehand strokes
- Mirror X / Mirror Y symmetry
- Drawing is clipped to the selection; Alt is a temporary eyedropper

**Canvas**
- Zoom 25%–6400% around the cursor (wheel, pinch, `=` `-` `0`)
- Pan with Space-drag, middle mouse, the Hand tool or two fingers
- Pixel grid, transparent checkerboard, brush preview cursor

**Colour**
- Primary and secondary colours with alpha, hex entry and a native picker
- Per-sprite palette with presets: DawnBringer 32, ENDESGA 32, PICO-8, Sweetie 16, Game Boy

**Layers and animation**
- Layers with visibility, opacity, rename, reorder, duplicate, merge down
- Frames with per-frame duration, duplicate, reorder, delete
- Onion skin (frames before in red, after in blue), playback with loop
- A live preview panel that keeps playing while you draw
- Animation tags ("idle", "walk") over frame ranges

**Files**
- Save and open projects as `.sprite.json`
- Export the current frame as PNG, all frames as a sprite sheet (row, column or grid,
  with padding and scale) plus Aseprite-compatible JSON, or an animated GIF
- Open PNG/GIF/JPEG/WebP images, and slice a sprite sheet into frames
- Drag and drop files onto the window
- Undo/redo for every edit, and autosave so a reload never loses work

**Examples**
- A bouncing slime and a 10-frame talking pumpkin, under Examples in the toolbar
  or File menu. In the browser, a link ending in `#pumpkin` opens it and plays it.

Press **F1** in the app for the full shortcut list. They follow Aseprite where
possible (B pencil, E eraser, G bucket, M marquee, V move, Alt+N new frame…).

## Getting started

Requires Node 20 or newer.

```bash
npm install
npm run dev          # browser at http://localhost:5173
npm run desktop      # build and launch the Electron app
npm test             # unit tests
npm run package      # installers for your OS into release/
```

For desktop development with hot reload, run `npm run dev` in one terminal and
`npm run desktop:dev` in another.

`npm run build:preview` writes a single self-contained `dist-preview/index.html`
you can open or share without a server.

## Architecture

```
src/
  core/        Sprite model and pixel algorithms. No DOM, fully unit tested.
    document.ts    SpriteDoc: layers × frames of RGBA cels, tags, palette, compositing
    raster.ts      Bresenham, ellipses, flood fill, region copy/paste/flip
    history.ts     Undo stack (per-cel diffs for strokes, snapshots for structure)
    serialize.ts   .sprite.json project format (versioned)
    color.ts, palettes.ts
  io/          Export encoders: animated GIF (LZW), sprite sheet + JSON
  editor/      The editor UI
    editor.ts      Session state and change events; the only thing panels talk to
    tools.ts       Pointer tools, all writing through one undoable CelEdit
    actions.ts     Non-pointer edits (layers, frames, clipboard, palette)
    commands.ts    Command registry and keyboard shortcuts
    viewport.ts    Canvas rendering, zoom/pan, pointer and touch input
    panels/        Toolbar, options bar, colours, palette, preview, layers, timeline
  platform/    Desktop (Electron IPC) vs browser file access
electron/      Main process (window, native menus, file dialogs) and preload bridge
tests/         Vitest suites for core, io and editor behaviour
```

The rules that keep it extensible:

- `core/` never imports from `editor/`. A future game runtime, tilemap editor or
  scene editor loads and composites sprites with the same code.
- Pixels are packed `Uint32Array` RGBA, so cels go straight into `ImageData`
  without conversion.
- Every edit goes through `Editor.commitCel` or `Editor.structural`, so undo,
  autosave and the "unsaved" marker work for new features automatically.
- Native menus send command ids; the same `COMMANDS` table drives the in-app
  toolbar and the keyboard, so there is one place to add an action.
- The project file carries a format id and version, so new modules can extend
  it without breaking old files.

## Roadmap

Sprite editor, next:
- Linked cels, layer groups and blend modes
- Indexed colour mode and palette swaps (recolour the sprite from the palette)
- Lasso and magic-wand selection, rotate and scale selection
- Custom brushes, dithering patterns, shading ink
- Tilemap layers with a tileset panel
- Import and export of `.aseprite` files

Toward the game toolkit:
- Tileset and level editor using sprites from the project
- Entity/scene editor with colliders and animation states mapped to tags
- A small 2D runtime that plays scenes in the editor
- One-click export to a web build
