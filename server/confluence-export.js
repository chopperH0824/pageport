import { load } from 'cheerio';

const emoticons = {
  tick:'✓', cross:'✗', warning:'⚠', information:'i', plus:'+', minus:'−', question:'?',
  smile:'☺', sad:'☹', cheeky:'😛', laugh:'😁', wink:'😉', 'thumbs-up':'👍', 'thumbs-down':'👎',
  'yellow-star':'★', 'red-star':'★', 'green-star':'★', 'blue-star':'★', heart:'♥', 'broken-heart':'♡',
};
const keptStyle = new Set(['text-align', 'color', 'background-color', 'width']);

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
  return String(style || '').split(';').map(part => {
    const split = part.indexOf(':');
    if (split < 0) return '';
    const key = part.slice(0, split).trim().toLowerCase();
    const value = part.slice(split + 1).replace(/!important/ig, '').trim();
    if (!keptStyle.has(key) || !value) return '';
    if (key === 'width' && !/^\d+(?:\.\d+)?%$/.test(value)) return '';
    if (key === 'text-align' && !/^(left|center|right|justify)$/i.test(value)) return '';
    return `${key}: ${value}`;
  }).filter(Boolean).join('; ');
}

export function extractConfluenceExport(buffer) {
  const probe = buffer.slice(0, 1200).toString('latin1');
  if (!/MIME-Version:/i.test(probe) || !/multipart\//i.test(probe)) return null;
  const source = buffer.toString('latin1');
  const boundary = /boundary="([^"]+)"/i.exec(source)?.[1];
  if (!boundary || !/Exported From Confluence|confluence(?:Table|Td|Th)/i.test(source)) return null;
  let html = '';
  for (const part of source.split(`--${boundary}`)) {
    const split = part.indexOf('\r\n\r\n');
    if (split < 0) continue;
    const headers = part.slice(0, split);
    let body = part.slice(split + 4);
    if (body.endsWith('\r\n')) body = body.slice(0, -2);
    const type = (/Content-Type:\s*([^;\r\n]+)/i.exec(headers)?.[1] || '').trim().toLowerCase();
    if (type !== 'text/html') continue;
    html = decodePart(headers, body).toString('utf8');
    break;
  }
  if (!html) return null;
  const page = load(html);
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
    const height = String(item.attr('height') || '').replace(/\D/g, '').slice(0, 4);
    item.replaceWith(`<span data-confluence-image="${src}" data-height="${height}">${item.attr('alt') || '图片'}</span>`);
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
