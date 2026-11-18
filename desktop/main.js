'use strict';

const { app, BrowserWindow, dialog, shell, Menu, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const crypto = require('node:crypto');
const extract = require('extract-zip');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const HOST = '127.0.0.1';
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');

let mainWindow = null;
let origin = '';
let dataDirInUse = '';

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH()), { recursive: true });
  fs.writeFileSync(CONFIG_PATH(), JSON.stringify(config, null, 2));
}

function isUsableFolder(folder) {
  try {
    fs.mkdirSync(folder, { recursive: true });
    const probe = path.join(folder, '.artalog-write-test');
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe);
    return true;
  } catch {
    return false;
  }
}

// First launch: ask where the archive should live. Returns null if the user quits.
async function askForDataFolder() {
  const suggested = path.join(app.getPath('documents'), 'Artalog');
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: 'Welcome to Artalog',
      message: 'Where should Artalog keep your archive?',
      detail:
        'Your images and records are stored in this folder, separate from the app, so updates never touch them. ' +
        'A folder inside a synced location (OneDrive, Dropbox, iCloud) gives you automatic backup.\n\n' +
        `Suggested: ${suggested}`,
      buttons: ['Use suggested folder', 'Choose a folder...', 'Quit'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });

    let folder = null;
    if (response === 0) {
      folder = suggested;
    } else if (response === 1) {
      const picked = await dialog.showOpenDialog({
        title: 'Choose your Artalog folder',
        defaultPath: suggested,
        properties: ['openDirectory', 'createDirectory'],
      });
      if (picked.canceled || picked.filePaths.length === 0) continue;
      folder = picked.filePaths[0];
    } else {
      return null;
    }

    if (isUsableFolder(folder)) return folder;
    await dialog.showMessageBox({
      type: 'error',
      title: 'Folder not usable',
      message: 'Artalog cannot write to that folder. Please choose another one.',
    });
  }
}

function findPort(preferred) {
  const tryListen = (port) =>
    new Promise((resolve) => {
      const probe = net.createServer();
      probe.once('error', () => resolve(null));
      probe.listen(port, HOST, () => {
        const { port: actual } = probe.address();
        probe.close(() => resolve(actual));
      });
    });
  return (async () => (preferred && (await tryListen(preferred))) || (await tryListen(0)))();
}

function waitForServer(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get({ host: HOST, port, path: '/api/health', timeout: 1000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      request.on('error', retry);
      request.on('timeout', () => request.destroy());
    };
    const retry = () => {
      if (Date.now() > deadline) reject(new Error('The Artalog engine did not start in time.'));
      else setTimeout(attempt, 150);
    };
    attempt();
  });
}

function applySecurity() {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  // Tell the user where their backup went.
  session.defaultSession.on('will-download', (_event, item) => {
    if (!item.getURL().includes('/api/backup')) return;
    item.once('done', (_doneEvent, state) => {
      if (state === 'completed') {
        void dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Backup saved',
          message: 'Your backup is saved.',
          detail: item.getSavePath(),
        });
      } else if (state === 'interrupted') {
        dialog.showErrorBox('Backup failed', 'The backup could not be completed. Please try again.');
      }
    });
  });
}

function relaunchWithFolder(folder) {
  const config = readConfig();
  config.dataDir = folder;
  writeConfig(config);
  app.relaunch();
  app.exit(0);
}

function backupArchive() {
  if (mainWindow) mainWindow.webContents.downloadURL(`${origin}/api/backup`);
}

// Restoring never overwrites an existing archive: the backup is unpacked into an empty folder,
// then Artalog switches to it. The previous archive stays where it was.
async function restoreFromBackup() {
  const zipPick = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a backup file',
    filters: [{ name: 'Artalog backup', extensions: ['zip'] }],
    properties: ['openFile'],
  });
  if (zipPick.canceled || zipPick.filePaths.length === 0) return;

  const destPick = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose an empty folder to restore into',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (destPick.canceled || destPick.filePaths.length === 0) return;
  const dest = path.resolve(destPick.filePaths[0]);

  if (!isUsableFolder(dest) || fs.readdirSync(dest).length > 0) {
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Folder not empty',
      message: 'Please choose an empty folder so nothing is overwritten.',
    });
    return;
  }

  try {
    await extract(zipPick.filePaths[0], { dir: dest });
    if (!fs.existsSync(path.join(dest, 'artalog.sqlite'))) {
      throw new Error('This file does not look like an Artalog backup.');
    }
  } catch (error) {
    dialog.showErrorBox('Restore failed', String(error && error.message ? error.message : error));
    return;
  }

  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Backup restored',
    message: 'Your archive was restored. Artalog will now restart with it.',
    detail: `Your previous archive is untouched at:\n${dataDirInUse}`,
  });
  relaunchWithFolder(dest);
}

async function changeArchiveFolder() {
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose your Artalog folder',
    defaultPath: dataDirInUse,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (picked.canceled || picked.filePaths.length === 0) return;
  const folder = path.resolve(picked.filePaths[0]);
  if (folder === path.resolve(dataDirInUse)) return;

  if (!isUsableFolder(folder)) {
    dialog.showErrorBox('Folder not usable', 'Artalog cannot write to that folder.');
    return;
  }

  const hasArchive = fs.existsSync(path.join(folder, 'artalog.sqlite'));
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Switch archive folder',
    message: hasArchive ? 'Open the archive in this folder?' : 'Start a new, empty archive in this folder?',
    detail:
      `${folder}\n\nYour current archive stays where it is and can be reopened any time. ` +
      'To move your existing works, make a backup and restore it into the new folder instead.',
    buttons: ['Switch', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) relaunchWithFolder(folder);
}

let manualUpdateCheck = false;

// Updates replace only the app. The archive folder is never touched, and the database makes
// a safety copy of itself first if an update changes its structure.
function setupUpdates() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update ready',
      message: `Artalog ${info.version} is ready to install.`,
      detail:
        'Your archive is not changed by updates. Restart now to finish updating, ' +
        'or it will install the next time you close Artalog.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) autoUpdater.quitAndInstall(true, true);
  });

  autoUpdater.on('error', (error) => {
    if (manualUpdateCheck) {
      manualUpdateCheck = false;
      dialog.showErrorBox('Could not check for updates', String(error && error.message ? error.message : error));
    }
  });

  autoUpdater.checkForUpdates().catch(() => undefined);
}

async function checkForUpdatesNow() {
  if (!app.isPackaged) {
    await dialog.showMessageBox(mainWindow, { type: 'info', message: 'Updates are available in the installed app.' });
    return;
  }
  manualUpdateCheck = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result && result.isUpdateAvailable) {
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: `Version ${result.updateInfo.version} is available.`,
        detail: 'It is downloading now. You will be asked to restart when it is ready.',
      });
    } else {
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: 'You are up to date.',
        detail: `Artalog ${app.getVersion()}`,
      });
    }
  } catch (error) {
    dialog.showErrorBox('Could not check for updates', String(error && error.message ? error.message : error));
  } finally {
    manualUpdateCheck = false;
  }
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          { label: 'Back Up Archive...', click: backupArchive },
          { label: 'Restore From Backup...', click: () => void restoreFromBackup() },
          { type: 'separator' },
          { label: 'Show Archive Folder', click: () => void shell.openPath(dataDirInUse) },
          { label: 'Change Archive Folder...', click: () => void changeArchiveFolder() },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'togglefullscreen' }],
      },
      {
        label: 'Help',
        submenu: [
          { label: 'Check for Updates...', click: () => void checkForUpdatesNow() },
          {
            label: 'Artalog on GitHub',
            click: () => void shell.openExternal('https://github.com/justinmzielke/artalog'),
          },
          { type: 'separator' },
          {
            label: 'About Artalog',
            click: () =>
              void dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'About Artalog',
                message: `Artalog ${app.getVersion()}`,
                detail: `Archive folder:\n${dataDirInUse}`,
              }),
          },
        ],
      },
    ]),
  );
}

function createWindow(startUrl) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Artalog',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Links to other sites open in the normal browser; downloads from our own server save to disk.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${origin}/`)) {
      mainWindow.webContents.downloadURL(url);
    } else if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${origin}/`)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  void mainWindow.loadURL(startUrl);
}

async function start() {
  const config = readConfig();
  let dataDir = process.env.ARTALOG_DATA_DIR || config.dataDir;

  if (!dataDir || !isUsableFolder(dataDir)) {
    dataDir = await askForDataFolder();
    if (!dataDir) {
      app.quit();
      return;
    }
    config.dataDir = dataDir;
  }

  const port = await findPort(config.port);
  config.port = port;
  writeConfig(config);

  const token = crypto.randomBytes(32).toString('hex');
  origin = `http://${HOST}:${port}`;

  process.env.ARTALOG_DATA_DIR = dataDir;
  process.env.ARTALOG_FRONTEND_DIR = path.join(__dirname, 'frontend');
  process.env.ARTALOG_TOKEN = token;
  process.env.HOST = HOST;
  process.env.PORT = String(port);

  require(path.join(__dirname, 'server', 'server.js'));
  await waitForServer(port);

  applySecurity();
  dataDirInUse = dataDir;
  buildMenu();
  createWindow(`${origin}/?token=${token}`);
  if (app.isPackaged) setupUpdates();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(start).catch((error) => {
    dialog.showErrorBox('Artalog could not start', String(error && error.message ? error.message : error));
    app.quit();
  });

  app.on('window-all-closed', () => app.quit());
}
