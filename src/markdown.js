import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export function createSerializer() {
  const service = new TurndownService({ headingStyle:'atx', codeBlockStyle:'fenced', bulletListMarker:'-', emDelimiter:'*' });
  service.use(gfm);
  service.remove(['label','input']);
  service.addRule('extendedInline', {
    filter:['u','mark','sub','sup'],
    replacement:(_content,node)=>node.outerHTML,
  });
  service.addRule('strike', {filter:['s','del'],replacement:content=>`~~${content}~~`});
  service.addRule('complexTable', {
    filter:node=>node.nodeName==='TABLE' && !!node.querySelector('[colspan]:not([colspan="1"]),[rowspan]:not([rowspan="1"]),table'),
    replacement:(_content,node)=>`\n\n${node.outerHTML}\n\n`,
  });
  service.addRule('alignedBlock', {
    filter:node=>/^(P|H[1-6])$/.test(node.nodeName) && /text-align:\s*(center|right|justify)/.test(node.getAttribute('style') || ''),
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
