import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import mammoth from 'mammoth';
import sanitizeHtml from 'sanitize-html';
import { load } from 'cheerio';
import { fileTypeFromBuffer } from 'file-type';
import yauzl from 'yauzl';

const exec = promisify(execFile);
const md = new MarkdownIt({ html: true, linkify: true, breaks: false }).use(taskLists);
md.block.ruler.before('paragraph','pageport_toc',(state,start,end,silent)=>{
  const line=state.src.slice(state.bMarks[start]+state.tShift[start],state.eMarks[start]);
  if(state.sCount[start]-state.blkIndent>=4 || !/^\[toc\]\s*$/i.test(line))return false;
  if(!silent) {
    const token=state.push('html_block','',0);
    token.content='<div data-pageport-toc="true" data-min-level="1" data-max-level="6"></div>\n';
    token.map=[start,start+1];state.line=start+1;
  }
  return true;
});
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const allowedTags = [
  'p','br','h1','h2','h3','h4','h5','h6','strong','b','em','i','u','s','del',
  'sub','sup','ul','ol','li','blockquote','pre','code','hr','table','thead',
  'tbody','tfoot','tr','th','td','caption','a','img','span','div','mark',
];
export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const hash = value => createHash('sha256').update(value).digest('hex');
const escape = text => String(text).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const colorValue = [/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i];
const blockStyle = {'text-align':[/^(left|center|right|justify)$/], 'margin-left':[/^\d{1,3}(?:\.\d+)?px$/]};
const panelTypes = new Set(['info','tip','note','warning']);
const statusColours = {grey:'Grey',blue:'Blue',green:'Green',yellow:'Yellow',red:'Red'};
const DEFAULT_HIGHLIGHT = 'rgb(255, 250, 179)';
const isColor = value => colorValue.some(pattern => pattern.test(value || ''));

export function cleanHtml(html) {
  return sanitizeHtml(html, {
    allowedTags,
    allowedAttributes: {
      '*': ['id'], a: ['href','title'], img: ['src','alt','width','height'],
      p:['style'], h1:['style'],h2:['style'],h3:['style'],h4:['style'],h5:['style'],h6:['style'],
      ul:['data-type'],li:['data-type','data-checked'],code:['class'],
      td: ['colspan','rowspan'], th: ['colspan','rowspan','scope'],
      ol: ['start'], span: ['data-image-ref','data-pageport-status','style'], mark: ['data-color','style'],
      div:['data-pageport-toc','data-min-level','data-max-level','data-pageport-panel'],
    },
    allowedClasses:{code:[/^language-[a-zA-Z0-9_-]+$/]},
    allowedStyles:{
      '*':{'text-align':blockStyle['text-align']},
      p:blockStyle, h1:blockStyle, h2:blockStyle, h3:blockStyle, h4:blockStyle, h5:blockStyle, h6:blockStyle,
      span:{color:colorValue}, mark:{'background-color':colorValue, color:[/^inherit$/]},
    },
    transformTags:{mark:(tagName,attribs)=>{
      const {['data-color']:color,...rest}=attribs;
      return {tagName,attribs:isColor(color)?attribs:rest};
    }},
    allowedSchemes: ['https','http','mailto','data'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
  });
}

// Check the ZIP directory before handing DOCX to a converter: no zip bombs or encrypted entries.
async function checkDocx(buffer) {
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(new AppError('Word 文件损坏，或不是有效的 .docx 文件。'));
      let size = 0, count = 0;
      zip.on('error', () => reject(new AppError('无法读取 Word 文件。')));
      zip.on('entry', entry => {
        size += entry.uncompressedSize; count++;
        if (size > 45 * 1024 * 1024 || count > 2000 || (entry.generalPurposeBitFlag & 1)) {
          zip.close();
          return reject(new AppError('Word 文件解压体积过大、条目过多或已加密。'));
        }
        zip.readEntry();
      });
      zip.on('end', resolve);
      zip.readEntry();
    });
  });
}

async function compileMark(html, scratchRoot = tmpdir()) {
  const dir = await mkdtemp(path.join(scratchRoot, 'pageport-'));
  try {
    const file = path.join(dir, 'document.md');
    // Only sanitized HTML reaches Mark. User metadata, includes, macros and local paths cannot execute.
    await writeFile(file, '<!-- Space: PAGEPORT -->\n<!-- Title: Preview -->\n<!-- Layout: plain -->\n\n' + html, {mode: 0o600});
    const { stdout } = await exec(process.env.MARK_BIN || 'mark', [
      '--config', '/dev/null', '--compile-only', '--files', file,
    ], {
      cwd: dir, timeout: 12000, maxBuffer: 4 * 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: dir, LANG: 'en_US.UTF-8' },
    });
    return stdout;
  } catch {
    throw new AppError('Mark 转换引擎不可用或转换超时，请联系维护者。', 503);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function convertDocument(file, imageFiles = [], scratchRoot) {
  const ext = path.extname(file.originalname).toLowerCase();
  const warnings = [], blockers = [], assets = [];
  let html, source = '', title = path.basename(file.originalname, ext);
  const images = new Map();
  for (const image of imageFiles) {
    const key = path.basename(image.originalname.replaceAll('\\','/'));
    if (images.has(key)) throw new AppError(`图片文件名重复：${key}`);
    images.set(key, image.buffer);
  }
  async function addImage(buffer, label) {
    const type = await fileTypeFromBuffer(buffer);
    if (!type || !imageTypes.has(type.mime)) throw new AppError(`图片格式不支持：${label}，请使用 PNG、JPEG、GIF 或 WebP。`);
    if (buffer.length > 6 * 1024 * 1024) throw new AppError('单张图片不能超过 6 MB。');
    if (assets.length >= 24) throw new AppError('每篇文档最多包含 24 张图片。');
    const digest = hash(buffer);
    const existing = assets.find(a => a.digest === digest);
    if (existing) return existing;
    const asset = { id: digest.slice(0,20), name: `pageport-${digest.slice(0,24)}.${type.ext}`, mime: type.mime, buffer, digest };
    assets.push(asset);
    return asset;
  }
  if (ext === '.docx') {
    await checkDocx(file.buffer);
    const result = await mammoth.convertToHtml({ buffer: file.buffer }, {
      externalFileAccess: false,
      convertImage: mammoth.images.imgElement(async image => {
        const asset = await addImage(await image.read(), 'Word 内嵌图片');
        return { src: `data:${asset.mime};base64,${asset.buffer.toString('base64')}` };
      }),
    });
    html = result.value;
    warnings.push('Word 将保留可转换的内容结构；字体、分页、浮动布局、批注和修订不保证还原。请逐项核对预览。');
    if (result.messages.length) warnings.push(`Word 转换器报告了 ${result.messages.length} 项兼容性提示。`);
  } else {
    source = file.buffer.toString('utf8');
    if (source.includes('\0')) throw new AppError('文件不是有效的文本格式。');
    if (['.md','.markdown'].includes(ext)) {
      if (/<!--\s*(Include|Macro|Attachment|Parent|Space|Title)\s*:/i.test(source)) warnings.push('源文件中的 Mark 发布指令已移除，发布目标仅由右侧链接决定。');
      const safeSource = source.replace(/<!--[\s\S]*?-->/g, '');
      const heading = safeSource.match(/^#\s+(.+)$/m);
      if (heading) title = heading[1].trim();
      html = md.render(safeSource);
      if (/```(?:mermaid|math|latex)\b|\$\$/.test(safeSource)) warnings.push('公式与 Mermaid 图暂不渲染，保留为源码或代码块，请核对后发布。');
    } else if (['.html','.htm'].includes(ext)) {
      html = source;
      warnings.push('HTML 保留支持的表格与内容结构；脚本、样式表、表单、嵌入页面及不受支持的标签会被清理。');
    } else if (ext === '.txt') {
      html = source.split(/\n\s*\n/).map(text => `<p>${escape(text).replaceAll('\n','<br />')}</p>`).join('\n');
    } else throw new AppError('支持 .md、.markdown、.html、.htm、.docx 和 .txt；PDF 与旧版 .doc 暂不支持。');
  }
  // Resolve images before sanitization strips unsafe or remote image schemes.
  const raw = load(html);
  raw('div[data-pageport-toc="true"]').each((_,node)=>{
    const item=raw(node);
    const min=Math.min(6,Math.max(1,Number.parseInt(item.attr('data-min-level'),10) || 1));
    const max=Math.min(6,Math.max(min,Number.parseInt(item.attr('data-max-level'),10) || 6));
    item.empty().attr('data-min-level',String(min)).attr('data-max-level',String(max));
  });
  raw('div[data-pageport-panel]').each((_,node)=>{
    const item=raw(node);
    if(!panelTypes.has(item.attr('data-pageport-panel')))item.attr('data-pageport-panel','info');
  });
  raw('span[data-pageport-status]').each((_,node)=>{
    const item=raw(node);
    if(!statusColours[item.attr('data-pageport-status')])item.attr('data-pageport-status','grey');
    item.text(item.text().replace(/\s+/g,' ').trim().slice(0,40) || '状态');
  });
  raw('li').each((_,node)=>{
    const item=raw(node), checkbox=item.children('input[type="checkbox"]').first();
    if(checkbox.length) {
      item.attr('data-type','taskItem').attr('data-checked',checkbox.is('[checked]')?'true':'false');
      item.parent('ul').attr('data-type','taskList');
    }
  });
  raw('script,style,iframe,object,embed,form,input,button').remove();
  for (const node of raw('img').toArray()) {
    const element = raw(node), src = element.attr('src') || '', alt = element.attr('alt') || '图片';
    let asset;
    if (src.startsWith('data:')) {
      const data = src.match(/^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/=\s]+)$/);
      if (!data) { blockers.push(`图片「${alt}」的数据格式不支持。`); element.replaceWith(`<p>[图片未转换：${escape(alt)}]</p>`); continue; }
      asset = await addImage(Buffer.from(data[1], 'base64'), alt);
    } else {
      let filename;
      try { filename = decodeURIComponent(src.split(/[?#]/)[0]).replaceAll('\\','/').split('/').pop(); } catch { filename = ''; }
      const image = images.get(filename);
      if (!image) {
        blockers.push(`图片「${filename || alt}」尚未上传。请添加对应图片文件；不会自动抓取外部地址。`);
        element.replaceWith(`<p>[待补充图片：${escape(filename || alt)}]</p>`);
        continue;
      }
      asset = await addImage(image, filename);
    }
    element.replaceWith(`<span data-image-ref="${asset.id}">${escape(alt)}</span>`);
  }
  raw('a').each((_, node) => {
    const element = raw(node), href = element.attr('href') || '';
    if (href && !/^(https?:\/\/|mailto:|#)/i.test(href)) {
      warnings.push('文档中的相对页面链接已去除；请改为完整的 Confluence 链接。');
      element.removeAttr('href');
    }
  });
  if (raw('table table').length) warnings.push('检测到嵌套表格。已保留结构，但 Confluence 编辑器可能重新调整宽度。');
  if (raw('[rowspan],[colspan]').length) warnings.push('检测到合并单元格。已保留跨度属性，请核对发布后的显示效果。');
  if (raw('pre').length) warnings.push('代码块使用纯文本兼容显示，保留缩进与换行，不启用旧版代码宏高亮。');
  // Mark ends a <div> HTML block at the first blank line, which would split code blocks inside panels.
  const content = cleanHtml(raw('body').html() || '').replace(/<pre\b[\s\S]*?<\/pre>/g, block => block.replace(/\n/g, '&#10;'));
  if (!load(content).text().trim() && !assets.length && !raw('div[data-pageport-toc="true"]').length) throw new AppError('文档没有可发布的内容。');
  const compiled = await compileMark(content, scratchRoot);
  const $ = load(cleanHtml(compiled), { xmlMode: true });
  $('script,style').remove();
  const storageTree = load($.xml(), { xmlMode: true });
  const previewTree = load($.xml(), { xmlMode: true });
  const usedIds=new Set(previewTree('[id]').toArray().map(node=>previewTree(node).attr('id')));
  const idCounts=new Map();
  previewTree('[id]').each((_,node)=>{const id=previewTree(node).attr('id');idCounts.set(id,(idCounts.get(id) || 0)+1);});
  let headingId=0;
  const headings=(previewTree('div[data-pageport-toc="true"]').length?previewTree('h1,h2,h3,h4,h5,h6').toArray():[]).map(node=>{
    const heading=previewTree(node);
    let id=heading.attr('id');
    if(!id || idCounts.get(id)!==1)do {id=`pageport-heading-${++headingId}`;} while(usedIds.has(id));
    usedIds.add(id);heading.attr('id',id);
    return {id,level:Number(node.name.slice(1)),text:heading.text()};
  });
  storageTree('div[data-pageport-toc="true"]').each((_,node)=>{
    const item=storageTree(node);
    item.replaceWith(`<ac:structured-macro ac:name="toc" ac:schema-version="1"><ac:parameter ac:name="minLevel">${item.attr('data-min-level')}</ac:parameter><ac:parameter ac:name="maxLevel">${item.attr('data-max-level')}</ac:parameter><ac:parameter ac:name="outline">false</ac:parameter></ac:structured-macro>`);
  });
  previewTree('div[data-pageport-toc="true"]').each((_,node)=>{
    const item=previewTree(node), min=Number(item.attr('data-min-level')), max=Number(item.attr('data-max-level'));
    const entries=headings.filter(h=>h.level>=min && h.level<=max);
    item.html(`<strong>目录</strong><ul>${entries.map(h=>`<li style="margin-left:${(h.level-min)*16}px"><a href="#${escape(encodeURIComponent(h.id))}">${escape(h.text)}</a></li>`).join('')}</ul>`);
  });
  let taskId=0;
  // Deepest lists first so nested tasks survive the parent's conversion.
  storageTree('ul[data-type="taskList"]').toArray().reverse().forEach(node=>{
    const list=storageTree(node);
    list.children('li').each((_,child)=>{
      const item=storageTree(child), status=item.attr('data-checked')==='true'?'complete':'incomplete';
      item.replaceWith(`<ac:task><ac:task-id>${++taskId}</ac:task-id><ac:task-status>${status}</ac:task-status><ac:task-body>${item.html()}</ac:task-body></ac:task>`);
    });
    list.replaceWith(`<ac:task-list>${list.html()}</ac:task-list>`);
  });
  storageTree('mark').each((_,node)=>{
    const item=storageTree(node), color=item.attr('data-color');
    item.replaceWith(`<span style="background-color: ${isColor(color)?color:DEFAULT_HIGHLIGHT};">${item.html()}</span>`);
  });
  storageTree('span[data-pageport-status]').each((_,node)=>{
    const item=storageTree(node), colour=statusColours[item.attr('data-pageport-status')] || 'Grey';
    item.replaceWith(`<ac:structured-macro ac:name="status" ac:schema-version="1"><ac:parameter ac:name="colour">${colour}</ac:parameter><ac:parameter ac:name="title">${escape(item.text())}</ac:parameter></ac:structured-macro>`);
  });
  // Deepest panels first so nested panels keep their own macro bodies.
  storageTree('div[data-pageport-panel]').toArray().reverse().forEach(node=>{
    const item=storageTree(node), type=panelTypes.has(item.attr('data-pageport-panel'))?item.attr('data-pageport-panel'):'info';
    item.replaceWith(`<ac:structured-macro ac:name="${type}" ac:schema-version="1"><ac:rich-text-body>${item.html()}</ac:rich-text-body></ac:structured-macro>`);
  });
  for (const asset of assets) {
    storageTree(`span[data-image-ref="${asset.id}"]`).each((_, node) => {
      storageTree(node).replaceWith(`<ac:image><ri:attachment ri:filename="${asset.name}" /></ac:image>`);
    });
    previewTree(`span[data-image-ref="${asset.id}"]`).each((_, node) => {
      const alt = previewTree(node).text();
      previewTree(node).replaceWith(`<img alt="${escape(alt)}" src="data:${asset.mime};base64,${asset.buffer.toString('base64')}" />`);
    });
  }
  const storage = storageTree.xml(), preview = previewTree.xml();
  return {
    title, source, storage, preview, assets,
    warnings: [...new Set(warnings)], blockers: [...new Set(blockers)],
    stats: { headings: $('h1,h2,h3,h4,h5,h6').length, tables: $('table').length, images: assets.length, characters: $.text().length },
    digest: hash(storage),
  };
}
