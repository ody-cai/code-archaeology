import { app, BrowserWindow, Menu, dialog, shell, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL, PRODUCT_NAME, isSiteUrl, externalUrl, safeDownloadName, isAllowedDownload, securePreferences } from './desktop-policy.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const offlineFile = path.join(dirname, '../assets/offline.html');
let window;
app.enableSandbox();
app.setName(PRODUCT_NAME);

async function openExternal(url) {
  const safe = externalUrl(url);
  if (!safe) return;
  const answer = await dialog.showMessageBox(window, {
    type: 'question', title: '打开外部链接', message: '在系统浏览器中打开这个链接？',
    detail: safe, buttons: ['取消', '打开'], defaultId: 0, cancelId: 0,
  });
  if (answer.response === 1) await shell.openExternal(safe);
}

function loadSite() {
  if (window && !window.isDestroyed()) window.loadURL(SITE_URL).catch(() => {});
}

function createWindow() {
  window = new BrowserWindow({
    title: PRODUCT_NAME, width: 1280, height: 900, minWidth: 780, minHeight: 580,
    backgroundColor: '#faf8f3', show: false, autoHideMenuBar: false,
    // No preload bridge: website features need no privileged native API.
    webPreferences: securePreferences(),
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && isSiteUrl(url)) window.loadFile(offlineFile).catch(() => {});
  });
  window.webContents.on('render-process-gone', () => window.loadFile(offlineFile).catch(() => {}));
  window.webContents.on('will-navigate', (event, url) => {
    if (isSiteUrl(url)) return;
    event.preventDefault();
    openExternal(url).catch(() => {});
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!isSiteUrl(url)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  window.on('closed', () => { window = null; });
  loadSite();
}

function installMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ label: PRODUCT_NAME, submenu: [
      { role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] }] : []),
    { label: '应用', submenu: [
      { label: '重新连接网站', accelerator: 'CmdOrCtrl+R', click: loadSite },
      { label: '在浏览器中打开网站', click: () => openExternal(SITE_URL) },
      { type: 'separator' }, { role: process.platform === 'darwin' ? 'close' : 'quit' },
    ] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '显示', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: '帮助', submenu: [{ label: '版本与功能一致性', click: () => dialog.showMessageBox(window, {
      type: 'info', title: PRODUCT_NAME, message: `${PRODUCT_NAME} ${app.getVersion()}`,
      detail: `Windows / macOS / 网站使用同一线上页面和 API。\n${SITE_URL}\n需要联网。网站更新后重新连接即可同步。\n网站已有的重构限制不会因桌面封装自动消失。`,
    }) }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(() => {
    const ses = session.fromPartition('code-archaeology-session');
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (event, item, contents) => {
      if (!contents || !isAllowedDownload(item.getURL(), contents.getURL())) { event.preventDefault(); return; }
      item.setSaveDialogOptions({
        title: '保存文件', defaultPath: path.join(app.getPath('downloads'), safeDownloadName(item.getFilename())),
      });
      item.once('done', (_event, state) => {
        if (state === 'interrupted') dialog.showMessageBox(window, { type: 'error', message: '下载中断，请重新下载。' });
      });
    });
    installMenu();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
