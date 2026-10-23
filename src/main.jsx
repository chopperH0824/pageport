import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronDown, ChevronRight,
  CloudUpload, Code2, Download, Eye, EyeOff, FileCode2, FileText, Files,
  History, ImagePlus, Loader2, LockKeyhole, LogOut, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen, Plus, RefreshCw, Send, ShieldCheck, TriangleAlert, X, XCircle,
} from 'lucide-react';
import './style.css';
import RichEditor from './RichEditor.jsx';
import { toMarkdown } from './markdown.js';
import UpdatePanel from './UpdatePanel.jsx';

const demo = `# PagePort 格式示例

公开的虚构格式示例。
`;
const previewCss = `
*{box-sizing:border-box}html{color-scheme:light}body{margin:0;padding:8px 4px 40px;font:14px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;color:#172b4d;overflow-wrap:anywhere;background:#fff;letter-spacing:0}
h1{font-size:24px;line-height:1.25;margin:30px 0 0;font-weight:400;color:#172b4d}h2{font-size:20px;line-height:1.3;margin:30px 0 0;font-weight:400;color:#172b4d}h3{font-size:16px;margin:24px 0 0;font-weight:600;color:#172b4d}p{margin:10px 0 0}
table{border-collapse:collapse;width:auto;max-width:100%;margin:10px 0 0;table-layout:auto;font-size:14px}th,td{border:1px solid #c1c7d0;padding:7px 10px;vertical-align:top;line-height:20px}th{background:#f4f5f7;font-weight:600;color:#172b4d}td p,th p{margin:0}table table{font-size:14px}
ul,ol{padding-left:24px;margin:10px 0 0}li{padding-left:2px;margin:0}blockquote{border-left:1px solid #dfe1e5;padding:10px 20px;margin:10px 0 0 19px;background:transparent;color:#7a869a;font-style:normal}blockquote p{margin:0;color:inherit}
pre{background:#f4f5f7;border:1px solid #dfe1e5;border-radius:3px;padding:10px 12px;overflow:auto;white-space:pre;font:14px/20px ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:normal;color:#172b4d}code{background:#f4f5f7;padding:2px 4px;border-radius:3px;font-size:14px;color:#172b4d}pre code{background:none;padding:0}img{max-width:100%;height:auto}a{color:#0052cc;font-weight:700;text-decoration:none}hr{border:0;border-top:1px solid #dfe1e5;margin:10px 0 0}
@media(max-width:650px){body{padding:24px 18px}h1{font-size:22px}th,td{padding:7px 8px}table{font-size:12px}}
ul[data-type="taskList"]{list-style:none;padding-left:8px}li[data-type="taskItem"]::before{content:"☐";margin-right:8px}li[data-checked="true"]::before{content:"☑"}mark{background:#fff0ad}
[data-pageport-panel]{border-radius:4px;padding:10px 14px 10px 40px;margin:16px 0;position:relative}[data-pageport-panel] p{margin:4px 0}[data-pageport-panel]::before{position:absolute;left:12px;top:12px;width:18px;height:18px;border-radius:50%;color:#fff;font:600 11px/18px sans-serif;text-align:center}
[data-pageport-panel="info"]{background:#deebff}[data-pageport-panel="info"]::before{content:"i";background:#0052cc}[data-pageport-panel="tip"]{background:#e3fcef}[data-pageport-panel="tip"]::before{content:"✓";background:#00875a}[data-pageport-panel="note"]{background:#fffae6}[data-pageport-panel="note"]::before{content:"!";background:#ff991f}[data-pageport-panel="warning"]{background:#ffebe6}[data-pageport-panel="warning"]::before{content:"×";background:#de350b}
[data-pageport-status]{display:inline-block;font-size:11px;font-weight:700;line-height:1.5;padding:0 6px;border-radius:3px;text-transform:uppercase;vertical-align:1px}[data-pageport-status="grey"]{background:#dfe1e6;color:#42526e}[data-pageport-status="blue"]{background:#deebff;color:#0747a6}[data-pageport-status="green"]{background:#e3fcef;color:#006644}[data-pageport-status="yellow"]{background:#fff0b3;color:#172b4d}[data-pageport-status="red"]{background:#ffebe6;color:#bf2600}
`;
const makeSrcDoc = body => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'"><style>${previewCss}</style></head><body>${body}</body></html>`;
const formatSize = size => size > 1024*1024 ? `${(size/1024/1024).toFixed(1)} MB` : `${Math.max(1,Math.round(size/1024))} KB`;
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { return; } },
};
const readWidth = (key, fallback, min, max) => {
  const value = Number(storage.get(key));
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};
const toBytes = buffer => {
  if (buffer instanceof Uint8Array) return buffer;
  if (Array.isArray(buffer)) return new Uint8Array(buffer);
  if (Array.isArray(buffer?.data)) return new Uint8Array(buffer.data);
  return new Uint8Array(buffer);
};
const tipClasses = ['icon-button','format-tool','split-arrow','symbol','swatch','resize-handle','heading-action'];

function HoverTip() {
  const [tip, setTip] = useState(null);
  const current = useRef(null);
  useEffect(() => {
    let timer;
    const restore = el => {
      if (el?.dataset?.tipRestore != null) {
        el.setAttribute('title', el.dataset.tipRestore);
        delete el.dataset.tipRestore;
      }
    };
    const hide = () => {
      clearTimeout(timer);
      restore(current.current);
      current.current = null;
      setTip(null);
    };
    const labelFor = el => {
      if (!el) return '';
      const label = (el.dataset.tipRestore || el.getAttribute('title') || el.getAttribute('aria-label') || '').trim();
      return label && tipClasses.some(name => el.classList.contains(name)) ? label : '';
    };
    const show = event => {
      const el = event.target.closest?.('button, a, label, .resize-handle');
      if (!el || el === current.current) return;
      const label = labelFor(el);
      if (!label) { if (current.current) hide(); return; }
      restore(current.current);
      current.current = el;
      if (el.getAttribute('title')) {
        el.dataset.tipRestore = el.getAttribute('title');
        el.removeAttribute('title');
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (current.current !== el) return;
        const rect = el.getBoundingClientRect();
        const below = rect.top < 64;
        const nearRight = rect.left > window.innerWidth - 240;
        setTip({
          label, below,
          top: below ? rect.bottom + 8 : rect.top - 8,
          left: nearRight ? undefined : Math.max(8, rect.left),
          right: nearRight ? Math.max(8, window.innerWidth - rect.right) : undefined,
        });
      }, 250);
    };
    const leave = event => {
      if (!current.current) return;
      const next = event.relatedTarget?.closest?.('button, a, label, .resize-handle');
      if (next === current.current || current.current.contains(event.relatedTarget)) return;
      hide();
    };
    document.addEventListener('mouseover', show);
    document.addEventListener('focusin', show);
    document.addEventListener('mouseout', leave);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timer);
      restore(current.current);
      document.removeEventListener('mouseover', show);
      document.removeEventListener('focusin', show);
      document.removeEventListener('mouseout', leave);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);
  if (!tip) return null;
  return <div className={`hover-tip${tip.below ? ' below' : ' above'}`} style={{top:tip.top,left:tip.left,right:tip.right}} role="tooltip">{tip.label}</div>;
}

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
  const [leftWidth,setLeftWidth] = useState(()=>readWidth('pageport-doc-col',224,180,420));
  const [rightWidth,setRightWidth] = useState(()=>readWidth('pageport-publish-col',328,260,520));
  const [leftOpen,setLeftOpen] = useState(()=>storage.get('pageport-doc-open')!=='0');
  const [rightOpen,setRightOpen] = useState(()=>storage.get('pageport-publish-open')!=='0');
  const [resizing,setResizing] = useState(false);
  const [editorContent,setEditorContent] = useState({html:'',version:0}), [outline,setOutline] = useState([]);
  const [readOnly,setReadOnly] = useState(false), [focus,setFocus] = useState(false), [sync,setSync] = useState('ready'), [dirty,setDirty] = useState(false);
  const rich = useRef(null), draft = useRef({revision:0,applied:0,source:'',images:[],origin:'rich'}), pending = useRef(null);
  const input = useRef(), imageInput = useRef(), generation = useRef(0);
  const fileToken = useRef(null), fileHandle = useRef(null);
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
  useEffect(()=>{ storage.set('pageport-doc-col',String(leftWidth)); },[leftWidth]);
  useEffect(()=>{ storage.set('pageport-publish-col',String(rightWidth)); },[rightWidth]);
  useEffect(()=>{ storage.set('pageport-doc-open',leftOpen?'1':'0'); },[leftOpen]);
  useEffect(()=>{ storage.set('pageport-publish-open',rightOpen?'1':'0'); },[rightOpen]);
  function invalidate() { setPlan(null); setResult(null); setConfirmTitle(''); setAck(false); }
  function changeDraft(value,origin='rich') {
    draft.current={...draft.current,source:value,revision:draft.current.revision+1,origin};
    setSource(value);setDirty(true);setSync('pending');invalidate();
  }
  async function flushDraft() {
    if(pending.current)return pending.current;
    pending.current=(async()=>{
      const seq=generation.current;
      try {
        while(draft.current.applied!==draft.current.revision) {
          if(seq!==generation.current)return;
          const snapshot={...draft.current};
          setSync('syncing');
          const form=new FormData();
          form.append('document',new File([snapshot.source],'document.md',{type:'text/markdown'}));
          snapshot.images.forEach(image=>form.append('images',image));
          const nextDoc=await api('/convert',{method:'POST',body:form});
          if(seq!==generation.current)return;
          draft.current.applied=snapshot.revision;
          if(snapshot.revision===draft.current.revision) {
            setDocument(nextDoc);
            if(snapshot.origin==='source')setEditorContent(prev=>({html:nextDoc.preview,version:prev.version+1}));
          }
        }
        if(seq===generation.current)setSync('ready');
      } catch(err){if(seq===generation.current){setSync('error');setError(err.message);}throw err;}
      finally {pending.current=null;}
    })();
    return pending.current;
  }
  useEffect(()=>{
    if(sync!=='pending')return;
    const timer=setTimeout(()=>flushDraft().catch(()=>{}),1400);
    return()=>clearTimeout(timer);
  },[source,sync]);
  function exportMarkdown() {
    const link=window.URL.createObjectURL(new Blob([source],{type:'text/markdown;charset=utf-8'}));
    const anchor=window.document.createElement('a');anchor.href=link;anchor.download=(file?.name || 'document').replace(/\.[^.]+$/,'')+'.md';anchor.click();
    setTimeout(()=>window.URL.revokeObjectURL(link),1000);setDirty(false);
  }
  useEffect(()=>{
    const close=e=>{if(dirty){e.preventDefault();e.returnValue='';}};
    const save=e=>{if((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==='s'){e.preventDefault();saveToFile().catch(err=>setError(err.message || '保存失败'));}};
    window.addEventListener('beforeunload',close);window.addEventListener('keydown',save);
    return()=>{window.removeEventListener('beforeunload',close);window.removeEventListener('keydown',save);};
  },[dirty,source,file,document,busy]);
  async function convert(nextFile, nextImages = [], options = {}) {
    if (!nextFile || busy === 'publish') return false;
    if(!options.replace && dirty && !window.confirm('当前修改尚未保存到文件，确定替换此文档？'))return false;
    setBusy('convert');
    try {if(pending.current || draft.current.applied!==draft.current.revision)await flushDraft();}
    catch {setBusy('');return false;}
    const seq = ++generation.current;
    invalidate(); setError(''); setNotice(''); setBusy('convert');
    try {
      const form = new FormData();
      form.append('document',nextFile);
      nextImages.forEach(image=>form.append('images',image));
      const nextDoc = await api('/convert',{method:'POST',body:form});
      if (seq !== generation.current) return false;
      const markdown=/\.(md|markdown)$/i.test(nextFile.name)?nextDoc.source:toMarkdown(nextDoc.preview);
      setFile(nextFile);setImages(nextImages);
      draft.current={revision:0,applied:0,source:markdown,images:nextImages,origin:'rich'};
      setDocument(nextDoc); setSource(markdown);setDirty(false);setSync('ready');
      setEditorContent(prev=>({html:nextDoc.preview,version:prev.version+1}));setTab('preview');
      return true;
    } catch(err) { if(seq === generation.current) setError(err.message); return false; }
    finally { if(seq === generation.current) setBusy(''); }
  }
  const loadDemo = () => convert(new File([demo],'PagePort-format-example.md',{type:'text/markdown'})).then(ok=>{if(ok){fileToken.current=null;fileHandle.current=null;}});
  function closeDocument() {
    if(busy==='publish' || busy==='convert')return;
    if(dirty && !window.confirm('当前修改尚未保存到文件。关闭后这些修改会丢失，确定关闭？'))return;
    generation.current += 1;
    fileToken.current=null;fileHandle.current=null;
    draft.current={revision:0,applied:0,source:'',images:[],origin:'rich'};
    setFile(null);setImages([]);setDocument(null);setSource('');setOutline([]);
    setDirty(false);setSync('ready');setReadOnly(false);setTab('preview');
    setEditorContent({html:'',version:0});
    invalidate();setError('');setNotice('');
  }
  async function saveToFile() {
    if(!document || busy==='publish')return;
    try {if(pending.current || draft.current.applied!==draft.current.revision)await flushDraft();}
    catch {return;}
    const text=draft.current.source;
    const suggested=(file?.name || 'document').replace(/\.[^.]+$/,'')+'.md';
    try {
      if(window.pageportDesktop?.saveDocument) {
        const result=await window.pageportDesktop.saveDocument({token:fileToken.current,name:suggested,text,overwrite:/\.(md|markdown|txt)$/i.test(file?.name || '')});
        if(!result || result.canceled)return;
        if(result.error){setError(result.error);return;}
        fileToken.current=result.token;fileHandle.current=null;
        setFile(new File([text],result.name,{type:'text/markdown'}));
        setDirty(false);setError('');
        setNotice(result.overwritten?`已写回 ${result.name}`:`已另存为 ${result.name}。Word 或 HTML 原件没有被改写。`);
        return;
      }
      if(typeof window.showSaveFilePicker==='function') {
        const handle=await window.showSaveFilePicker({suggestedName:suggested,types:[{description:'Markdown',accept:{'text/markdown':['.md']}}]});
        const writable=await handle.createWritable();
        await writable.write(new Blob([text],{type:'text/markdown'}));
        await writable.close();
        if(/\.(md|markdown|txt)$/i.test(handle.name)){fileHandle.current=handle;fileToken.current=null;setFile(new File([text],handle.name,{type:'text/markdown'}));}
        setDirty(false);setError('');setNotice(`已保存为 ${handle.name}`);
        return;
      }
      exportMarkdown();
      setNotice('已下载 Markdown。浏览器不能直接改写你打开的 Word 原件。');
    } catch(err) {
      if(err?.name==='AbortError')return;
      setError(err.message || '保存失败');
    }
  }
  async function importDocument(options = {}) {
    if(busy)return false;
    if(window.pageportDesktop?.openDocument) {
      const result=await window.pageportDesktop.openDocument();
      if(!result || result.canceled)return false;
      if(result.error){setError(result.error);return false;}
      const ok=await convert(new File([toBytes(result.buffer)],result.name),[],options);
      if(ok){fileToken.current=result.token;fileHandle.current=null;}
      return ok;
    }
    if(typeof window.showOpenFilePicker==='function') {
      try {
        const [handle]=await window.showOpenFilePicker({multiple:false,types:[{description:'文档',accept:{'text/markdown':['.md','.markdown'],'text/html':['.html','.htm'],'text/plain':['.txt'],'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['.docx'],'application/msword':['.doc','.wps']}}]});
        const next=await handle.getFile();
        const ok=await convert(next,[],options);
        if(ok){fileHandle.current=handle;fileToken.current=null;}
        return ok;
      } catch(err) { if(err?.name==='AbortError')return false; }
    }
    input.current.click();
    return false;
  }
  async function refreshFile() {
    if(!file || busy)return;
    if(dirty && !window.confirm('重新读取会丢掉尚未保存的编辑，确定继续？'))return;
    try {
      if(window.pageportDesktop && fileToken.current) {
        const result=await window.pageportDesktop.readDocument(fileToken.current);
        if(!result?.buffer){setError(result?.error || '原文件已不可用，请重新导入。');return;}
        await convert(new File([toBytes(result.buffer)],result.name),images,{replace:true});
        return;
      }
      if(fileHandle.current) {
        await convert(await fileHandle.current.getFile(),images,{replace:true});
        return;
      }
    } catch(err) { setError(err.message || '无法重新读取文件。'); return; }
    setNotice('这份文档没有磁盘路径，请重新选择文件。');
    await importDocument({replace:true});
  }
  function startResize(side, event) {
    if(event.button!==0)return;
    event.preventDefault();
    const startX=event.clientX, start=side==='left'?leftWidth:rightWidth;
    setResizing(true);
    const move=e=>{
      const dx=e.clientX-startX;
      const next=side==='left'?start+dx:start-dx;
      const other=side==='left'?(rightOpen?rightWidth:0):(leftOpen?leftWidth:0);
      const limit=Math.max(side==='left'?180:260,Math.min(side==='left'?420:520,window.innerWidth-other-520));
      const width=Math.min(limit,Math.max(side==='left'?180:260,Math.round(next)));
      if(side==='left')setLeftWidth(width);else setRightWidth(width);
    };
    const stop=()=>{setResizing(false);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',stop);};
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',stop);
    window.addEventListener('pointercancel',stop);
  }
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
    const all = [...list], doc = all.find(f=>/\.(md|markdown|html?|docx|doc|wps|txt)$/i.test(f.name));
    const pics = all.filter(f=>/\.(png|jpe?g|gif|webp)$/i.test(f.name));
    if(doc) convert(doc,pics).then(ok=>{if(ok){fileToken.current=null;fileHandle.current=null;}});
    else if(pics.length && file) {
      const nextImages=[...images,...pics];
      if(document?.blockers.length)convert(file,nextImages);
      else {setImages(nextImages);draft.current.images=nextImages;changeDraft(source,'source');}
    }
    else setError('请选择 Markdown、HTML、Word .docx/.doc、WPS 或纯文本，以及配套图片。');
    setSidebar(false);
  }
  const valid = !!document && !document.blockers.length && !busy && sync==='ready';
  const edited = sync!=='ready';
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
  return <div className={`app-shell ${focus?'focus-mode':''}`} onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();if(!busy && !e.target.closest('.rich-editor'))setDrag(true);}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDrag(false);}} onDrop={e=>{if(!e.dataTransfer.files.length)return;e.preventDefault();setDrag(false);if(!busy)chooseFiles(e.dataTransfer.files);}}>
    <header className="topbar">
      <button className="mobile-menu icon-button" title="打开文档栏" aria-label="打开文档栏" onClick={()=>setSidebar(!sidebar)}><Files size={20}/></button>
      <a href="/" className="brand"><img src="/favicon.svg" alt="" width="32" height="32"/><span>PagePort</span><span className="brand-divider"/><span className="brand-sub">文档发布台</span></a>
      <nav className="top-actions"><span className="engine-status"><span className="status-dot"/>Mark 引擎</span><span className="secure-indicator" title={boot.desktop?'转换与认证均在本机运行，不经过第三方发布服务器':'凭据仅用于本次请求，不保存密码'}><ShieldCheck size={15}/>{boot.desktop?'本机运行':'安全会话'}</span>
        <UpdatePanel/>
        <button className="icon-button" title="清除会话" aria-label="清除会话" onClick={async()=>{if(busy)return;await api('/logout',{method:'POST',json:{}});window.location.reload();}}><LogOut size={17}/></button>
      </nav>
    </header>
    <div className={`workspace${leftOpen?'':' left-collapsed'}${rightOpen?'':' right-collapsed'}${resizing?' is-resizing':''}`} style={{'--doc-col':`${leftWidth}px`,'--publish-col':`${rightWidth}px`}}>
      <aside className={`sidebar ${sidebar?'is-open':''}`}>
        <div className="sidebar-head"><span className="overline">工作区</span><span className="sidebar-head-actions"><button className="icon-button collapse-side" title="收起文档栏，预览区变宽" aria-label="收起文档栏" onClick={()=>setLeftOpen(false)}><PanelLeftClose size={16}/></button><button className="icon-button mobile-close" title="关闭文档栏" aria-label="关闭文档栏" onClick={()=>setSidebar(false)}><PanelLeftClose size={16}/></button></span></div>
        <button className="import-button" title="导入文档。已打开的文档会在确认后被替换。" onClick={()=>importDocument()} disabled={!!busy}><Plus size={17}/>导入文档<span>+</span></button>
        <input ref={input} type="file" className="hidden" accept=".md,.markdown,.html,.htm,.docx,.doc,.wps,.txt,.png,.jpg,.jpeg,.webp,.gif" multiple onChange={e=>{chooseFiles(e.target.files);e.target.value='';}}/>
        <input ref={imageInput} type="file" className="hidden" accept=".png,.jpg,.jpeg,.webp,.gif" multiple onChange={e=>{chooseFiles(e.target.files);e.target.value='';}}/>
        <div className="section-label">当前文档<span>{file? '01':'00'}</span></div>
        {file ? <div className="file-item active"><span className="file-icon"><FileText size={18}/></span><div><strong title={file.name}>{file.name}</strong><small>{formatSize(file.size)}<span>·</span>{document?'已转换':busy==='convert'?'转换中':'待转换'}</small></div><span className="file-actions"><button className="icon-button" title="重新读取磁盘上的文件" aria-label="重新读取文件" disabled={!!busy} onClick={refreshFile}><RefreshCw size={14}/></button><button className="icon-button" title="关闭当前文档，以便编辑另一份" aria-label="关闭当前文档" disabled={busy==='publish' || busy==='convert'} onClick={closeDocument}><X size={14}/></button></span></div> : <div className="sidebar-empty">暂无文档</div>}
        <button className="sidebar-row" title="为 Markdown 中的本地图片补充同名文件" onClick={()=>imageInput.current.click()} disabled={!file || !!busy}><ImagePlus size={16}/><span>配套图片</span><span className="count">{images.length}</span></button>
        {images.length>0 && <div className="image-list">{images.map((image,index)=><div key={`${image.name}-${index}`}><span title={image.name}>{image.name}</span><button className="icon-button" title={`移除 ${image.name}`} aria-label={`移除 ${image.name}`} disabled={!!busy} onClick={()=>{const next=images.filter((_,i)=>i!==index);if(document?.blockers.length)convert(file,next);else {setImages(next);draft.current.images=next;changeDraft(source,'source');}}}><X size={12}/></button></div>)}</div>}
        <div className="sidebar-separator"/>
        <nav className="outline-nav" aria-label="文档大纲">{outline.map((item,i)=><button key={i} style={{paddingLeft:12+(item.level-1)*10}} onClick={()=>{setTab('preview');setReadOnly(false);rich.current?.chain().focus().setTextSelection(item.pos+1).scrollIntoView().run();}}>{item.text || '未命名标题'}</button>)}</nav>
        <button className="sidebar-row" title="查看这次会话已经发布的页面" onClick={()=>setShowHistory(true)}><History size={16}/><span>本次发布记录</span><span className="count">{history.length}</span></button>
        <button className="sidebar-row muted" title="打开内置示例，并替换当前文档" onClick={loadDemo} disabled={!!busy}><FileCode2 size={16}/><span>示例文档</span><ArrowUpRight size={14}/></button>
        <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label="拖动调整文档栏宽度" title="按住左右拖动，改变文档栏宽度" onPointerDown={e=>startResize('left',e)}/>
        <div className="sidebar-bottom"><div className="format-label">支持格式</div><div className="format-list"><span>MD</span><span>HTML</span><span>DOCX</span><span>DOC</span><span>WPS</span><span>TXT</span></div><div className="size-note">单文件 ≤ 10 MB</div><div className="workspace-user"><span className="avatar"><LockKeyhole size={15}/></span><div><strong>{boot.desktop?'本地工作区':'私有工作区'}</strong><small>会话将在 30 分钟后失效</small></div></div></div>
      </aside>
      {sidebar && <button className="sidebar-scrim" aria-label="关闭文档栏" onClick={()=>setSidebar(false)}/>}
      <main className="editor">
        <div className="page-heading"><h1>发布工作区<span className="tag">Confluence 7.6</span></h1><div className="tabs" role="tablist" aria-label="文档视图">
          <button role="tab" aria-selected={tab==='preview'} className={tab==='preview'?'selected':''} onClick={()=>setTab('preview')}><Eye size={15}/>编辑预览</button>
          <button role="tab" aria-selected={tab==='source'} className={tab==='source'?'selected':''} onClick={()=>setTab('source')}><Code2 size={15}/>源文件</button>
          <button role="tab" aria-selected={tab==='checks'} className={tab==='checks'?'selected':''} onClick={()=>setTab('checks')}><ShieldCheck size={15}/>检查项{document && <span className={document.blockers.length?'issue-count':'tab-count'}>{document.warnings.length+document.blockers.length}</span>}</button>
        </div><span className="preview-state" title="编辑会自动更新即将发布的正文。这不会写回原始文件，写回请用「保存到文件」。">{busy==='convert' || sync==='syncing'?<><Loader2 className="spin" size={13}/>同步中</>:document?<><span className="status-dot"/>{sync==='ready'?'发布稿已同步':sync==='error'?'同步失败':'待同步'}</>:null}</span><div className="page-heading-actions">{!leftOpen && !focus && <button className="icon-button desktop-only" title="展开文档栏" aria-label="展开文档栏" onClick={()=>setLeftOpen(true)}><PanelLeftOpen size={18}/></button>}{!rightOpen && !focus && <button className="icon-button desktop-only" title="展开发布栏" aria-label="展开发布栏" onClick={()=>setRightOpen(true)}><PanelRightOpen size={18}/></button>}<button className="small-button heading-action" title="把当前编辑保存成 Markdown 文件。不会改写 Word 或 HTML 原件。" aria-label="保存到文件" disabled={!document || busy==='publish'} onClick={()=>saveToFile().catch(err=>setError(err.message || '保存失败'))}><Download size={15}/><span>保存到文件</span></button><button className="small-button heading-action" title="关闭当前文档，以便编辑另一份" aria-label="关闭当前文档" disabled={!document || busy==='publish' || busy==='convert'} onClick={closeDocument}><X size={15}/><span>关闭</span></button><button className="icon-button" title={focus?'退出专注模式':'专注模式：隐藏两侧栏，预览铺满可用宽度'} aria-label="切换专注模式" onClick={()=>setFocus(!focus)}><PanelLeftClose size={18}/></button></div></div>
        {error && <div className="alert error" role="alert"><XCircle size={17}/><span>{error}</span><button className="icon-button" title="关闭提示" aria-label="关闭提示" onClick={()=>setError('')}><X size={14}/></button></div>}
        {notice && <div className="alert" role="status">{notice}</div>}
        {sync==='error' && <div className="sync-error"><span>修改仍保留在编辑器中，发布已暂停。</span><button className="small-button" onClick={()=>flushDraft().catch(()=>{})}><RefreshCw size={13}/>重试同步</button></div>}
        <div className="document-area">
          {busy==='convert'?<div className="document-loading"><Loader2 className="spin" size={26}/><h2>正在转换文档</h2><span>准备页面内容与配套图片</span></div>:!document?<button className="empty-upload" onClick={()=>importDocument()}><CloudUpload size={36}/><h2>选择文档</h2><span>Markdown / HTML / Word / WPS / TXT</span></button>:
            <><div className="preview-page" style={{display:tab==='preview'?'':'none'}}><div className="preview-page-head"><span title={readOnly?'这是本地近似预览，不是 Confluence 官方页面。字体、宏外观和站点主题以目标页面为准。':'这里改的是本地正文。约 1 秒后更新发布稿；写回磁盘请点「保存到文件」。'}><span className="confluence-mark">{readOnly?'C':'编'}</span>{readOnly?'近似预览':'正在编辑'}</span><div className="editor-mode-tools"><button className="small-button" title={readOnly?'返回编辑，继续修改正文':'查看即将发布的正文。版式只是近似，和 Confluence 站点不会完全一致。'} onClick={()=>setReadOnly(!readOnly)}>{readOnly?'返回编辑':'发布预览'}</button></div></div><div className="preview-body" style={{display:readOnly?'none':''}}><RichEditor key={generation.current} content={editorContent.html} contentVersion={editorContent.version} disabled={!!busy || !!document.blockers.length} onChange={({source})=>changeDraft(source)} onError={setError} onReady={editor=>{rich.current=editor;}} onOutline={setOutline}/></div>{readOnly && <iframe title="Confluence 文档预览" sandbox="allow-same-origin" srcDoc={makeSrcDoc(document.preview)}/>}</div>
            {tab==='source'?<div className="source-view"><div className="source-toolbar"><span>Markdown{dirty?' · 未导出':''}</span><button className="small-button" disabled={!edited || !!busy} onClick={()=>flushDraft().catch(()=>{})}><RefreshCw size={13}/>立即同步</button></div><textarea aria-label="文档源文件" spellCheck={false} value={source} disabled={!!busy} onChange={e=>changeDraft(e.target.value,'source')}/></div>:tab==='checks'?
            <div className="checks-view"><h2>转换检查</h2><div className="checks-intro">{document.blockers.length?'有待处理的阻断项':'转换完成，可继续核对目标页面'}</div>
              <div className="check-row"><CheckCircle2 size={18}/><div><strong>内容结构</strong><p>{document.stats.headings} 个标题 · {document.stats.tables} 个表格 · {document.stats.images} 张图片</p></div></div>
              <div className="check-row"><CheckCircle2 size={18}/><div><strong>预览与发布使用同一份转换结果</strong><p>已清理可执行内容，代码块使用兼容显示。</p></div></div>
              {document.blockers.map((message,i)=><div className="check-row blocked" key={`b${i}`}><XCircle size={18}/><div><strong>需要处理</strong><p>{message}</p></div></div>)}
              {document.warnings.map((message,i)=><div className="check-row warning" key={`w${i}`}><TriangleAlert size={18}/><div><strong>请核对</strong><p>{message}</p></div></div>)}
              <div className="check-row warning"><TriangleAlert size={18}/><div><strong>格式保真边界</strong><p>预览不是 Confluence 官方渲染器。文字、标题、表格和图片会按发布稿核对；字体、间距、宏外观和站点主题仍以目标页面为准。</p></div></div>
            </div>:null}</>}
        </div>
        <footer className="document-footer"><span><FileText size={13}/>{document?`${document.stats.characters.toLocaleString()} 字符`:'未导入'}<span className="footer-divider"/> {document?.stats.tables || 0} 个表格<span className="footer-divider"/>{document?.stats.images || 0} 张图片</span><span>UTF-8<span className="footer-divider"/>兼容模式</span></footer>
      </main>
      <aside className="publish-panel">
        <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label="拖动调整发布栏宽度" title="按住左右拖动，改变发布栏宽度" onPointerDown={e=>startResize('right',e)}/>
        <div className="panel-scroll">
        <div className="publish-heading"><div className="publish-icon"><Send size={17}/></div><h2>发布到 Confluence</h2><button className="icon-button collapse-publish" title="收起发布栏，预览区变宽" aria-label="收起发布栏" onClick={()=>setRightOpen(false)}><PanelRightClose size={16}/></button></div>
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
        {edited && <p className="inline-warning">修改同步完成后可检查发布。</p>}
        {document?.blockers.length>0 && <button className="inline-warning text-link" onClick={()=>setTab('checks')}>有 {document.blockers.length} 项内容需要处理<ChevronRight size={13}/></button>}
        {plan && <div className="target-result"><div className="target-result-head"><CheckCircle2 size={15}/><span>读取成功</span><small>{remaining?`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`:'已过期'}</small></div><h3>{plan.target.title}</h3><dl><div><dt>空间</dt><dd>{plan.target.space}</dd></div><div><dt>当前版本</dt><dd>v{plan.target.version}</dd></div><div><dt>原正文</dt><dd>{plan.target.characters} 字符</dd></div></dl>
          {plan.target.warnings.map((warning,i)=><p className="inline-warning" key={i}>{warning}</p>)}
          {plan.target.excerpt && <details><summary>查看原正文摘要<ChevronDown size={12}/></summary><p>{plan.target.excerpt}</p></details>}
          <button className="text-link backup-download" onClick={()=>download(`/backups/${plan.token}`,`confluence-${plan.target.id}-v${plan.target.version}.json`)}><Download size={13}/>下载修改前备份</button>
        </div>}
        {result && <div className="success-result" role="status"><CheckCircle2 size={25}/><h3>发布完成</h3><p>{result.title} · v{result.version}</p><span>{result.verification==='matched'?'正文结构回读核对通过':'请打开目标页面核对最终显示'}</span><a href={result.url} target="_blank" rel="noreferrer">打开 Confluence<ArrowUpRight size={14}/></a></div>}
        <div className="publish-bottom"><div className="publish-safety"><ShieldCheck size={15}/><span>发布前备份原文，并检查线上版本</span></div><button className="primary publish-button" disabled={!checked || !!busy} onClick={()=>{setConfirmTitle('');setAck(false);setModal(true);}}><Send size={16}/>确认发布<ArrowRight size={16}/></button><div className="final-note">发布将替换目标页面的正文</div></div>
        </div>
      </aside>
    </div>
    {drag && <div className="drop-overlay"><CloudUpload size={44}/><h2>松开以上传文档或配套图片</h2><span>单文件最大 10 MB</span></div>}
    {modal && <div className="modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-heading"><button className="modal-close icon-button" title="关闭" aria-label="关闭" disabled={busy==='publish'} onClick={()=>setModal(false)}><X size={19}/></button><span className="modal-emblem"><Send size={22}/></span><h2 id="confirm-heading">确认替换页面正文</h2><p className="modal-subtitle">将更新已有页面，不会创建副本。</p><div className="confirm-target"><span>目标页面</span><strong>{plan?.target.title}</strong><a href={plan?.url} target="_blank" rel="noreferrer">查看页面<ArrowUpRight size={13}/></a></div>
      <label htmlFor="confirm-title">输入页面标题以确认</label><input id="confirm-title" autoFocus value={confirmTitle} disabled={busy==='publish'} onChange={e=>setConfirmTitle(e.target.value)} autoComplete="off"/>
      <label className="checkbox-label"><input type="checkbox" checked={ack} disabled={busy==='publish'} onChange={e=>setAck(e.target.checked)}/><span>我已核对文档预览及兼容性提示，确认替换目标正文。</span></label>
      <div className="modal-actions"><button className="secondary" disabled={busy==='publish'} onClick={()=>setModal(false)}>取消</button><button className="primary" disabled={!checked || !ack || confirmTitle!==plan?.target.title || !!busy} onClick={publish}>{busy==='publish'?<Loader2 className="spin" size={16}/>:<Send size={16}/>}备份并发布</button></div></section></div>}
    {showHistory && <div className="modal-overlay"><section className="modal history-modal" role="dialog" aria-modal="true" aria-labelledby="history-heading"><button className="modal-close icon-button" title="关闭" aria-label="关闭" onClick={()=>setShowHistory(false)}><X size={19}/></button><History size={23}/><h2 id="history-heading">本次发布记录</h2>{history.length?history.map((item,i)=><a className="history-row" key={i} href={item.url} target="_blank" rel="noreferrer"><CheckCircle2 size={17}/><span><strong>{item.title}</strong><small>v{item.version} · {item.time}</small></span><ArrowUpRight size={15}/></a>):<p className="history-empty">本次会话暂无发布记录</p>}</section></div>}
    <HoverTip/>
  </div>;
}

createRoot(window.document.getElementById('root')).render(<App/>);
