import { load } from 'cheerio';

// A backup stores the page's Confluence storage format, not the editor's HTML.
// Convert the parts PagePort can represent faithfully and make everything else
// explicit, so a restored draft never contains raw ac:/ri: markup or values
// glued together (for example "1complete完成" from a task macro).
const PANEL_MACROS = new Set(['info', 'note', 'warning', 'tip', 'panel']);
const PANEL_TYPES = new Set(['info', 'note', 'warning', 'tip']);
const STATUS_COLOURS = new Set(['grey', 'blue', 'green', 'yellow', 'red']);
const EMOTICON_GLYPHS = {
  tick: '✓', cross: '✗', warning: '⚠', information: 'i', plus: '+', minus: '−', question: '?',
  smile: '☺', sad: '☹', cheeky: '😛', laugh: '😁', wink: '😉', 'thumbs-up': '👍', 'thumbs-down': '👎',
  'yellow-star': '★', 'red-star': '★', 'green-star': '★', 'blue-star': '★', heart: '♥', 'broken-heart': '♡',
};

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const escape = text => String(text ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
// Cheerio's XML serializer collapses empty elements to `<div/>`. A browser's
// HTML parser would then treat the following siblings as children of that div,
// so expand non-void self-closing tags to real open/close pairs.
const toHtml = serialized => serialized.replace(/<([A-Za-z][\w:-]*)((?:\s[^<>]*?)?)\s*\/>/g, (match, tag, attributes) =>
  VOID_ELEMENTS.has(tag.toLowerCase()) ? match : `<${tag}${attributes}></${tag}>`);
const clampLevel = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(6, Math.max(1, parsed)) : fallback;
};
const textOf = element => element.text().replace(/\s+/g, ' ').trim();

export function storageToEditorHtml(storage) {
  const $ = load(String(storage ?? ''), { xmlMode: true }, false);
  const warnings = [];

  // Task lists become editor task nodes. Only the task body is kept: task ids
  // and task status words must never leak into the editable text.
  $('ac\\:task-list').toArray().reverse().forEach(node => {
    const list = $(node);
    const items = list.children('ac\\:task').toArray().map(task => {
      const item = $(task);
      const status = textOf(item.children('ac\\:task-status').first()).toLowerCase();
      const body = item.children('ac\\:task-body').first();
      return `<li data-type="taskItem" data-checked="${status === 'complete' ? 'true' : 'false'}">${body.length ? body.html() : ''}</li>`;
    });
    list.replaceWith(`<ul data-type="taskList">${items.join('')}</ul>`);
  });

  $('ac\\:emoticon').each((_, node) => {
    const item = $(node);
    const name = String(item.attr('ac:name') || '').trim().toLowerCase();
    const glyph = EMOTICON_GLYPHS[name];
    if (glyph) item.replaceWith(glyph);
    else {
      warnings.push(`备份中的表情符号「${name || '未命名'}」暂不支持，已移除。`);
      item.remove();
    }
  });

  // Innermost macros first so a converted child is already editor HTML when
  // the enclosing macro body is serialized.
  $('ac\\:structured-macro').toArray().reverse().forEach(node => {
    const macro = $(node);
    const name = String(macro.attr('ac:name') || '').trim().toLowerCase();
    const parameters = new Map();
    macro.children('ac\\:parameter').each((_, parameter) => {
      const item = $(parameter);
      const key = String(item.attr('ac:name') || '').trim().toLowerCase();
      if (key && !parameters.has(key)) parameters.set(key, textOf(item));
    });
    const richBody = macro.children('ac\\:rich-text-body').first();
    const richHtml = richBody.length ? richBody.html() : '';

    if (name === 'toc') {
      const min = clampLevel(parameters.get('minlevel'), 1);
      const max = Math.max(min, clampLevel(parameters.get('maxlevel'), 6));
      macro.replaceWith(`<div data-pageport-toc="true" data-min-level="${min}" data-max-level="${max}"></div>`);
      return;
    }
    if (PANEL_MACROS.has(name)) {
      // The editor has four panel kinds; Confluence's generic "panel" macro
      // becomes the neutral info panel.
      const type = PANEL_TYPES.has(name) ? name : 'info';
      const title = parameters.get('title');
      const heading = title ? `<p><strong>${escape(title)}</strong></p>` : '';
      macro.replaceWith(`<div data-pageport-panel="${type}">${heading}${richHtml}</div>`);
      return;
    }
    if (name === 'status') {
      const colour = String(parameters.get('colour') || '').trim().toLowerCase();
      const title = parameters.get('title') || '状态';
      macro.replaceWith(`<span data-pageport-status="${STATUS_COLOURS.has(colour) ? colour : 'grey'}">${escape(title)}</span>`);
      return;
    }
    if (name === 'code' || name === 'noformat') {
      const plain = macro.children('ac\\:plain-text-body').first();
      const code = plain.length ? plain.text() : textOf(richBody);
      macro.replaceWith(`<pre><code>${escape(code)}</code></pre>`);
      return;
    }

    const plainBody = macro.children('ac\\:plain-text-body').first();
    if (richBody.length) {
      warnings.push(`备份中的 Confluence 宏「${name || '未命名'}」无法完整还原，已保留其正文内容。`);
      macro.replaceWith(richHtml);
    } else if (plainBody.length) {
      warnings.push(`备份中的 Confluence 宏「${name || '未命名'}」无法完整还原，已保留其纯文本内容。`);
      macro.replaceWith(`<pre><code>${escape(plainBody.text())}</code></pre>`);
    } else {
      warnings.push(`备份中的 Confluence 宏「${name || '未命名'}」无法还原，已移除。`);
      macro.remove();
    }
  });

  // Backup JSON has no attachment bytes: leave a visible placeholder that the
  // normal conversion pipeline reports as a blocker, so publishing is stopped
  // until the user inserts the image again (or deletes the placeholder).
  $('ac\\:image').each((_, node) => {
    const image = $(node);
    const height = String(image.attr('ac:height') || '').replace(/\D/g, '').slice(0, 4);
    const url = image.children('ri\\:url').first();
    if (url.length) {
      let address = '';
      try { address = new URL(String(url.attr('ri:value') || '').trim()).href; } catch { address = ''; }
      if (/^https:\/\//i.test(address)) {
        image.replaceWith(`<span data-confluence-image="${escape(address)}"${height ? ` data-height="${height}"` : ''}>图片</span>`);
        return;
      }
    }
    const filename = String(image.children('ri\\:attachment').first().attr('ri:filename') || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const label = filename ? `备份附件图片 ${filename}` : '备份中的图片';
    image.replaceWith(`<span data-pageport-missing-image="${escape(label)}">[待补充图片：${escape(label)}]</span>`);
  });

  // Drop macro bookkeeping and any remaining namespaced wrapper before the
  // HTML reaches the editor. Deepest nodes first so unwrapping a parent cannot
  // re-introduce markup that was already processed.
  $('ac\\:task-id, ac\\:task-status, ac\\:parameter').remove();
  $('ac\\:rich-text-body, ac\\:plain-text-body, ac\\:task-body').toArray().reverse().forEach(node => {
    const item = $(node);
    const inner = item.html();
    if (inner === null || inner === '') item.remove();
    else item.replaceWith(inner);
  });
  $('*').filter((_, node) => /^(?:ac|ri):/i.test(node.name || '')).toArray().reverse().forEach(node => {
    const item = $(node);
    const inner = item.html();
    if (inner === null || inner === '') item.remove();
    else item.replaceWith(inner);
  });

  return { html: toHtml($.html()), warnings: [...new Set(warnings)] };
}
