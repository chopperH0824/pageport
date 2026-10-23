import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const escapeHtml=text=>String(text).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
const KEPT_ATTRIBUTES={MARK:['data-color','style'],SPAN:['style']};

export function createSerializer() {
  const contents=node=>`\n\n<div data-pageport-toc="true" data-min-level="${Number(node.getAttribute('data-min-level')) || 1}" data-max-level="${Number(node.getAttribute('data-max-level')) || 6}"></div>\n\n`;
  const service = new TurndownService({
    headingStyle:'atx', codeBlockStyle:'fenced', bulletListMarker:'-', emDelimiter:'*',
    blankReplacement:(_content,node)=>node.nodeName==='DIV' && node.getAttribute('data-pageport-toc')==='true'?contents(node):node.isBlock?'\n\n':'',
  });
  service.use(gfm);
  service.remove(['label','input']);
  service.addRule('tableOfContents', {
    filter:node=>node.nodeName==='DIV' && node.getAttribute('data-pageport-toc')==='true',
    replacement:(_content,node)=>contents(node),
  });
  // Blank lines around the content let Markdown inside the panel keep rendering as Markdown.
  service.addRule('panel', {
    filter:node=>node.nodeName==='DIV' && node.hasAttribute('data-pageport-panel'),
    replacement:(content,node)=>`\n\n<div data-pageport-panel="${escapeHtml(node.getAttribute('data-pageport-panel'))}">\n\n${content.trim()}\n\n</div>\n\n`,
  });
  service.addRule('status', {
    filter:node=>node.nodeName==='SPAN' && node.hasAttribute('data-pageport-status'),
    replacement:(_content,node)=>`<span data-pageport-status="${escapeHtml(node.getAttribute('data-pageport-status'))}">${escapeHtml(service.escape(node.textContent))}</span>`,
  });
  service.addRule('missingImage', {
    filter:node=>node.nodeName==='SPAN' && node.hasAttribute('data-pageport-missing-image'),
    replacement:(_content,node)=>`<span data-pageport-missing-image="${escapeHtml(node.getAttribute('data-pageport-missing-image'))}">${escapeHtml(node.textContent)}</span>`,
  });
  // Wrap the converted content rather than copying outerHTML, so Markdown characters stay escaped.
  service.addRule('extendedInline', {
    filter:node=>['U','MARK','SUB','SUP'].includes(node.nodeName) || (node.nodeName==='SPAN' && node.hasAttribute('style')),
    replacement:(content,node)=>{
      const tag=node.nodeName.toLowerCase();
      const attrs=(KEPT_ATTRIBUTES[node.nodeName] || []).filter(name=>node.getAttribute(name)).map(name=>` ${name}="${escapeHtml(node.getAttribute(name))}"`).join('');
      return `<${tag}${attrs}>${content}</${tag}>`;
    },
  });
  service.addRule('strike', {filter:['s','del'],replacement:content=>`~~${content}~~`});
  service.addRule('complexTable', {
    filter:node=>node.nodeName==='TABLE' && !!(node.getAttribute('style') || node.querySelector('[style],[colspan]:not([colspan="1"]),[rowspan]:not([rowspan="1"]),table')),
    replacement:(_content,node)=>`\n\n${node.outerHTML}\n\n`,
  });
  service.addRule('alignedBlock', {
    filter:node=>/^(P|H[1-6])$/.test(node.nodeName) && /text-align:\s*(center|right|justify)|margin-left:\s*[1-9]/.test(node.getAttribute('style') || ''),
    replacement:(_content,node)=>`\n\n${node.outerHTML}\n\n`,
  });
  service.addRule('task', {
    filter:node=>node.nodeName==='LI' && node.getAttribute('data-type')==='taskItem',
    replacement:(content,node)=>`\n- [${node.getAttribute('data-checked')==='true'?'x':' '}] ${content.trim().replace(/\n/g,'\n    ')}\n`,
  });
  // CommonMark cannot represent a punctuation-ended mark next to CJK text with delimiters.
  service.addRule('cjkMark', {
    filter:node=>/^(STRONG|EM|B|I)$/.test(node.nodeName) && /[：，。；！？、:;,!?]$/.test(node.textContent),
    replacement:(_content,node)=>node.outerHTML,
  });
  return html=>service.turndown(html).trim()+'\n';
}

export const toMarkdown=createSerializer();
