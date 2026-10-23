import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, FileCode2, History, LogOut, RefreshCw, Settings, SlidersHorizontal, X } from 'lucide-react';
import UpdatePanel from './UpdatePanel.jsx';

export default function SettingsPanel({ busy, historyCount, onDemo, onHistory, onLogout }) {
  const [visible, setVisible] = useState(false), [tab, setTab] = useState('general');
  const [available, setAvailable] = useState(false);
  const dialog = useRef(null), trigger = useRef(null);
  const hasUpdates = !!window.pageportDesktop?.updates;
  const openUpdates = useCallback(() => { setTab('updates'); setVisible(true); }, []);
  useEffect(() => {
    if (!visible) return;
    const previous = window.document.activeElement;
    dialog.current?.querySelector('[aria-label="关闭设置"]')?.focus();
    const key = event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); setVisible(false);
      }
      if (event.key === 'Tab') {
        const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
          .filter(element => element.tabIndex >= 0 && element.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      (previous?.isConnected && previous !== window.document.body && previous.getClientRects().length
        ? previous : trigger.current)?.focus();
    };
  }, [visible]);
  const action = callback => { setVisible(false); callback(); };
  return <>
    <button ref={trigger} className={`icon-button settings-trigger${available ? ' has-update' : ''}`}
      title={available ? '设置 · 有新版本' : '设置'} aria-label="设置" aria-haspopup="dialog" aria-expanded={visible}
      onClick={() => { setTab('general'); setVisible(true); }}>
      <Settings size={18}/>{available && <span className="update-dot"/>}
    </button>
    {createPortal(<div className="modal-overlay settings-overlay" hidden={!visible} onMouseDown={event => {
      if (event.target === event.currentTarget) setVisible(false);
    }}>
      <section ref={dialog} className={`modal settings-modal${tab === 'updates' ? ' update-modal' : ''}`}
        role="dialog" aria-modal="true" aria-labelledby="settings-heading">
        <button className="modal-close icon-button" aria-label="关闭设置" title="关闭" onClick={() => setVisible(false)}><X size={19}/></button>
        <h2 id="settings-heading">设置</h2>
        <div className="settings-tabs" role="tablist" aria-label="设置分类" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const buttons = [...event.currentTarget.querySelectorAll('[role="tab"]')];
          const index = buttons.indexOf(window.document.activeElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next].click(); buttons[next].focus();
        }}>
          <button id="settings-general-tab" role="tab" tabIndex={tab === 'general' ? 0 : -1} aria-selected={tab === 'general'} aria-controls="settings-general"
            onClick={() => setTab('general')}><SlidersHorizontal size={15}/>通用</button>
          {hasUpdates && <button id="settings-updates-tab" role="tab" tabIndex={tab === 'updates' ? 0 : -1} aria-selected={tab === 'updates'} aria-controls="settings-updates"
            onClick={() => setTab('updates')}><RefreshCw size={15}/>软件更新{available && <span className="settings-update-badge">新版本</span>}</button>}
        </div>
        <div id="settings-general" role="tabpanel" aria-labelledby="settings-general-tab" hidden={tab !== 'general'}>
          <h3 className="settings-section-title">工作区</h3>
          <button className="settings-row" disabled={busy} onClick={() => action(onDemo)}><FileCode2 size={18}/><span>打开示例文档</span><ChevronRight size={16}/></button>
          <button className="settings-row" onClick={() => action(onHistory)}><History size={18}/><span>本次发布记录</span><small>{historyCount}</small><ChevronRight size={16}/></button>
          <h3 className="settings-section-title">会话</h3>
          <button className="settings-row" disabled={busy} onClick={() => action(onLogout)}><LogOut size={18}/><span>清除会话</span><ChevronRight size={16}/></button>
        </div>
        {hasUpdates && <div id="settings-updates" role="tabpanel" aria-labelledby="settings-updates-tab" hidden={tab !== 'updates'}>
          <UpdatePanel onRequestOpen={openUpdates} onAvailability={setAvailable}/>
        </div>}
      </section>
    </div>, window.document.body)}
  </>;
}
