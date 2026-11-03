import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import JSZip from 'jszip';
import { convertDocument } from '../server/convert.js';
import { extractConfluenceExport } from '../server/confluence-export.js';
import { restoreOfficeDetails } from '../server/office-details.js';
import { toMarkdown } from '../src/markdown.js';
import { tableLayoutStyle } from '../server/table-layout.js';

const table='<table style="width:720px;table-layout:fixed"><colgroup><col style="width:180px"><col style="width:540px"></colgroup><tbody><tr style="height:48px"><th style="width:180px;padding:6px 8px;vertical-align:middle">Column A</th><th style="width:540px">Column B</th></tr><tr><td colspan="2" style="height:64px">Merged content</td></tr></tbody></table>';
const signature=html=>{
  const $=load(html);
  return ['table','col','tr','th','td'].map(tag=>$(tag).toArray().map(node=>({style:$(node).attr('style') || '',colspan:$(node).attr('colspan') || '',rowspan:$(node).attr('rowspan') || ''})));
};
test('absolute table, column, cell and row dimensions survive repeated editor serialization and publication conversion',async()=>{
  let doc=await convertDocument({originalname:'table.html',buffer:Buffer.from('<h1>Public layout</h1>'+table)});
  const baseline=signature(doc.storage);
  assert.match(doc.storage,/width:720px|width: 720px/);
  assert.match(doc.storage,/height:48px|height: 48px/);
  for(let round=0;round<3;round++) {
    assert.equal(doc.stats.tables,1);
    assert.deepEqual(signature(doc.preview),baseline);
    assert.deepEqual(signature(doc.storage),baseline);
    doc=await convertDocument({originalname:'edited.md',buffer:Buffer.from(toMarkdown(doc.preview))});
  }
});

test('Confluence MIME table pixel widths are retained along with percentage and nested table layout',async()=>{
  const html=table+'<table width="75%"><tr><td width="96" height="30"><table style="width:2in"><tr><td>Nested</td></tr></table></td></tr></table>';
  const body=Buffer.from(html).toString('base64');
  const mime=Buffer.from(`Subject: Exported From Confluence\r\nMIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=public-table\r\n\r\n--public-table\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}\r\n--public-table--\r\n`);
  const extracted=await extractConfluenceExport(mime);
  const $=load(extracted.html);
  assert.match($('col').first().attr('style'),/width: 180px/);
  assert.match($('table').eq(1).attr('style'),/width: 75%/);
  assert.match($('table table').attr('style'),/width: 192px/);
  const doc=await convertDocument({originalname:'export.doc',buffer:mime});
  assert.equal(doc.stats.tables,3);
  assert.match(doc.storage,/width: ?180px/);
  assert.match(doc.storage,/width: ?75%/);
  assert.match(doc.storage,/height: ?30px/);
});

test('DOCX grid, table width, row height and margins restore only on matching structures',async()=>{
  const zip=new JSZip();
  zip.file('word/document.xml',`<w:document xmlns:w="w"><w:body><w:tbl>
    <w:tblPr><w:tblW w:w="10800" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr>
    <w:tblGrid><w:gridCol w:w="2700"/><w:gridCol w:w="8100"/></w:tblGrid>
    <w:tr><w:trPr><w:trHeight w:val="720" w:hRule="atLeast"/></w:trPr>
    <w:tc><w:tcPr><w:tcW w:w="2700" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr></w:tc>
    <w:tc><w:tcPr><w:tcW w:w="8100" w:type="dxa"/></w:tcPr></w:tc></w:tr></w:tbl></w:body></w:document>`);
  const bytes=await zip.generateAsync({type:'nodebuffer'});
  const output=load(await restoreOfficeDetails(bytes,'<table><tr><td>A</td><td>B</td></tr></table>'));
  assert.equal(output('table').attr('style'),'width: 720px; table-layout: fixed');
  assert.deepEqual(output('col').toArray().map(node=>output(node).attr('style')),['width: 180px','width: 540px']);
  assert.equal(output('tr').attr('style'),'height: 48px');
  assert.match(output('td').first().attr('style'),/padding-left: 8px; width: 180px; vertical-align: middle/);
  const mismatch=await restoreOfficeDetails(bytes,'<table><tr><td colspan="2">Merged</td></tr></table>');
  assert.doesNotMatch(load(mismatch)('td').attr('style') || '',/width|padding/);
});

test('layout normalization accepts absolute units and safe spacing but rejects active or unsupported CSS',async()=>{
  assert.equal(tableLayoutStyle('width:50%;height:1in;padding:0 6pt;vertical-align:middle'),'width: 50%; height: 96px; padding: 0px 8px; vertical-align: middle');
  assert.equal(tableLayoutStyle('width:expression(alert(1));height:url(https://example.invalid);padding:calc(1px);position:fixed;white-space:invalid'),'');
  const doc=await convertDocument({originalname:'unsafe.html',buffer:Buffer.from('<h1>Safe</h1><table style="width:420px;position:fixed;background-image:url(https://example.invalid)"><tr style="height:30px"><td style="padding:8px;overflow:hidden" onclick="bad()">Content</td></tr></table>')});
  assert.doesNotMatch(doc.storage,/position|background-image|onclick|overflow/);
  assert.match(doc.storage,/width: ?420px/);
  assert.match(doc.storage,/padding: ?8px/);
});
