import { imageDimension } from './image-dimensions.js';

export function tableLength(value, percent = false, zero = false) {
  const text = String(value || '').trim().toLowerCase();
  if (percent && /^\d+(?:\.\d+)?%$/.test(text)) {
    const number = Number.parseFloat(text);
    return number > 0 && number <= 100 ? `${number}%` : '';
  }
  if (zero && /^0(?:px|pt|in|cm|mm)?$/.test(text)) return '0px';
  const pixels = imageDimension(text);
  return pixels ? `${pixels}px` : '';
}

function styleDeclarations(style) {
  const declarations = new Map();
  for (const part of String(style || '').split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    declarations.set(part.slice(0,colon).trim().toLowerCase(),part.slice(colon+1).replace(/!important/ig,'').trim().toLowerCase());
  }
  return declarations;
}

export function tableLayoutStyle(style, width, height) {
  const declarations = styleDeclarations(style);
  if (!declarations.has('width') && width) declarations.set('width',width);
  if (!declarations.has('height') && height) declarations.set('height',height);
  const kept = [];
  for (const [key,value] of declarations) {
    let safe = '';
    if (key === 'width') safe = tableLength(value,true);
    if (key === 'height' || key === 'min-height') safe = tableLength(value);
    if (/^padding(?:-(top|right|bottom|left))?$/.test(key)) {
      const values = value.split(/\s+/);
      const lengths = values.map(item=>tableLength(item,false,true));
      if (values.length <= (key === 'padding'?4:1) && lengths.every(Boolean)) safe = lengths.join(' ');
    }
    if (key === 'table-layout' && /^(fixed|auto)$/.test(value)) safe = value;
    if (key === 'vertical-align' && /^(top|middle|bottom|baseline)$/.test(value)) safe = value;
    if (key === 'white-space' && /^(normal|nowrap|pre-wrap)$/.test(value)) safe = value;
    if (safe) kept.push(`${key}: ${safe}`);
  }
  return kept.join('; ');
}

export function normalizeTableLayout($) {
  $('table,col,td,th,tr').each((_,node)=>{
    const item = $(node);
    const layout = tableLayoutStyle(item.attr('style'),item.attr('width'),item.attr('height'));
    if (layout) {
      const merged = styleDeclarations(item.attr('style'));
      for (const [key,value] of styleDeclarations(layout)) merged.set(key,value);
      item.attr('style',Array.from(merged,([key,value])=>`${key}: ${value}`).join('; '));
    }
    item.removeAttr('width').removeAttr('height');
  });
}
