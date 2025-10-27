const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 720, backgroundColor: '#000000', autoHideMenuBar: true, fullscreenable: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
    icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png')
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => { cb(permission === 'media'); });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
ipcMain.handle('toggle-fullscreen', () => { if (!mainWindow) return; const isFull = mainWindow.isFullScreen(); mainWindow.setFullScreen(!isFull); return !isFull; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
