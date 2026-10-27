import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive, ChevronRight, Download, FileCode2, FolderOpen, History,
  LogOut, RefreshCw, RotateCcw, Save, Settings, ShieldAlert, SlidersHorizontal, X,
} from 'lucide-react';
import UpdatePanel from './UpdatePanel.jsx';

const presetRetention = new Set(['0', '1', '3', '7', '14', '30', '90']);
const dateText = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知时间' : date.toLocaleString('zh-CN', {year:'numeric', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
};
const sizeText = size => size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round((size || 0) / 1024))} KB`;

function BackupPanel({ active, api, restoreDefaults = {} }) {
  const [items, setItems] = useState([]), [retentionChoice, setRetentionChoice] = useState('7');
  const [customDays, setCustomDays] = useState(''), [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [restore, setRestore] = useState(null), [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreFields, setRestoreFields] = useState({url:'', username:'', password:'', title:''});
  const apiRef = useRef(api); apiRef.current = api;

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const list = await apiRef.current('/backups');
      const settings = await apiRef.current('/backup-settings').catch(() => ({}));
      const days = Object.prototype.hasOwnProperty.call(settings, 'retentionDays') ? settings.retentionDays : (Object.prototype.hasOwnProperty.call(list, 'retentionDays') ? list.retentionDays : 7);
      const value = days === null ? '0' : String(days ?? 7);
      setItems(Array.isArray(list.items) ? list.items : []);
      if (presetRetention.has(value)) { setRetentionChoice(value); setCustomDays(''); }
      else { setRetentionChoice('custom'); setCustomDays(value); }
    } catch (err) { setError(err.message || '无法读取本机备份。'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (active) load(); }, [active, load]);

  const openFolder = async () => {
    setError(''); setNotice('');
    try {
      if (window.pageportDesktop?.openBackups) {
        const result = await window.pageportDesktop.openBackups();
        if (result?.error) throw new Error(result.error);
        setNotice('已打开本机备份文件夹。');
      } else setNotice('请使用 PagePort 菜单 → 打开备份文件夹。');
    } catch (err) { setError(err.message || '无法打开本机备份文件夹。'); }
  };
  const download = async item => {
    setError('');
    try {
      const response = await fetch(`/api/backups/${encodeURIComponent(item.name)}/download`);
      if (!response.ok) throw new Error('备份文件暂时不可用。');
      const blob = await response.blob(), link = window.URL.createObjectURL(blob), anchor = window.document.createElement('a');
      anchor.href = link; anchor.download = item.name; anchor.click();
      setTimeout(() => window.URL.revokeObjectURL(link), 1000);
    } catch (err) { setError(err.message || '下载备份失败。'); }
  };
  const saveRetention = async () => {
    const raw = retentionChoice === 'custom' ? customDays : retentionChoice;
    const days = Number(raw);
    const valid = retentionChoice === 'custom'
      ? Number.isInteger(days) && days >= 1 && days <= 3650
      : Number.isInteger(days) && (days === 0 || (days >= 1 && days <= 3650));
    if (!valid) { setError('请输入 1–3650 的整数天数，或选择不自动删除。'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      await apiRef.current('/backup-settings', {method:'PUT', json:{retentionDays: days}});
      setNotice(days === 0 ? '已设置为不自动删除备份。' : `已设置为自动删除 ${days} 天前的备份。`);
      await load();
    } catch (err) { setError(err.message || '保存保留策略失败。'); }
    finally { setSaving(false); }
  };
  const beginRestore = item => {
    setRestore(item); setError(''); setNotice('');
    setRestoreFields({url:restoreDefaults.url || '', username:restoreDefaults.username || '', password:restoreDefaults.password || '', title:''});
  };
  const cancelRestore = () => { if (restoreBusy) return; setRestore(null); setRestoreFields(fields => ({...fields, password:''})); };
  const restoreBackup = async event => {
    event.preventDefault();
    if (!restore || restoreBusy) return;
    if (!restoreFields.url || !restoreFields.username || !restoreFields.password || !restoreFields.title) {
      setError('请填写完整认证信息，并输入目标页面标题。'); return;
    }
    setRestoreBusy(true); setError(''); setNotice('');
    try {
      // Snapshot the current target before executing the restore. The server
      // rejects the second step if the page changes while confirmation is open.
      const checked = await apiRef.current(`/backups/${encodeURIComponent(restore.name)}/restore-check`, {
        method:'POST', json:{url:restoreFields.url, username:restoreFields.username, password:restoreFields.password},
      });
      const targetTitle = checked.target?.title || '';
      if (restoreFields.title !== targetTitle) {
        setError(`标题不匹配。请准确输入目标页面当前标题：${targetTitle || '（无法读取）'}`);
        return;
      }
      const data = await apiRef.current(`/backups/${encodeURIComponent(restore.name)}/restore`, {
        method:'POST', json:{token:checked.token, username:restoreFields.username, password:restoreFields.password,
          confirmTitle:restoreFields.title, acknowledge:true},
      });
      setRestore(null); setRestoreFields(fields => ({...fields, password:''}));
      setNotice(`已恢复「${data.title || restore.title}」到 v${data.version || '新版本'}。${data.verification === 'matched' ? '正文回读核对通过。' : ''}`);
      await load();
    } catch (err) { setError(err.message || '恢复备份失败。'); }
    finally { setRestoreBusy(false); }
  };

  return <div className="backup-content">
    <div className="backup-overview"><div><h3>本机页面备份</h3><p>发布前自动保存的原文快照，仅保留在本机，不会上传到第三方。</p></div><button className="small-button backup-open-folder" onClick={openFolder}><FolderOpen size={15}/>打开备份文件夹</button></div>
    {error && <p className="backup-message backup-error" role="alert">{error}</p>}
    {notice && <p className="backup-message" role="status">{notice}</p>}
    <section className="backup-retention"><div className="backup-section-heading"><div><strong>自动清理</strong><p>默认 7 天；升级前已有的备份不会被自动删除，保存后按规则清理。</p></div><RefreshCw size={16}/></div>
      <div className="backup-retention-controls"><label htmlFor="backup-retention">保留时间</label><select id="backup-retention" value={retentionChoice} disabled={saving} onChange={event => setRetentionChoice(event.target.value)}><option value="7">7 天（默认）</option><option value="1">1 天</option><option value="3">3 天</option><option value="14">14 天</option><option value="30">30 天</option><option value="90">90 天</option><option value="0">不自动删除</option><option value="custom">自定义天数…</option></select>{retentionChoice === 'custom' && <input aria-label="自定义保留天数" type="number" min="1" max="3650" value={customDays} disabled={saving} placeholder="天数" onChange={event => setCustomDays(event.target.value)}/>}<button className="small-button backup-save" disabled={saving} onClick={saveRetention}>{saving ? <RefreshCw className="spin" size={14}/> : <Save size={14}/>}保存</button></div>
    </section>
    <section className="backup-list"><div className="backup-section-heading"><div><strong>已保存备份</strong><p>{items.length ? `共 ${items.length} 份，恢复前会再次检查目标页面版本。` : '发布后备份会出现在这里。'}</p></div><button className="icon-button" aria-label="刷新备份列表" title="刷新" onClick={load} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={16}/></button></div>
      {loading && !items.length ? <p className="backup-empty">正在读取备份列表…</p> : items.length ? <div className="backup-items">{items.map(item => <article className="backup-item" key={item.name}><div className="backup-item-info"><strong title={item.title || item.name}>{item.title || `页面 ${item.id}`}</strong><small>v{item.version} · {dateText(item.createdAt)} · {sizeText(item.size)}</small><code title={item.name}>{item.name}</code></div><div className="backup-item-actions"><button className="small-button" onClick={() => download(item)}><Download size={14}/>下载</button><button className="small-button backup-restore" onClick={() => beginRestore(item)}><RotateCcw size={14}/>恢复</button></div></article>)}</div> : <p className="backup-empty">暂无本机备份。完成一次发布后，发布前原文会自动保存。</p>}
    </section>
    {restore && <div className="backup-confirm" role="dialog" aria-modal="true" aria-labelledby="backup-restore-heading"><div className="backup-confirm-heading"><ShieldAlert size={20}/><div><h3 id="backup-restore-heading">确认恢复备份</h3><p>{restore.title || restore.name} · 发布前版本 v{restore.version}</p></div></div><p className="backup-confirm-warning">恢复会替换目标页面的完整正文。系统会重新读取线上页面并检查版本，发生变化时会停止操作。</p><form onSubmit={restoreBackup}><label htmlFor="restore-url">目标页面链接</label><input id="restore-url" autoFocus type="url" value={restoreFields.url} onChange={event => setRestoreFields({...restoreFields,url:event.target.value})} required/><label htmlFor="restore-username">登录账号</label><input id="restore-username" value={restoreFields.username} autoComplete="off" onChange={event => setRestoreFields({...restoreFields,username:event.target.value})} required/><label htmlFor="restore-password">密码</label><input id="restore-password" type="password" value={restoreFields.password} autoComplete="new-password" onChange={event => setRestoreFields({...restoreFields,password:event.target.value})} required/><label htmlFor="restore-title">输入目标页面当前标题以确认</label><input id="restore-title" value={restoreFields.title} autoComplete="off" onChange={event => setRestoreFields({...restoreFields,title:event.target.value})} required/><label className="checkbox-label"><input type="checkbox" required/><span>我确认要用这份备份替换目标页面正文。</span></label><div className="modal-actions"><button type="button" className="secondary" disabled={restoreBusy} onClick={cancelRestore}>取消</button><button type="submit" className="primary" disabled={restoreBusy}>{restoreBusy ? <RefreshCw className="spin" size={15}/> : <RotateCcw size={15}/>}恢复并核对</button></div></form></div>}
  </div>;
}

export default function SettingsPanel({ busy, historyCount, onDemo, onHistory, onLogout, api, restoreDefaults }) {
  const [visible, setVisible] = useState(false), [tab, setTab] = useState('general');
  const [available, setAvailable] = useState(false);
  const dialog = useRef(null), trigger = useRef(null);
  const hasUpdates = !!window.pageportDesktop?.updates;
  const openUpdates = useCallback(() => { setTab('updates'); setVisible(true); }, []);
  const openBackups = useCallback(() => { setTab('backups'); setVisible(true); }, []);
  useEffect(() => {
    if (!visible) return;
    const previous = window.document.activeElement;
    dialog.current?.querySelector('[aria-label="关闭设置"]')?.focus();
    const key = event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); setVisible(false);
      }
      if (event.key === 'Tab') {
        const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')]
          .filter(element => element.tabIndex >= 0 && element.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      (previous?.isConnected && previous !== window.document.body && previous.getClientRects().length ? previous : trigger.current)?.focus();
    };
  }, [visible]);
  const action = callback => { setVisible(false); callback(); };
  return <>
    <button className="backup-trigger" title="查看、下载和恢复本机页面备份" aria-label="本机备份" aria-haspopup="dialog" aria-expanded={visible && tab === 'backups'} onClick={openBackups}><Archive size={16}/><span>本机备份</span></button>
    <button ref={trigger} className={`icon-button settings-trigger${available ? ' has-update' : ''}`} title={available ? '设置 · 有新版本' : '设置'} aria-label="设置" aria-haspopup="dialog" aria-expanded={visible} onClick={() => { setTab('general'); setVisible(true); }}>
      <Settings size={18}/>{available && <span className="update-dot"/>}
    </button>
    {createPortal(<div className="modal-overlay settings-overlay" hidden={!visible} onMouseDown={event => {
      if (event.target === event.currentTarget) setVisible(false);
    }}>
      <section ref={dialog} className={`modal settings-modal${tab === 'updates' ? ' update-modal' : ''}${tab === 'backups' ? ' backup-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="settings-heading">
        <button className="modal-close icon-button" aria-label="关闭设置" title="关闭" onClick={() => setVisible(false)}><X size={19}/></button>
        <h2 id="settings-heading">设置</h2>
        <div className="settings-tabs" role="tablist" aria-label="设置分类" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const buttons = [...event.currentTarget.querySelectorAll('[role="tab"]')];
          const index = buttons.indexOf(window.document.activeElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next].click(); buttons[next].focus();
        }}>
          <button id="settings-general-tab" role="tab" tabIndex={tab === 'general' ? 0 : -1} aria-selected={tab === 'general'} aria-controls="settings-general" onClick={() => setTab('general')}><SlidersHorizontal size={15}/>通用</button>
          <button id="settings-backups-tab" role="tab" tabIndex={tab === 'backups' ? 0 : -1} aria-selected={tab === 'backups'} aria-controls="settings-backups" onClick={() => setTab('backups')}><Archive size={15}/>本机备份</button>
          {hasUpdates && <button id="settings-updates-tab" role="tab" tabIndex={tab === 'updates' ? 0 : -1} aria-selected={tab === 'updates'} aria-controls="settings-updates" onClick={() => setTab('updates')}><RefreshCw size={15}/>软件更新{available && <span className="settings-update-badge">新版本</span>}</button>}
        </div>
        <div id="settings-general" role="tabpanel" aria-labelledby="settings-general-tab" hidden={tab !== 'general'}>
          <h3 className="settings-section-title">工作区</h3>
          <button className="settings-row" disabled={busy} onClick={() => action(onDemo)}><FileCode2 size={18}/><span>打开示例文档</span><ChevronRight size={16}/></button>
          <button className="settings-row" onClick={() => action(onHistory)}><History size={18}/><span>本次发布记录</span><small>{historyCount}</small><ChevronRight size={16}/></button>
          <button className="settings-row backup-settings-row" onClick={openBackups}><Archive size={18}/><span>本机备份</span><small>查看与恢复</small><ChevronRight size={16}/></button>
          <h3 className="settings-section-title">会话</h3>
          <button className="settings-row" disabled={busy} onClick={() => action(onLogout)}><LogOut size={18}/><span>清除会话</span><ChevronRight size={16}/></button>
        </div>
        <div id="settings-backups" role="tabpanel" aria-labelledby="settings-backups-tab" hidden={tab !== 'backups'}><BackupPanel active={visible && tab === 'backups'} api={api} restoreDefaults={restoreDefaults}/></div>
        {hasUpdates && <div id="settings-updates" role="tabpanel" aria-labelledby="settings-updates-tab" hidden={tab !== 'updates'}><UpdatePanel onRequestOpen={openUpdates} onAvailability={setAvailable}/></div>}
      </section>
    </div>, window.document.body)}
  </>;
}

export { BackupPanel };
