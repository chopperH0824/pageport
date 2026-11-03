import { load } from 'cheerio';
import { imageDimensions } from './image-dimensions.js';
import { normalizeTableLayout, tableLayoutStyle } from './table-layout.js';
import { fileTypeFromBuffer } from 'file-type';

const emoticons = {
  tick:'✓', cross:'✗', warning:'⚠', information:'i', plus:'+', minus:'−', question:'?',
  smile:'☺', sad:'☹', cheeky:'😛', laugh:'😁', wink:'😉', 'thumbs-up':'👍', 'thumbs-down':'👎',
  'yellow-star':'★', 'red-star':'★', 'green-star':'★', 'blue-star':'★', heart:'♥', 'broken-heart':'♡',
};
const keptStyle = new Set(['text-align', 'color', 'background-color']);
const embeddedImageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function referenceKeys(reference) {
  const value = String(reference || '').trim().replace(/^<|>$/g, '').replace(/^"|"$/g, '');
  if (!value) return [];
  const keys = new Set([value]);
  if (/^cid:/i.test(value)) keys.add(`cid:${value.slice(4)}`);
  try { keys.add(decodeURIComponent(value)); } catch {}
  // Confluence uses file:///image-id in MIME headers and just image-id in HTML.
  // Never use a remote URL's basename to associate an unrelated local image.
  for (const key of [...keys]) {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(key) || /^file:/i.test(key)) {
      keys.add(key.replaceAll('\\', '/').split('/').pop());
    }
  }
  return [...keys].filter(Boolean);
}

function decodeQuotedPrintable(value) {
  const folded = value.replace(/=\r\n/g, '').replace(/=\n/g, '');
  const bytes = [];
  for (let index = 0; index < folded.length; index += 1) {
    if (folded[index] === '=' && /^[0-9A-Fa-f]{2}$/.test(folded.slice(index + 1, index + 3))) {
      bytes.push(parseInt(folded.slice(index + 1, index + 3), 16));
      index += 2;
    } else bytes.push(folded.charCodeAt(index) & 0xff);
  }
  return Buffer.from(bytes);
}

function decodePart(headers, body) {
  const encoding = (/Content-Transfer-Encoding:\s*(\S+)/i.exec(headers)?.[1] || '').toLowerCase();
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(body);
  if (encoding === 'base64') return Buffer.from(body.replace(/\s/g, ''), 'base64');
  return Buffer.from(body, 'latin1');
}

function cleanStyle(style) {
  const ordinary = String(style || '').split(';').map(part => {
    const split = part.indexOf(':');
    if (split < 0) return '';
    const key = part.slice(0, split).trim().toLowerCase();
    const value = part.slice(split + 1).replace(/!important/ig, '').trim();
    if (!keptStyle.has(key) || !value) return '';
    if (key === 'text-align' && !/^(left|center|right|justify)$/i.test(value)) return '';
    return `${key}: ${value}`;
  }).filter(Boolean).join('; ');
  return [ordinary,tableLayoutStyle(style)].filter(Boolean).join('; ');
}

export async function extractConfluenceExport(buffer) {
  const probe = buffer.slice(0, 1200).toString('latin1');
  if (!/MIME-Version:/i.test(probe) || !/multipart\//i.test(probe)) return null;
  const source = buffer.toString('latin1');
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(source);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  const pageport = /^X-PagePort-Document:\s*1\s*$/im.test(probe);
  if (!boundary || (!pageport && !/Exported From Confluence|confluence(?:Table|Td|Th)/i.test(source))) return null;
  let html = '';
  const images = new Map();
  for (const part of source.split(`--${boundary}`)) {
    const separator = /\r?\n\r?\n/.exec(part);
    if (!separator) continue;
    const headers = part.slice(0, separator.index).replace(/\r?\n[ \t]+/g, ' ');
    const body = part.slice(separator.index + separator[0].length).replace(/\r?\n$/, '');
    const type = (/Content-Type:\s*([^;\r\n]+)/i.exec(headers)?.[1] || '').trim().toLowerCase();
    if (type === 'text/html' && !html) html = decodePart(headers, body).toString('utf8');
    if (type.startsWith('image/') || type === 'application/octet-stream') {
      const bytes = decodePart(headers, body);
      const actualType = await fileTypeFromBuffer(bytes);
      if (!actualType || !embeddedImageTypes.has(actualType.mime)) continue;
      const id = /Content-ID:\s*<([^>]+)>/i.exec(headers)?.[1];
      const location = /Content-Location:\s*([^\r\n]+)/i.exec(headers)?.[1];
      const image = `data:${actualType.mime};base64,${bytes.toString('base64')}`;
      for (const reference of [id && `cid:${id}`, location]) {
        for (const key of referenceKeys(reference)) {
          if (!images.has(key)) images.set(key, image);
          else if (images.get(key) !== image) images.set(key, null);
        }
      }
    }
  }
  if (!html) return null;
  const page = load(html);
  normalizeTableLayout(page);
  page('img').each((_, node) => {
    const item = page(node);
    const dimensions = imageDimensions(item);
    for (const key of ['width','height']) if (dimensions[key]) item.attr(key,dimensions[key]);
  });
  page('img').each((_, node) => {
    const item = page(node);
    const embedded = [item.attr('src'), item.attr('data-image-src')]
      .flatMap(referenceKeys).map(key => images.get(key)).find(Boolean);
    if (embedded) item.attr('src', embedded).removeAttr('data-image-src');
  });
  if (pageport) {
    return {html:page('body').html() || '',title:page('h1').first().text().trim(),pageport:true};
  }
  const origin = page('a[href^="http"]').toArray().map(node => {
    try { return new URL(page(node).attr('href')).origin; } catch { return ''; }
  }).find(Boolean) || '';
  page('img[data-emoticon-name]').each((_, node) => {
    const item = page(node);
    const name = String(item.attr('data-emoticon-name') || '').toLowerCase();
    if (!emoticons[name]) return;
    item.replaceWith(`<span data-confluence-emoticon="${name}">${emoticons[name]}</span>`);
  });
  page('img').each((_, node) => {
    const item = page(node);
    const src = String(item.attr('data-image-src') || item.attr('src') || '').replace(/&amp;/g, '&');
    if (!/^https:\/\//i.test(src)) return;
    const replacement = page('<span></span>').attr('data-confluence-image',src).text(item.attr('alt') || '图片');
    for (const [key,value] of Object.entries(imageDimensions(item))) if (value) replacement.attr(`data-${key}`,value);
    item.replaceWith(replacement);
  });
  page('[class]').each((_, node) => {
    const item = page(node);
    const highlight = String(item.attr('class') || '').split(/\s+/).find(name => /^highlight-#[0-9a-f]{3,8}$/i.test(name));
    if (highlight && /^(td|th)$/i.test(node.name)) {
      const color = highlight.slice('highlight-'.length);
      const style = cleanStyle(item.attr('style'));
      item.attr('style', style ? `${style}; background-color: ${color}` : `background-color: ${color}`);
    }
  });
  page('[style]').each((_, node) => {
    const item = page(node);
    const style = cleanStyle(item.attr('style'));
    if (style) item.attr('style', style);
    else item.removeAttr('style');
  });
  if (origin) page('a[href^="/"]').each((_, node) => {
    const item = page(node);
    item.attr('href', origin + item.attr('href'));
  });
  const title = page('h1').first().text().trim() || page('title').first().text().trim();
  return { html: page('body').html() || '', title };
}
