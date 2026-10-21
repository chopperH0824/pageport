const { app, BrowserWindow, session, shell, dialog, Menu } = require('electron');
const { fork } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { mkdir, writeFile } = require('node:fs/promises');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

app.setName('PagePort');
let backend, window, origin;
const desktopToken = randomBytes(32).toString('hex');
const smoke = process.argv.includes('--smoke');
const appRoot = path.resolve(__dirname,'..');
if(smoke)app.setPath('userData',mkdtempSync(path.join(tmpdir(),'pageport-smoke-profile-')));

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

async function start() {
  const dataDir=path.join(app.getPath('userData'),'data');
  const mark=app.isPackaged ? path.join(process.resourcesPath,'bin','mark') : path.join(appRoot,'resources','mark');
  await mkdir(dataDir,{recursive:true,mode:0o700});
  backend=fork(path.join(appRoot,'server','index.js'),[],{
    execPath:process.execPath,
    env:{
      PATH:process.env.PATH || '/usr/bin:/bin', HOME:app.getPath('home'), LANG:'en_US.UTF-8',
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
    width:1440,height:960,minWidth:940,minHeight:660,backgroundColor:'#f5f8f9',
    title:'PagePort · 本地文档发布台',show:false,
    webPreferences:{session:isolatedSession,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true},
  });
  if(smoke) window.webContents.on('console-message',(_event,...details)=>console.log('Renderer:',...details));
  window.webContents.setWindowOpenHandler(({url})=>{openExternal(url);return {action:'deny'};});
  window.webContents.on('will-navigate',(event,url)=>{
    if(!url.startsWith(origin+'/')){event.preventDefault();openExternal(url);}
  });
  window.webContents.on('will-prevent-unload',event=>{
    const choice=dialog.showMessageBoxSync(window,{type:'warning',buttons:['继续编辑','放弃修改并关闭'],defaultId:0,cancelId:0,message:'文档修改尚未导出',detail:'关闭后未导出的本地修改将丢失。'});
    if(choice===1)event.preventDefault();
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'PagePort',submenu:[{role:'about'},{type:'separator'},{label:'打开备份文件夹',click:()=>shell.openPath(path.join(dataDir,'backups'))},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},
    {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'窗口',submenu:[{role:'minimize'},{role:'zoom'},{role:'front'}]},
  ]));
  await window.loadURL(origin);
  if(!smoke)window.show();
  app.on('activate',()=>{if(window){window.show();window.focus();}});
  backend.on('exit',()=>{if(window && !window.isDestroyed()){dialog.showErrorBox('本地服务已停止','请退出并重新打开 PagePort。');app.quit();}});
  if(smoke) {
    const output=process.env.PAGEPORT_SMOKE_DIR || path.join(appRoot,'artifacts');
    await mkdir(output,{recursive:true});
    const deadline=Date.now()+20000;
    let state;
    do {
      state=await window.webContents.executeJavaScript(`({
        title:document.title,
        preview:document.querySelector('iframe')?.getAttribute('srcdoc') || '',
        rendered:document.querySelector('.prose-editor')?.innerText || '',
        sync:document.querySelector('.preview-state')?.textContent || '',
        undoDisabled:document.querySelector('[aria-label="撤销 (⌘Z)"]')?.disabled,
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
      await window.webContents.executeJavaScript(`document.querySelector('[role="tab"]:nth-child(2)').click()`);
      state.toc.sourceMarker=await window.webContents.executeJavaScript(`document.querySelector('textarea')?.value.includes('data-pageport-toc="true"')`);
      await window.webContents.executeJavaScript(`document.querySelector('[role="tab"]:first-child').click();document.querySelector('.contents-node nav button').click()`);
      window.webContents.insertText('目录更新验证');
      await new Promise(resolve=>setTimeout(resolve,300));
      state.toc.liveUpdate=await window.webContents.executeJavaScript(`document.querySelector('.contents-node nav').textContent.includes('目录更新验证')`);
      await window.webContents.executeJavaScript(`document.querySelector('[aria-label="撤销 (⌘Z)"]').click()`);
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
      await window.webContents.executeJavaScript(`document.querySelector('[aria-label="查找与替换 (⌘F)"]').click()`);
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
      state.editor.passed=state.editor.status && state.editor.panel && state.editor.words && state.editor.search && !state.editor.errors.length;
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
    app.exit(state.rendered?.includes('功能概述') && state.sync==='发布稿已同步' && !state.errors.length && !state.overflow && (!state.toc || (state.toc.passed && !state.toc.narrowOverflow)) && (!state.editor || state.editor.passed) ? 0 : 1);
  }
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{if(backend){backend.removeAllListeners('exit');backend.kill();}});
process.on('exit',()=>backend?.kill());
