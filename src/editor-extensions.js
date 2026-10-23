import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { Table, TableCell, TableHeader, TableView } from '@tiptap/extension-table';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { liftTarget } from '@tiptap/pm/transform';

export const INDENT_STEP=30, MAX_INDENT=8;
export const PANEL_TYPES=[
  {type:'info',label:'信息'},{type:'tip',label:'提示'},{type:'note',label:'注意'},{type:'warning',label:'警告'},
];
export const STATUS_COLORS=[
  {color:'grey',label:'灰色'},{color:'blue',label:'蓝色'},{color:'green',label:'绿色'},{color:'yellow',label:'黄色'},{color:'red',label:'红色'},
];
const panelType=value=>PANEL_TYPES.some(p=>p.type===value)?value:'info';
const statusColor=value=>STATUS_COLORS.some(s=>s.color===value)?value:'grey';
const clampIndent=value=>Math.min(MAX_INDENT,Math.max(0,value));

function shiftParagraphs(tr,delta,dispatch) {
  const {from,to}=tr.selection;
  let changed=false;
  tr.doc.nodesBetween(from,to,(node,pos)=>{
    if(['listItem','taskItem','table','codeBlock'].includes(node.type.name))return false;
    if(node.type.name!=='paragraph' && node.type.name!=='heading')return true;
    const indent=clampIndent((node.attrs.indent || 0)+delta);
    if(indent!==node.attrs.indent){if(dispatch)tr.setNodeMarkup(pos,undefined,{...node.attrs,indent});changed=true;}
    return false;
  });
  return changed;
}

// Paragraph indent maps to Confluence's native `margin-left` paragraph style; list items still nest.
export const Indent=Extension.create({
  name:'indent',
  addGlobalAttributes:()=>[{
    types:['paragraph','heading'],
    attributes:{indent:{
      default:0,
      parseHTML:element=>clampIndent(Math.round((Number.parseFloat(element.style.marginLeft) || 0)/INDENT_STEP)),
      renderHTML:attrs=>attrs.indent?{style:`margin-left: ${attrs.indent*INDENT_STEP}px`}:{},
    }},
  }],
  addCommands:()=>({
    indent:()=>({editor,commands,tr,dispatch})=>{
      if(editor.isActive('taskItem'))return commands.sinkListItem('taskItem');
      if(editor.isActive('listItem'))return commands.sinkListItem('listItem');
      return shiftParagraphs(tr,1,dispatch);
    },
    outdent:()=>({editor,commands,tr,dispatch})=>{
      if(editor.isActive('taskItem'))return commands.liftListItem('taskItem');
      if(editor.isActive('listItem'))return commands.liftListItem('listItem');
      return shiftParagraphs(tr,-1,dispatch);
    },
  }),
  addKeyboardShortcuts() {
    return {'Mod-]':()=>this.editor.commands.indent(),'Mod-[':()=>this.editor.commands.outdent()};
  },
});

export const Panel=Node.create({
  name:'panel',
  group:'block',
  content:'block+',
  defining:true,
  addAttributes:()=>({
    type:{default:'info',parseHTML:element=>panelType(element.getAttribute('data-pageport-panel')),renderHTML:attrs=>({'data-pageport-panel':attrs.type})},
  }),
  parseHTML:()=>[{tag:'div[data-pageport-panel]'}],
  renderHTML:({HTMLAttributes})=>['div',mergeAttributes(HTMLAttributes),0],
  addCommands:()=>({
    setPanel:type=>({editor,commands})=>editor.isActive('panel')?commands.updateAttributes('panel',{type:panelType(type)}):commands.wrapIn('panel',{type:panelType(type)}),
    unsetPanel:()=>({state,tr,dispatch})=>{
      const {$from}=state.selection;
      for(let depth=$from.depth;depth>0;depth--) {
        if($from.node(depth).type.name!=='panel')continue;
        const range=tr.doc.resolve($from.start(depth)).blockRange(tr.doc.resolve($from.end(depth)));
        const target=range && liftTarget(range);
        if(target==null)return false;
        if(dispatch)tr.lift(range,target);
        return true;
      }
      return false;
    },
  }),
  addKeyboardShortcuts() {
    return {
      // Enter on a trailing empty line leaves the panel, like lists do.
      Enter:()=>{
        const {$from,empty}=this.editor.state.selection;
        if(!empty || $from.parent.type.name!=='paragraph' || $from.parent.content.size || $from.depth<2)return false;
        const panel=$from.node(-1);
        if(panel.type.name!=='panel' || panel.childCount<2 || $from.index(-1)!==panel.childCount-1)return false;
        return this.editor.commands.lift('panel');
      },
    };
  },
});

export const Status=Node.create({
  name:'status',
  group:'inline',
  inline:true,
  atom:true,
  selectable:true,
  priority:200,
  addAttributes:()=>({
    color:{default:'grey',parseHTML:element=>statusColor(element.getAttribute('data-pageport-status')),renderHTML:attrs=>({'data-pageport-status':attrs.color})},
    text:{default:'状态',parseHTML:element=>element.textContent.trim().slice(0,40) || '状态',renderHTML:()=>({})},
  }),
  parseHTML:()=>[{tag:'span[data-pageport-status]'}],
  renderHTML:({node,HTMLAttributes})=>['span',mergeAttributes(HTMLAttributes),node.attrs.text],
  renderText:({node})=>node.attrs.text,
});

export const searchKey=new PluginKey('pageportSearch');

function findMatches(doc,term,caseSensitive) {
  if(!term)return [];
  const needle=caseSensitive?term:term.toLowerCase(), results=[];
  doc.descendants((node,pos)=>{
    if(!node.isTextblock)return true;
    // Index each character back to a document position; inline atoms never match.
    let text='';const positions=[];
    node.forEach((child,offset)=>{
      if(child.isText){for(let i=0;i<child.text.length;i++)positions.push(pos+1+offset+i);text+=child.text;}
      else {positions.push(pos+1+offset);text+='\ufffc';}
    });
    const haystack=caseSensitive?text:text.toLowerCase();
    if(haystack.length!==text.length)return false;
    for(let i=haystack.indexOf(needle);i!==-1;i=haystack.indexOf(needle,i+needle.length)) {
      results.push({from:positions[i],to:positions[i+needle.length-1]+1});
    }
    return false;
  });
  return results;
}

export const SearchReplace=Extension.create({
  name:'searchReplace',
  addProseMirrorPlugins:()=>[new Plugin({
    key:searchKey,
    state:{
      init:()=>({term:'',caseSensitive:false,index:0,results:[]}),
      apply:(tr,prev)=>{
        const meta=tr.getMeta(searchKey);
        if(!meta && !tr.docChanged)return prev;
        const next={...prev,...meta};
        const results=findMatches(tr.doc,next.term,next.caseSensitive);
        return {...next,results,index:results.length?Math.min(Math.max(next.index,0),results.length-1):0};
      },
    },
    props:{
      decorations(state) {
        const {results,index}=searchKey.getState(state);
        if(!results.length)return DecorationSet.empty;
        return DecorationSet.create(state.doc,results.map((r,i)=>Decoration.inline(r.from,r.to,{class:i===index?'search-match current':'search-match'})));
      },
    },
  })],
});

export const getSearch=editor=>searchKey.getState(editor.state);
export function updateSearch(editor,patch,reveal=false) {
  let tr=editor.state.tr.setMeta(searchKey,patch);
  editor.view.dispatch(tr);
  const {results,index}=getSearch(editor);
  if(reveal && results[index]) {
    tr=editor.state.tr.setSelection(TextSelection.create(editor.state.doc,results[index].from,results[index].to)).scrollIntoView();
    editor.view.dispatch(tr);
  }
}
export function stepSearch(editor,delta) {
  const {results,index}=getSearch(editor);
  if(results.length)updateSearch(editor,{index:(index+delta+results.length)%results.length},true);
}
export function replaceMatches(editor,replacement,all=false) {
  const {results,index}=getSearch(editor);
  if(!results.length || !editor.isEditable)return 0;
  const targets=all?[...results].reverse():[results[index]];
  const tr=editor.state.tr;
  for(const {from,to} of targets)replacement?tr.insertText(replacement,from,to):tr.delete(from,to);
  editor.view.dispatch(tr);
  if(!all)updateSearch(editor,{},true);
  return targets.length;
}

const CJK=/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g;
const WORD=/[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*/g;
export function countWords(text) {
  return {words:(text.match(CJK) || []).length+(text.replace(CJK,' ').match(WORD) || []).length,characters:text.replace(/\s/g,'').length};
}

class WidthTableView extends TableView {
  constructor(node, cellMinWidth, view, HTMLAttributes) {
    super(node, cellMinWidth, view, HTMLAttributes);
    this.keepWidth(node);
  }
  update(node) {
    const ok = super.update(node);
    if (ok) this.keepWidth(node);
    return ok;
  }
  keepWidth(node) {
    const width = /width\s*:\s*([^;]+)/i.exec(node.attrs.style || '')?.[1]?.trim();
    if (width) this.table.style.width = width;
  }
}
const percentWidth = element => {
  const width = (element.style.width || '').trim();
  return /^\d+(?:\.\d+)?%$/.test(width) ? `width: ${width}` : null;
};
const cellStyle = element => {
  const parts = [];
  const align = (element.style.textAlign || '').trim().toLowerCase();
  if (['left','center','right','justify'].includes(align)) parts.push(`text-align: ${align}`);
  const background = (element.style.backgroundColor || '').trim();
  if (background && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)') parts.push(`background-color: ${background}`);
  return parts.join('; ') || null;
};
const styledCell = ExtensionNode => ExtensionNode.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align:{default:null,parseHTML:element=>(element.style.textAlign || '').trim().toLowerCase() || null,renderHTML:()=>({})},
      cellStyle:{default:null,parseHTML:cellStyle,renderHTML:attributes=>attributes.cellStyle?{style:attributes.cellStyle}:{}},
    };
  },
});
export const ConfluenceTable = Table.extend({
  addAttributes() {
    return {...this.parent?.(), style:{default:null,parseHTML:percentWidth,renderHTML:attributes=>attributes.style?{style:attributes.style}:{}}};
  },
  addOptions() {
    return {...this.parent?.(), resizable:false, View:WidthTableView};
  },
});
export const ConfluenceTableCell = styledCell(TableCell);
export const ConfluenceTableHeader = styledCell(TableHeader);
