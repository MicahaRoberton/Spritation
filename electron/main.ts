import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItemConstructorOptions, shell } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';

interface FileFilter {
  name: string;
  extensions: string[];
}

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#13151c',
    title: 'Spritation',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Links open in the system browser, never inside the editor window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  // The renderer sets the title (document name + unsaved marker) over IPC.
  win.on('page-title-updated', (e) => e.preventDefault());
  win.on('closed', () => (win = null));
}

/**
 * The renderer owns keyboard shortcuts, so accelerators here are labels only
 * (`registerAccelerator: false`) and each item forwards a command id.
 */
function cmd(label: string, id: string, accelerator?: string): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    registerAccelerator: false,
    click: () => win?.webContents.send('menu:command', id),
  };
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        cmd('New Sprite…', 'new', 'CmdOrCtrl+N'),
        cmd('Open…', 'open', 'CmdOrCtrl+O'),
        cmd('Examples…', 'examples'),
        { type: 'separator' },
        cmd('Save', 'save', 'CmdOrCtrl+S'),
        cmd('Save As…', 'save-as', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        cmd('Export…', 'export', 'CmdOrCtrl+E'),
        ...(isMac ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, { role: 'quit' } as MenuItemConstructorOptions]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        cmd('Undo', 'undo', 'CmdOrCtrl+Z'),
        cmd('Redo', 'redo', 'CmdOrCtrl+Shift+Z'),
        { type: 'separator' },
        cmd('Cut', 'cut', 'CmdOrCtrl+X'),
        cmd('Copy', 'copy', 'CmdOrCtrl+C'),
        cmd('Paste', 'paste', 'CmdOrCtrl+V'),
        cmd('Clear', 'clear', 'Delete'),
        { type: 'separator' },
        cmd('Select All', 'select-all', 'CmdOrCtrl+A'),
        cmd('Deselect', 'deselect', 'CmdOrCtrl+D'),
        { type: 'separator' },
        cmd('Flip Horizontal', 'flip-h', 'Shift+H'),
        cmd('Flip Vertical', 'flip-v', 'Shift+V'),
      ],
    },
    {
      label: 'Sprite',
      submenu: [cmd('Canvas Size…', 'canvas-size', 'CmdOrCtrl+Alt+C')],
    },
    {
      label: 'Layer',
      submenu: [
        cmd('New Layer', 'new-layer', 'Shift+N'),
        cmd('Duplicate Layer', 'duplicate-layer'),
        cmd('Delete Layer', 'delete-layer'),
        cmd('Merge Down', 'merge-down', 'CmdOrCtrl+M'),
      ],
    },
    {
      label: 'Frame',
      submenu: [
        cmd('New Frame', 'new-frame', 'Alt+N'),
        cmd('New Empty Frame', 'new-empty-frame'),
        cmd('Delete Frame', 'delete-frame'),
        { type: 'separator' },
        cmd('Play / Stop', 'play', 'Enter'),
        cmd('Previous Frame', 'prev-frame', ','),
        cmd('Next Frame', 'next-frame', '.'),
        { type: 'separator' },
        cmd('New Tag…', 'new-tag'),
      ],
    },
    {
      label: 'View',
      submenu: [
        cmd('Zoom In', 'zoom-in', '='),
        cmd('Zoom Out', 'zoom-out', '-'),
        cmd('Fit to Window', 'zoom-fit', '0'),
        { type: 'separator' },
        cmd('Pixel Grid', 'toggle-grid', 'CmdOrCtrl+\''),
        cmd('Onion Skin', 'toggle-onion', 'F3'),
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [cmd('Keyboard Shortcuts', 'shortcuts', 'F1')],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('file:save', async (_e, suggestedName: string, data: Uint8Array, filters: FileFilter[], overwritePath?: string) => {
  let target = overwritePath;
  if (!target) {
    const res = await dialog.showSaveDialog(win!, { defaultPath: suggestedName, filters });
    if (res.canceled || !res.filePath) return null;
    target = res.filePath;
  }
  await fs.writeFile(target, Buffer.from(data));
  return target;
});

ipcMain.handle('file:open', async (_e, filters: FileFilter[]) => {
  const res = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters });
  if (res.canceled || !res.filePaths[0]) return null;
  const file = res.filePaths[0];
  return { name: path.basename(file), path: file, data: new Uint8Array(await fs.readFile(file)) };
});

ipcMain.on('window:title', (_e, title: string) => win?.setTitle(title));

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
