const { app, BrowserWindow, shell, dialog, Menu, ipcMain } = require('electron');
const { fork } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const smoke = process.argv.includes('--gateway-smoke');
app.setName('PagePort Gateway');
app.setPath('userData', smoke ? mkdtempSync(path.join(tmpdir(), 'pageport-gateway-smoke-'))
  : path.join(app.getPath('appData'), 'PagePort Gateway'));
const root = path.resolve(__dirname, '..');
let backend, window, origin, quitting = false, confirming = false;
const pending = new Map();
const controllerUrl = pathToFileURL(path.join(__dirname, 'gateway.html')).href;
const trusted = event => event.sender === window?.webContents && event.senderFrame?.url === controllerUrl;
async function openWorkspace() {
  const token = randomBytes(32).toString('hex');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(token); reject(new Error('Gateway unavailable.')); }, 10000);
    pending.set(token, () => { clearTimeout(timer); resolve(); });
    backend.send({ type: 'gateway-open', token });
  });
  await shell.openExternal(`${origin}/gateway-launch#${token}`);
}
async function confirmQuit() {
  if (quitting || confirming) return;
  confirming = true;
  const choice = await dialog.showMessageBox(window, {
    type: 'warning', title: '退出本地网关', message: '请先保存浏览器中正在编辑的文档。',
    detail: '退出后本次会话将清除；已保存的文件和发布前备份会保留。',
    buttons: ['继续使用', '已保存，退出网关'], defaultId: 0, cancelId: 0,
  }).finally(() => { confirming = false; });
  if (choice.response === 1) { quitting = true; app.quit(); }
}
ipcMain.handle('gateway:open', event => { if (!trusted(event)) throw new Error('Untrusted sender.'); return openWorkspace(); });
ipcMain.handle('gateway:quit', event => { if (!trusted(event)) throw new Error('Untrusted sender.'); return confirmQuit(); });
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    const token = randomBytes(32).toString('hex');
    const mark = app.isPackaged ? path.join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'mark.exe' : 'mark')
      : path.join(root, 'resources', process.platform === 'win32' ? 'mark.exe' : 'mark');
    backend = fork(path.join(root, 'server/index.js'), [], {
      execPath: process.execPath, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: {
        ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0',
        HOME: app.getPath('home'), PATH: process.env.PATH || '', LANG: process.env.LANG || 'en_US.UTF-8',
        ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
          TEMP: app.getPath('temp'), TMP: app.getPath('temp'), COMSPEC: process.env.COMSPEC } : {}),
        MARK_BIN: mark, DATA_DIR: path.join(app.getPath('userData'), 'data'),
        ACCESS_PASSWORD: token, PAGEPORT_GATEWAY_TOKEN: token,
      },
    });
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Gateway startup timed out.')), 20000);
      backend.on('message', message => {
        if (message?.port) { clearTimeout(timer); resolve(message.port); }
        if (message?.type === 'gateway-open') { pending.get(message.token)?.(); pending.delete(message.token); }
      });
      backend.once('exit', () => { clearTimeout(timer); reject(new Error('Gateway stopped.')); });
      backend.once('error', reject);
    });
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid gateway port.');
    origin = `http://127.0.0.1:${port}`;
    backend.on('exit', () => {
      if (!quitting && !smoke) dialog.showErrorBox('PagePort', '本地网关已停止，请保存已有内容后重新启动。');
      quitting = true; app.quit();
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ label: 'PagePort Gateway', submenu: [
        { label: '打开工作区', click: () => openWorkspace().catch(() => {}) },
        { label: '退出本地网关', accelerator: 'Cmd+Q', click: confirmQuit },
      ] }] : []), { role: 'editMenu' },
    ]));
    window = new BrowserWindow({ width: 490, height: 510, minWidth: 440, minHeight: 500, show: !smoke,
      title: 'PagePort 本地网关', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'gateway-preload.cjs'), sandbox: true,
        contextIsolation: true, nodeIntegration: false, webSecurity: true, partition: `gateway-${token}` } });
    window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (url !== controllerUrl) event.preventDefault(); });
    window.on('close', event => { if (!quitting && !smoke) { event.preventDefault(); confirmQuit(); } });
    await window.loadFile(path.join(__dirname, 'gateway.html'));
    if (smoke) {
      await require('./gateway-smoke.cjs')({ origin, token, controller: window });
      quitting = true; app.quit();
    } else await openWorkspace().catch(() => dialog.showMessageBox(window, {
      type: 'warning', message: '浏览器未能自动打开，请点击「打开工作区」重试。',
    }));
  }).catch(error => {
    if (smoke) console.error(error);
    if (!smoke) dialog.showErrorBox('PagePort', '无法启动本地网关，请确认文件已完整解压，且公司策略允许运行。');
    quitting = true; app.exit(1);
  });
}
app.on('before-quit', event => {
  if (!quitting && !smoke) { event.preventDefault(); confirmQuit(); return; }
  if (backend) { backend.removeAllListeners('exit'); backend.kill(); }
});
app.on('window-all-closed', () => { if (quitting) app.quit(); });
