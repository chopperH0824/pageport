import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGatewayGuard } from '../server/gateway.js';
import { createApp } from '../server/app.js';

const token = 'a'.repeat(64);
async function fixture(t, options = {}) {
  const gateway = createGatewayGuard(token);
  const app = createApp({ ...options, accessPassword: token, production: true, gatewayGuard: gateway.guard, desktopToken: '' });
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { app.locals.dispose(); server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const login = () => fetch(`${origin}/gateway/session`, { method: 'POST', headers: { Origin: origin, 'X-PagePort-Launch': token } });
  return { gateway, origin, login };
}
test('gateway rejects unauthenticated, cross-origin, cross-site and DNS-rebinding requests', async t => {
  const { origin, login } = await fixture(t);
  for (const url of ['/api/bootstrap', '/brand.png', '/']) assert.equal((await fetch(origin + url)).status, 403);
  const rebinding = await new Promise(resolve => {
    http.get(origin + '/gateway-launch', { headers: { Host: 'evil.test' } }, response => { response.resume(); resolve(response.statusCode); });
  });
  assert.equal(rebinding, 403);
  assert.equal((await fetch(origin + '/gateway/session', { method: 'POST', headers: { Origin: 'https://evil.test', 'X-PagePort-Launch': token } })).status, 403);
  assert.equal((await fetch(origin + '/gateway/session', { method: 'POST', headers: { Origin: origin, 'Sec-Fetch-Site': 'cross-site', 'X-PagePort-Launch': token } })).status, 403);
  const response = await login();
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.doesNotMatch(cookie, /Secure/);
  assert.equal((await login()).status, 403, 'handoff must be single-use');
});
test('authenticated gateway publishes embedded images with backup, version protection and readback', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pageport-gateway-publish-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZWQAAAAASUVORK5CYII=', 'base64');
  let uploads = 0;
  let page = { id: '12', type: 'page', status: 'current', title: 'Gateway test', version: { number: 1 },
    space: { key: 'TEST' }, body: { storage: { value: '<p>Original</p>' } } };
  const fetcher = async (url, options) => {
    assert.equal(new URL(url).hostname, 'wiki.example.com');
    if (options.method === 'POST') {
      assert.ok(Buffer.from(await options.body.get('file').arrayBuffer()).equals(png));
      uploads++;
      return Response.json({ results: [] });
    }
    if (options.method === 'PUT') {
      assert.equal(uploads, 1);
      assert.ok((await readdir(path.join(dir, 'backups'))).length);
      const update = JSON.parse(options.body);
      assert.equal(update.version.number, 2);
      page = { ...page, body: update.body, version: update.version };
    }
    return Response.json(page);
  };
  const { origin, login } = await fixture(t, { fetcher, dataDir: dir, allowedHosts: [] });
  const cookies = [(await login()).headers.get('set-cookie').split(';')[0]];
  const bootstrap = await fetch(origin + '/api/bootstrap', { headers: { Cookie: cookies.join('; ') } });
  cookies.push(bootstrap.headers.get('set-cookie').split(';')[0]);
  const headers = { Cookie: cookies.join('; '), Origin: origin, 'X-CSRF-Token': (await bootstrap.json()).csrf };
  const body = new FormData();
  body.append('document', new Blob([`<h1>Gateway test</h1><img src="${'data:' + 'image/png;base64,'}${png.toString('base64')}">`]), 'sample.html');
  const converted = await fetch(origin + '/api/convert', { method: 'POST', headers, body });
  assert.equal(converted.status, 200);
  const doc = await converted.json();
  assert.equal(doc.blockers.length, 0);
  const auth = { username: 'mock', password: 'mock-only', url: 'https://wiki.example.com/pages/viewpage.action?pageId=12' };
  const post = (url, data) => fetch(origin + url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const checked = await post('/api/check', { ...auth, documentId: doc.id });
  assert.equal(checked.status, 200, await checked.clone().text());
  const plan = await checked.json();
  const published = await post('/api/publish', { ...auth, token: plan.token, confirmTitle: 'Gateway test', acknowledge: true });
  assert.equal(published.status, 200);
  assert.equal((await published.json()).verification, 'matched');
  assert.equal((await post('/api/publish', { ...auth, token: plan.token, confirmTitle: 'Gateway test', acknowledge: true })).status, 409);
});
test('gateway browser authentication retains CSRF, local conversion and explicit target selection', async t => {
  const { origin, login, gateway } = await fixture(t);
  const cookies = [(await login()).headers.get('set-cookie').split(';')[0]];
  const boot = await fetch(origin + '/api/bootstrap', { headers: { Cookie: cookies.join('; ') } });
  cookies.push(boot.headers.get('set-cookie').split(';')[0]);
  const state = await boot.json();
  assert.equal(state.gateway, true); assert.equal(state.desktop, false);
  assert.equal(state.authenticated, true); assert.equal(state.requiresAccess, false);
  assert.doesNotMatch(boot.headers.get('content-security-policy'), /upgrade-insecure-requests/);
  const headers = { Cookie: cookies.join('; '), Origin: origin, 'X-CSRF-Token': state.csrf };
  assert.equal((await fetch(origin + '/api/documents/blank', { method: 'POST', headers: { Cookie: headers.Cookie } })).status, 403);
  const blank = await fetch(origin + '/api/documents/blank', { method: 'POST', headers });
  assert.equal(blank.status, 200);
  assert.ok((await blank.json()).id);
  assert.equal((await fetch(origin + '/api/health', { headers: { Cookie: headers.Cookie, Origin: 'https://evil.test' } })).status, 403);
  gateway.rotate('b'.repeat(64));
  assert.equal((await login()).status, 403);
  assert.equal((await fetch(origin + '/gateway/session', { method: 'POST', headers: { Origin: origin, 'X-PagePort-Launch': 'b'.repeat(64) } })).status, 200);
});
