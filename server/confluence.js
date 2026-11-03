import { AppError, hash } from './convert.js';
import { load } from 'cheerio';

export function parseTarget(input, allowedHosts = []) {
  let url;
  try { url = new URL(input); } catch { throw new AppError('请输入完整的 Confluence 页面链接。'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowedHosts.includes(url.hostname)) {
    throw new AppError(`仅允许 HTTPS 页面：${allowedHosts.join('、')}。`);
  }
  let id = url.pathname === '/pages/viewpage.action' ? url.searchParams.get('pageId') : url.pathname.match(/^\/spaces\/[^/]+\/pages\/(\d+)(?:\/.*)?$/)?.[1];
  if (!id) {
    const named = url.pathname.match(/^\/display\/([^/]+)\/(.+)$/);
    if (named) {
      let spaceKey, title;
      try {
        spaceKey = decodeURIComponent(named[1]);
        title = decodeURIComponent(named[2].replaceAll('+', ' '));
      } catch { throw new AppError('页面名称链接的编码无效，请重新复制完整链接。'); }
      if (!spaceKey.trim() || !title.trim() || /[\0\r\n]/.test(spaceKey + title)) throw new AppError('页面名称链接不完整，请重新复制完整链接。');
      return { origin:url.origin, url:url.href, spaceKey, title };
    }
  }
  if (!/^\d{1,20}$/.test(id || '')) throw new AppError('无法识别目标页面，请使用包含 pageId 或 /display/空间/页面名称 的链接。');
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
  async function request(path, options = {}, stage = '读取目标页面') {
    let response;
    try {
      response = await fetcher(target.origin + path, {
        ...options, redirect: 'error', signal: AbortSignal.timeout(25000),
        headers: { Authorization: authorization, Accept: 'application/json', ...options.headers },
      });
    } catch {
      throw new AppError(options.method === 'PUT' ? '提交正文时响应中断，结果暂不确定。请先打开目标页面确认，勿直接重复发布。' : `${stage}时无法连接 Confluence。请检查公司网络；不要直接重复发布。`, 502);
    }
    if (response.status === 401) throw new AppError('账号密码认证失败。请核对一次，避免连续重试导致账号锁定。', 401);
    if (response.status === 403) throw new AppError('Confluence 拒绝访问。可能是页面权限不足，或账号需要在网页完成验证。', 403);
    if (response.status === 404) throw new AppError('页面不存在或当前账号不可见，请检查链接和权限。', 404);
    if (response.status === 409) throw new AppError('线上页面已被其他人修改，已停止覆盖。请重新检查目标页面。', 409);
    if (!response.ok) {
      // Classify a bounded JSON error without exposing server-echoed document or credentials.
      let detail = '';
      const reader = response.body?.getReader();
      if (reader && /application\/json/i.test(response.headers.get('content-type') || '')) {
        const parts = []; let bytes = 0;
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.length;
            if (bytes > 16384) { await reader.cancel(); break; }
            parts.push(Buffer.from(value));
          }
          if (bytes <= 16384) {
            const error = JSON.parse(Buffer.concat(parts).toString('utf8'));
            const message = typeof error.message === 'string' ? error.message : '';
            if (/attachment.*(?:same file name|already exists)|same file name.*attachment/i.test(message)) detail = '同名图片附件已存在。';
            else if (/error parsing|xhtml|xml.*pars|storage.*(?:invalid|pars)/i.test(message)) detail = '服务器拒绝正文的存储格式。';
            else if (/maximum.*(?:size|upload)|file.*too large/i.test(message)) detail = '附件超过服务器允许的大小。';
          }
        } catch { /* Error bodies are optional; never retry a write to obtain diagnostics. */ }
      } else if (reader) await reader.cancel().catch(()=>{});
      throw new AppError(`${stage}失败：Confluence 返回 ${response.status}。${detail}操作未能确认完成，请检查目标页面后再处理。`, 502);
    }
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
    resolve: async () => {
      if (target.id) return target;
      const query = new URLSearchParams({spaceKey:target.spaceKey,title:target.title,type:'page',status:'current',limit:'2'});
      const result = await request(`/rest/api/content?${query}`, {}, '查询目标页面');
      if (!Array.isArray(result.results)) throw new AppError('Confluence 未返回有效的页面查询结果。',502);
      if (!result.results.length) throw new AppError('未找到该名称的页面，或当前账号不可见。请检查空间、页面名称和权限。',404);
      if (result.results.length !== 1 || result._links?.next) throw new AppError('页面名称未能唯一确定目标，请改用包含 pageId 的链接。',409);
      const page = result.results[0];
      if (!/^\d{1,20}$/.test(String(page.id || '')) || page.title !== target.title || page.type !== 'page' || page.status !== 'current') {
        throw new AppError('查询结果与页面名称不一致，已停止操作，请重新复制链接。',409);
      }
      const id = String(page.id);
      return {id,origin:target.origin,url:`${target.origin}/pages/viewpage.action?pageId=${id}`,spaceKey:target.spaceKey,title:target.title};
    },
    read: () => request(`/rest/api/content/${target.id}?expand=body.storage,version,space`),
    attach: async asset => {
      const base = `/rest/api/content/${target.id}/child/attachment`;
      const query = new URLSearchParams({ filename: asset.name, limit: '2' });
      const existing = await request(`${base}?${query}`, {}, '检查图片附件');
      if (!Array.isArray(existing.results) || existing.results.length > 1 || existing._links?.next) {
        throw new AppError('图片附件查询结果不完整或不唯一，已停止发布。', 502);
      }
      const attachment = existing.results[0];
      if (attachment && (!/^\d{1,20}$/.test(String(attachment.id || '')) ||
        attachment.type !== 'attachment' || attachment.title !== asset.name)) {
        throw new AppError('图片附件查询结果与文件名不符，已停止发布。', 502);
      }
      const form = new FormData();
      form.append('file', new Blob([asset.buffer], { type: asset.mime }), asset.name);
      form.append('minorEdit', 'true');
      // Re-send the actual bytes: a matching hash-based name alone does not prove integrity.
      return request(attachment ? `${base}/${attachment.id}/data` : base, {
        method: 'POST', headers: { 'X-Atlassian-Token': 'no-check' }, body: form,
      }, attachment ? '更新已有图片附件' : '上传新图片附件');
    },
    update: (snapshot, storage) => request(`/rest/api/content/${target.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: target.id, type: 'page', title: snapshot.title,
        version: { number: snapshot.version.number + 1, minorEdit: true, message: 'Published with PagePort' },
        body: { storage: { value: storage, representation: 'storage' } },
      }),
    }, '提交正文'),
  };
}

export function validateSnapshot(page, target) {
  if (String(page.id) !== target.id || page.type !== 'page' || !page.title || !Number.isInteger(page.version?.number) || typeof page.body?.storage?.value !== 'string') {
    throw new AppError('页面数据不完整或不是普通页面，已停止操作。', 502);
  }
  if (target.spaceKey && (page.space?.key !== target.spaceKey || page.title !== target.title)) {
    throw new AppError('页面空间或名称已发生变化，请重新检查目标链接。',409);
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
