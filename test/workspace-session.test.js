import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createWorkspaceApi } from '../src/workspace-api.js';

const expired = () => Response.json({code:'DESKTOP_SESSION_EXPIRED'}, {status:403});
const ttl = 30 * 60 * 1000;
const desktopToken = 'synthetic-desktop-test';
const auth = { username:'test', password:'synthetic-test', url:'https://wiki.example.com/pages/viewpage.action?pageId=12' };

test('desktop expiry rotates credentials and plans while preserving the draft and allowing another import', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pageport-session-'));
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  let reads = 0, writes = 0;
  let page = {id:'12',type:'page',status:'current',title:'Test page',space:{key:'TEST'},version:{number:1},body:{storage:{value:'<p>Original</p>'}}};
  const app = createApp({ dataDir:dir, desktopToken, accessPassword:desktopToken, production:true, fetcher:async (url, init) => {
    assert.equal(new URL(url).hostname, 'wiki.example.com');
    if (init.method === 'PUT') {
      const {version,body} = JSON.parse(init.body);
      page = {...page,version,body};
      writes++;
    } else reads++;
    return Response.json(page);
  } });
  t.after(async () => { app.locals.dispose(); await rm(dir, {recursive:true,force:true}); });

  const send = (method, route, cookie, csrf) => {
    const req = request(app)[method](`/api${route}`).set('X-PagePort-Desktop', desktopToken);
    if (cookie) req.set('Cookie', cookie);
    if (csrf) req.set('X-CSRF-Token', csrf);
    return req;
  };
  const boot = await send('get', '/bootstrap').expect(200);
  const cookie = boot.headers['set-cookie'][0].split(';')[0];
  const {csrf} = boot.body;
  const before = (route) => send('post', route, cookie, csrf);
  const first = await before('/convert').attach('document', Buffer.from('# First\n\nWorking draft'), 'first.md').expect(200);
  clock += ttl - 10_000;
  const checkInput = {...auth,documentId:first.body.id};
  const plan = await before('/check').send(checkInput).expect(200);
  const publishInput = {...auth,token:plan.body.token,confirmTitle:page.title,acknowledge:true};
  await before('/publish').send(publishInput).expect(200);
  const secondPlan = await before('/check').send(checkInput).expect(200);
  const oldPublish = {...publishInput,token:secondPlan.body.token};
  clock += 11_000;
  const priorReads = reads;
  const [stalePublish, staleImport] = await Promise.all([
    before('/publish').send(oldPublish).expect(403),
    before('/convert').attach('document', Buffer.from('# Next\n\nNew draft'), 'next.md').expect(403),
  ]);
  assert.equal(stalePublish.body.code, 'DESKTOP_SESSION_EXPIRED');
  assert.equal(staleImport.body.code, 'DESKTOP_SESSION_EXPIRED');
  const newCookie = stalePublish.headers['set-cookie'][0].split(';')[0];
  assert.notEqual(newCookie, cookie);
  assert.equal(newCookie, staleImport.headers['set-cookie'][0].split(';')[0]);
  const resumed = await send('get', '/bootstrap', newCookie).expect(200);
  assert.notEqual(resumed.body.csrf, csrf);
  const after = (route) => send('post', route, newCookie, resumed.body.csrf);
  await after('/publish').send(oldPublish).expect(409);
  assert.equal(writes, 1);
  assert.equal(reads, priorReads);
  await request(app).get(`/api/documents/${first.body.id}/storage`).set('Cookie', newCookie).expect(403);
  const exported = await after(`/documents/${first.body.id}/export/docx`).buffer(true).parse((res, callback) => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
  }).expect(200);
  const zip = await JSZip.loadAsync(exported.body);
  assert.match(await zip.file('word/document.xml').async('string'), /Working draft/);
  const next = await after('/convert').attach('document', Buffer.from('# Next\n\nNew draft'), 'next.md').expect(200);
  assert.match(next.body.source, /New draft/);
  await after('/logout').send({}).expect(200);
  const loggedOut = await send('get', '/bootstrap').expect(200);
  const clearedCookie = loggedOut.headers['set-cookie'][0].split(';')[0];
  await send('get', `/documents/${next.body.id}/storage`, clearedCookie).expect(404);
});

test('web expiry still discards the document and does not enable desktop recovery', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pageport-web-session-'));
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const app = createApp({dataDir:dir});
  t.after(async () => { app.locals.dispose(); await rm(dir, {recursive:true,force:true}); });
  const agent = request.agent(app);
  const {body:{csrf}} = await agent.get('/api/bootstrap').expect(200);
  const {body:first} = await agent.post('/api/documents/blank').set('X-CSRF-Token', csrf).expect(200);
  clock += ttl + 1;
  const stale = await agent.post('/api/documents/blank').set('X-CSRF-Token', csrf).expect(403);
  assert.equal(stale.body.code, undefined);
  await agent.get(`/api/documents/${first.id}/storage`).expect(404);
});

test('the client coalesces expiry recovery, retries only local operations, and never replays check or publish', async () => {
  let boots = 0, recovered = 0;
  const calls = [];
  const form = new FormData();
  form.append('document', new Blob(['Unsaved edit']), 'draft.md');
  const {api,bootstrap} = createWorkspaceApi({
    onRecovery:() => { recovered++; },
    fetcher:async (route, options) => {
      if (route === '/api/bootstrap') return Response.json({desktop:true,authenticated:true,csrf:`token-${++boots}`});
      const token = options.headers['X-CSRF-Token'];
      calls.push([route,token]);
      if (route.includes('/convert')) assert.equal(options.body.get('document').name, 'draft.md');
      if (token === 'token-1') return expired();
      if (route.includes('/export/')) return new Response('Unsaved edit');
      return Response.json({ok:true});
    },
  });
  await bootstrap();
  await Promise.all([
    api('/convert?allowEmpty=1',{method:'POST',body:form}),
    api('/documents/draft/export/docx',{method:'POST',raw:true}).then(async result => assert.equal(await result.text(),'Unsaved edit')),
    assert.rejects(api('/check',{method:'POST',json:{}}), /请重新检查目标页面/),
    assert.rejects(api('/publish',{method:'POST',json:{}}), /本次未发布/),
  ]);
  assert.equal(boots, 2);
  assert.equal(recovered, 1);
  assert.deepEqual(calls.filter(([route]) => /\/(?:check|publish)$/.test(route)),
    [['/api/check','token-1'],['/api/publish','token-1']]);
  assert.equal(calls.filter(([,token]) => token === 'token-2').length, 2);
});

test('ordinary failures and an uncertain publish are never treated as session expiry', async () => {
  let boots = 0, posts = 0;
  const {api,bootstrap} = createWorkspaceApi({fetcher:async (route) => {
    if (route === '/api/bootstrap') {
      boots++;
      return Response.json({desktop:true,authenticated:true,csrf:'synthetic'});
    }
    posts++;
    if (route === '/api/publish') throw new TypeError('Connection closed');
    return Response.json({error:'Forbidden'}, {status:403});
  }});
  await bootstrap();
  await assert.rejects(api('/convert',{method:'POST'}), /Forbidden/);
  await assert.rejects(api('/publish',{method:'POST'}), /Connection closed/);
  assert.equal(boots,1);
  assert.equal(posts,2);
});

test('a local operation never loops when its one retry is also rejected', async () => {
  let boots = 0, attempts = 0;
  const {api,bootstrap} = createWorkspaceApi({fetcher:async (route) => {
    if (route === '/api/bootstrap') return Response.json({desktop:true,authenticated:true,csrf:`test-${++boots}`});
    attempts++;
    return expired();
  }});
  await bootstrap();
  await assert.rejects(api('/documents/blank',{method:'POST'}));
  assert.equal(boots,2);
  assert.equal(attempts,2);
});
