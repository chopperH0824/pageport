import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { load } from 'cheerio';
import JSZip from 'jszip';
import { createApp } from '../server/app.js';
import { convertDocument, cleanHtml } from '../server/convert.js';
import { parseTarget, credentials, contentSignature } from '../server/confluence.js';
import { toMarkdown } from '../src/markdown.js';

const exec = promisify(execFile);
const file = (text, name='test.md') => ({originalname:name, buffer:Buffer.from(text)});
const officeXml = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
async function officeFile(parts, name='sample.docx') {
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="emf" ContentType="image/x-emf"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml',parts.document);
  if(parts.styles)zip.file('word/styles.xml',parts.styles);
  if(parts.numbering)zip.file('word/numbering.xml',parts.numbering);
  if(parts.rels)zip.file('word/_rels/document.xml.rels',parts.rels);
  if(parts.media)zip.file(parts.media.name,parts.media.data);
  return {originalname:name,buffer:await zip.generateAsync({type:'nodebuffer'})};
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZWQAAAAASUVORK5CYII=','base64');

test('real Mark preserves Chinese, emphasis, tables, lists and literal code', async()=>{
  const doc = await convertDocument(file('# 中文标题\n\n**重点** 与 *强调*\n\n|功能|优先级|\n|---|---|\n|控制|P0|\n\n1. 打开\n2. 确认\n\n```json\n{\n  "volume": 50\n}\n```\n'));
  assert.equal(doc.stats.tables,1);
  const $=load(doc.storage,{xmlMode:true});
  assert.equal($('strong').text(),'重点');
  assert.equal($('em').text(),'强调');
  assert.match(doc.storage,/<ol>/);
  assert.match(doc.storage,/<pre><code class="language-json">\{\n  &quot;volume&quot;: 50\n\}/);
  assert.doesNotMatch(doc.storage,/structured-macro|language=/);
});

test('visual editor Markdown retains extended marks, tasks, alignment and merged cells',async()=>{
  const source=toMarkdown('<h2>编辑测试</h2><p><u>下划线</u> <mark>高亮</mark> H<sub>2</sub> x<sup>2</sup> <s>删除</s></p><p style="text-align: center">居中</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox"></label><div><p>完成</p></div></li><li data-type="taskItem" data-checked="false"><div><p>待办</p></div></li></ul><table><tr><th colspan="2">合并</th></tr><tr><td>A</td><td>B</td></tr></table>');
  assert.match(source,/- \[x\] 完成/);
  assert.match(source,/- \[ \] 待办/);
  const doc=await convertDocument(file(source));
  const $=load(doc.preview);
  assert.equal($('u').text(),'下划线');
  assert.equal($('mark').text(),'高亮');
  assert.equal($('sub').text(),'2');
  assert.equal($('sup').text(),'2');
  assert.match(doc.storage,/text-align:center/);
  assert.match(doc.storage,/colspan="2"/);
  assert.match(doc.storage,/<ac:task-status>complete/);
  assert.match(doc.storage,/<ac:task-status>incomplete/);
  assert.equal($('ul[data-type="taskList"] li[data-type="taskItem"]').length,2);
});

test('editor roundtrip preserves regular tables, code language, CJK emphasis and embedded images',async()=>{
  const html='<p><strong>网络不可用：</strong>保留本地能力</p><table><thead><tr><th>功能</th><th>级别</th></tr></thead><tbody><tr><td>语音</td><td>P0</td></tr></tbody></table><pre><code class="language-json">{ "volume": 50 }</code></pre><img src="data:image/png;base64,'+png.toString('base64')+'" alt="test">';
  const source=toMarkdown(html);
  const doc=await convertDocument(file(source));
  assert.equal(doc.stats.tables,1);assert.equal(doc.assets.length,1);
  assert.equal(load(doc.preview)('strong').text(),'网络不可用：');
  assert.match(doc.preview,/language-json/);
  const unsafe=cleanHtml('<p style="text-align:center;position:fixed;background:url(https://evil.test)">test</p><code class="language-js evil">x</code>');
  assert.doesNotMatch(unsafe,/position|background|evil/);
});

test('text colour, colour highlight and paragraph indent survive Markdown and publish as native styles',async()=>{
  const html='<p style="margin-left: 60px; text-align: center">缩进 <span style="color: #c0392b">红色 2*3*4</span> <mark data-color="#c9f2d6" style="background-color: #c9f2d6; color: inherit">绿底</mark> <mark>默认</mark></p><h2 style="margin-left: 30px">标题缩进</h2>';
  const source=toMarkdown(html);
  assert.match(source,/margin-left: 60px/);
  const inline=toMarkdown('<p>前 <span style="color: #1f6fb2">2*3*4</span> 后</p>');
  assert.match(inline,/<span style="color: #1f6fb2">2\\\*3\\\*4<\/span>/);
  const doc=await convertDocument(file(source+'\n'+inline));
  const $=load(doc.preview);
  assert.equal($('span[style="color:#c0392b"]').text(),'红色 2*3*4');
  assert.equal($('mark[data-color="#c9f2d6"]').text(),'绿底');
  assert.equal($('span[style="color:#1f6fb2"]').text(),'2*3*4');
  assert.match(doc.storage,/<p style="margin-left:60px;text-align:center">/);
  assert.match(doc.storage,/<h2 style="margin-left:30px">/);
  const xml=load(doc.storage,{xmlMode:true});
  assert.equal(xml('span[style="background-color: #c9f2d6;"]').text(),'绿底');
  assert.equal(xml('span[style="background-color: rgb(255, 250, 179);"]').text(),'默认');
  assert.doesNotMatch(doc.storage,/<mark|<em>3/);
  const unsafe=cleanHtml('<span style="color:red;position:fixed;background:url(x)">a</span><mark data-color="url(x)" style="background-color:url(javascript:x)">b</mark><p style="margin-left:9999px">c</p>');
  assert.doesNotMatch(unsafe,/red|position|url|9999/);
});

test('panels and status labels become Confluence info/tip/note/warning and status macros',async()=>{
  const html='<div data-pageport-panel="warning"><p>注意 <strong>风险</strong></p><ul><li><p>条目</p></li></ul><pre><code>a\n\n  b</code></pre></div><p>进度 <span data-pageport-status="green">已完成</span> 后续</p><div data-pageport-panel="tip"><p>提示</p></div>';
  const source=toMarkdown(html);
  assert.match(source,/<div data-pageport-panel="warning">\n\n注意 \*\*风险\*\*/);
  const doc=await convertDocument(file(source));
  const xml=load(doc.storage,{xmlMode:true});
  const warning=xml('ac\\:structured-macro[ac\\:name="warning"]');
  assert.equal(warning.length,1);
  assert.equal(warning.find('ac\\:rich-text-body strong').text(),'风险');
  assert.equal(warning.find('ac\\:rich-text-body li').length,1);
  assert.match(warning.find('pre').text(),/^a\n\n  b\n?$/);
  assert.equal(xml('ac\\:structured-macro[ac\\:name="tip"]').length,1);
  const status=xml('ac\\:structured-macro[ac\\:name="status"]');
  assert.equal(status.find('ac\\:parameter[ac\\:name="colour"]').text(),'Green');
  assert.equal(status.find('ac\\:parameter[ac\\:name="title"]').text(),'已完成');
  assert.doesNotMatch(doc.storage,/data-pageport/);
  const $=load(doc.preview);
  assert.equal($('[data-pageport-panel="warning"] strong').text(),'风险');
  assert.equal($('[data-pageport-status="green"]').text(),'已完成');
  const again=await convertDocument(file(toMarkdown(doc.preview)));
  assert.equal(again.digest,doc.digest);
  const hostile=await convertDocument(file('<div data-pageport-panel="include"><p>x</p></div>\n\n<p><span data-pageport-status="evil"><b>超长</b>'+'很'.repeat(80)+'</span></p>'));
  const hx=load(hostile.storage,{xmlMode:true});
  assert.equal(hx('ac\\:structured-macro[ac\\:name="info"]').length,1);
  assert.equal(hx('ac\\:parameter[ac\\:name="colour"]').text(),'Grey');
  assert.equal(hx('ac\\:parameter[ac\\:name="title"]').text().length,40);
  assert.doesNotMatch(hostile.storage,/include|evil|<b>/);
});

test('TOC marker becomes a bounded native macro and clickable preview without duplicating text',async()=>{
  const marker='<div data-pageport-toc="true" data-min-level="2" data-max-level="3"></div>';
  const source=toMarkdown(marker+'<h1>产品</h1><h2>概述</h2><h3>范围</h3><h4>细节</h4><h2>概述</h2>');
  assert.match(source,/data-pageport-toc="true"/);
  const doc=await convertDocument(file(source));
  const $=load(doc.preview), xml=load(doc.storage,{xmlMode:true});
  assert.equal(xml('ac\\:structured-macro[ac\\:name="toc"]').length,1);
  assert.equal(xml('ac\\:parameter[ac\\:name="minLevel"]').text(),'2');
  assert.equal(xml('ac\\:parameter[ac\\:name="maxLevel"]').text(),'3');
  const links=$('[data-pageport-toc] a');
  assert.equal(links.length,3);
  for(const link of links.toArray())assert.equal($( $(link).attr('href') ).length,1);
  assert.equal(new Set(links.toArray().map(link=>$(link).attr('href'))).size,3);
  assert.equal(xml('h2').length,2);
  const again=await convertDocument(file(toMarkdown(doc.preview)));
  assert.equal(load(again.storage,{xmlMode:true})('ac\\:structured-macro').length,1);
  assert.equal(again.stats.headings,5);
  const anchor=await convertDocument(file('[TOC]\n\n<h2 id="existing-anchor">Existing</h2>\n\n[Jump](#existing-anchor)'));
  assert.equal(load(anchor.preview)('h2').attr('id'),'existing-anchor');
  assert.equal(load(anchor.preview)('[data-pageport-toc] a').attr('href'),'#existing-anchor');
});

test('TOC shorthand skips fenced code and arbitrary macro input is never executable',async()=>{
  const doc=await convertDocument(file('[TOC]\n\n# A\n\n```md\n[TOC]\n```\n\n<ac:structured-macro ac:name="include"><ac:parameter ac:name="">secret</ac:parameter></ac:structured-macro>'));
  const $=load(doc.storage,{xmlMode:true});
  assert.equal($('ac\\:structured-macro').length,1);
  assert.equal($('ac\\:structured-macro').attr('ac:name'),'toc');
  assert.match($('pre').text(),/\[TOC\]/);
  const bounded=await convertDocument(file('<div data-pageport-toc="true" data-min-level="-9" data-max-level="999"><h1>fake</h1><script>bad()</script></div>\n\n# Real'));
  assert.equal(bounded.stats.headings,1);
  assert.equal(load(bounded.storage,{xmlMode:true})('ac\\:parameter[ac\\:name="maxLevel"]').text(),'6');
  assert.doesNotMatch(bounded.storage,/fake|bad\(\)/);
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

test('WPS-style headings, text boxes, Chinese numbering and unknown images stay visible',async()=>{
  const styled=await officeFile({
    styles:`<w:styles xmlns:w="${officeXml}"><w:style w:type="paragraph" w:styleId="a1"><w:name w:val="标题 1"/></w:style></w:styles>`,
    document:`<w:document xmlns:w="${officeXml}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body><w:p><w:pPr><w:pStyle w:val="a1"/></w:pPr><w:r><w:t>章节</w:t></w:r></w:p><w:p><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>第二节</w:t></w:r></w:p><mc:AlternateContent><mc:Choice Requires="wps"><w:txbxContent><w:p><w:r><w:t>文本框正文</w:t></w:r></w:p></w:txbxContent></mc:Choice><mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:body></w:document>`,
  });
  const styledDoc=await convertDocument(styled);
  const styledHtml=load(styledDoc.storage,{xmlMode:true});
  assert.equal(styledHtml('h1').text(),'章节');
  assert.equal(styledHtml('h2').text(),'第二节');
  assert.match(styledHtml.text(),/文本框正文/);
  const numbered=await officeFile({
    numbering:`<w:numbering xmlns:w="${officeXml}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="chineseCounting"/><w:lvlText w:val="%1、"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimalEnclosedCircle"/><w:lvlText w:val="（%2）"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    document:`<w:document xmlns:w="${officeXml}"><w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>背景</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>细节</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>方案</w:t></w:r></w:p></w:body></w:document>`,
  });
  const numberedDoc=await convertDocument(numbered);
  const numberedText=load(numberedDoc.storage,{xmlMode:true}).text();
  assert.match(numberedText,/一、背景/);
  assert.match(numberedText,/（①）细节/);
  assert.match(numberedText,/二、方案/);
  assert.doesNotMatch(numberedDoc.storage,/<ol>/);
  const image=await officeFile({
    rels:'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.emf"/></Relationships>',
    media:{name:'word/media/image1.emf',data:Buffer.from('not-an-image')},
    document:`<w:document xmlns:w="${officeXml}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:t>前后文</w:t></w:r><w:r><w:drawing><wp:inline><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>`,
  });
  const imageDoc=await convertDocument(image);
  const imageText=load(imageDoc.storage,{xmlMode:true}).text();
  assert.match(imageText,/前后文/);
  assert.match(imageText,/未转换的图片/);
  assert.match(imageDoc.warnings.join('\n'),/图片格式无法放入页面/);
  const wps=await officeFile({document:`<w:document xmlns:w="${officeXml}"><w:body><w:p><w:r><w:t>金山正文</w:t></w:r></w:p></w:body></w:document>`},'方案.wps');
  await assert.rejects(()=>convertDocument(wps),/另存为 DOCX/);
});

test('legacy .doc files convert on macOS',async(t)=>{
  if(process.platform!=='darwin'){t.skip('Legacy binary Office conversion requires macOS textutil.');return;}
  const source=await officeFile({document:`<w:document xmlns:w="${officeXml}"><w:body><w:p><w:r><w:t>旧版正文</w:t></w:r></w:p></w:body></w:document>`});
  const dir=await mkdtemp(path.join(tmpdir(),'pageport-doc-'));
  try {
    const docx=path.join(dir,'input.docx');
    const doc=path.join(dir,'input.doc');
    await writeFile(docx,source.buffer);
    await exec('/usr/bin/textutil',['-convert','doc','-output',doc,docx]);
    const converted=await convertDocument({originalname:'旧版.doc',buffer:await readFile(doc)});
    assert.match(load(converted.storage,{xmlMode:true}).text(),/旧版正文/);
    assert.match(converted.warnings.join('\n'),/旧版/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('styled Confluence tables stay HTML so column width and cell colour survive editing',()=>{
  const source=toMarkdown('<table style="width: 28.379%"><tbody><tr><td style="text-align: center; background-color: #fffae6">P0</td><td>基础功能</td></tr></tbody></table>');
  assert.match(source,/width:\s*28\.379%/);
  assert.match(source,/background-color:\s*#fffae6/i);
  assert.match(source,/text-align:\s*center/);
});

test('Confluence web Word export restores tables, colours, ticks and page links',async()=>{
  const html='<html><head><title>模板</title></head><body><h1>模板</h1><table class="confluenceTable"><tr><td class="highlight-#fffae6 confluenceTd" style="text-align: center;">P0</td><td>基础功能</td></tr></table><p><img class="emoticon emoticon-tick" data-emoticon-name="tick" alt="(滴答)" src="tick.svg"></p><p><a href="/pages/viewpage.action?pageId=68254847">相关页</a> <a href="https://confluence.example.com/pages/viewpage.action?pageId=1">外链</a></p></body></html>';
  const qp=[...Buffer.from(html,'utf8')].map(byte => byte===61 || byte>126 || byte<32 && byte!==10 && byte!==13 ? `=${byte.toString(16).toUpperCase().padStart(2,'0')}` : String.fromCharCode(byte)).join('');
  const mime=Buffer.from(`Date: Thu, 15 Oct 2026 14:25:35 +0800\r\nSubject: Exported From Confluence\r\nMIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="----=_Part_1"\r\n\r\n------=_Part_1\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qp.replace(/\n/g,'\r\n')}\r\n------=_Part_1--\r\n`,'latin1');
  const doc=await convertDocument({originalname:'模板.doc',buffer:mime});
  const $=load(doc.storage,{xmlMode:true});
  assert.equal(doc.title,'模板');
  assert.equal($('td').first().text(),'P0');
  assert.match($('td').first().attr('style') || '',/background-color:\s*#fffae6/i);
  assert.match($('td').first().attr('style') || '',/text-align:\s*center/);
  assert.match(doc.storage,/<ac:emoticon ac:name="tick"\s*\/>/);
  assert.match(doc.storage,/https:\/\/confluence\.example\.com\/pages\/viewpage\.action\?pageId=68254847/);
  assert.doesNotMatch(load(doc.storage,{xmlMode:true}).text(),/MIME-Version|quoted-printable/);
});

test('the private Confluence PRD template imports as the original page',async(t)=>{
  let buffer;
  try { buffer=await readFile(new URL('../local-private/fixtures/confluence-prd-template.doc',import.meta.url)); }
  catch(error) {
    if(error.code!=='ENOENT')throw error;
    t.skip('Private template is not available in this checkout.');
    return;
  }
  const doc=await convertDocument({originalname:'private-template.doc',buffer});
  const text=load(doc.storage,{xmlMode:true}).text().replace(/\s+/g,'');
  assert.ok(doc.title);
  assert.equal(doc.stats.tables,5);
  assert.ok(text.length > 100);
  assert.equal((doc.storage.match(/<ac:emoticon ac:name="tick"\s*\/>/g) || []).length,129);
  assert.match(doc.storage,/background-color:\s*#fffae6/i);
  assert.equal(doc.blockers.length,0);
  assert.doesNotMatch(text,/MIME-Version|quoted-printable|xmlns:w/);
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
  return {agent,post,boot,dir,calls,cleanupBackups:()=>app.locals.cleanupBackups(),setPage:p=>{page={...page,...p};}};
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

test('backup list, download, retention policy and guarded restore APIs',async t=>{
  const h=await harness(t);
  const documentId=await upload(h);
  const checked=await h.post('/check',{...auth,url,documentId}).expect(200);
  const published=await h.post('/publish',{...auth,token:checked.body.token,confirmTitle:'Test page',acknowledge:true}).expect(200);
  const list=await h.agent.get('/api/backups').expect(200);
  assert.equal(list.body.retentionDays,7);
  assert.equal(list.body.items.length,1);
  const backup=list.body.items[0];
  assert.equal(backup.id,'12');
  assert.equal(backup.version,1);
  assert.equal(backup.title,'Test page');
  assert.equal(typeof backup.createdAt,'string');
  assert.equal(typeof backup.size,'number');
  assert.equal(published.body.backup,backup.name);
  const download=await h.agent.get('/api/backups/'+backup.name+'/download').expect(200);
  assert.match(download.headers['content-disposition'],/attachment/);
  assert.match(download.text,/Original body/);
  assert.doesNotMatch(download.text,/transient-password-only|Authorization/);
  await h.agent.put('/api/backup-settings').set('X-CSRF-Token',h.boot.csrf).send({retentionDays:0}).expect(200);
  assert.equal((await h.agent.get('/api/backup-settings')).body.retentionDays,null);
  const restoreCheck=await h.post('/backups/'+backup.name+'/restore-check',{...auth,url}).expect(200);
  assert.equal(restoreCheck.body.target.version,2);
  assert.equal(restoreCheck.body.backup.name,backup.name);
  h.setPage({version:{number:3}});
  await h.post('/backups/'+backup.name+'/restore',{...auth,token:restoreCheck.body.token,confirmTitle:'Test page',acknowledge:true}).expect(409);
  const secondCheck=await h.post('/backups/'+backup.name+'/restore-check',{...auth,url}).expect(200);
  const restored=await h.post('/backups/'+backup.name+'/restore',{...auth,token:secondCheck.body.token,confirmTitle:'Test page',acknowledge:true}).expect(200);
  assert.equal(restored.body.verification,'matched');
  assert.equal(restored.body.version,4);
  assert.equal(restored.body.restoredFrom,backup.name);
  assert.ok(restored.body.backup);
  const afterRestore=await h.agent.get('/api/backups').expect(200);
  assert.equal(afterRestore.body.items.length,2);
  assert.doesNotMatch(JSON.stringify(afterRestore.body),/transient-password-only|Authorization/);
  await h.agent.get('/api/backups/not-a-backup/download').expect(400);
  const oldName='12-v1-'+(Date.now()-8*24*60*60*1000)+'-deadbeef.json';
  await writeFile(path.join(h.dir,'backups',oldName),JSON.stringify({id:'12',type:'page',status:'current',title:'Old',version:{number:1},body:{storage:{value:'<p>Old</p>'}}}));
  // A snapshot that predates the retention feature is protected from the
  // default policy until the user explicitly saves a policy.
  await h.cleanupBackups();
  assert.ok((await readdir(path.join(h.dir,'backups'))).includes(oldName));
  await h.agent.put('/api/backup-settings').set('X-CSRF-Token',h.boot.csrf).send({retentionDays:7}).expect(200);
  await assert.rejects(()=>readFile(path.join(h.dir,'backups',oldName)),{code:'ENOENT'});
});

test('conversion failures retain current draft, but every conversion invalidates the old publish plan',async t=>{
  const h=await harness(t);
  const documentId=await upload(h);
  const checked=await h.post('/check',{...auth,url,documentId}).expect(200);
  await h.agent.post('/api/convert').set('X-CSRF-Token',h.boot.csrf).attach('document',Buffer.from('bad'),'bad.pdf').expect(400);
  await h.agent.get('/api/documents/'+documentId+'/storage').expect(200);
  await h.post('/publish',{...auth,token:checked.body.token,confirmTitle:'Test page',acknowledge:true}).expect(409);
  assert.equal(h.calls.filter(c=>c.method==='PUT').length,0);
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
