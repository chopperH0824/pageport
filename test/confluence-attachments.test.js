import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createConfluenceClient } from '../server/confluence.js';

const asset = { name: 'pageport-public.png', mime: 'image/png', buffer: Buffer.from('public image') };
const target = { id: '12', origin: 'https://wiki.example.com' };
const auth = { username: 'mock', password: 'mock-only' };
const attachment = { id: '21', type: 'attachment', title: asset.name };

test('new and existing images use the official create and attachment data endpoints', async () => {
  for (const existing of [false, true]) {
    const calls = [];
    const client = createConfluenceClient(auth, target, async (url, options) => {
      calls.push({ url, options });
      return Response.json({ results: existing ? [attachment] : [] });
    });
    await client.attach(asset);
    assert.equal(calls.length, 2);
    const query = new URL(calls[0].url);
    assert.equal(query.searchParams.get('filename'), asset.name);
    assert.equal(query.searchParams.get('limit'), '2');
    assert.equal(calls[1].url, `${target.origin}/rest/api/content/12/child/attachment${existing ? '/21/data' : ''}`);
    assert.equal(calls[1].options.method, 'POST');
    assert.equal(calls[1].options.headers['X-Atlassian-Token'], 'no-check');
    assert.equal(calls[1].options.body.get('minorEdit'), 'true');
    const uploaded = calls[1].options.body.get('file');
    assert.equal(uploaded.name, asset.name);
    assert.equal(uploaded.type, asset.mime);
    assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), asset.buffer);
  }
});

test('invalid or ambiguous attachment lookup never writes', async () => {
  for (const payload of [
    {}, { results: [attachment, attachment] }, { results: [], _links: { next: '/next' } },
    { results: [{ ...attachment, title: 'different.png' }] },
    { results: [{ ...attachment, id: '../bad' }] },
    { results: [{ ...attachment, type: 'page' }] },
  ]) {
    let calls = 0;
    const client = createConfluenceClient(auth, target, async (_url, options) => {
      calls++;
      assert.equal(options.method, undefined);
      return Response.json(payload);
    });
    await assert.rejects(client.attach(asset), /图片附件查询结果/);
    assert.equal(calls, 1);
  }
});

test('attachment failures identify their stage and never retry the write', async () => {
  for (const existing of [false, true]) {
    let calls = 0;
    const client = createConfluenceClient(auth, target, async () => {
      calls++;
      return calls === 1 ? Response.json({ results: existing ? [attachment] : [] })
        : Response.json({ message: 'Cannot add attachment with same file name' }, { status: 400 });
    });
    await assert.rejects(client.attach(asset), existing ? /更新已有图片附件失败/ : /上传新图片附件失败/);
    assert.equal(calls, 2);
  }
});

test('errors identify the failed stage and classify errors without echoing private server text or retrying', async () => {
  const secret = 'PRIVATE-BODY mock-only someone@example.invalid';
  const cases = [
    ['Cannot add attachment with same file name ' + secret, /同名图片附件已存在/],
    ['Error parsing XHTML ' + secret, /正文的存储格式/],
    ['File is too large ' + secret, /超过服务器允许的大小/],
    [secret, /Confluence 返回 400/],
    ['x'.repeat(20000) + secret, /Confluence 返回 400/],
  ];
  for (const [message, expected] of cases) {
    let writes = 0;
    const client = createConfluenceClient(auth, target, async () => {
      writes++;
      return Response.json({ message }, { status: 400 });
    });
    await assert.rejects(client.update({ title: 'Public', version: { number: 1 } }, '<p>Public</p>'), error => {
      assert.match(error.message, /提交正文失败/);
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /PRIVATE-BODY|mock-only|someone@/);
      return true;
    });
    assert.equal(writes, 1);
  }
});

test('repeated publication updates existing images and still backs up, checks versions and verifies the body', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pageport-repeat-publish-'));
  let page = { id: '12', type: 'page', status: 'current', title: 'Public test', version: { number: 1 },
    space: { key: 'TEST' }, body: { storage: { value: '<p>Original</p>' } } };
  let image, creates = 0, updates = 0, puts = 0, readsSinceUpload = 0;
  const app = createApp({ dataDir: dir, allowedHosts: ['wiki.example.com'], fetcher: async (url, options) => {
    if (url.includes('/child/attachment?')) {
      assert.ok((await readdir(path.join(dir, 'backups'))).length);
      if (image) assert.equal(new URL(url).searchParams.get('filename'), image.title);
      return Response.json({ results: image ? [image] : [] });
    }
    if (options.method === 'POST') {
      const file = options.body.get('file');
      if (image) {
        assert.ok(url.endsWith('/21/data'));
        assert.equal(file.name, image.title);
        updates++;
      } else {
        assert.ok(url.endsWith('/child/attachment'));
        creates++;
        image = { id: '21', type: 'attachment', title: file.name };
      }
      readsSinceUpload = 0;
      return Response.json({ results: [image] });
    }
    if (options.method === 'PUT') {
      assert.ok(readsSinceUpload >= 1);
      const body = JSON.parse(options.body);
      assert.equal(body.version.number, page.version.number + 1);
      page = { ...page, version: body.version, body: body.body };
      puts++;
    } else readsSinceUpload++;
    return Response.json(page);
  } });
  t.after(async () => { app.locals.dispose(); await rm(dir, { recursive: true, force: true }); });
  const agent = request.agent(app);
  const bootstrap = (await agent.get('/api/bootstrap')).body;
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZWQAAAAASUVORK5CYII=';
  const converted = await agent.post('/api/convert').set('X-CSRF-Token', bootstrap.csrf)
    .attach('document', Buffer.from(`<p>Public</p><img src="data:image/png;base64,${png}">`), 'public.html').expect(200);
  const input = { ...auth, url: `${target.origin}/pages/viewpage.action?pageId=12`, documentId: converted.body.id };
  for (let i = 0; i < 3; i++) {
    const checked = await agent.post('/api/check').set('X-CSRF-Token', bootstrap.csrf).send(input).expect(200);
    const result = await agent.post('/api/publish').set('X-CSRF-Token', bootstrap.csrf)
      .send({ ...input, token: checked.body.token, confirmTitle: 'Public test', acknowledge: true }).expect(200);
    assert.equal(result.body.verification, 'matched');
  }
  assert.deepEqual({ creates, updates, puts }, { creates: 1, updates: 2, puts: 3 });
  assert.equal((await readdir(path.join(dir, 'backups'))).length, 3);
});
