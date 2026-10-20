const { app, BrowserWindow, session, shell, dialog, Menu } = require('electron');
const { fork } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');

app.setName('PagePort');
let backend, window, origin;
const desktopToken = randomBytes(32).toString('hex');
const smoke = process.argv.includes('--smoke');
const appRoot = path.resolve(__dirname,'..');

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=>{if(window){window.show();window.focus();}});
  app.whenReady().then(start).catch(error=>{
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
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'PagePort',submenu:[{role:'about'},{type:'separator'},{label:'打开备份文件夹',click:()=>shell.openPath(path.join(dataDir,'backups'))},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},
    {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'窗口',submenu:[{role:'minimize'},{role:'zoom'},{role:'front'}]},
  ]));
  await window.loadURL(origin);
  window.show();
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
        rendered:document.querySelector('iframe')?.contentDocument?.body?.innerText || '',
        errors:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent),
        overflow:document.documentElement.scrollWidth>innerWidth
      })`);
      if(state.rendered?.includes('功能概述')) break;
      await new Promise(resolve=>setTimeout(resolve,200));
    } while(Date.now()<deadline);
    await new Promise(resolve=>setTimeout(resolve,500));
    await writeFile(path.join(output,'desktop-smoke.json'),JSON.stringify(state,null,2));
    await writeFile(path.join(output,'desktop.png'),(await window.webContents.capturePage()).toPNG());
    app.exit(state.rendered?.includes('功能概述') && !state.errors.length && !state.overflow ? 0 : 1);
  }
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{if(backend){backend.removeAllListeners('exit');backend.kill();}});
process.on('exit',()=>backend?.kill());
