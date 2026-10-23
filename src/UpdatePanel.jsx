import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Download, FolderOpen, Loader2, RefreshCw, X } from 'lucide-react';

export default function UpdatePanel() {
  const desktop = window.pageportDesktop;
  const [state, setState] = useState(null), [visible, setVisible] = useState(false);
  const dialog = useRef(null), trigger = useRef(null);
  useEffect(() => {
    if (!desktop?.updates) return;
    let live = true;
    desktop.updates.state().then(value => { if (live) setState(value); });
    const unsubscribe = desktop.updates.subscribe(value => { setState(value); if (value.show) setVisible(true); });
    return () => { live = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!visible) return;
    const previous = window.document.activeElement;
    dialog.current?.querySelector('button')?.focus();
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setVisible(false); }
      if (event.key === 'Tab') {
        const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); (previous?.isConnected ? previous : trigger.current)?.focus(); };
  }, [visible]);
  if (!state) return null;
  const checking = state.status === 'checking', downloading = state.status === 'downloading';
  const available = state.available && state.status !== 'current';
  const command = async action => {
    try { setState(await desktop.updates[action]()); }
    catch { setState(value => ({ ...value, error: '更新操作未完成，请重试。' })); }
  };
  return <>
    <button ref={trigger} className={`icon-button update-trigger${available ? ' has-update' : ''}`}
      aria-label={available ? `发现新版本 ${state.version}` : '检查更新'} title={available ? `发现新版本 ${state.version}` : `检查更新 · 当前 ${state.currentVersion}`}
      onClick={() => { setVisible(true); if (state.status === 'idle') command('check'); }}>
      {checking ? <Loader2 size={17} className="spin"/> : <Download size={17}/>}
      {available && <span className="update-dot"/>}
    </button>
    {visible && <div className="modal-overlay update-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setVisible(false); }}>
      <section ref={dialog} className="modal update-modal" role="dialog" aria-modal="true" aria-labelledby="update-heading">
        <button className="modal-close icon-button" aria-label="关闭更新" title="关闭" onClick={() => setVisible(false)}><X size={19}/></button>
        <img src="/favicon.svg" width="40" height="40" alt="PagePort"/>
        <h2 id="update-heading">{checking ? '正在检查更新' : available ? `PagePort ${state.version}` : state.status === 'current' ? '已是最新版本' : '检查更新'}</h2>
        <p className="modal-subtitle">当前版本 {state.currentVersion}{state.publishedAt && available ? ` · 发布于 ${new Date(state.publishedAt).toLocaleDateString('zh-CN')}` : ''}</p>
        {available && state.notes && <pre className="update-notes">{state.notes}</pre>}
        {state.error && <p className="update-error" role="alert">{state.error}</p>}
        {downloading && <div className="update-progress"><progress aria-label="安装包下载进度" max="100" value={state.progress}/><span role="status">{state.progress}%</span></div>}
        {state.status === 'downloaded' && <p className="update-verified" role="status"><CheckCircle2 size={16}/>安装包 SHA-256 校验通过</p>}
        {available && <p className="update-install-note">安装前请保存文档并正常退出 PagePort。更新不会清除本机页面备份。</p>}
        <label className="checkbox-label update-preference"><input type="checkbox" checked={state.automatic !== false} onChange={async event => {
          try { setState(await desktop.updates.configure(event.target.checked)); }
          catch { setState(value => ({ ...value, error: '无法保存更新设置。' })); }
        }}/><span>自动检查更新</span></label>
        <div className="modal-actions">
          <button className="secondary" onClick={() => setVisible(false)}>稍后</button>
          {available && state.installer && <button className="small-button" onClick={() => command('release')}><ArrowUpRight size={15}/>发布页</button>}
          <button className="small-button" disabled={checking || downloading} onClick={() => command('check')}><RefreshCw size={15}/>重新检查</button>
          {available ? state.status === 'downloaded'
            ? <button className="primary" onClick={() => command('reveal')}><FolderOpen size={16}/>查看安装包</button>
            : state.installer
              ? <button className="primary" disabled={state.status !== 'available'} onClick={() => command('download')}>{downloading ? <Loader2 size={16} className="spin"/> : <Download size={16}/>}下载安装包</button>
              : <button className="primary" disabled={checking} onClick={() => command('release')}><ArrowUpRight size={16}/>前往发布页</button>
            : null}
        </div>
      </section>
    </div>}
  </>;
}
