import { load } from 'cheerio/slim';

const panels = {info:'info',information:'info',warning:'warning',danger:'warning',error:'warning',success:'tip',tip:'tip',note:'note'};
const colours = new Set(['grey','blue','green','yellow','red']);

// Normalize explicit exported semantics only. Ordinary coloured text is not a status.
export function normalizeOnlineDocument(html) {
  const $ = load(html, {xmlMode:false}, false);
  const warnings = [];
  $('script,style,iframe,object,embed,form,button,meta,link').remove();
  $('.pageport-warning').attr('data-callout-type','warning');
  $('.pageport-success').attr('data-callout-type','success');
  $('[data-callout-type],[data-type="callout"],[data-type="alert"],.dingtalk-callout').each((_,node)=>{
    const item=$(node);
    const type=item.attr('data-callout-type') || item.attr('data-alert-type') || item.attr('data-kind') || 'info';
    item.replaceWith($('<div></div>').attr('data-pageport-panel',panels[type.toLowerCase()] || 'info').html(item.html()));
  });
  $('[data-type="status"],[data-type="status-tag"],.dingtalk-status').each((_,node)=>{
    const item=$(node), colour=(item.attr('data-color') || 'grey').toLowerCase();
    item.replaceWith($('<span></span>').attr('data-pageport-status',colours.has(colour)?colour:'grey').text(item.text().trim().slice(0,40)));
  });
  $('li').each((_,node)=>{
    const item=$(node), checkbox=item.children('input[type="checkbox"]').add(item.children('label').find('input[type="checkbox"]')).first();
    const explicit=item.attr('data-type')==='taskItem' || item.attr('data-type')==='todo' || item.attr('data-checked')!=null;
    if (!checkbox.length && !explicit) return;
    const checked=checkbox.length?checkbox.is('[checked]'):['true','1','checked'].includes(item.attr('data-checked'));
    item.attr('data-type','taskItem').attr('data-checked',String(checked));
    item.parent('ul').attr('data-type','taskList');
    checkbox.remove();
  });
  // Text-only checkbox exports retain their meaning without guessing ordinary bullet lists.
  $('p').each((_,node)=>{
    const item=$(node), first=node.children?.[0];
    if (first?.type!=='text' || !/^\s*[☐☑☒]\s*/u.test(first.data)) return;
    const checked=/^\s*[☑☒]/u.test(first.data);
    first.data=first.data.replace(/^\s*[☐☑☒]\s*/u,'');
    item.replaceWith($('<ul data-type="taskList"><li data-type="taskItem"></li></ul>').find('li').attr('data-checked',String(checked)).html(item.html()).end());
  });
  $('input').remove();
  $('img').each((_,node)=>{
    const item=$(node), src=item.attr('src') || '';
    if (/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(src)) return;
    // File imports resolve companion image files later; clipboard callers opt into placeholders.
    warnings.push('在线图片未归档，请补充本地图片；不会自动下载受限地址。');
  });
  return {html:$.html(),warnings:[...new Set(warnings)]};
}

export function normalizeClipboardHtml(html) {
  const normalized=normalizeOnlineDocument(html);
  const $=load(normalized.html,{xmlMode:false},false);
  $('img').each((_,node)=>{
    const item=$(node);
    if (!/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(item.attr('src') || '')) {
      const label=(item.attr('alt') || '在线图片').slice(0,120);
      item.replaceWith($('<span></span>').attr('data-pageport-missing-image',label).text(`[待补充图片：${label}]`));
    }
  });
  return {...normalized,html:$.html()};
}
