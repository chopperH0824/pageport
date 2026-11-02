import HtmlToDocx from '@turbodocx/html-to-docx';
import JSZip from 'jszip';
import { load } from 'cheerio';
import { randomBytes } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { AppError, hash } from './convert.js';

const imageData = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/;
const stylesheet = 'body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.4;color:#172b4d}h1{font-size:20pt}h2{font-size:16pt}h3{font-size:13pt}table{border-collapse:collapse}td,th{border:1px solid #c1c7d0;padding:6px 8px}th{background:#f4f5f7}img{max-width:100%;height:auto}pre{white-space:pre-wrap}';
const wrap = body => `<!doctype html><html><head><meta charset="utf-8"><style>${stylesheet}</style></head><body>${body}</body></html>`;
const propertyOrder = {
  tblPr:['tblStyle','tblpPr','tblOverlap','bidiVisual','tblStyleRowBandSize','tblStyleColBandSize','tblW','jc','tblCellSpacing','tblInd','tblBorders','shd','tblLayout','tblCellMar','tblLook','tblCaption','tblDescription','tblPrChange'],
  tcPr:['cnfStyle','tcW','gridSpan','hMerge','vMerge','tcBorders','shd','noWrap','tcMar','textDirection','tcFitText','vAlign','hideMark','headers','cellIns','cellDel','cellMerge','tcPrChange'],
  tblBorders:['top','left','bottom','right','insideH','insideV'],
  tcBorders:['top','left','bottom','right','insideH','insideV','tl2br','tr2bl'],
  tblCellMar:['top','left','bottom','right'],
  tcMar:['top','left','bottom','right'],
};

function normalizeWordProperties(xml) {
  for(const [parent,order] of Object.entries(propertyOrder)) {
    xml(`w\\:${parent}`).each((_,node)=>{
      const properties=xml(node);
      const children=properties.children().toArray().sort((a,b)=>{
        const rank=node=>{const index=order.indexOf(node.name.slice(2));return index<0?order.length:index;};
        return rank(a)-rank(b);
      });
      properties.append(xml(children).remove());
    });
  }
}

export async function exportDocument(document, format) {
  if (!['docx','doc'].includes(format)) throw new AppError('不支持此保存格式。');
  if (document.blockers?.length) throw new AppError('文档中有未补齐或不支持的图片，请先处理检查项再保存，避免丢图。',422);
  const $ = load(document.preview);
  if ($('[data-pageport-missing-image],[data-confluence-image]').length) throw new AppError('部分图片尚未归档，请先插入对应本地图片再保存。',422);
  const images = [];
  for (const node of $('img').toArray()) {
    const match = imageData.exec($(node).attr('src') || '');
    if (!match) throw new AppError('部分图片只有远程地址，无法离线保存。请先插入对应本地图片。',422);
    const buffer = Buffer.from(match[2],'base64');
    const type = await fileTypeFromBuffer(buffer);
    if (!type || type.mime !== match[1]) throw new AppError('图片数据损坏或格式不符，未保存文件。',422);
    images.push({node,buffer,mime:type.mime,digest:hash(buffer)});
  }
  // Render task checkmarks as text so they remain visible without editor CSS.
  $('li[data-type="taskItem"]').each((_,node)=>{
    const item=$(node);
    item.prepend(item.attr('data-checked')==='true'?'☑ ':'☐ ');
  });
  if (format === 'doc') {
    const boundary = `pageport-${randomBytes(16).toString('hex')}`;
    const fold = buffer => buffer.toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
    images.forEach((image,index)=>$(image.node).attr('src',`cid:image-${index}@pageport`));
    const parts = [
      'MIME-Version: 1.0\r\nX-PagePort-Document: 1\r\n' +
        `Content-Type: multipart/related; type="text/html"; boundary="${boundary}"\r\n`,
      'Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + fold(Buffer.from(wrap($('body').html()))),
      ...images.map((image,index)=>`Content-Type: ${image.mime}\r\nContent-ID: <image-${index}@pageport>\r\nContent-Transfer-Encoding: base64\r\n\r\n${fold(image.buffer)}`),
    ];
    return {mime:'application/msword',buffer:Buffer.from(parts[0] + '\r\n' + parts.slice(1).map(part=>`--${boundary}\r\n${part}\r\n`).join('') + `--${boundary}--\r\n`)};
  }
  let output;
  try {
    output = Buffer.from(await HtmlToDocx(wrap($('body').html()),null,{
      title:document.title || '',creator:'PagePort',lastModifiedBy:'PagePort',
      font:'Arial',fontSize:22,lang:'zh-CN',pageSize:{width:11906,height:16838},
      margins:{top:1134,bottom:1134,left:1134,right:1134},
      footer:true,pageNumber:true,
      table:{row:{cantSplit:false},borderOptions:{size:4,stroke:'single',color:'C1C7D0'}},
      preProcessing:{skipHTMLMinify:true},
      imageProcessing:{maxImageSize:Number.MAX_SAFE_INTEGER,minImageSize:0,maxRetries:0,suppressSharpWarning:true},
    }));
    // The converter may skip a failed image without rejecting. Verify every
    // source image is actually embedded and referenced before writing any file.
    const zip = await JSZip.loadAsync(output);
    const media = await Promise.all(zip.file(/^word\/media\/[^/]+$/).map(entry=>entry.async('nodebuffer')));
    const embedded = new Set(media.map(hash));
    const xml = load(await zip.file('word/document.xml').async('string'),{xmlMode:true});
    // The upstream writer emits section properties first and footer references
    // after page dimensions. OOXML requires the inverse order in both places.
    const section=xml('w\\:body > w\\:sectPr').remove();
    section.prepend(section.children('w\\:headerReference,w\\:footerReference').remove());
    xml('w\\:body').append(section);
    normalizeWordProperties(xml);
    zip.file('word/document.xml',xml.xml());
    if (images.some(image=>!embedded.has(image.digest)) || xml('a\\:blip[r\\:embed]').length !== images.length) {
      throw new Error('Missing embedded image');
    }
    output=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  } catch {
    throw new AppError('Word 导出未通过完整性检查，文件未保存。请核对图片后重试。',422);
  }
  return {mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:output};
}
