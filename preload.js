const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  toggleFullscreen: async () => {
    try { return await ipcRenderer.invoke('toggle-fullscreen'); }
    catch (e) {
      const doc = document;
      if (!doc.fullscreenElement) { const el = doc.documentElement; if (el.requestFullscreen) el.requestFullscreen(); }
      else { if (doc.exitFullscreen) doc.exitFullscreen(); }
      return !!doc.fullscreenElement;
    }
  }
});