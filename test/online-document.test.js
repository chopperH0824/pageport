import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { normalizeOnlineDocument, normalizeClipboardHtml } from '../server/online-document.js';
import { convertDocument } from '../server/convert.js';
import JSZip from 'jszip';
import { restoreOfficeDetails } from '../server/office-details.js';

test('Office table shading is restored only with matching cell counts',async()=>{
  const zip=new JSZip();
  zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:tcPr><w:shd w:fill="DDFFEE"/></w:tcPr></w:tc></w:tr></w:tbl></w:body></w:document>');
  const buffer=await zip.generateAsync({type:'nodebuffer'});
  const restored=await restoreOfficeDetails(buffer,'<table><tr><td colspan="2" style="text-align:center">内容</td></tr></table>');
  assert.match(restored,/background-color:#DDFFEE/);
  assert.match(restored,/text-align:center/);
  assert.doesNotMatch(await restoreOfficeDetails(buffer,'<p>内容</p>'),/background-color/);
});

test('font size survives editor serialization and Confluence conversion',async()=>{
  const {toMarkdown}=await import('../src/markdown.js');
  const source=toMarkdown('<p><span style="font-size: 24px">标题文字</span></p>');
  const result=await convertDocument({originalname:'format.md',buffer:Buffer.from(source)});
  assert.match(result.storage,/font-size:\s*24px/);
});

test('online rich text preserves explicit panels, statuses and nested tasks',()=>{
  const result=normalizeOnlineDocument('<div data-type="callout" data-callout-type="success"><p>提示</p></div><span data-type="status" data-color="green">完成</span><ul><li><label><input type="checkbox" checked></label><p>任务</p><ul><li data-type="todo" data-checked="false">子任务</li></ul></li></ul><p>☐ 文本任务</p>');
  const $=load(result.html);
  assert.equal($('[data-pageport-panel="tip"]').text(),'提示');
  assert.equal($('[data-pageport-status="green"]').text(),'完成');
  assert.equal($('li[data-checked="true"]').length,1);
  assert.equal($('li[data-checked="false"]').length,2);
  assert.equal($('input').length,0);
});

test('clipboard removes active elements and external images without losing local images',()=>{
  const result=normalizeClipboardHtml('<script>alert(1)</script><iframe src="https://example.invalid"></iframe><p>内容<img src="https://example.invalid/private?token=secret" alt="示意图"><img src="data:image/png;base64,abcd"></p><span style="color:green">普通文字</span>');
  assert.doesNotMatch(result.html,/secret|iframe|script|example.invalid/);
  assert.match(load(result.html).text(),/待补充图片：示意图/);
  assert.match(result.html,/data:image\/png/);
  assert.doesNotMatch(result.html,/data-pageport-status/);
  assert.equal(result.warnings.length,1);
});

test('online export semantics reach Confluence macros and missing images block publication',async()=>{
  const result=await convertDocument({originalname:'在线导出.html',buffer:Buffer.from('<div data-type="alert" data-alert-type="warning"><p>注意</p></div><span data-type="status-tag" data-color="blue">进行中</span><ul><li><input type="checkbox" checked>已完成</li></ul><table><tr><td colspan="2" style="background-color:#ddffee;text-align:center">合并</td></tr></table><img src="https://example.invalid/private.png">')});
  assert.match(result.storage,/ac:name="warning"/);
  assert.match(result.storage,/ac:name="status"/);
  assert.match(result.storage,/<ac:task-status>complete/);
  assert.match(result.storage,/colspan="2"/);
  assert.match(result.storage,/background-color:\s*#ddffee/);
  assert.equal(result.blockers.length,1);
  assert.doesNotMatch(result.storage,/example.invalid/);
});

test('clipboard missing-image markers survive editing and block publishing',async()=>{
  const {toMarkdown}=await import('../src/markdown.js');
  const normalized=normalizeClipboardHtml('<p>正文<img src="https://example.invalid/private.png" alt="图一"></p>');
  const source=toMarkdown(normalized.html);
  const result=await convertDocument({originalname:'clipboard.md',buffer:Buffer.from(source)});
  assert.equal(result.blockers.length,1);
  assert.match(result.blockers[0],/图一/);
  assert.doesNotMatch(result.storage,/example.invalid/);
});
