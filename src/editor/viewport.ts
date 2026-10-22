import { colorToCss } from '../core/color';
import { compositeFrame } from '../core/document';
import { Point, brushOffsets } from '../core/raster';
import { Editor, ToolId } from './editor';
import { PointerInfo, Tool, createTools } from './tools';

export const ZOOM_STEPS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64];

const DRAWING_TOOLS: ToolId[] = ['pencil', 'eraser', 'fill', 'line', 'rect', 'ellipse', 'move'];
const BRUSH_TOOLS: ToolId[] = ['pencil', 'eraser', 'line', 'rect', 'ellipse'];

/** Draws the sprite canvas and turns pointer input into tool calls. */
export class Viewport {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;

  private comp = document.createElement('canvas');
  private compCtx = this.comp.getContext('2d')!;
  private onionCanvas = document.createElement('canvas');
  private onionCtx = this.onionCanvas.getContext('2d')!;
  private buf = new Uint32Array(0);
  private checker: CanvasPattern | null = null;

  private tools: Record<string, Tool>;
  private active: { tool: Tool; pointerId: number } | null = null;
  private pan: { x: number; y: number; px: number; py: number; pointerId: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; mid: Point; zoom: number; panX: number; panY: number } | null = null;
  private frameReq = 0;

  hover: Point | null = null;
  spaceDown = false;
  onHover: (p: Point | null) => void = () => {};
  notify: (msg: string) => void = () => {};

  constructor(private ed: Editor, host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewport-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Sprite canvas');
    host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.tools = createTools(ed);

    new ResizeObserver(() => this.resize(host)).observe(host);
    this.resize(host);
    this.bindPointer();
    ed.subscribe(() => this.requestRender());
  }

  // ---- view transform -------------------------------------------------------

  private resize(host: HTMLElement) {
    const r = host.getBoundingClientRect();
    const first = this.cssW === 0;
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = Math.max(1, r.width);
    this.cssH = Math.max(1, r.height);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    if (first) this.fit();
    this.requestRender();
  }

  fit() {
    const { width, height } = this.ed.doc;
    const avail = Math.min((this.cssW * 0.86) / width, (this.cssH * 0.86) / height);
    const z = [...ZOOM_STEPS].reverse().find((s) => s <= avail) ?? ZOOM_STEPS[0];
    this.ed.zoom = z;
    this.ed.panX = Math.round((this.cssW - width * z) / 2);
    this.ed.panY = Math.round((this.cssH - height * z) / 2);
    this.ed.emit('view');
  }

  /** Zooms to `z`, keeping the sprite point under (cx, cy) fixed. */
  zoomTo(z: number, cx = this.cssW / 2, cy = this.cssH / 2) {
    const ed = this.ed;
    const sx = (cx - ed.panX) / ed.zoom;
    const sy = (cy - ed.panY) / ed.zoom;
    ed.zoom = z;
    ed.panX = Math.round(cx - sx * z);
    ed.panY = Math.round(cy - sy * z);
    ed.emit('view');
  }

  zoomStep(dir: 1 | -1, cx?: number, cy?: number) {
    const i = ZOOM_STEPS.findIndex((s) => s >= this.ed.zoom);
    const cur = i < 0 ? ZOOM_STEPS.length - 1 : i;
    const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, cur + dir))];
    this.zoomTo(next, cx, cy);
  }

  private toPixel(clientX: number, clientY: number): Point {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: Math.floor((clientX - r.left - this.ed.panX) / this.ed.zoom),
      y: Math.floor((clientY - r.top - this.ed.panY) / this.ed.zoom),
    };
  }

  // ---- input ----------------------------------------------------------------

  private bindPointer() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('pointerdown', (e) => {
      c.focus({ preventScroll: true });
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size === 2) {
        // A second finger turns the gesture into pinch-zoom.
        this.active?.tool.cancel();
        this.active = null;
        this.pan = null;
        const [a, b] = [...this.pointers.values()];
        const r = c.getBoundingClientRect();
        this.pinch = {
          dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          mid: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top },
          zoom: this.ed.zoom,
          panX: this.ed.panX,
          panY: this.ed.panY,
        };
        return;
      }
      if (this.pointers.size > 2) return;

      if (e.button === 1 || this.spaceDown || this.ed.tool === 'hand') {
        this.pan = { x: e.clientX, y: e.clientY, px: this.ed.panX, py: this.ed.panY, pointerId: e.pointerId };
        c.classList.add('is-panning');
        return;
      }
      if (e.button !== 0 && e.button !== 2) return;

      const toolId: ToolId = e.altKey ? 'eyedropper' : this.ed.tool;
      if (DRAWING_TOOLS.includes(toolId) && !this.ed.activeLayer.visible) {
        this.notify(`“${this.ed.activeLayer.name}” is hidden. Show the layer to draw on it.`);
        return;
      }
      if (this.ed.playing) {
        this.ed.playing = false;
        this.ed.emit('playback');
      }
      const tool = this.tools[toolId];
      if (!tool) return;
      this.active = { tool, pointerId: e.pointerId };
      tool.down(this.info(e));
    });

    c.addEventListener('pointermove', (e) => {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = this.toPixel(e.clientX, e.clientY);
      if (!this.hover || this.hover.x !== p.x || this.hover.y !== p.y) {
        this.hover = p;
        this.onHover(p);
        this.requestRender();
      }

      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const r = c.getBoundingClientRect();
        const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
        const raw = (this.pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / this.pinch.dist;
        const z = ZOOM_STEPS.reduce((best, s) => (Math.abs(Math.log(s / raw)) < Math.abs(Math.log(best / raw)) ? s : best));
        const sx = (this.pinch.mid.x - this.pinch.panX) / this.pinch.zoom;
        const sy = (this.pinch.mid.y - this.pinch.panY) / this.pinch.zoom;
        this.ed.zoom = z;
        this.ed.panX = Math.round(mid.x - sx * z);
        this.ed.panY = Math.round(mid.y - sy * z);
        this.ed.emit('view');
        return;
      }
      if (this.pan && this.pan.pointerId === e.pointerId) {
        this.ed.panX = this.pan.px + (e.clientX - this.pan.x);
        this.ed.panY = this.pan.py + (e.clientY - this.pan.y);
        this.ed.emit('view');
        return;
      }
      if (this.active && this.active.pointerId === e.pointerId) this.active.tool.move(this.info(e));
    });

    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pan?.pointerId === e.pointerId) {
        this.pan = null;
        c.classList.remove('is-panning');
      }
      if (this.active?.pointerId === e.pointerId) {
        if (e.type === 'pointercancel') this.active.tool.cancel();
        else this.active.tool.up(this.info(e));
        this.active = null;
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => {
      if (!this.active) {
        this.hover = null;
        this.onHover(null);
        this.requestRender();
      }
    });

    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX) * 2) {
          // Mouse wheel and trackpad pinch zoom, like Aseprite.
          if (Math.abs(e.deltaY) < 1) return;
          this.zoomStep(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
        } else {
          this.ed.panX -= e.deltaX;
          this.ed.panY -= e.deltaY;
          this.ed.emit('view');
        }
      },
      { passive: false },
    );
  }

  private info(e: PointerEvent): PointerInfo {
    const p = this.toPixel(e.clientX, e.clientY);
    return { ...p, button: e.button === 2 ? 'secondary' : 'primary', shift: e.shiftKey, alt: e.altKey };
  }

  get isBusy() {
    return !!this.active;
  }

  // ---- rendering ------------------------------------------------------------

  requestRender() {
    if (!this.frameReq) this.frameReq = requestAnimationFrame(() => this.render());
  }

  private drawFrameTo(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, frame: number) {
    const { doc } = this.ed;
    if (canvas.width !== doc.width || canvas.height !== doc.height) {
      canvas.width = doc.width;
      canvas.height = doc.height;
    }
    if (this.buf.length !== doc.width * doc.height) this.buf = new Uint32Array(doc.width * doc.height);
    compositeFrame(doc, frame, this.buf);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(this.buf.buffer), doc.width, doc.height), 0, 0);
  }

  private checkerPattern(ctx: CanvasRenderingContext2D): CanvasPattern {
    if (this.checker) return this.checker;
    const t = document.createElement('canvas');
    t.width = t.height = 16;
    const g = t.getContext('2d')!;
    g.fillStyle = '#c9ccd6';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#e9ebf1';
    g.fillRect(0, 0, 8, 8);
    g.fillRect(8, 8, 8, 8);
    this.checker = ctx.createPattern(t, 'repeat')!;
    return this.checker;
  }

  render() {
    this.frameReq = 0;
    const { ed, ctx } = this;
    const { doc, zoom, panX, panY } = ed;
    const sw = doc.width * zoom;
    const sh = doc.height * zoom;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    ctx.save();
    ctx.translate(panX, panY);
    ctx.fillStyle = this.checkerPattern(ctx);
    ctx.fillRect(0, 0, sw, sh);
    ctx.restore();

    ctx.imageSmoothingEnabled = false;

    if (ed.onion && !ed.playing) {
      const draw = (f: number, tint: string, alpha: number) => {
        if (f < 0 || f >= doc.frames.length || f === ed.frame) return;
        this.drawFrameTo(this.onionCanvas, this.onionCtx, f);
        this.onionCtx.globalCompositeOperation = 'source-atop';
        this.onionCtx.fillStyle = tint;
        this.onionCtx.fillRect(0, 0, doc.width, doc.height);
        this.onionCtx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = alpha;
        ctx.drawImage(this.onionCanvas, panX, panY, sw, sh);
        ctx.globalAlpha = 1;
      };
      for (let k = ed.onionBefore; k >= 1; k--) draw(ed.frame - k, 'rgba(255,70,90,0.55)', 0.42 / k);
      for (let k = ed.onionAfter; k >= 1; k--) draw(ed.frame + k, 'rgba(60,140,255,0.55)', 0.42 / k);
    }

    this.drawFrameTo(this.comp, this.compCtx, ed.frame);
    ctx.drawImage(this.comp, panX, panY, sw, sh);

    const hair = 1 / this.dpr;

    if (ed.showGrid && zoom >= 6) {
      ctx.beginPath();
      for (let x = 1; x < doc.width; x++) {
        const X = Math.round((panX + x * zoom) * this.dpr) / this.dpr + hair / 2;
        ctx.moveTo(X, panY);
        ctx.lineTo(X, panY + sh);
      }
      for (let y = 1; y < doc.height; y++) {
        const Y = Math.round((panY + y * zoom) * this.dpr) / this.dpr + hair / 2;
        ctx.moveTo(panX, Y);
        ctx.lineTo(panX + sw, Y);
      }
      ctx.lineWidth = hair;
      ctx.strokeStyle = 'rgba(20,22,30,0.16)';
      ctx.stroke();
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeRect(panX - 0.5, panY - 0.5, sw + 1, sh + 1);

    if (ed.selection) {
      const s = ed.selection;
      const x = panX + s.x * zoom + 0.5;
      const y = panY + s.y * zoom + 0.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#000';
      ctx.strokeRect(x, y, s.w * zoom - 1, s.h * zoom - 1);
      ctx.lineDashOffset = 4;
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(x, y, s.w * zoom - 1, s.h * zoom - 1);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    this.drawBrushCursor();
  }

  private drawBrushCursor() {
    const { ed, ctx, hover } = this;
    if (!hover || this.pan || ed.playing) return;
    const tool = ed.tool;
    if (!BRUSH_TOOLS.includes(tool) && tool !== 'fill' && tool !== 'eyedropper') return;
    const size = BRUSH_TOOLS.includes(tool) ? ed.settings.brushSize : 1;
    const offs = brushOffsets(size, ed.settings.brushShape);
    const pts: Point[] = [hover];
    if (ed.settings.mirrorX) pts.push({ x: ed.doc.width - 1 - hover.x, y: hover.y });
    if (ed.settings.mirrorY) pts.push({ x: hover.x, y: ed.doc.height - 1 - hover.y });
    if (ed.settings.mirrorX && ed.settings.mirrorY) pts.push({ x: ed.doc.width - 1 - hover.x, y: ed.doc.height - 1 - hover.y });
    const z = ed.zoom;
    ctx.save();
    for (const p of pts) {
      for (const o of offs) {
        const x = ed.panX + (p.x + o.x) * z;
        const y = ed.panY + (p.y + o.y) * z;
        if (tool === 'pencil' || tool === 'line' || tool === 'rect' || tool === 'ellipse') {
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = colorToCss(ed.primary);
          ctx.fillRect(x, y, z, z);
        }
      }
      // Outline the brush footprint so it reads on any colour.
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1;
      const minX = Math.min(...offs.map((o) => o.x));
      const minY = Math.min(...offs.map((o) => o.y));
      ctx.strokeRect(ed.panX + (p.x + minX) * z - 0.5, ed.panY + (p.y + minY) * z - 0.5, size * z + 1, size * z + 1);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeRect(ed.panX + (p.x + minX) * z - 1.5, ed.panY + (p.y + minY) * z - 1.5, size * z + 3, size * z + 3);
    }
    ctx.restore();
  }
}
