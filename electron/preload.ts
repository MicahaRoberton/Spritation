import { contextBridge, ipcRenderer } from 'electron';

interface FileFilter {
  name: string;
  extensions: string[];
}

contextBridge.exposeInMainWorld('spritationDesktop', {
  saveFile: (suggestedName: string, data: Uint8Array, filters: FileFilter[], overwritePath?: string) =>
    ipcRenderer.invoke('file:save', suggestedName, data, filters, overwritePath),
  openFile: (filters: FileFilter[]) => ipcRenderer.invoke('file:open', filters),
  onMenuCommand: (handler: (id: string) => void) => {
    ipcRenderer.on('menu:command', (_event, id: string) => handler(id));
  },
  setTitle: (title: string) => ipcRenderer.send('window:title', title),
});
