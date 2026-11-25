function canRetryLocally(route, method) {
  if (method === 'PUT') return route === '/backup-settings';
  if (method !== 'POST') return false;
  return ['/convert','/convert?allowEmpty=1','/documents/blank','/logout'].includes(route) ||
    /^\/(?:backups\/[^/]+\/open|documents\/[^/]+\/export\/docx?)$/.test(route);
}

export function createWorkspaceApi({ fetcher = fetch, onRecovery = () => {} } = {}) {
  let state, bootstrapping, recovering;

  function bootstrap() {
    if (!bootstrapping) {
      bootstrapping = (async () => {
        const response = await fetcher('/api/bootstrap');
        const data = await response.json();
        if (!response.ok || typeof data?.csrf !== 'string' || !data.csrf) {
          throw new Error('无法连接本地工作区，请重试。');
        }
        state = data;
        return data;
      })().finally(() => { bootstrapping = undefined; });
    }
    return bootstrapping;
  }

  async function api(route, { json, raw, ...options } = {}) {
    const send = csrf => fetcher(`/api${route}`, {
      ...options,
      headers: { 'X-CSRF-Token': csrf, ...(json ? {'Content-Type':'application/json'} : {}), ...options.headers },
      ...(json ? {body:JSON.stringify(json)} : {}),
    });
    const initial = state;
    let response = await send(initial?.csrf);
    let data = response.ok && raw ? null : await response.json().catch(() => null);
    if (initial?.desktop && response.status === 403 && data?.code === 'DESKTOP_SESSION_EXPIRED') {
      try {
        if (!recovering && state === initial) {
          recovering = bootstrap().then(next => {
            if (!next.desktop || !next.authenticated) throw new Error('Expected a desktop session.');
            onRecovery();
          }).finally(() => { recovering = undefined; });
        }
        await recovering;
        if (!state?.desktop || !state.authenticated) throw new Error('Expected a desktop session.');
      } catch {
        throw new Error('暂时无法恢复本地工作区。编辑仍在当前窗口，请重试。');
      }
      const method = options.method || 'GET';
      if (!canRetryLocally(route, method)) {
        if (route === '/publish') throw new Error('本地会话已恢复，本次未发布。请重新核对目标页面，再确认发布。');
        if (route === '/check') throw new Error('本地会话已恢复，请重新检查目标页面。');
        throw new Error('本地会话已恢复，请重新操作。');
      }
      response = await send(state.csrf);
      data = response.ok && raw ? null : await response.json().catch(() => null);
    }
    if (!response.ok) throw new Error(data?.error || '请求失败，请稍后再试。');
    return raw ? response : data;
  }

  return { api, bootstrap };
}
