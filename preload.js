import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    loadWebsite: (url) => ipcRenderer.invoke('load-website', url),
    getPreviewBounds: () => ipcRenderer.invoke('get-preview-bounds'),
    previewSuspend: () => ipcRenderer.invoke('preview-suspend'),
    previewResume: () => ipcRenderer.invoke('preview-resume'),
    savePacs: (record) => ipcRenderer.invoke('pacs-save', record),
    listPacs: () => ipcRenderer.invoke('pacs-list')
});