import { AppError, hash } from './convert.js';
import { load } from 'cheerio';

export function parseTarget(input, allowedHosts = []) {
  let url;
  try { url = new URL(input); } catch { throw new AppError('请输入完整的 Confluence 页面链接。'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowedHosts.includes(url.hostname)) {
    throw new AppError(`仅允许 HTTPS 页面：${allowedHosts.join('、')}。`);
  }
  let id = url.pathname === '/pages/viewpage.action' ? url.searchParams.get('pageId') : url.pathname.match(/^\/spaces\/[^/]+\/pages\/(\d+)(?:\/.*)?$/)?.[1];
  if (!/^\d{1,20}$/.test(id || '')) throw new AppError('无法识别页面 ID，请使用包含 pageId 的页面链接。');
  return { id, origin: url.origin, url: `${url.origin}/pages/viewpage.action?pageId=${id}` };
}

export function credentials(input) {
  const username = String(input.username || '').trim(), password = input.password;
  if (!username || username.includes(':') || username.length > 200 || typeof password !== 'string' || !password || password.length > 1000 || /[\r\n\0]/.test(username + password)) {
    throw new AppError('请输入有效的账号和密码。');
  }
  return { username, password };
}

export function createConfluenceClient(auth, target, fetcher = fetch) {
  const authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
  async function request(path, options = {}) {
    let response;
    try {
      response = await fetcher(target.origin + path, {
        ...options, redirect: 'error', signal: AbortSignal.timeout(25000),
        headers: { Authorization: authorization, Accept: 'application/json', ...options.headers },
      });
    } catch {
      throw new AppError(options.method === 'PUT' ? '发布响应中断，结果暂不确定。请先打开目标页面确认，勿直接重复发布。' : '发布服务器无法连接 Confluence。如果目标仅在公司内网可用，需要经公司批准的网络连接，或在内网运行本工具。', 502);
    }
    if (response.status === 401) throw new AppError('账号密码认证失败。请核对一次，避免连续重试导致账号锁定。', 401);
    if (response.status === 403) throw new AppError('Confluence 拒绝访问。可能是页面权限不足，或账号需要在网页完成验证。', 403);
    if (response.status === 404) throw new AppError('页面不存在或当前账号不可见，请检查链接和权限。', 404);
    if (response.status === 409) throw new AppError('线上页面已被其他人修改，已停止覆盖。请重新检查目标页面。', 409);
    if (!response.ok) throw new AppError(`Confluence 返回 ${response.status}，操作未能确认完成。请检查目标页面后再处理。`, 502);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 12 * 1024 * 1024) throw new AppError('目标页面过大，暂不支持更新。', 413);
    const reader = response.body?.getReader();
    if (!reader) throw new AppError('Confluence 返回了空响应。', 502);
    const parts = []; let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 12 * 1024 * 1024) { await reader.cancel(); throw new AppError('目标页面响应过大。', 413); }
      parts.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
    catch { throw new AppError('Confluence 未返回有效数据，可能跳转到了登录页面。', 502); }
  }
  return {
    read: () => request(`/rest/api/content/${target.id}?expand=body.storage,version,space`),
    attach: asset => {
      const form = new FormData();
      form.append('file', new Blob([asset.buffer], { type: asset.mime }), asset.name);
      form.append('minorEdit', 'true');
      return request(`/rest/api/content/${target.id}/child/attachment`, {
        method: 'POST', headers: { 'X-Atlassian-Token': 'no-check' }, body: form,
      });
    },
    update: (snapshot, storage) => request(`/rest/api/content/${target.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: target.id, type: 'page', title: snapshot.title,
        version: { number: snapshot.version.number + 1, minorEdit: true, message: 'Published with PagePort' },
        body: { storage: { value: storage, representation: 'storage' } },
      }),
    }),
  };
}

export function validateSnapshot(page, target) {
  if (String(page.id) !== target.id || page.type !== 'page' || !page.title || !Number.isInteger(page.version?.number) || typeof page.body?.storage?.value !== 'string') {
    throw new AppError('页面数据不完整或不是普通页面，已停止操作。', 502);
  }
  if (page.status !== 'current') throw new AppError('目标不是已发布的当前页面，暂不支持更新。');
  if (Buffer.byteLength(page.body.storage.value)>2*1024*1024) throw new AppError('目标正文超过 2 MB，暂不支持安全更新。',413);
}
export function assertUnchanged(before, current) {
  if (before.version.number !== current.version.number || before.title !== current.title || hash(before.body.storage.value) !== hash(current.body.storage.value)) {
    throw new AppError('预检查后线上页面已发生变化，已停止覆盖。请重新检查。', 409);
  }
}
export function summarizePage(page) {
  const $ = load(page.body.storage.value, { xmlMode: true });
  const warnings = [];
  if ($('ac\\:structured-macro').length) warnings.push('原页面含 Confluence 宏，发布将替换正文，原宏不会自动合并。');
  const hasComments = $('ac\\:inline-comment-marker').length > 0;
  return {
    id: String(page.id), title: page.title, version: page.version.number, space: page.space?.name || page.space?.key,
    excerpt: $.text().trim().slice(0,1200),
    characters: $.text().trim().length, tables: $('table').length,
    modifiedBy: page.version.by?.displayName || '', modifiedAt: page.version.when || '',
    warnings, hasComments,
  };
}
export function contentSignature(storage) {
  const $ = load(storage, { xmlMode: true });
  return {
    text: $.text().replace(/\s+/g,' ').trim(),
    tables: $('table').length, rows: $('tr').length,
    images: $('ac\\:image').length,
  };
}
