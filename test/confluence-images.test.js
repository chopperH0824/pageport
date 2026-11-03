import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { load } from 'cheerio';
import { extractConfluenceExport } from '../server/confluence-export.js';
import { convertDocument, hash } from '../server/convert.js';
import { exportDocument } from '../server/export.js';
import { toMarkdown } from '../src/markdown.js';
import { createApp } from '../server/app.js';
import { normalizeClipboardHtml } from '../server/online-document.js';
import { restoreOfficeDetails } from '../server/office-details.js';
import JSZip from 'jszip';

const png = await readFile(new URL('../public/brand.png', import.meta.url));
const boundary = 'pageport-public-confluence-test';
function mimeDocument(html, attachments, newline = '\r\n') {
  const parts = [
    'Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + Buffer.from(html).toString('base64'),
    ...attachments.map(({ type = 'application/octet-stream', location, id, bytes = png }) =>
      `Content-Type: ${type}\r\nContent-Transfer-Encoding: base64\r\n` +
      (location ? `Content-Location: ${location}\r\n` : '') +
      (id ? `Content-ID: <${id}>\r\n` : '') + '\r\n' + bytes.toString('base64')),
  ];
  return Buffer.from(('Subject: Exported From Confluence\r\nMIME-Version: 1.0\r\n' +
    `Content-Type: multipart/related; boundary=${boundary}\r\n\r\n` +
    parts.map(part => `--${boundary}\r\n${part}\r\n`).join('') + `--${boundary}--\r\n`).replaceAll('\r\n', newline));
}

test('Confluence generic MIME attachments restore opaque file references and repeated images', async () => {
  const buffer = mimeDocument('<h1>公开图片测试</h1><img src="opaque-image"><img src="opaque-image">', [
    { location: 'file:///opaque-image' },
  ]);
  const doc = await convertDocument({ originalname: 'public.doc', buffer });
  assert.equal(doc.blockers.length, 0);
  assert.equal(doc.assets.length, 1);
  assert.equal(doc.assets[0].digest, hash(png));
  assert.equal(load(doc.preview)('img').length, 2);
  assert.equal(load(doc.storage, { xmlMode: true })('ri\\:attachment').length, 2);
  assert.doesNotMatch(doc.preview, /file:|opaque-image/);
  const edited = await convertDocument({ originalname: 'edited.md', buffer: Buffer.from(toMarkdown(doc.preview)) });
  assert.equal(edited.assets[0].digest, hash(png));
  assert.equal(edited.blockers.length, 0);
  for (const format of ['docx', 'doc']) {
    const saved = await exportDocument(edited, format);
    const reopened = await convertDocument({ originalname: `saved.${format}`, buffer: saved.buffer });
    assert.equal(reopened.assets[0].digest, hash(png));
    assert.equal(load(reopened.preview)('img').length, 2);
  }
});

test('Confluence MIME uses image bytes rather than declared type and accepts CID and encoded locations', async () => {
  const buffer = mimeDocument('<h1>Images</h1><img src="cid:part@example.invalid"><img src="image one"><img src="https://example.invalid/image.png">', [
    { type: 'image/jpeg', id: 'part@example.invalid' },
    { location: 'file:///image%20one' },
    { location: 'https://example.invalid/image.png' },
  ], '\n');
  const result = await extractConfluenceExport(buffer);
  const $ = load(result.html);
  assert.equal($('img').length, 3);
  assert.equal($('[data-confluence-image]').length, 0);
  $('img').each((_, node) => {
    const source = $(node).attr('src');
    assert.match(source, /^data:image\/png;base64,/);
    assert.equal(hash(Buffer.from(source.split(',')[1], 'base64')), hash(png));
  });
});

test('mixed embedded and online Confluence images survive editor synchronization without fetching', async () => {
  const address='https://wiki.example.invalid/attachments/remote.png?version=2&preview=true';
  const buffer=mimeDocument(`<h1>Mixed images</h1><p><img src="embedded"></p><p><img src="${address.replaceAll('&','&amp;')}" height="240"></p>`,[
    {location:'file:///embedded'},
  ]);
  let doc=await convertDocument({originalname:'mixed.doc',buffer});
  for(let iteration=0;iteration<3;iteration++) {
    assert.equal(doc.blockers.length,0);
    assert.equal(doc.assets.length,1);
    assert.equal(doc.assets[0].digest,hash(png));
    const preview=load(doc.preview);
    assert.equal(preview('img').length,1);
    assert.equal(preview('[data-confluence-image]').attr('data-confluence-image'),address);
    assert.equal(preview('[data-confluence-image]').attr('data-height'),'240');
    assert.equal(preview('[data-pageport-missing-image]').length,0);
    const storage=load(doc.storage,{xmlMode:true});
    assert.equal(storage('ri\\:url').attr('ri:value'),address);
    assert.equal(storage('ac\\:image[ac\\:height="240"]').length,1);
    assert.ok(doc.warnings.some(warning=>warning.includes('1 处图片仅含在线引用')));
    await assert.rejects(exportDocument(doc,'docx'),/尚未归档/);
    doc=await convertDocument({originalname:'edited.md',buffer:Buffer.from(toMarkdown(normalizeClipboardHtml(doc.preview).html))});
  }
});

test('each image reference preserves display dimensions across import, editing and storage', async()=>{
  const buffer=mimeDocument('<h1>Sizes</h1><p><img src="embedded" width="240" height="120"></p><p><img src="embedded" style="width:3in;height:1.5in"></p><img src="https://example.invalid/remote.png" width="180" height="90">',[{location:'embedded'}]);
  let doc=await convertDocument({originalname:'sizes.doc',buffer});
  for(let round=0;round<3;round++) {
    assert.equal(doc.assets.length,1);
    assert.equal(doc.assets[0].digest,hash(png));
    const storage=load(doc.storage,{xmlMode:true});
    assert.deepEqual(storage('ac\\:image').toArray().map(node=>[storage(node).attr('ac:width'),storage(node).attr('ac:height')]),[['240','120'],['288','144'],['180','90']]);
    const preview=load(doc.preview);
    assert.deepEqual(preview('img').toArray().map(node=>[preview(node).attr('width'),preview(node).attr('height')]),[['240','120'],['288','144']]);
    doc=await convertDocument({originalname:'edited.md',buffer:Buffer.from(toMarkdown(normalizeClipboardHtml(doc.preview).html))});
  }
});

test('DOCX display extents are restored without resizing image bytes or guessing incomplete sequences',async()=>{
  const zip=new JSZip();
  zip.file('word/document.xml','<w:document xmlns:w="w" xmlns:wp="wp"><w:drawing><wp:extent cx="2286000" cy="1143000"/></w:drawing></w:document>');
  const bytes=await zip.generateAsync({type:'nodebuffer'});
  const restored=load(await restoreOfficeDetails(bytes,'<p><img src="data:image/png;base64,test"></p>'));
  assert.equal(restored('img').attr('width'),'240');
  assert.equal(restored('img').attr('height'),'120');
  assert.doesNotMatch(await restoreOfficeDetails(bytes,'<img src="one"><img src="two">'),/width=/);
});

test('ambiguous MIME filenames and non-image attachments never become guessed images', async () => {
  const buffer = mimeDocument('<h1>Images</h1><img src="same"><img src="invalid"><img src="https://remote.invalid/same">', [
    { location: 'file:///first/same' },
    { location: 'file:///second/same', bytes: Buffer.concat([png, Buffer.from('different')]) },
    { location: 'file:///invalid', bytes: Buffer.from('<script>not an image</script>') },
  ]);
  const result = await extractConfluenceExport(buffer);
  const $ = load(result.html);
  assert.equal($('img[src^="data:"]').length, 0);
  assert.equal($('[data-confluence-image]').length, 1);
  const doc = await convertDocument({ originalname: 'public.doc', buffer });
  assert.equal(doc.assets.length, 0);
  assert.equal(doc.blockers.length, 2);
});

test('Confluence MIME images upload as attachments before protected publication and readback', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pageport-mime-publish-'));
  const uploads = [];
  let page = { id: '12', type: 'page', status: 'current', title: 'Public test', version: { number: 1 },
    space: { key: 'TEST' }, body: { storage: { value: '<p>Original</p>' } } };
  const fetcher = async (url, options) => {
    if (url.includes('/child/attachment?')) return Response.json({ results: [] });
    if (options.method === 'POST') {
      assert.match(url, /\/child\/attachment$/);
      const file = options.body.get('file');
      uploads.push({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
      return Response.json({ results: [] });
    }
    if (options.method === 'PUT') {
      assert.equal(uploads.length, 1);
      assert.ok((await readdir(path.join(dir, 'backups'))).length);
      const update = JSON.parse(options.body);
      page = { ...page, version: update.version, body: update.body };
    }
    return Response.json(page);
  };
  const app = createApp({ fetcher, dataDir: dir, allowedHosts: ['wiki.example.com'] });
  t.after(async () => { app.locals.dispose(); await rm(dir, { recursive: true, force: true }); });
  const agent = request.agent(app);
  const bootstrap = (await agent.get('/api/bootstrap')).body;
  const input = mimeDocument('<h1>Public test</h1><img src="image-id" width="240" height="120"><img src="image-id" width="120" height="60"><img src="https://wiki.example.com/remote.png" width="180">', [{ location: 'file:///image-id' }]);
  const converted = await agent.post('/api/convert').set('X-CSRF-Token', bootstrap.csrf).attach('document', input, 'public.doc').expect(200);
  assert.equal(converted.body.blockers.length, 0);
  assert.equal(converted.body.stats.images, 1);
  const auth = { username: 'test', password: 'mock-only', url: 'https://wiki.example.com/pages/viewpage.action?pageId=12' };
  const checked = await agent.post('/api/check').set('X-CSRF-Token', bootstrap.csrf).send({ ...auth, documentId: converted.body.id }).expect(200);
  const published = await agent.post('/api/publish').set('X-CSRF-Token', bootstrap.csrf)
    .send({ ...auth, token: checked.body.token, confirmTitle: 'Public test', acknowledge: true }).expect(200);
  assert.equal(published.body.verification, 'matched');
  assert.ok(uploads[0].bytes.equals(png));
  const storage = load(page.body.storage.value, { xmlMode: true });
  assert.equal(storage('ri\\:attachment').length, 2);
  assert.equal(storage('ri\\:url').attr('ri:value'),'https://wiki.example.com/remote.png');
  assert.deepEqual(storage('ac\\:image').toArray().map(node=>storage(node).attr('ac:width')),['240','120','180']);
  storage('ri\\:attachment').each((_, node) => assert.equal(storage(node).attr('ri:filename'), uploads[0].name));
});
