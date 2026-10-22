import { Editor } from './editor';
import { Viewport } from './viewport';
import { Platform } from '../platform/platform';

/** What panels and commands share. Built once in main.ts. */
export interface App {
  ed: Editor;
  view: Viewport;
  platform: Platform;
  toast(message: string): void;
  run(command: string): void;
}

/** Puts packed RGBA pixels on a canvas at 1:1 (CSS scales it with `pixelated`). */
export function paintPixels(canvas: HTMLCanvasElement, pixels: Uint32Array, width: number, height: number) {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const copy = new Uint8ClampedArray(pixels.length * 4);
  copy.set(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength));
  canvas.getContext('2d')!.putImageData(new ImageData(copy, width, height), 0, 0);
}
