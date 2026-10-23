import JSZip from 'jszip';

const HEADING_NAME = /^(?:标题|heading)\s*([1-6])$/i;
const CN = ['零','一','二','三','四','五','六','七','八','九'];
const LEGAL = ['','壹','贰','叁','肆','伍','陆','柒','捌','玖','拾'];
const CIRCLED = [...'①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'];
const HEAVENLY = [...'甲乙丙丁戊己庚辛壬癸'];

function isTagAt(xml, index, name) {
  if (!xml.startsWith(`<${name}`, index)) return false;
  const next = xml[index + name.length + 1];
  return next === '>' || next === '/' || next === ' ' || next === '\n' || next === '\r' || next === '\t';
}

function scanTag(xml, name) {
  const needle = `<${name}`;
  const close = `</${name}>`;
  const found = [];
  let i = 0;
  while (i < xml.length) {
    const start = xml.indexOf(needle, i);
    if (start < 0) break;
    if (!isTagAt(xml, start, name)) { i = start + needle.length; continue; }
    const gt = xml.indexOf('>', start);
    if (gt < 0) break;
    if (xml[gt - 1] === '/') {
      found.push({ start, end: gt + 1, open: xml.slice(start, gt + 1), inner: '' });
      i = gt + 1;
      continue;
    }
    let depth = 1;
    let j = gt + 1;
    let broken = false;
    while (depth > 0) {
      const nextOpen = xml.indexOf(needle, j);
      const nextClose = xml.indexOf(close, j);
      if (nextClose < 0) { broken = true; break; }
      if (nextOpen !== -1 && nextOpen < nextClose && isTagAt(xml, nextOpen, name)) {
        depth += 1;
        j = nextOpen + needle.length;
      } else {
        depth -= 1;
        if (depth === 0) {
          found.push({ start, end: nextClose + close.length, open: xml.slice(start, gt + 1), inner: xml.slice(gt + 1, nextClose) });
          i = nextClose + close.length;
        } else j = nextClose + close.length;
      }
    }
    if (broken) break;
  }
  return found;
}

function firstTag(xml, name) {
  return scanTag(xml, name)[0] || null;
}

function plainText(xml) {
  return [...xml.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map(match => decodeXml(match[1])).join('');
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

function escapeXml(value) {
  return value.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
}

function headingLevelFromStyle(block) {
  const name = decodeXml(/<w:name\b[^>]*w:val="([^"]*)"/.exec(block)?.[1] || '').trim();
  const titled = HEADING_NAME.exec(name);
  if (titled) return Number(titled[1]);
  const outline = /<w:outlineLvl\b[^>]*w:val="(\d+)"/.exec(block)?.[1];
  if (outline != null && Number(outline) <= 5) return Number(outline) + 1;
  return 0;
}

function headingMap(stylesXml) {
  const map = new Map();
  if (!stylesXml) return map;
  for (const style of scanTag(stylesXml, 'w:style')) {
    if (!/w:type="paragraph"/.test(style.open)) continue;
    const styleId = /w:styleId="([^"]+)"/.exec(style.open)?.[1];
    const level = headingLevelFromStyle(style.inner);
    if (styleId && level) map.set(styleId, level);
  }
  return map;
}

function rewriteHeadingNames(stylesXml, styles) {
  let xml = stylesXml || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:styles>';
  const blocks = scanTag(xml, 'w:style').sort((a, b) => b.start - a.start);
  for (const style of blocks) {
    const styleId = /w:styleId="([^"]+)"/.exec(style.open)?.[1];
    const level = styles.get(styleId);
    if (!level) continue;
    let inner = style.inner;
    if (/<w:name\b/.test(inner)) inner = inner.replace(/(<w:name\b[^>]*w:val=")[^"]*(")/, `$1heading ${level}$2`);
    else inner = `<w:name w:val="heading ${level}"/>${inner}`;
    xml = xml.slice(0, style.start) + style.open + inner + '</w:style>' + xml.slice(style.end);
  }
  for (let level = 1; level <= 6; level += 1) {
    const styleId = `PagePortHeading${level}`;
    if (!xml.includes(`w:styleId="${styleId}"`)) {
      xml = xml.replace('</w:styles>', `<w:style w:type="paragraph" w:styleId="${styleId}"><w:name w:val="heading ${level}"/></w:style></w:styles>`);
    }
  }
  return xml;
}

function applyDirectOutlines(xml, styles) {
  const paragraphs = scanTag(xml, 'w:p').sort((a, b) => b.start - a.start);
  let changed = false;
  for (const paragraph of paragraphs) {
    const properties = firstTag(paragraph.inner, 'w:pPr');
    if (!properties) continue;
    const outline = /<w:outlineLvl\b[^>]*w:val="(\d+)"/.exec(properties.inner)?.[1];
    if (outline == null || Number(outline) > 5) continue;
    const styleId = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(properties.inner)?.[1];
    if (styleId && styles.has(styleId)) continue;
    const level = Number(outline) + 1;
    const style = `<w:pStyle w:val="PagePortHeading${level}"/>`;
    let inner = properties.inner;
    if (/<w:pStyle\b/.test(inner)) inner = inner.replace(/<w:pStyle\b[^>]*\/>/, style).replace(/<w:pStyle\b[^>]*>[\s\S]*?<\/w:pStyle>/, style);
    else inner = style + inner;
    const updated = properties.open + inner + '</w:pPr>';
    const paragraphXml = paragraph.open + paragraph.inner.slice(0, properties.start) + updated + paragraph.inner.slice(properties.end) + '</w:p>';
    xml = xml.slice(0, paragraph.start) + paragraphXml + xml.slice(paragraph.end);
    changed = true;
  }
  return { xml, changed };
}

function topLevel(xml, name) {
  const all = scanTag(xml, name);
  return all.filter(item => !all.some(other => other !== item && other.start < item.start && other.end > item.end));
}

function elementXml(item, name) {
  return item.open + item.inner + `</${name}>`;
}

function rewriteAlternate(block) {
  const choice = firstTag(block.inner, 'mc:Choice');
  const fallback = firstTag(block.inner, 'mc:Fallback');
  const choiceXml = choice ? elementXml(choice, 'mc:Choice') : '';
  const fallbackXml = fallback ? elementXml(fallback, 'mc:Fallback') : '';
  const choiceText = plainText(choiceXml).trim();
  const fallbackText = plainText(fallbackXml).trim();
  if (choiceText && choiceText.length > fallbackText.length) {
    const boxes = scanTag(choiceXml, 'w:txbxContent').map(item => item.inner).join('');
    if (boxes.trim()) return boxes;
    const paragraphs = topLevel(choiceXml, 'w:p');
    if (paragraphs.length) return paragraphs.map(item => elementXml(item, 'w:p')).join('');
  }
  if (!choiceText && !fallbackText) {
    const drawings = scanTag(choiceXml, 'w:drawing').filter(item => /<a:blip\b/.test(item.inner));
    const fallbackHasImage = /<v:imagedata\b|<a:blip\b/.test(fallbackXml);
    if (drawings.length && !fallbackHasImage) {
      return drawings.map(item => `<w:p><w:r>${item.open}${item.inner}</w:drawing></w:r></w:p>`).join('');
    }
  }
  return '';
}

function promoteDrawingsAndText(xml) {
  let changed = false;
  let guard = 0;
  while (guard < 40) {
    guard += 1;
    const blocks = scanTag(xml, 'mc:AlternateContent');
    const target = blocks.find(block => !block.open.includes('pageport-kept') && !block.inner.includes('<mc:AlternateContent'));
    if (!target) break;
    const replacement = rewriteAlternate(target);
    if (!replacement) {
      xml = xml.slice(0, target.start) + target.open.replace('<mc:AlternateContent', '<mc:AlternateContent pageport-kept="1"') + target.inner + '</mc:AlternateContent>' + xml.slice(target.end);
      continue;
    }
    xml = xml.slice(0, target.start) + replacement + xml.slice(target.end);
    changed = true;
  }
  return { xml: xml.replace(/ pageport-kept="1"/g, ''), changed };
}

function chinese(number) {
  if (number <= 10) return ['零','一','二','三','四','五','六','七','八','九','十'][number];
  if (number < 20) return `十${CN[number % 10]}`;
  if (number < 100) {
    const tens = Math.floor(number / 10);
    const ones = number % 10;
    return `${CN[tens]}十${ones ? CN[ones] : ''}`;
  }
  return String(number);
}

function roman(number) {
  const pairs = [[1000,'m'],[900,'cm'],[500,'d'],[400,'cd'],[100,'c'],[90,'xc'],[50,'l'],[40,'xl'],[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']];
  let rest = number;
  let out = '';
  for (const [value, glyph] of pairs) while (rest >= value) { out += glyph; rest -= value; }
  return out || String(number);
}

function formatToken(fmt, number) {
  switch (fmt) {
    case 'chineseCounting':
    case 'chineseCountingThousand':
    case 'japaneseCounting':
    case 'ideographDigital':
    case 'taiwaneseCounting':
    case 'taiwaneseCountingThousand':
      return chinese(number);
    case 'chineseLegalSimplified':
    case 'japaneseLegal':
      return LEGAL[number] || chinese(number);
    case 'decimalEnclosedCircle':
    case 'decimalEnclosedCircleChinese':
      return CIRCLED[number - 1] || `(${number})`;
    case 'decimalEnclosedParen':
      return `(${number})`;
    case 'ideographTraditional':
      return HEAVENLY[number - 1] || String(number);
    case 'lowerLetter':
      return String.fromCharCode(96 + ((number - 1) % 26) + 1);
    case 'upperLetter':
      return String.fromCharCode(64 + ((number - 1) % 26) + 1);
    case 'lowerRoman':
      return roman(number);
    case 'upperRoman':
      return roman(number).toUpperCase();
    default:
      return String(number);
  }
}

function parseNumbering(xml) {
  if (!xml) return null;
  const abstracts = new Map();
  for (const item of scanTag(xml, 'w:abstractNum')) {
    const id = /w:abstractNumId="([^"]+)"/.exec(item.open)?.[1];
    const levels = {};
    for (const level of scanTag(item.inner, 'w:lvl')) {
      const index = /w:ilvl="([^"]+)"/.exec(level.open)?.[1] ?? '0';
      levels[index] = {
        fmt: /<w:numFmt\b[^>]*w:val="([^"]+)"/.exec(level.inner)?.[1] || 'decimal',
        text: decodeXml(/<w:lvlText\b[^>]*w:val="([^"]*)"/.exec(level.inner)?.[1] ?? `%${Number(index) + 1}`),
        start: Number(/<w:start\b[^>]*w:val="(\d+)"/.exec(level.inner)?.[1] || '1'),
      };
    }
    if (id) abstracts.set(id, levels);
  }
  const nums = new Map();
  for (const item of scanTag(xml, 'w:num')) {
    const numId = /w:numId="([^"]+)"/.exec(item.open)?.[1];
    const abstractId = /<w:abstractNumId\b[^>]*w:val="([^"]+)"/.exec(item.inner)?.[1];
    const overrides = {};
    for (const override of scanTag(item.inner, 'w:lvlOverride')) {
      const index = /w:ilvl="([^"]+)"/.exec(override.open)?.[1];
      const start = /<w:startOverride\b[^>]*w:val="(\d+)"/.exec(override.inner)?.[1];
      if (index && start) overrides[index] = Number(start);
    }
    if (numId && abstractId) nums.set(numId, { abstractId, overrides });
  }
  return { abstracts, nums };
}

function numberingLabel(model, counters, numId, ilvl) {
  const num = model.nums.get(numId);
  const levels = num && model.abstracts.get(num.abstractId);
  const level = levels?.[ilvl];
  if (!level || level.fmt === 'bullet' || level.fmt === 'none') return '';
  if (!counters.has(numId)) {
    const state = Array(9).fill(0);
    for (let index = 0; index < 9; index += 1) state[index] = (num.overrides[String(index)] ?? levels[String(index)]?.start ?? 1) - 1;
    counters.set(numId, state);
  }
  const state = counters.get(numId);
  const current = Number(ilvl);
  state[current] += 1;
  for (let index = current + 1; index < 9; index += 1) state[index] = (num.overrides[String(index)] ?? levels[String(index)]?.start ?? 1) - 1;
  let label = level.text;
  for (let index = 0; index <= current; index += 1) {
    const fmt = levels[String(index)]?.fmt || 'decimal';
    label = label.replaceAll(`%${index + 1}`, formatToken(fmt, state[index]));
  }
  return /[\s、.．。）)\]】]$/.test(label) ? label : `${label} `;
}

function writeNumbering(paragraph, label) {
  let inner = paragraph.inner.replace(/<w:numPr\b[\s\S]*?<\/w:numPr>/, '');
  const run = `<w:r><w:t xml:space="preserve">${escapeXml(label)}</w:t></w:r>`;
  const refreshed = firstTag(inner, 'w:pPr');
  if (refreshed) inner = inner.slice(0, refreshed.end) + run + inner.slice(refreshed.end);
  else inner = run + inner;
  return paragraph.open + inner + '</w:p>';
}

function materializeNumbering(xml, numberingXml) {
  const model = parseNumbering(numberingXml);
  if (!model) return { xml, changed: false };
  const counters = new Map();
  const edits = [];
  for (const paragraph of scanTag(xml, 'w:p')) {
    const properties = firstTag(paragraph.inner, 'w:pPr');
    if (!properties || !properties.inner.includes('<w:numPr')) continue;
    const numId = /<w:numId\b[^>]*w:val="([^"]+)"/.exec(properties.inner)?.[1];
    const ilvl = /<w:ilvl\b[^>]*w:val="([^"]+)"/.exec(properties.inner)?.[1] ?? '0';
    if (!numId || numId === '0') continue;
    const label = numberingLabel(model, counters, numId, ilvl);
    if (!label) continue;
    edits.push({ paragraph, label });
  }
  let changed = false;
  for (const edit of edits.reverse()) {
    xml = xml.slice(0, edit.paragraph.start) + writeNumbering(edit.paragraph, edit.label) + xml.slice(edit.paragraph.end);
    changed = true;
  }
  return { xml, changed };
}

async function part(zip, pattern) {
  const file = zip.file(pattern)[0];
  return file ? { name: file.name, xml: await file.async('string') } : null;
}

export async function looksLikeDocx(buffer) {
  if (!buffer || buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false;
  try {
    const zip = await JSZip.loadAsync(buffer);
    return zip.file(/word\/document\.xml$/i).length > 0;
  } catch {
    return false;
  }
}

export async function adaptOfficePackage(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const document = await part(zip, /word\/document\.xml$/i);
  if (!document) return { buffer, notes: [] };
  const stylesPart = await part(zip, /word\/styles\.xml$/i);
  const numberingPart = await part(zip, /word\/numbering\.xml$/i);
  const styles = headingMap(stylesPart?.xml || '');
  const promoted = promoteDrawingsAndText(document.xml);
  const outlined = applyDirectOutlines(promoted.xml, styles);
  const numbered = materializeNumbering(outlined.xml, numberingPart?.xml || '');
  zip.file(document.name, numbered.xml);
  zip.file(stylesPart?.name || 'word/styles.xml', rewriteHeadingNames(stylesPart?.xml || '', styles));
  const usesHeading = [...styles.keys()].some(id => document.xml.includes(`w:val="${id}"`));
  const notes = [];
  if (usesHeading || outlined.changed) notes.push('已把中文标题和大纲级别转成标题，请核对层级。');
  if (promoted.changed) notes.push('已取出文本框或形状中的正文，位置改为按阅读顺序排列。');
  if (numbered.changed) notes.push('已按原文保留编号，例如「一、」「（一）」「①」，不再改成自动的 1. 2. 3.。');
  return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), notes };
}
