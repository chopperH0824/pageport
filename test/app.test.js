import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { load } from 'cheerio';
import JSZip from 'jszip';
import { createApp } from '../server/app.js';
import { convertDocument, cleanHtml } from '../server/convert.js';
import { parseTarget, credentials, contentSignature } from '../server/confluence.js';

const file = (text, name='test.md') => ({originalname:name, buffer:Buffer.from(text)});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZWQAAAAASUVORK5CYII=','base64');

test('real Mark preserves Chinese, emphasis, tables, lists and literal code', async()=>{
  const doc = await convertDocument(file('# 中文标题\n\n**重点** 与 *强调*\n\n|功能|优先级|\n|---|---|\n|控制|P0|\n\n1. 打开\n2. 确认\n\n```json\n{\n  "volume": 50\n}\n```\n'));
  assert.equal(doc.stats.tables,1);
  const $=load(doc.storage,{xmlMode:true});
  assert.equal($('strong').text(),'重点');
  assert.equal($('em').text(),'强调');
  assert.match(doc.storage,/<ol>/);
  assert.match(doc.storage,/<pre><code>\{\n  &quot;volume&quot;: 50\n\}/);
  assert.doesNotMatch(doc.storage,/structured-macro|language=/);
});

test('HTML retains merged cells but strips executable content and Mark metadata',async()=>{
  const doc = await convertDocument(file('<!-- Include: /etc/passwd -->\n# Safe\n<script>alert(1)</script><iframe src="file:///etc/passwd"></iframe><p onclick="x()"><a href="javascript:alert(1)">x</a></p><table><tr><td colspan="2">合并</td></tr></table>'));
  assert.match(doc.storage,/colspan="2"/);
  assert.doesNotMatch(doc.storage,/script|iframe|onclick|javascript|root:|Include:/);
  assert.ok(doc.warnings.length);
  assert.doesNotMatch(cleanHtml('<img src="file:///secret"><ac:structured-macro ac:name="include"/>'),/file:|ac:/);
});

test('images use attachments; missing images block publishing; no remote fetch',async()=>{
  const doc = await convertDocument(file('# Image\n\n![图](assets/a.png)'),[{originalname:'a.png',buffer:png}]);
  assert.equal(doc.assets.length,1);
  assert.match(doc.storage,/<ac:image><ri:attachment ri:filename="pageport-/);
  assert.match(doc.preview,/src="data:image\/png;base64,/);
  assert.equal(doc.blockers.length,0);
  const missing = await convertDocument(file('![remote](https://example.com/tracker.png)'));
  assert.equal(missing.blockers.length,1);
  assert.equal(missing.assets.length,0);
  await assert.rejects(()=>convertDocument(file('![x](a.png)'),[{originalname:'a.png',buffer:Buffer.from('<svg/>')}]),/图片格式/);
});

test('text is escaped, unsupported documents and invalid ZIP rejected',async()=>{
  const doc = await convertDocument(file('<script>literal</script>\nnext','text.txt'));
  assert.match(doc.storage,/&lt;script&gt;/);
  await assert.rejects(()=>convertDocument(file('bad','file.pdf')),/暂不支持/);
  await assert.rejects(()=>convertDocument(file('bad','file.docx')),/Word/);
});

test('Word headings, bold text and tables survive a valid DOCX conversion',async()=>{
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Word text</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');
  const doc=await convertDocument({originalname:'test.docx',buffer:await zip.generateAsync({type:'nodebuffer'})});
  assert.match(doc.storage,/<strong>Word text<\/strong>/);
  assert.equal(doc.stats.tables,1);
  assert.ok(doc.warnings.length);
});

test('targets are fixed allowlisted HTTPS origins, credentials validated',()=>{
  const hosts=['wiki.example.com'];
  assert.equal(parseTarget('https://wiki.example.com/pages/viewpage.action?pageId=12',hosts).id,'12');
  assert.equal(parseTarget('https://wiki.example.com/spaces/ENG/pages/12/Test',hosts).id,'12');
  for(const url of ['http://wiki.example.com/pages/viewpage.action?pageId=12','https://evil.example/pages/viewpage.action?pageId=12','https://wiki.example.com.evil.example/pages/viewpage.action?pageId=12','https://u:p@wiki.example.com/pages/viewpage.action?pageId=12','https://127.0.0.1/pages/viewpage.action?pageId=12','https://wiki.example.com:8080/pages/viewpage.action?pageId=12']) assert.throws(()=>parseTarget(url,hosts));
  assert.throws(()=>credentials({username:'u:p',password:'pass'}));
  assert.throws(()=>credentials({username:'u',password:'pass\ninjection'}));
});

async function harness(t, options={}) {
  const dir = await mkdtemp(path.join(tmpdir(),'pageport-test-'));
  let page = {id:'12',type:'page',status:'current',title:'Test page',space:{key:'TEST'},version:{number:1},body:{storage:{value:'<p>Original body</p>'}}};
  const calls=[];
  const fetcher=async(url,init)=>{
    calls.push({url,method:init.method || 'GET'});
    if(options.deny) return new Response('{}',{status:401});
    if(init.method==='PUT') {
      assert.ok((await readdir(path.join(dir,'backups'))).length,'backup exists BEFORE PUT');
      const body=JSON.parse(init.body);
      assert.equal(body.version.number,page.version.number+1);
      page={...page,version:body.version,body:body.body};
    }
    return Response.json(page);
  };
  const app=createApp({fetcher,dataDir:dir,allowedHosts:['wiki.example.com'],...options});
  const agent=request.agent(app);
  const boot=(await agent.get('/api/bootstrap')).body;
  const post=(route,body)=>agent.post('/api'+route).set('X-CSRF-Token',boot.csrf).send(body);
  t.after(async()=>{app.locals.dispose();await rm(dir,{recursive:true,force:true});});
  return {agent,post,boot,dir,calls,setPage:p=>{page={...page,...p};}};
}
const auth={username:'tester',password:'transient-password-only'};
const url='https://wiki.example.com/pages/viewpage.action?pageId=12';
async function upload(h) {
  const response=await h.agent.post('/api/convert').set('X-CSRF-Token',h.boot.csrf).attach('document',Buffer.from('# New body\n\n**Changed**'),'test.md').expect(200);
  return response.body.id;
}

test('access gate, CSRF and cross-origin rejection',async t=>{
  const h=await harness(t,{accessPassword:'a-long-private-access-password'});
  assert.equal(h.boot.authenticated,false);
  assert.deepEqual(h.boot.hosts,[]);
  await h.agent.post('/api/login').send({password:'x'}).expect(403);
  await h.post('/login',{password:'wrong'}).expect(401);
  await h.post('/login',{password:'a-long-private-access-password'}).expect(200);
  await h.agent.post('/api/logout').set('X-CSRF-Token',h.boot.csrf).set('Origin','https://evil.example').send({}).expect(403);
});

test('mocked complete publish, protected backup, readback and no replay',async t=>{
  const h=await harness(t);
  const documentId=await upload(h);
  const check=await h.post('/check',{...auth,url,documentId}).expect(200);
  const token=check.body.token;
  await h.post('/publish',{...auth,token,confirmTitle:'Wrong',acknowledge:true}).expect(400);
  await h.agent.get('/api/backups/'+token).expect(200);
  const result=await h.post('/publish',{...auth,token,confirmTitle:'Test page',acknowledge:true}).expect(200);
  assert.equal(result.body.verification,'matched');
  assert.equal(result.body.version,2);
  assert.equal(h.calls.filter(c=>c.method==='PUT').length,1);
  const backup=await readFile(path.join(h.dir,'backups',(await readdir(path.join(h.dir,'backups')))[0]),'utf8');
  assert.match(backup,/Original body/);
  assert.doesNotMatch(backup,/transient-password-only|Authorization/);
  await h.post('/publish',{...auth,token,confirmTitle:'Test page',acknowledge:true}).expect(409);
});

test('concurrent edits and inline comments prevent overwrite',async t=>{
  const h=await harness(t);
  const documentId=await upload(h);
  const check=await h.post('/check',{...auth,url,documentId}).expect(200);
  h.setPage({version:{number:2}});
  await h.post('/publish',{...auth,token:check.body.token,confirmTitle:'Test page',acknowledge:true}).expect(409);
  assert.equal(h.calls.filter(c=>c.method==='PUT').length,0);
  h.setPage({body:{storage:{value:'<p><ac:inline-comment-marker ac:ref="1">Comment</ac:inline-comment-marker></p>'}}});
  await h.post('/check',{...auth,url,documentId}).expect(409);
});

test('upstream authentication error is bounded and never exposes secrets',async t=>{
  const h=await harness(t,{deny:true});
  const documentId=await upload(h);
  const response=await h.post('/check',{...auth,url,documentId}).expect(401);
  assert.doesNotMatch(JSON.stringify(response.body),/transient-password-only|Basic /);
});

test('signature retains text and structure counts',()=>{
  assert.deepEqual(contentSignature('<table><tr><td>Hello</td></tr></table>'),{text:'Hello',tables:1,rows:1,images:0});
});

test('desktop backend rejects browsers without per-launch token and auto-opens private session',async t=>{
  const token='local-only-per-launch-test-secret';
  const app=createApp({desktopToken:token,accessPassword:token,production:true});
  t.after(()=>app.locals.dispose());
  await request(app).get('/api/bootstrap').expect(403);
  const response=await request(app).get('/api/bootstrap').set('X-PagePort-Desktop',token).expect(200);
  assert.equal(response.body.desktop,true);
  assert.equal(response.body.authenticated,true);
  assert.equal(response.body.requiresAccess,false);
  assert.doesNotMatch(response.headers['set-cookie'].join(';'),/;\s*Secure/i);
});
