import React, { useEffect, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Download, FolderOpen, Loader2, RefreshCw } from 'lucide-react';

export default function UpdatePanel({ onRequestOpen, onAvailability }) {
  const desktop = window.pageportDesktop;
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!desktop?.updates) return;
    let live = true;
    desktop.updates.state().then(value => { if (live) setState(value); });
    const unsubscribe = desktop.updates.subscribe(value => { if (live) { setState(value); if (value.show) onRequestOpen(); } });
    return () => { live = false; unsubscribe(); };
  }, [onRequestOpen]);
  useEffect(() => {
    onAvailability(!!state?.available && state.status !== 'current');
  }, [state?.available, state?.status, onAvailability]);
  if (!state) return <p className="modal-subtitle" role="status">正在读取更新信息…</p>;
  const checking = state.status === 'checking', downloading = state.status === 'downloading';
  const available = state.available && state.status !== 'current';
  const command = async action => {
    try { setState(await desktop.updates[action]()); }
    catch { setState(value => ({ ...value, error: '更新操作未完成，请重试。' })); }
  };
  return <div className="update-content">
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
          {available && state.installer && <button className="small-button" onClick={() => command('release')}><ArrowUpRight size={15}/>发布页</button>}
          <button className={available ? 'small-button' : 'primary'} aria-label="检查更新" disabled={checking || downloading} onClick={() => command('check')}>
            {checking ? <Loader2 className="spin" size={15}/> : <RefreshCw size={15}/>}检查更新</button>
          {available ? state.status === 'downloaded'
            ? <button className="primary" onClick={() => command('reveal')}><FolderOpen size={16}/>查看安装包</button>
            : state.installer
              ? <button className="primary" disabled={state.status !== 'available'} onClick={() => command('download')}>{downloading ? <Loader2 size={16} className="spin"/> : <Download size={16}/>}下载安装包</button>
              : <button className="primary" disabled={checking} onClick={() => command('release')}><ArrowUpRight size={16}/>前往发布页</button>
            : null}
        </div>
  </div>;
}
