const { app, BrowserWindow, clipboard, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { Downloader, extractYouTubeUrl, videoId } = require('./downloader');

// ffmpeg-static: dentro del instalador el binario queda en app.asar.unpacked
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

// Registro simple en %APPDATA%\KevTube\kevtube.log para diagnosticar problemas
function log(...a) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'kevtube.log'), `[${new Date().toISOString()}] ${a.join(' ')}\n`);
  } catch {}
}
process.on('uncaughtException', (e) => log('uncaughtException', e.stack || e));
process.on('unhandledRejection', (e) => log('unhandledRejection', (e && e.stack) || e));
app.on('render-process-gone', (_e, _wc, d) => log('render-process-gone', JSON.stringify(d)));
app.on('child-process-gone', (_e, d) => log('child-process-gone', JSON.stringify(d)));
app.on('before-quit', () => log('before-quit'));

let win;
let downloader;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  const defaults = {
    outDir: path.join(app.getPath('downloads'), 'KevTube'),
    watchClipboard: true,
  };
  try {
    // La carpeta siempre es Descargas\KevTube (ya no se puede cambiar)
    return { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')), outDir: defaults.outDir };
  } catch {
    return defaults;
  }
}
let settings;
function saveSettings() {
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}

function createWindow() {
  win = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 380,
    minHeight: 500,
    backgroundColor: '#0f0f14',
    title: 'KevTube',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.on('closed', () => log('window closed'));
  win.webContents.on('did-fail-load', (_e, c, d) => log('did-fail-load', c, d));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  log('window created');
}

// ---------- Vigilancia del portapapeles ----------
let lastClip = '';
function startClipboardWatcher() {
  lastClip = clipboard.readText(); // no tomar lo que ya estaba copiado al abrir
  setInterval(() => {
    if (!settings.watchClipboard || !win) return;
    const text = clipboard.readText();
    if (text === lastClip) return;
    lastClip = text;
    const url = extractYouTubeUrl(text);
    if (url) {
      win.webContents.send('link-detected', { url, id: videoId(url) });
      if (!win.isFocused() && Notification.isSupported()) {
        new Notification({ title: 'KevTube', body: 'Agregando a la lista de descargas…', silent: true }).show();
      }
    }
  }, 700);
}

// ---------- IPC ----------
ipcMain.handle('get-settings', () => settings);
ipcMain.handle('set-watch', (_e, v) => {
  settings.watchClipboard = !!v;
  saveSettings();
  return settings;
});
ipcMain.handle('open-folder', () => {
  fs.mkdirSync(settings.outDir, { recursive: true });
  shell.openPath(settings.outDir);
});
ipcMain.handle('show-file', (_e, f) => f && shell.showItemInFolder(f));
ipcMain.handle('parse-url', (_e, text) => {
  const url = extractYouTubeUrl(text);
  return url ? { url, id: videoId(url) } : null;
});

ipcMain.handle('get-info', async (_e, url) => {
  await downloader.ensureReady((msg) => win && win.webContents.send('engine-status', msg));
  return downloader.getInfo(url);
});

ipcMain.handle('download', async (_e, item) => {
  await downloader.ensureReady((msg) => win && win.webContents.send('engine-status', msg));
  return downloader.downloadItem(item, settings.outDir, (pct) => {
    win && win.webContents.send('progress', { key: item.key, pct });
  });
});
ipcMain.handle('cancel', () => downloader.cancel());
ipcMain.handle('notify', (_e, body) => {
  if (win && !win.isFocused() && Notification.isSupported()) new Notification({ title: 'KevTube', body }).show();
});

app.whenReady().then(() => {
  settings = loadSettings();
  downloader = new Downloader({ binDir: path.join(app.getPath('userData'), 'bin'), ffmpegPath });
  createWindow();
  startClipboardWatcher();
  // Preparar yt-dlp de una vez al arrancar
  downloader.ensureReady((msg) => win && win.webContents.send('engine-status', msg)).catch((e) => {
    win && win.webContents.send('engine-status', 'No se pudo preparar el motor: ' + e.message);
  });
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
