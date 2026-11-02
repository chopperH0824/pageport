import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { load } from 'cheerio';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { exportDocument } from '../server/export.js';
import { convertDocument, hash } from '../server/convert.js';
import { toMarkdown } from '../src/markdown.js';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import documentFiles from '../desktop/document-files.cjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZWQAAAAASUVORK5CYII=','base64');
const image=`data:image/png;base64,${png.toString('base64')}`;
const html=`<h1>中文保存验证</h1><p><strong>修改后的正文</strong></p><table><tr><th colspan="2">表格</th></tr><tr><td>左</td><td>右<img src="${image}" alt="表内图片"></td></tr></table><p><img src="${image}" alt="重复图片"></p>`;
const document={preview:html,title:'中文保存验证',blockers:[]};

test('DOCX contains native text, merged table, and every image with unchanged bytes',async()=>{
  const result=await exportDocument(document,'docx');
  const zip=await JSZip.loadAsync(result.buffer);
  const xml=load(await zip.file('word/document.xml').async('string'),{xmlMode:true});
  assert.match(xml('w\\:t').text(),/修改后的正文/);
  assert.equal(xml('w\\:tbl').length,1);
  assert.equal(xml('w\\:gridSpan[w\\:val="2"]').length,1);
  assert.equal(xml('a\\:blip[r\\:embed]').length,2);
  assert.equal(xml('w\\:body').children().last()[0].name,'w:sectPr');
  assert.equal(xml('w\\:sectPr').children().first()[0].name,'w:footerReference');
  const media=await Promise.all(zip.file(/^word\/media\/[^/]+$/).map(entry=>entry.async('nodebuffer')));
  assert.ok(media.length>0);
  assert.ok(media.every(buffer=>hash(buffer)===hash(png)));
  const reimported=await convertDocument({originalname:'saved.docx',buffer:result.buffer});
  assert.equal(reimported.blockers.length,0);
  assert.equal(load(reimported.preview)('img').length,2);
  assert.equal(reimported.assets[0].digest,hash(png));
});

test('Word-compatible DOC archives MIME images and reimports offline on all platforms',async()=>{
  const result=await exportDocument(document,'doc');
  assert.match(result.buffer.toString(),/multipart\/related/);
  assert.doesNotMatch(result.buffer.toString(),/https?:\/\//);
  const reimported=await convertDocument({originalname:'saved.doc',buffer:result.buffer});
  assert.equal(reimported.blockers.length,0);
  assert.equal(load(reimported.preview)('img').length,2);
  assert.equal(reimported.assets[0].digest,hash(png));
  assert.equal(reimported.stats.tables,1);
  assert.match(load(reimported.preview).text(),/修改后的正文/);
});

test('Word export fails closed for remote, missing, corrupt and unsupported image data',async()=>{
  for(const format of ['docx','doc']) {
    await assert.rejects(()=>exportDocument({...document,blockers:['missing']},format),/图片/);
    for(const preview of [
      '<img src="https://example.invalid/private.png">',
      '<img src="file:///private.png">',
      '<span data-pageport-missing-image="missing">missing</span>',
      '<span data-confluence-image="https://example.invalid/private.png">remote</span>',
      '<img src="data:image/png;base64,AAAA">',
    ])await assert.rejects(()=>exportDocument({preview,blockers:[]},format),/图片/);
  }
  await assert.rejects(()=>exportDocument(document,'exe'),/不支持/);
});

test('Markdown generated from resolved preview keeps companion images self-contained',async()=>{
  const doc=await convertDocument({originalname:'companion.md',buffer:Buffer.from('# 图片\n\n![配套](chart.png)')},[{originalname:'chart.png',buffer:png}]);
  const saved=toMarkdown(doc.preview);
  assert.ok(saved.includes(image));
  const reopened=await convertDocument({originalname:'saved.md',buffer:Buffer.from(saved)});
  assert.equal(reopened.blockers.length,0);
  assert.equal(reopened.assets[0].digest,hash(png));
});

test('large uploads and more than 24 companion images have no fixed size or count cap',async()=>{
  const app=createApp(), agent=request.agent(app);
  try {
    const {body:{csrf}}=await agent.get('/api/bootstrap');
    const source=Buffer.from('# 大文件\n\n<!--'+ 'x'.repeat(22*1024*1024)+'-->\n\n正文');
    const response=await agent.post('/api/convert').set('X-CSRF-Token',csrf).attach('document',source,'large.md');
    assert.equal(response.status,200,JSON.stringify(response.body));
    const largeImage=Buffer.concat([png,Buffer.alloc(7*1024*1024)]);
    const doc=await convertDocument({originalname:'image.md',buffer:Buffer.from('![大图](large.png)')},[{originalname:'large.png',buffer:largeImage}]);
    assert.equal(doc.assets[0].buffer.length,largeImage.length);
    const names=Array.from({length:25},(_,index)=>`image-${index}.png`);
    let upload=agent.post('/api/convert').set('X-CSRF-Token',csrf)
      .attach('document',Buffer.from(names.map(name=>`![图片](${name})`).join('\n\n')),'many.md');
    names.forEach((name,index)=>{upload=upload.attach('images',Buffer.concat([png,Buffer.from([index])]),name);});
    const many=await upload;
    assert.equal(many.status,200,JSON.stringify(many.body));
    assert.equal(many.body.stats.images,25);
  } finally {app.locals.dispose();}
});

test('export API is session-bound, CSRF-protected and uses the latest converted draft',async()=>{
  const app=createApp(), agent=request.agent(app);
  try {
    const {body:{csrf}}=await agent.get('/api/bootstrap');
    const {body:doc}=await agent.post('/api/convert').set('X-CSRF-Token',csrf).attach('document',Buffer.from(html),'draft.html');
    assert.equal((await agent.post(`/api/documents/${doc.id}/export/docx`)).status,403);
    const other=request.agent(app);
    const {body:{csrf:otherCsrf}}=await other.get('/api/bootstrap');
    assert.equal((await other.post(`/api/documents/${doc.id}/export/docx`).set('X-CSRF-Token',otherCsrf)).status,404);
    for(const format of ['docx','doc']) {
      const response=await agent.post(`/api/documents/${doc.id}/export/${format}`).set('X-CSRF-Token',csrf)
        .buffer(true).parse((res,callback)=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>callback(null,Buffer.concat(chunks)));});
      assert.equal(response.status,200);
      const reopened=await convertDocument({originalname:`saved.${format}`,buffer:response.body});
      assert.equal(load(reopened.preview)('img').length,2);
    }
  } finally {app.locals.dispose();}
});

test('local document writes replace complete bytes without leaving temporary files',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'pageport-save-test-'));
  try {
    const target=path.join(directory,'saved.docx');
    await writeFile(target,'original');
    const {buffer}=await exportDocument(document,'docx');
    await documentFiles.writeDocument(target,buffer);
    assert.deepEqual(await readFile(target),buffer);
    assert.deepEqual(await readdir(directory),['saved.docx']);
    await assert.rejects(()=>documentFiles.writeDocument(directory,buffer));
    assert.deepEqual(await readdir(directory),['saved.docx']);
    assert.deepEqual(await readFile(target),buffer);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('DOCX rejects extreme ZIP expansion but allows many ordinary package entries',async()=>{
  const {buffer}=await exportDocument(document,'docx');
  const zip=await JSZip.loadAsync(buffer);
  for(let index=0;index<2100;index++)zip.file(`customXml/item-${index}.xml`,'<item/>');
  const imported=await convertDocument({originalname:'many-parts.docx',buffer:await zip.generateAsync({type:'nodebuffer'})});
  assert.equal(imported.blockers.length,0);
  zip.file('suspicious.bin',Buffer.alloc(2*1024*1024));
  const bomb=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  await assert.rejects(()=>convertDocument({originalname:'bomb.docx',buffer:bomb}),/压缩比例/);
});
