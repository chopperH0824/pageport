const { app, BrowserWindow, session, shell, dialog, Menu, ipcMain, net } = require('electron');
const { fork, spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { UpdateManager } = require('./updates.cjs');

app.setName('PagePort');
let backend, window, origin, updater;
let automaticUpdates = true;
let ignoredUpdateVersion = '';
let cleanupInstaller = true;
const openedFiles = new Map();
const desktopToken = randomBytes(32).toString('hex');
const smoke = process.argv.includes('--smoke');
const appRoot = path.resolve(__dirname,'..');
if(smoke)app.setPath('userData',mkdtempSync(path.join(tmpdir(),'pageport-smoke-profile-')));

function updateState() {
  return { ...updater.state, automatic: automaticUpdates, ignoredVersion: ignoredUpdateVersion, cleanupInstaller };
}
function sendUpdateState(show = false) {
  if (window && !window.isDestroyed()) window.webContents.send('pageport:update-state', { ...updateState(), show });
}
async function saveUpdateSettings() {
  await writeFile(path.join(app.getPath('userData'), 'update-settings.json'),
    JSON.stringify({ automatic: automaticUpdates, ignoredVersion: ignoredUpdateVersion, cleanupInstaller }), { mode: 0o600 });
}
for (const [action, handler] of Object.entries({
  state: () => updateState(),
  check: async () => { await updater.check(); return updateState(); },
  download: async () => { await updater.download(); return updateState(); },
  reveal: () => { if (updater.state.status === 'downloaded' && updater.downloaded) shell.showItemInFolder(updater.downloaded.file); return updateState(); },
  install: async () => {
    if (process.platform !== 'win32') throw new Error('当前平台请打开安装包完成更新。');
    if (updater.state.status !== 'downloaded' || !updater.downloaded?.file) throw new Error('请先下载并校验安装包。');
    const installer = updater.downloaded.file;
    const choice = await dialog.showMessageBox(window, {
      type: 'info',
      buttons: ['取消', '打开安装程序'],
      defaultId: 1,
      cancelId: 0,
      title: '安装 PagePort 更新',
      message: '请先保存文档，再打开安装程序。',
      detail: cleanupInstaller
        ? '安装器会在 PagePort 安装完成后自动删除已下载的安装包。你可以在安装器中取消，取消时不会删除安装包。'
        : '安装器会打开并等待你完成安装，已下载的安装包会保留。',
    });
    if (choice.response !== 1) return updateState();
    const script = '$installer = $env:PAGEPORT_INSTALLER; ' +
      '$working = Split-Path -Parent $installer; ' +
      '$p = Start-Process -FilePath $installer -WorkingDirectory $working -PassThru -Wait; ' +
      'if ($p.ExitCode -eq 0) { ' +
      'if ($env:PAGEPORT_DELETE -eq "1") { ' +
      '$deadline = (Get-Date).AddSeconds(30); ' +
      'do { ' +
      'try { Remove-Item -LiteralPath $installer -Force -ErrorAction Stop } catch {}; ' +
      'if (-not (Test-Path -LiteralPath $installer)) { break }; ' +
      'Start-Sleep -Milliseconds 500 ' +
      '} while ((Get-Date) -lt $deadline) ' +
      '}; exit $p.ExitCode';
    const child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script,
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, PAGEPORT_INSTALLER: installer, PAGEPORT_DELETE: cleanupInstaller ? '1' : '0' },
    });
    child.unref();
    const launched = await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    }).then(() => true, () => {
      updater.set({ status: 'downloaded', error: '无法直接启动安装程序，安装包仍保留，可重新打开安装程序。' });
      return false;
    });
    if (!launched) return updateState();
    updater.set({ status: 'installing', error: '' });
    child.once('close', code => {
      if (!updater || updater.state.status !== 'installing') return;
      updater.set(code === 0
        ? { status: 'installed', error: '' }
        : { status: 'downloaded', error: '安装程序未完成，安装包仍保留，可重新打开安装程序。' });
    });
    updater.set({ status: 'installing', error: '' });
    // Let the installer take over after PagePort has had a chance to close normally.
    setTimeout(() => app.quit(), 250).unref();
    return updateState();
  },
  release: () => { if (updater.state.releaseUrl) openExternal(updater.state.releaseUrl); return updateState(); },
  configure: async automatic => {
    if (typeof automatic !== 'boolean') throw new Error('Invalid update preference.');
    automaticUpdates = automatic;
    await saveUpdateSettings();
    sendUpdateState();
    return updateState();
  },
  cleanup: async cleanup => {
    if (typeof cleanup !== 'boolean') throw new Error('Invalid installer cleanup preference.');
    cleanupInstaller = cleanup;
    await saveUpdateSettings();
    sendUpdateState();
    return updateState();
  },
  ignore: async ignored => {
    if (typeof ignored !== 'boolean') throw new Error('Invalid update preference.');
    if (ignored && (!updater.state.available || !updater.state.version)) throw new Error('No update is available.');
    ignoredUpdateVersion = ignored ? updater.state.version : '';
    await saveUpdateSettings();
    sendUpdateState();
    return updateState();
  },
})) {
  ipcMain.handle(`pageport:update-${action}`, (event, ...args) => {
    if (!updater || event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame ||
      new URL(event.senderFrame.url).origin !== origin) throw new Error('Untrusted update request.');
    return handler(...args);
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=>{if(window){window.show();window.focus();}});
  app.whenReady().then(start).catch(error=>{
    if(smoke){console.error(error);app.exit(1);return;}
    dialog.showErrorBox('PagePort 无法启动',error.message);
    app.quit();
  });
}

function openExternal(url) {
  try { if (new URL(url).protocol === 'https:') shell.openExternal(url); } catch {}
}

const textExtensions = new Set(['.md', '.markdown', '.txt']);
const blockedExtensions = new Set(['.docx', '.doc', '.html', '.htm', '.wps']);

function rememberFile(filePath) {
  const token = randomBytes(16).toString('hex');
  openedFiles.set(token, filePath);
  return token;
}

async function readOpenedFile(filePath) {
  try {
    const buffer = await readFile(filePath);
    if (buffer.length > 10 * 1024 * 1024) return { error: '单文件不能超过 10 MB。' };
    let token = [...openedFiles.entries()].find(([, stored]) => stored === filePath)?.[0];
    if (!token) token = rememberFile(filePath);
    return { token, name: path.basename(filePath), buffer };
  } catch {
    return { error: '无法读取这个文件。' };
  }
}

ipcMain.handle('pageport:open-document', async () => {
  const choice = await dialog.showOpenDialog(window, {
    properties: ['openFile'],
    filters: [{ name: '文档', extensions: ['md', 'markdown', 'html', 'htm', 'docx', 'doc', 'txt'] }],
  });
  if (choice.canceled || !choice.filePaths[0]) return { canceled: true };
  return readOpenedFile(choice.filePaths[0]);
});

ipcMain.handle('pageport:read-document', async (_event, token) => {
  if (typeof token !== 'string' || !openedFiles.has(token)) return { error: '原文件已不可用，请重新导入。' };
  return readOpenedFile(openedFiles.get(token));
});

ipcMain.handle('pageport:save-document', async (_event, payload) => {
  const text = typeof payload?.text === 'string' ? payload.text : '';
  if (text.length > 8000000) return { error: '内容过大，无法保存。' };
  const existing = payload?.overwrite && typeof payload.token === 'string' ? openedFiles.get(payload.token) : '';
  const existingExt = existing ? path.extname(existing).toLowerCase() : '';
  let filePath = existing && textExtensions.has(existingExt) ? existing : '';
  const overwritten = Boolean(filePath);
  if (!filePath) {
    const choice = await dialog.showSaveDialog(window, {
      defaultPath: typeof payload?.name === 'string' ? payload.name : 'document.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (choice.canceled || !choice.filePath) return { canceled: true };
    filePath = choice.filePath;
    const ext = path.extname(filePath).toLowerCase();
    if (blockedExtensions.has(ext)) return { error: '不能把编辑结果写回 Word 或 HTML 原件。请保存为 .md 文件。' };
    if (ext !== '.md') filePath += '.md';
  }
  try { await writeFile(filePath, text, 'utf8'); }
  catch { return { error: '无法写入这个文件。' }; }
  return { token: rememberFile(filePath), name: path.basename(filePath), overwritten };
});

async function start() {
  const dataDir=path.join(app.getPath('userData'),'data');
  const markName=process.platform==='win32'?'mark.exe':'mark';
  const mark=app.isPackaged ? path.join(process.resourcesPath,'bin',markName) : path.join(appRoot,'resources',markName);
  await mkdir(dataDir,{recursive:true,mode:0o700});
  try {
    const settings = JSON.parse(await readFile(path.join(app.getPath('userData'), 'update-settings.json'), 'utf8'));
    automaticUpdates = settings.automatic !== false;
    ignoredUpdateVersion = typeof settings.ignoredVersion === 'string' ? settings.ignoredVersion : '';
    cleanupInstaller = settings.cleanupInstaller !== false;
  } catch {}
  updater = new UpdateManager({
    version: app.getVersion(), directory: path.join(app.getPath('userData'), 'updates'),
    downloadBase: 'https://pageport.chopperh.me/downloads',
    fetcher: smoke ? async () => {
      if (!process.argv.includes('--smoke-updates')) throw new Error('Network disabled during smoke tests.');
      return Response.json({ tag_name: 'v99.0.0', body: '更新检测测试\n\n• 改进文档编辑与跨平台兼容。\n• 安装包按当前系统匹配。', published_at: '2026-10-23T00:00:00Z', assets: [] });
    } : (url, options) => net.fetch(url, options),
  });
  updater.on('change', () => sendUpdateState());
  backend=fork(path.join(appRoot,'server','index.js'),[],{
    execPath:process.execPath,
    env:{
      PATH:process.env.PATH || '/usr/bin:/bin', HOME:app.getPath('home'), LANG:'en_US.UTF-8',
      ...(process.platform==='win32'?{SystemRoot:process.env.SystemRoot,USERPROFILE:app.getPath('home'),TEMP:tmpdir(),TMP:tmpdir()} : {}),
      ELECTRON_RUN_AS_NODE:'1', NODE_ENV:'production',
      HOST:'127.0.0.1',PORT:'0', MARK_BIN:mark, DATA_DIR:dataDir,
      ACCESS_PASSWORD:desktopToken, PAGEPORT_DESKTOP_TOKEN:desktopToken,
    },
    stdio:['ignore','ignore','ignore','ipc'],
  });
  const port=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('本地服务启动超时。')),20000);
    backend.once('message',message=>{clearTimeout(timeout);resolve(message.port);});
    backend.once('exit',()=>{clearTimeout(timeout);reject(new Error('本地服务未能启动。请重新打开应用。'));});
  });
  origin=`http://127.0.0.1:${port}`;
  // In-memory partition: company passwords, documents, cookies and cache are not persisted.
  const isolatedSession=session.fromPartition(`pageport-${randomBytes(8).toString('hex')}`);
  isolatedSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  isolatedSession.setPermissionCheckHandler(()=>false);
  isolatedSession.webRequest.onBeforeSendHeaders({urls:[`${origin}/*`]},(details,callback)=>{
    callback({requestHeaders:{...details.requestHeaders,'X-PagePort-Desktop':desktopToken}});
  });
  window=new BrowserWindow({
    width:1440,height:960,minWidth:940,minHeight:660,backgroundColor:'#f1f4f9',
    title:'PagePort · 本地文档发布台',show:false,
    webPreferences:{session:isolatedSession,preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true},
  });
  if(smoke) window.webContents.on('console-message',(_event,...details)=>console.log('Renderer:',...details));
  window.webContents.setWindowOpenHandler(({url})=>{openExternal(url);return {action:'deny'};});
  window.webContents.on('will-navigate',(event,url)=>{
    if(!url.startsWith(origin+'/')){event.preventDefault();openExternal(url);}
  });
  window.webContents.on('will-prevent-unload',event=>{
    const choice=dialog.showMessageBoxSync(window,{type:'warning',buttons:['继续编辑','放弃修改并关闭'],defaultId:0,cancelId:0,message:'文档修改尚未保存',detail:'关闭后未保存到文件的本地修改将丢失。'});
    if(choice===1)event.preventDefault();
  });
  const checkForUpdates = () => { sendUpdateState(true); updater.check(); };
  let autoNotifiedVersion = '';
  const checkAutomatically = async () => {
    if (!automaticUpdates) return;
    const state = await updater.check();
    if (automaticUpdates && state.available && state.version !== ignoredUpdateVersion &&
      autoNotifiedVersion !== state.version) {
      autoNotifiedVersion = state.version;
      sendUpdateState(true);
    }
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'PagePort',submenu:[{role:'about'},{label:'检查更新…',click:checkForUpdates},{type:'separator'},{label:'打开备份文件夹',click:()=>shell.openPath(path.join(dataDir,'backups'))},{type:'separator'},...(process.platform==='darwin'?[{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'}]:[]),{role:'quit'}]},
    {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'窗口',submenu:[{role:'minimize'},{role:'zoom'},{role:'front'}]},
  ]));
  await window.loadURL(origin);
  if(!smoke)window.show();
  if(!smoke) {
    setTimeout(checkAutomatically, 10000).unref();
    setInterval(checkAutomatically, 6 * 60 * 60 * 1000).unref();
  }
  app.on('activate',()=>{if(window){window.show();window.focus();}});
  backend.on('exit',()=>{if(window && !window.isDestroyed()){dialog.showErrorBox('本地服务已停止','请退出并重新打开 PagePort。');app.quit();}});
  if(smoke) {
    const output=process.env.PAGEPORT_SMOKE_DIR || path.join(appRoot,'artifacts');
    await mkdir(output,{recursive:true});
    const deadline=Date.now()+20000;
    let state;
    while(Date.now()<deadline) {
      const ready=await window.webContents.executeJavaScript(`!!document.querySelector('[aria-label="设置"]')`);
      if(ready)break;
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    const exampleDeadline=Date.now()+20000;
    if (process.platform === 'win32') {
      do {
        state=await window.webContents.executeJavaScript(`({
          rendered:document.querySelector('.prose-editor')?.innerText || '',
          sync:document.querySelector('.preview-state')?.textContent || '',
          errors:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent)
        })`);
        if(state.rendered.includes('功能概述') && state.sync==='发布稿已同步')break;
        await new Promise(resolve=>setTimeout(resolve,200));
      } while(Date.now()<exampleDeadline);
      state.defaultExample = state.rendered.includes('功能概述') && state.sync==='发布稿已同步' && !state.errors.length;
      if(!state.defaultExample)throw new Error('Windows must start with the public example document.');
      await writeFile(path.join(output,'desktop-default-start.png'),(await window.webContents.capturePage()).toPNG());
    } else {
      const startsEmpty=await window.webContents.executeJavaScript(`!document.querySelector('.prose-editor') && !!document.querySelector('.empty-upload')`);
      if(!startsEmpty)throw new Error('macOS must start with an empty workspace.');
      await writeFile(path.join(output,'desktop-empty-start.png'),(await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(`document.querySelector('[aria-label="设置"]').click();[...document.querySelectorAll('.settings-row')].find(e=>e.textContent.includes('示例文档')).click()`);
    }
    do {
      state=await window.webContents.executeJavaScript(`({
        title:document.title,
        brand: {
          loaded:document.querySelector('.brand img')?.complete && document.querySelector('.brand img')?.naturalWidth>0,
          source:document.querySelector('.brand img')?.getAttribute('src'),
          blue:getComputedStyle(document.documentElement).getPropertyValue('--blue').trim(),
          mint:getComputedStyle(document.documentElement).getPropertyValue('--mint').trim()
        },
        preview:document.querySelector('iframe')?.getAttribute('srcdoc') || '',
        rendered:document.querySelector('.prose-editor')?.innerText || '',
        sync:document.querySelector('.preview-state')?.textContent || '',
        undoDisabled:document.querySelector('[aria-label^="撤销 ("]')?.disabled,
        errors:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent),
        overflow:document.documentElement.scrollWidth>innerWidth
      })`);
      if(state.rendered?.includes('功能概述') && state.sync==='发布稿已同步') break;
      await new Promise(resolve=>setTimeout(resolve,200));
    } while(Date.now()<deadline);
    await new Promise(resolve=>setTimeout(resolve,500));
    if(process.argv.includes('--smoke-toc')) {
      await window.webContents.executeJavaScript(`document.querySelector('[aria-label="插入目录"]').click()`);
      const tocDeadline=Date.now()+15000;
      do {
        state.toc=await window.webContents.executeJavaScript(`({
          count:document.querySelectorAll('.contents-node').length,
          items:document.querySelectorAll('.contents-node nav button').length,
          sync:document.querySelector('.preview-state')?.textContent,
          errors:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent)
        })`);
        if(state.toc.count===1 && state.toc.items>=5 && state.toc.sync==='发布稿已同步')break;
        await new Promise(resolve=>setTimeout(resolve,200));
      }while(Date.now()<tocDeadline);
      await window.webContents.executeJavaScript(`document.querySelector('.page-heading [role="tab"]:nth-child(2)').click()`);
      state.toc.sourceMarker=await window.webContents.executeJavaScript(`document.querySelector('textarea')?.value.includes('data-pageport-toc="true"')`);
      await window.webContents.executeJavaScript(`document.querySelector('.page-heading [role="tab"]:first-child').click();document.querySelector('.contents-node nav button').click()`);
      window.webContents.insertText('目录更新验证');
      await new Promise(resolve=>setTimeout(resolve,300));
      state.toc.liveUpdate=await window.webContents.executeJavaScript(`document.querySelector('.contents-node nav').textContent.includes('目录更新验证')`);
      await window.webContents.executeJavaScript(`document.querySelector('[aria-label^="撤销 ("]').click()`);
      state.toc.undo=await window.webContents.executeJavaScript(`!document.querySelector('.contents-node nav').textContent.includes('目录更新验证')`);
      await window.webContents.executeJavaScript(`document.querySelector('.editor-mode-tools button').click()`);
      const previewDeadline=Date.now()+15000;
      do {
        state.toc.previewLinks=await window.webContents.executeJavaScript(`document.querySelector('iframe')?.contentDocument?.querySelectorAll('[data-pageport-toc] a').length || 0`);
        if(state.toc.previewLinks>=5)break;
        await new Promise(resolve=>setTimeout(resolve,200));
      }while(Date.now()<previewDeadline);
      await window.webContents.executeJavaScript(`document.querySelector('.editor-mode-tools button').click()`);
      state.toc.passed=state.toc.count===1 && state.toc.items>=5 && state.toc.sourceMarker && state.toc.liveUpdate && state.toc.undo && state.toc.previewLinks>=5 && !state.toc.errors.length;
    }
    if(process.argv.includes('--smoke-editor')) {
      state.modules=await window.webContents.executeJavaScript(`(() => {
        const common=document.querySelector('#tools-common').getAttribute('aria-selected')==='true';
        const hidden=!document.querySelector('[aria-label="插入图片"]').checkVisibility();
        document.querySelector('#tools-insert').click();
        return {common,hidden};
      })()`);
      await new Promise(resolve=>setTimeout(resolve,100));
      state.modules.insert=await window.webContents.executeJavaScript(`document.querySelector('[aria-label="插入图片"]').checkVisibility()`);
      await window.webContents.executeJavaScript(`document.querySelector('#tools-all').click()`);
      await new Promise(resolve=>setTimeout(resolve,100));
      state.modules.all=await window.webContents.executeJavaScript(`document.querySelector('[aria-label="插入图片"]').checkVisibility() && document.querySelector('[aria-label^="增加缩进 ("]')?.checkVisibility()`);
      state.clipboard=await window.webContents.executeJavaScript(`(() => {
        const data=new DataTransfer();
        data.setData('text/html','<div data-type="callout" data-callout-type="note"><p>Clipboard synthetic check</p></div><span data-type="status" data-color="green">Synthetic</span>');
        document.querySelector('.prose-editor').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
        return !!document.querySelector('.prose-editor [data-pageport-panel="note"]') && !!document.querySelector('.prose-editor [data-pageport-status="green"]');
      })()`);
      for(const selector of ['[aria-label="状态标签"]','.status-popover button[type="submit"]','[aria-label="提示面板"]','.panel-popover [data-panel="info"]']) {
        await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      await new Promise(resolve=>setTimeout(resolve,300));
      state.editor=await window.webContents.executeJavaScript(`({
        status:!!document.querySelector('.prose-editor [data-pageport-status="blue"]'),
        panel:!!document.querySelector('.prose-editor [data-pageport-panel="info"]'),
        words:document.querySelector('.editor-status')?.textContent.includes('字数')
      })`);
      await window.webContents.executeJavaScript(`document.querySelector('[aria-label^="查找与替换 ("]').click()`);
      await new Promise(resolve=>setTimeout(resolve,100));
      await window.webContents.executeJavaScript(`
        const input=document.querySelector('[aria-label="查找内容"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'功能');
        input.dispatchEvent(new Event('input',{bubbles:true}));
      `);
      await new Promise(resolve=>setTimeout(resolve,300));
      state.editor.search=await window.webContents.executeJavaScript(`document.querySelectorAll('.search-match').length>0`);
      await window.webContents.executeJavaScript(`document.querySelector('[aria-label="关闭查找"]').click()`);
      await new Promise(resolve=>setTimeout(resolve,1500));
      state.editor.errors=await window.webContents.executeJavaScript(`[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent)`);
      state.editor.passed=state.modules.common && state.modules.hidden && state.modules.insert && state.modules.all && state.clipboard && state.editor.status && state.editor.panel && state.editor.words && state.editor.search && !state.editor.errors.length;
    }
    if (process.argv.includes('--smoke-updates')) {
      state.spacing = [];
      for (const [name, width, height, focus] of [['normal',1440,960,false],['focus',1440,960,true],['narrow',940,700,false]]) {
        window.setSize(width,height);
        await window.webContents.executeJavaScript(`if(document.querySelector('.app-shell').classList.contains('focus-mode')!==${focus})document.querySelector('[aria-label="切换专注模式"]').click();
          document.querySelector('.rich-document-scroll').scrollTop=0;`);
        await new Promise(resolve=>setTimeout(resolve,200));
        const editor = await window.webContents.executeJavaScript(`(() => {
          const el=document.querySelector('.prose-editor'), style=getComputedStyle(el);
          return {left:parseFloat(style.paddingLeft),right:parseFloat(style.paddingRight),
            overflow:document.documentElement.scrollWidth>innerWidth};
        })()`);
        await writeFile(path.join(output,`desktop-spacing-${name}.png`),(await window.webContents.capturePage()).toPNG());
        await window.webContents.executeJavaScript(`document.querySelector('.editor-mode-tools button').click()`);
        const previewDeadline=Date.now()+5000;
        let preview;
        do {
          preview = await window.webContents.executeJavaScript(`(() => {
            const body=document.querySelector('iframe')?.contentDocument?.body;
            if(!body?.children.length)return null;
            const style=body.ownerDocument.defaultView.getComputedStyle(body);
            return {left:parseFloat(style.paddingLeft),right:parseFloat(style.paddingRight)};
          })()`);
          if(preview)break;
          await new Promise(resolve=>setTimeout(resolve,100));
        } while(Date.now()<previewDeadline);
        await writeFile(path.join(output,`desktop-preview-${name}.png`),(await window.webContents.capturePage()).toPNG());
        state.spacing.push({name,editor,preview,passed:editor.left>=18 && editor.right>=18 && !editor.overflow && preview?.left>=18 && preview?.right>=18});
        await window.webContents.executeJavaScript(`document.querySelector('.editor-mode-tools button').click()`);
      }
      window.setSize(1440,960);
      await window.webContents.executeJavaScript(`document.querySelector('[aria-label="设置"]').click()`);
      await new Promise(resolve=>setTimeout(resolve,100));
      state.settings = await window.webContents.executeJavaScript(`({
        general:document.querySelector('#settings-general').checkVisibility(),
        actions:[...document.querySelectorAll('.settings-row')].map(el=>el.textContent),
        cleanToolbar:!document.querySelector('.top-actions [aria-label="检查更新"]') && !document.querySelector('.top-actions [aria-label="清除会话"]'),
        focused:!!document.activeElement.closest('.settings-modal')
      })`);
      await writeFile(path.join(output,'desktop-settings.png'),(await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(`document.querySelectorAll('.settings-row')[1].click()`);
      await new Promise(resolve=>setTimeout(resolve,100));
      state.settings.history=await window.webContents.executeJavaScript(`!!document.querySelector('#history-heading') && !document.querySelector('.settings-overlay').checkVisibility()`);
      await window.webContents.executeJavaScript(`document.querySelector('.history-modal .modal-close').click();document.querySelector('[aria-label="设置"]').click()`);
      await new Promise(resolve=>setTimeout(resolve,100));
      await window.webContents.executeJavaScript(`document.querySelector('#settings-general-tab').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}))`);
      await new Promise(resolve=>setTimeout(resolve,100));
      state.settings.keyboard=await window.webContents.executeJavaScript(`document.querySelector('#settings-updates-tab').getAttribute('aria-selected')==='true' && document.activeElement.id==='settings-updates-tab'`);
      await window.webContents.executeJavaScript(`document.querySelector('[aria-label="检查更新"]').click()`);
      await new Promise(resolve=>setTimeout(resolve,500));
      state.updates = await window.webContents.executeJavaScript(`({
        heading: document.querySelector('#update-heading')?.textContent,
        notes: !!document.querySelector('.update-notes'),
        fallback: [...document.querySelectorAll('.update-modal button')].some(b=>b.textContent.includes('前往发布页')),
        focused: !!document.activeElement?.closest('.update-modal'),
        overflow: document.documentElement.scrollWidth > innerWidth
      })`);
      state.settings.focusTrap=await window.webContents.executeJavaScript(`(() => {
        const controls=[...document.querySelectorAll('.settings-modal button:not(:disabled), .settings-modal input:not(:disabled)')]
          .filter(el=>el.tabIndex>=0 && el.getClientRects().length);
        controls.at(-1).focus();
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
        const forward=document.activeElement===controls[0];
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
        return forward && document.activeElement===controls.at(-1);
      })()`);
      await writeFile(path.join(output,'desktop-updates.png'),(await window.webContents.capturePage()).toPNG());
      const mockInstaller = Buffer.from('PagePort isolated update download test');
      const mockName = process.platform==='win32' ? 'PagePort-99.0.0-x64-setup.exe' : `PagePort-99.0.0-${process.arch}.dmg`;
      updater.options.fetcher = async address => address.includes('api.github.com') ? Response.json({
        tag_name:'v99.0.0',body:'下载与校验测试',assets:[{name:mockName,state:'uploaded',size:mockInstaller.length,
          digest:`sha256:${require('node:crypto').createHash('sha256').update(mockInstaller).digest('hex')}`,
          browser_download_url:`https://github.com/chopperH0824/pageport/releases/download/v99.0.0/${mockName}`}],
      }) : new Response(mockInstaller);
      await updater.check();
      await new Promise(resolve=>setTimeout(resolve,100));
      await window.webContents.executeJavaScript(`document.querySelector('.update-modal button.primary').click()`);
      const downloadDeadline = Date.now()+5000;
      while (updater.state.status !== 'downloaded' && Date.now()<downloadDeadline) await new Promise(resolve=>setTimeout(resolve,100));
      state.updates.downloaded = updater.state.status === 'downloaded' &&
        await window.webContents.executeJavaScript(`document.querySelector('.update-verified')?.textContent.includes('SHA-256')`);
      state.updates.cleanupOption = process.platform !== 'win32' ||
        await window.webContents.executeJavaScript(`document.querySelector('[aria-label="安装完成后删除安装包"]')?.checked === true`);
      if (process.platform !== 'win32') {
        await window.webContents.executeJavaScript(`document.querySelector('.update-modal button.primary').click()`);
      }
      await window.webContents.executeJavaScript(`document.querySelector('[aria-label="自动检查更新"]').click()`);
      await new Promise(resolve=>setTimeout(resolve,100));
      state.updates.preference = !automaticUpdates && JSON.parse(await readFile(path.join(app.getPath('userData'),'update-settings.json'),'utf8')).automatic === false;
      await window.webContents.executeJavaScript(`document.querySelector('[aria-label="此版本不再提醒"]').click()`);
      await new Promise(resolve=>setTimeout(resolve,100));
      const ignoredSettings = JSON.parse(await readFile(path.join(app.getPath('userData'),'update-settings.json'),'utf8'));
      state.updates.ignore = ignoredSettings.ignoredVersion === '99.0.0' &&
        await window.webContents.executeJavaScript(`document.querySelector('[aria-label="此版本不再提醒"]').checked`);
      await window.webContents.executeJavaScript(`document.querySelector('[aria-label="此版本不再提醒"]').click()`);
      await new Promise(resolve=>setTimeout(resolve,100));
      state.updates.unignore = !(JSON.parse(await readFile(path.join(app.getPath('userData'),'update-settings.json'),'utf8')).ignoredVersion);
      window.setSize(940,700);
      await new Promise(resolve=>setTimeout(resolve,200));
      state.updates.narrowOverflow = await window.webContents.executeJavaScript(`(() => {
        const rect = document.querySelector('.update-modal').getBoundingClientRect();
        return rect.left < 0 || rect.right > innerWidth || rect.bottom > innerHeight || rect.top < 0;
      })()`);
      await writeFile(path.join(output,'desktop-updates-downloaded.png'),(await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
      await new Promise(resolve=>setTimeout(resolve,100));
      state.settings.escape=await window.webContents.executeJavaScript(`!document.querySelector('.settings-overlay').checkVisibility() && document.activeElement.getAttribute('aria-label')==='设置'`);
      state.settings.badge=await window.webContents.executeJavaScript(`!!document.querySelector('.settings-trigger .update-dot')`);
      sendUpdateState(true);
      await new Promise(resolve=>setTimeout(resolve,100));
      state.settings.menu=await window.webContents.executeJavaScript(`document.querySelector('.settings-overlay').checkVisibility() && document.querySelector('#settings-updates').checkVisibility()`);
      await window.webContents.executeJavaScript(`document.querySelector('[aria-label="关闭设置"]').click()`);
      state.settings.passed=state.settings.general && state.settings.actions.some(text=>text.includes('示例文档')) &&
        state.settings.actions.some(text=>text.includes('清除会话')) && state.settings.history && state.settings.cleanToolbar && state.settings.focused &&
        state.settings.keyboard && state.settings.focusTrap && state.settings.escape && state.settings.badge && state.settings.menu;
      state.updates.passed = state.updates.heading === 'PagePort 99.0.0' && state.updates.notes && state.updates.fallback && state.updates.focused &&
        state.updates.downloaded && state.updates.cleanupOption && state.updates.preference && state.updates.ignore && state.updates.unignore &&
        !state.updates.overflow && !state.updates.narrowOverflow;
      window.setSize(1440,960);
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    await writeFile(path.join(output,'desktop-smoke.json'),JSON.stringify(state,null,2));
    await writeFile(path.join(output,'desktop.png'),(await window.webContents.capturePage()).toPNG());
    if(state.toc) {
      window.setSize(940,700);
      await new Promise(resolve=>setTimeout(resolve,200));
      state.toc.narrowOverflow=await window.webContents.executeJavaScript(`document.documentElement.scrollWidth>innerWidth`);
      await writeFile(path.join(output,'desktop-narrow.png'),(await window.webContents.capturePage()).toPNG());
      await writeFile(path.join(output,'desktop-smoke.json'),JSON.stringify(state,null,2));
    }
    app.exit(state.brand?.loaded && state.brand.source==='/brand.png' && state.brand.blue==='#2463eb' && state.brand.mint==='#008a78' && state.rendered?.includes('功能概述') && state.sync==='发布稿已同步' && !state.errors.length && !state.overflow && (!state.toc || (state.toc.passed && !state.toc.narrowOverflow)) && (!state.editor || state.editor.passed) && (!state.updates || state.updates.passed) && (!state.settings || state.settings.passed) && (!state.spacing || state.spacing.every(item=>item.passed)) ? 0 : 1);
  }
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{if(backend){backend.removeAllListeners('exit');backend.kill();}});
process.on('exit',()=>backend?.kill());
