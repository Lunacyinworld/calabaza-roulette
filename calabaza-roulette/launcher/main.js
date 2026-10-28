// Launcher: abre una ventana que carga tu juego ya publicado.
// CAMBIA esta URL por la de tu servidor (ej. https://calabaza-roulette.onrender.com)
const GAME_URL = 'https://TU-SERVIDOR.onrender.com';

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 900, height: 780, minWidth: 420, minHeight: 600,
    backgroundColor: '#14101a', title: 'Calabaza Roulette',
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  Menu.setApplicationMenu(null);
  win.loadURL(GAME_URL);
  win.webContents.on('did-fail-load', () => win.loadFile(path.join(__dirname, 'offline.html')));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
