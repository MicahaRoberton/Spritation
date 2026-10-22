/**
 * Everything the editor needs from the host: files and native menus. The
 * desktop build talks to Electron through the preload bridge; the browser
 * build falls back to file inputs and downloads.
 */

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenedFile {
  name: string;
  /** Full path, desktop only. */
  path?: string;
  data: Uint8Array;
}

export interface Platform {
  kind: 'desktop' | 'web';
  /**
   * Resolves to where the file went (a path on desktop, the name on web), or
   * null if the user cancelled. `overwritePath` skips the dialog on desktop.
   */
  saveFile(suggestedName: string, data: Uint8Array | string, filters: FileFilter[], overwritePath?: string): Promise<string | null>;
  openFile(filters: FileFilter[]): Promise<OpenedFile | null>;
  /** Native menu items dispatch editor commands by id. */
  onMenuCommand(handler: (id: string) => void): void;
  setTitle(title: string): void;
}

/** Shape of `window.spritationDesktop`, exposed by electron/preload.ts. */
export interface DesktopBridge {
  saveFile(suggestedName: string, data: Uint8Array, filters: FileFilter[], overwritePath?: string): Promise<string | null>;
  openFile(filters: FileFilter[]): Promise<OpenedFile | null>;
  onMenuCommand(handler: (id: string) => void): void;
  setTitle(title: string): void;
}

declare global {
  interface Window {
    spritationDesktop?: DesktopBridge;
  }
}

const encoder = new TextEncoder();
const toBytes = (d: Uint8Array | string) => (typeof d === 'string' ? encoder.encode(d) : d);

function desktopPlatform(bridge: DesktopBridge): Platform {
  return {
    kind: 'desktop',
    saveFile: (name, data, filters, path) => bridge.saveFile(name, toBytes(data), filters, path),
    openFile: (filters) => bridge.openFile(filters),
    onMenuCommand: (h) => bridge.onMenuCommand(h),
    setTitle: (t) => bridge.setTitle(t),
  };
}

interface DownloadsCapability {
  save(req: { filename: string; data: Blob | Uint8Array | string }): Promise<unknown>;
}

interface ClaudeHost {
  use(name: string): Promise<unknown>;
}

function webPlatform(): Platform {
  // When hosted as a claude.ai artifact, plain downloads are blocked and the
  // host's downloads capability has to be used instead.
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  const downloads: Promise<DownloadsCapability | null> = host?.use
    ? host.use('downloads').then((d) => (d as DownloadsCapability) ?? null, () => null)
    : Promise.resolve(null);

  return {
    kind: 'web',
    async saveFile(name, data) {
      const cap = await downloads;
      if (cap) {
        try {
          await cap.save({ filename: name, data: new Blob([toBytes(data) as BlobPart]) });
          return name;
        } catch (e) {
          if ((e as { code?: string }).code === 'declined') return null;
          throw new Error((e as { message?: string }).message ?? 'The file could not be saved');
        }
      }
      const url = URL.createObjectURL(new Blob([toBytes(data) as BlobPart]));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return name;
    },
    openFile(filters) {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = filters.flatMap((f) => f.extensions.map((e) => '.' + e)).join(',');
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) return resolve(null);
          resolve({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
        });
        input.addEventListener('cancel', () => resolve(null));
        input.click();
      });
    },
    onMenuCommand() {},
    setTitle(t) {
      document.title = t;
    },
  };
}

export function detectPlatform(): Platform {
  return window.spritationDesktop ? desktopPlatform(window.spritationDesktop) : webPlatform();
}
