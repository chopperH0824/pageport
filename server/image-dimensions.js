// Convert absolute display units to CSS pixels without treating percentages as pixels.
export function imageDimension(value) {
  const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)\s*(px|pt|in|cm|mm)?$/i);
  if (!match) return '';
  const pixels = Math.round(Number(match[1]) * ({px:1,pt:96/72,in:96,cm:96/2.54,mm:96/25.4}[match[2]?.toLowerCase() || 'px']));
  return pixels > 0 && pixels <= 100000 ? String(pixels) : '';
}

export function imageDimensions(item) {
  const style = new Map(String(item.attr('style') || '').split(';').map(part => {
    const [key, value] = part.split(':');
    return [key.trim().toLowerCase(),value?.trim()];
  }));
  return Object.fromEntries(['width','height'].map(key => [key,imageDimension(style.get(key) || item.attr(key) || item.attr(`data-${key}`))]));
}

export function dimensionAttributes(dimensions, prefix = '') {
  return ['width','height'].map(key => {
    const value = imageDimension(dimensions[key]);
    return value ? ` ${prefix}${key}="${value}"` : '';
  }).join('');
}
