import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronDown, ChevronRight,
  CloudUpload, Code2, Download, Eye, EyeOff, FileCode2, FileText, Files,
  History, ImagePlus, Loader2, LockKeyhole, LogOut, PanelLeftClose,
  Plus, RefreshCw, Send, ShieldCheck, TriangleAlert, X, XCircle,
} from 'lucide-react';
import './style.css';

const demo = `# PagePort 格式示例

公开的虚构格式示例。
`;
const previewCss = `
*{box-sizing:border-box}html{color-scheme:light}body{margin:0;padding:38px 44px 70px;font:14px/1.8 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#26343b;overflow-wrap:anywhere;background:#fff;letter-spacing:0}
h1{font-size:25px;line-height:1.4;margin:0 0 12px;font-weight:650;color:#182a33}h2{font-size:18px;margin:30px 0 12px;font-weight:620;color:#233640}h3{font-size:16px;margin:24px 0 10px}p{margin:10px 0}h1+p{color:#78848a;font-size:12px;margin-bottom:26px}
table{border-collapse:collapse;width:100%;margin:15px 0;table-layout:auto;font-size:13px}th,td{border:1px solid #dce3e7;padding:10px 12px;text-align:left;vertical-align:top}th{background:#f3f6f7;font-weight:600;color:#324750}td p{margin:4px 0}table table{font-size:12px}
ul,ol{padding-left:24px}li{padding-left:2px;margin:5px 0}blockquote{border-left:3px solid #d4a46d;padding:7px 16px;margin:16px 0;background:#fbf8f3;color:#65543e}blockquote p{margin:4px 0}
pre{background:#f5f7f8;border:1px solid #e2e7ea;border-radius:4px;padding:16px;overflow:auto;white-space:pre;font:12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:normal}code{background:#f0f3f5;padding:2px 5px;border-radius:3px;font-size:12px}pre code{background:none;padding:0}img{max-width:100%;height:auto}a{color:#087f72}hr{border:0;border-top:1px solid #e5eaec;margin:24px 0}
@media(max-width:650px){body{padding:24px 18px}h1{font-size:22px}th,td{padding:7px 8px}table{font-size:12px}}
`;
const makeSrcDoc = body => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>${previewCss}</style></head><body>${body}</body></html>`;
const formatSize = size => size > 1024*1024 ? `${(size/1024/1024).toFixed(1)} MB` : `${Math.max(1,Math.round(size/1024))} KB`;

function App() {
  const [boot,setBoot] = useState(null), [csrf,setCsrf] = useState(''), [access,setAccess] = useState('');
  const [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [document,setDocument] = useState(null), [file,setFile] = useState(null), [images,setImages] = useState([]);
  const [busy,setBusy] = useState(''), [tab,setTab] = useState('preview'), [source,setSource] = useState('');
  const [url,setUrl] = useState(''), [username,setUsername] = useState(''), [password,setPassword] = useState('');
  const [showPassword,setShowPassword] = useState(false), [plan,setPlan] = useState(null), [result,setResult] = useState(null);
  const [modal,setModal] = useState(false), [confirmTitle,setConfirmTitle] = useState(''), [ack,setAck] = useState(false);
  const [history,setHistory] = useState([]), [showHistory,setShowHistory] = useState(false), [remaining,setRemaining] = useState(0);
  const [drag,setDrag] = useState(false), [sidebar,setSidebar] = useState(false);
  const input = useRef(), imageInput = useRef(), generation = useRef(0);
  const csrfRef = useRef('');
  async function api(route, options = {}) {
    const { json, ...rest } = options;
    const response = await fetch(`/api${route}`, {
      ...rest,
      headers: { 'X-CSRF-Token': csrfRef.current, ...(json ? {'Content-Type':'application/json'} : {}), ...rest.headers },
      ...(json ? {body:JSON.stringify(json)} : {}),
    });
    const data = await response.json().catch(()=>({error:'服务器返回了无效响应。'}));
    if (!response.ok) throw new Error(data.error || '请求失败，请稍后再试。');
    return data;
  }
  function invalidate() { setPlan(null); setResult(null); setConfirmTitle(''); setAck(false); }
  async function convert(nextFile, nextImages = []) {
    if (!nextFile || busy === 'publish') return;
    const seq = ++generation.current;
    setFile(nextFile); setImages(nextImages); setDocument(null); invalidate(); setError(''); setNotice(''); setBusy('convert');
    try {
      const form = new FormData();
      form.append('document',nextFile);
      nextImages.forEach(image=>form.append('images',image));
      const nextDoc = await api('/convert',{method:'POST',body:form});
      if (seq !== generation.current) return;
      setDocument(nextDoc); setSource(nextDoc.source); setTab('preview');
    } catch(err) { if(seq === generation.current) setError(err.message); }
    finally { if(seq === generation.current) setBusy(''); }
  }
  const loadDemo = () => convert(new File([demo],'PagePort-format-example.md',{type:'text/markdown'}));
  useEffect(()=>{
    fetch('/api/bootstrap').then(r=>r.json()).then(data=>{
      setBoot(data); csrfRef.current = data.csrf; setCsrf(data.csrf);
    }).catch(()=>setError('无法连接服务，请刷新重试。'));
  },[]);
  useEffect(()=>{ if(boot?.authenticated && !file) loadDemo(); },[boot?.authenticated]);
  useEffect(()=>{
    if (!plan) return;
    const update = () => setRemaining(Math.max(0,Math.ceil((plan.deadline-Date.now())/1000)));
    update(); const interval = setInterval(update,1000); return ()=>clearInterval(interval);
  },[plan]);
  useEffect(()=>{
    const listener = event => { if(event.key === 'Escape' && busy !== 'publish') {setModal(false);setShowHistory(false);} };
    window.addEventListener('keydown',listener);
    return ()=>window.removeEventListener('keydown',listener);
  },[busy]);
  async function login(event) {
    event.preventDefault();setBusy('login');setError('');
    try {await api('/login',{method:'POST',json:{password:access}});setAccess('');setBoot(await api('/bootstrap'));}
    catch(err){setError(err.message);}finally{setBusy('');}
  }
  async function check() {
    setBusy('check');setError('');setNotice('');invalidate();
    try {
      const data = await api('/check',{method:'POST',json:{url,username,password,documentId:document.id}});
      setPlan({...data,deadline:Date.now()+data.expiresIn*1000});
    }catch(err){setError(err.message);}finally{setBusy('');}
  }
  async function publish() {
    setBusy('publish');setError('');
    try {
      const data = await api('/publish',{method:'POST',json:{token:plan.token,username,password,confirmTitle,acknowledge:ack}});
      setResult(data);setHistory(prev=>[{...data,time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})},...prev]);
      setPlan(null);setPassword('');setModal(false);
    }catch(err){setError(err.message);setPlan(null);setPassword('');setModal(false);}
    finally{setBusy('');}
  }
  async function download(route,name) {
    try {
      const response = await fetch(`/api${route}`);
      if(!response.ok) throw new Error('文件已过期，请重新检查。');
      const link = window.URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement('a');anchor.href=link;anchor.download=name;anchor.click();
      setTimeout(()=>window.URL.revokeObjectURL(link),1000);
    }catch(err){setError(err.message);}
  }
  function chooseFiles(list) {
    const all = [...list], doc = all.find(f=>/\.(md|markdown|html?|docx|txt)$/i.test(f.name));
    const pics = all.filter(f=>/\.(png|jpe?g|gif|webp)$/i.test(f.name));
    if(doc) convert(doc,pics);
    else if(pics.length && file) convert(file,[...images,...pics]);
    else setError('请选择 Markdown、HTML、Word .docx、纯文本或配套图片。');
    setSidebar(false);
  }
  const valid = !!document && !document.blockers.length && !busy;
  const edited = !!document && !!document.source && source !== document.source;
  const checked = !!plan && remaining > 0 && !edited;
  const hostname = boot?.hosts?.[0] || 'confluence.example.com';
  if(!boot) return <div className="loading-page"><Loader2 className="spin" size={24}/><span>正在连接 PagePort</span></div>;
  if(!boot.authenticated) return <div className="access-screen">
    <div className="access-brand"><img src="/favicon.svg" alt="PagePort" width="44" height="44"/><span>PagePort</span></div>
    <form className="access-form" onSubmit={login}><LockKeyhole size={26}/><h1>文档发布台</h1>
      <label htmlFor="access">网站访问口令</label><input id="access" type="password" value={access} onChange={e=>setAccess(e.target.value)} autoFocus autoComplete="off" required/>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary" disabled={!!busy}>{busy ? <Loader2 className="spin" size={16}/> : <ArrowRight size={16}/>}进入工作区</button>
    </form><span className="access-foot">PagePort · Confluence Publisher</span>
  </div>;
  return <div className="app-shell" onDragOver={e=>{e.preventDefault();if(!busy)setDrag(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDrag(false);}} onDrop={e=>{e.preventDefault();setDrag(false);if(!busy)chooseFiles(e.dataTransfer.files);}}>
    <header className="topbar">
      <button className="mobile-menu icon-button" title="打开文档栏" aria-label="打开文档栏" onClick={()=>setSidebar(!sidebar)}><Files size={20}/></button>
      <a href="/" className="brand"><img src="/favicon.svg" alt="" width="32" height="32"/><span>PagePort</span><span className="brand-divider"/><span className="brand-sub">文档发布台</span></a>
      <nav className="top-actions"><span className="engine-status"><span className="status-dot"/>Mark 引擎</span><span className="secure-indicator" title={boot.desktop?'转换与认证均在本机运行，不经过第三方发布服务器':'凭据仅用于本次请求，不保存密码'}><ShieldCheck size={15}/>{boot.desktop?'本机运行':'安全会话'}</span>
        <button className="icon-button" title="清除会话" aria-label="清除会话" onClick={async()=>{if(busy)return;await api('/logout',{method:'POST',json:{}});window.location.reload();}}><LogOut size={17}/></button>
      </nav>
    </header>
    <div className="workspace">
      <aside className={`sidebar ${sidebar?'is-open':''}`}>
        <div className="sidebar-head"><span className="overline">工作区</span><button className="icon-button mobile-close" title="关闭文档栏" aria-label="关闭文档栏" onClick={()=>setSidebar(false)}><PanelLeftClose size={16}/></button></div>
        <button className="import-button" onClick={()=>input.current.click()} disabled={!!busy}><Plus size={17}/>导入文档<span>+</span></button>
        <input ref={input} type="file" className="hidden" accept=".md,.markdown,.html,.htm,.docx,.txt,.png,.jpg,.jpeg,.webp,.gif" multiple onChange={e=>{chooseFiles(e.target.files);e.target.value='';}}/>
        <input ref={imageInput} type="file" className="hidden" accept=".png,.jpg,.jpeg,.webp,.gif" multiple onChange={e=>{chooseFiles(e.target.files);e.target.value='';}}/>
        <div className="section-label">当前文档<span>{file? '01':'00'}</span></div>
        {file ? <div className="file-item active"><span className="file-icon"><FileText size={18}/></span><div><strong title={file.name}>{file.name}</strong><small>{formatSize(file.size)}<span>·</span>{document?'已转换':busy==='convert'?'转换中':'待转换'}</small></div><span className="file-dot"/></div> : <div className="sidebar-empty">暂无文档</div>}
        <button className="sidebar-row" onClick={()=>imageInput.current.click()} disabled={!file || !!busy}><ImagePlus size={16}/><span>配套图片</span><span className="count">{images.length}</span></button>
        {images.length>0 && <div className="image-list">{images.map((image,index)=><div key={`${image.name}-${index}`}><span title={image.name}>{image.name}</span><button className="icon-button" title={`移除 ${image.name}`} aria-label={`移除 ${image.name}`} disabled={!!busy} onClick={()=>convert(file,images.filter((_,i)=>i!==index))}><X size={12}/></button></div>)}</div>}
        <div className="sidebar-separator"/>
        <button className="sidebar-row" onClick={()=>setShowHistory(true)}><History size={16}/><span>本次发布记录</span><span className="count">{history.length}</span></button>
        <button className="sidebar-row muted" onClick={loadDemo} disabled={!!busy}><FileCode2 size={16}/><span>示例文档</span><ArrowUpRight size={14}/></button>
        <div className="sidebar-bottom"><div className="format-label">支持格式</div><div className="format-list"><span>MD</span><span>HTML</span><span>DOCX</span><span>TXT</span></div><div className="size-note">单文件 ≤ 10 MB</div><div className="workspace-user"><span className="avatar"><LockKeyhole size={15}/></span><div><strong>{boot.desktop?'本地工作区':'私有工作区'}</strong><small>会话将在 30 分钟后失效</small></div></div></div>
      </aside>
      {sidebar && <button className="sidebar-scrim" aria-label="关闭文档栏" onClick={()=>setSidebar(false)}/>}
      <main className="editor">
        <div className="page-heading"><div><div className="breadcrumb">工作区<ChevronRight size={12}/>文档预览</div><h1>发布工作区<span className="tag">Confluence 7.6</span></h1></div><button className="icon-button" title="下载 Confluence 存储格式" aria-label="下载 Confluence 存储格式" disabled={!document || !!busy} onClick={()=>download(`/documents/${document.id}/storage`,'confluence-storage.xhtml')}><Download size={18}/></button></div>
        <div className="document-toolbar"><div className="tabs" role="tablist" aria-label="文档视图">
          <button role="tab" aria-selected={tab==='preview'} className={tab==='preview'?'selected':''} onClick={()=>setTab('preview')}><Eye size={15}/>页面预览</button>
          <button role="tab" aria-selected={tab==='source'} className={tab==='source'?'selected':''} onClick={()=>setTab('source')}><Code2 size={15}/>源文件</button>
          <button role="tab" aria-selected={tab==='checks'} className={tab==='checks'?'selected':''} onClick={()=>setTab('checks')}><ShieldCheck size={15}/>检查项{document && <span className={document.blockers.length?'issue-count':'tab-count'}>{document.warnings.length+document.blockers.length}</span>}</button>
        </div><span className="preview-state">{busy==='convert'?<><Loader2 className="spin" size={13}/>转换中</>:document?<><span className="status-dot"/>预览已就绪</>:null}</span></div>
        {error && <div className="alert error" role="alert"><XCircle size={17}/><span>{error}</span><button className="icon-button" title="关闭提示" aria-label="关闭提示" onClick={()=>setError('')}><X size={14}/></button></div>}
        {notice && <div className="alert" role="status">{notice}</div>}
        <div className="document-area">
          {busy==='convert'?<div className="document-loading"><Loader2 className="spin" size={26}/><h2>正在转换文档</h2><span>准备页面内容与配套图片</span></div>:!document?<button className="empty-upload" onClick={()=>input.current.click()}><CloudUpload size={36}/><h2>选择文档</h2><span>Markdown / HTML / Word / TXT</span></button>:
            tab==='preview'?<div className="preview-page"><div className="preview-page-head"><span><span className="confluence-mark">C</span>CONFLUENCE</span><span>近似预览<span className="small-dot"/>最终样式以目标页面为准</span></div><iframe title="Confluence 文档预览" sandbox="allow-same-origin" srcDoc={makeSrcDoc(document.preview)}/></div>:
            tab==='source'?<div className="source-view"><div className="source-toolbar"><span>{document.source?'Markdown / HTML / TXT':'Word · 二进制文件'}</span>{document.source && <button className="small-button" disabled={!edited || !!busy} onClick={()=>convert(new File([source],file.name,{type:file.type}),images)}><RefreshCw size={13}/>更新预览</button>}</div>{document.source?<textarea aria-label="文档源文件" spellCheck={false} value={source} disabled={!!busy} onChange={e=>{setSource(e.target.value);invalidate();}}/>:<div className="source-unavailable"><FileText size={30}/><p>Word 源文件请在原编辑器中修改后重新上传。</p></div>}</div>:
            <div className="checks-view"><h2>转换检查</h2><div className="checks-intro">{document.blockers.length?'有待处理的阻断项':'转换完成，可继续核对目标页面'}</div>
              <div className="check-row"><CheckCircle2 size={18}/><div><strong>内容结构</strong><p>{document.stats.headings} 个标题 · {document.stats.tables} 个表格 · {document.stats.images} 张图片</p></div></div>
              <div className="check-row"><CheckCircle2 size={18}/><div><strong>预览与发布使用同一份转换结果</strong><p>已清理可执行内容，代码块使用兼容显示。</p></div></div>
              {document.blockers.map((message,i)=><div className="check-row blocked" key={`b${i}`}><XCircle size={18}/><div><strong>需要处理</strong><p>{message}</p></div></div>)}
              {document.warnings.map((message,i)=><div className="check-row warning" key={`w${i}`}><TriangleAlert size={18}/><div><strong>请核对</strong><p>{message}</p></div></div>)}
              <div className="check-row warning"><TriangleAlert size={18}/><div><strong>格式保真边界</strong><p>预览不是 Confluence 官方渲染器。Word 分页、字体及专有宏不保证无损还原。</p></div></div>
            </div>}
        </div>
        <footer className="document-footer"><span><FileText size={13}/>{document?`${document.stats.characters.toLocaleString()} 字符`:'未导入'}<span className="footer-divider"/> {document?.stats.tables || 0} 个表格<span className="footer-divider"/>{document?.stats.images || 0} 张图片</span><span>UTF-8<span className="footer-divider"/>兼容模式</span></footer>
      </main>
      <aside className="publish-panel">
        <div className="publish-heading"><div className="publish-icon"><Send size={17}/></div><h2>发布到 Confluence</h2></div>
        <div className="stepper"><span className={document?'done':''}>{document?<Check size={11}/>:1}</span><i/><span className={checked?'done':'current'}>{checked?<Check size={11}/>:2}</span><i/><span className={result?'done':''}>{result?<Check size={11}/>:3}</span></div>
        <div className="step-labels"><span>导入文档</span><span>核对目标</span><span>确认发布</span></div>
        <div className="publish-section"><div className="section-title"><span>01</span><h3>目标页面</h3></div>
          <label htmlFor="target">页面链接</label><input id="target" type="url" value={url} placeholder={`https://${hostname}/pages/…`} disabled={!!busy} onChange={e=>{setUrl(e.target.value);invalidate();}}/>
          <div className="field-hint">仅更新指定页面，不创建或移动页面</div>
        </div>
        <div className="publish-section"><div className="section-title"><span>02</span><h3>账号认证</h3><LockKeyhole size={13}/></div>
          <label htmlFor="username">登录账号</label><input id="username" value={username} placeholder="Confluence 登录账号" autoComplete="off" disabled={!!busy} onChange={e=>{setUsername(e.target.value);invalidate();}}/>
          <label htmlFor="password">密码</label><div className="password-input"><input id="password" type={showPassword?'text':'password'} value={password} placeholder="输入密码" autoComplete="off" disabled={!!busy} onChange={e=>{setPassword(e.target.value);invalidate();}}/><button className="icon-button" aria-label={showPassword?'隐藏密码':'显示密码'} title={showPassword?'隐藏密码':'显示密码'} onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={16}/>:<Eye size={16}/>}</button></div>
          <div className="privacy-line"><ShieldCheck size={13}/>不保存密码，发布后自动清空</div>
        </div>
        <button className="check-button" disabled={!valid || !url || !username || !password || edited} onClick={check}>{busy==='check'?<Loader2 className="spin" size={16}/>:<ShieldCheck size={16}/>}检查目标页面<ArrowRight size={15}/></button>
        {edited && <p className="inline-warning">源文件有修改，请先更新预览。</p>}
        {document?.blockers.length>0 && <button className="inline-warning text-link" onClick={()=>setTab('checks')}>有 {document.blockers.length} 项内容需要处理<ChevronRight size={13}/></button>}
        {plan && <div className="target-result"><div className="target-result-head"><CheckCircle2 size={15}/><span>读取成功</span><small>{remaining?`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`:'已过期'}</small></div><h3>{plan.target.title}</h3><dl><div><dt>空间</dt><dd>{plan.target.space}</dd></div><div><dt>当前版本</dt><dd>v{plan.target.version}</dd></div><div><dt>原正文</dt><dd>{plan.target.characters} 字符</dd></div></dl>
          {plan.target.warnings.map((warning,i)=><p className="inline-warning" key={i}>{warning}</p>)}
          {plan.target.excerpt && <details><summary>查看原正文摘要<ChevronDown size={12}/></summary><p>{plan.target.excerpt}</p></details>}
          <button className="text-link backup-download" onClick={()=>download(`/backups/${plan.token}`,`confluence-${plan.target.id}-v${plan.target.version}.json`)}><Download size={13}/>下载修改前备份</button>
        </div>}
        {result && <div className="success-result" role="status"><CheckCircle2 size={25}/><h3>发布完成</h3><p>{result.title} · v{result.version}</p><span>{result.verification==='matched'?'正文结构回读核对通过':'请打开目标页面核对最终显示'}</span><a href={result.url} target="_blank" rel="noreferrer">打开 Confluence<ArrowUpRight size={14}/></a></div>}
        <div className="publish-bottom"><div className="publish-safety"><ShieldCheck size={15}/><span>发布前备份原文，并检查线上版本</span></div><button className="primary publish-button" disabled={!checked || !!busy} onClick={()=>{setConfirmTitle('');setAck(false);setModal(true);}}><Send size={16}/>确认发布<ArrowRight size={16}/></button><div className="final-note">发布将替换目标页面的正文</div></div>
      </aside>
    </div>
    {drag && <div className="drop-overlay"><CloudUpload size={44}/><h2>松开以上传文档或配套图片</h2><span>单文件最大 10 MB</span></div>}
    {modal && <div className="modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-heading"><button className="modal-close icon-button" title="关闭" aria-label="关闭" disabled={busy==='publish'} onClick={()=>setModal(false)}><X size={19}/></button><span className="modal-emblem"><Send size={22}/></span><h2 id="confirm-heading">确认替换页面正文</h2><p className="modal-subtitle">将更新已有页面，不会创建副本。</p><div className="confirm-target"><span>目标页面</span><strong>{plan?.target.title}</strong><a href={plan?.url} target="_blank" rel="noreferrer">查看页面<ArrowUpRight size={13}/></a></div>
      <label htmlFor="confirm-title">输入页面标题以确认</label><input id="confirm-title" autoFocus value={confirmTitle} disabled={busy==='publish'} onChange={e=>setConfirmTitle(e.target.value)} autoComplete="off"/>
      <label className="checkbox-label"><input type="checkbox" checked={ack} disabled={busy==='publish'} onChange={e=>setAck(e.target.checked)}/><span>我已核对文档预览及兼容性提示，确认替换目标正文。</span></label>
      <div className="modal-actions"><button className="secondary" disabled={busy==='publish'} onClick={()=>setModal(false)}>取消</button><button className="primary" disabled={!checked || !ack || confirmTitle!==plan?.target.title || !!busy} onClick={publish}>{busy==='publish'?<Loader2 className="spin" size={16}/>:<Send size={16}/>}备份并发布</button></div></section></div>}
    {showHistory && <div className="modal-overlay"><section className="modal history-modal" role="dialog" aria-modal="true" aria-labelledby="history-heading"><button className="modal-close icon-button" title="关闭" aria-label="关闭" onClick={()=>setShowHistory(false)}><X size={19}/></button><History size={23}/><h2 id="history-heading">本次发布记录</h2>{history.length?history.map((item,i)=><a className="history-row" key={i} href={item.url} target="_blank" rel="noreferrer"><CheckCircle2 size={17}/><span><strong>{item.title}</strong><small>v{item.version} · {item.time}</small></span><ArrowUpRight size={15}/></a>):<p className="history-empty">本次会话暂无发布记录</p>}</section></div>}
  </div>;
}

createRoot(window.document.getElementById('root')).render(<App/>);
