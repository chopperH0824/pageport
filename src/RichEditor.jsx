import React, { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import {
  Undo2, Redo2, Bold, Italic, Underline, Strikethrough, Highlighter, Code,
  List, ListOrdered, ListTodo, Quote, SquareCode, Minus, Link2, Unlink,
  ImagePlus, Table2, Trash2, Combine, Split, ListTree,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, Subscript as SubIcon, Superscript as SupIcon,
  IndentIncrease, IndentDecrease, RemoveFormatting, X, Check, ChevronDown, Baseline, Paintbrush,
  Info, Tag, Omega, Search, Replace, ReplaceAll, Keyboard, CaseSensitive, CalendarDays, ArrowUp, ArrowDown,
  BetweenHorizontalStart, BetweenHorizontalEnd, BetweenVerticalStart, BetweenVerticalEnd, PanelTop, PanelLeft,
} from 'lucide-react';
import { toMarkdown } from './markdown.js';
import { TableOfContents } from './TableOfContents.jsx';
import {
  Indent, Panel, Status, SearchReplace, PANEL_TYPES, STATUS_COLORS,
  getSearch, updateSearch, stepSearch, replaceMatches, countWords,
} from './editor-extensions.js';
import './rich-editor.css';

const TEXT_COLORS=[
  {value:'#172b4d',label:'深灰'},{value:'#97a0af',label:'浅灰'},{value:'#c0392b',label:'红色'},{value:'#d35400',label:'橙色'},
  {value:'#b7950b',label:'黄褐'},{value:'#1e8449',label:'绿色'},{value:'#1f6fb2',label:'蓝色'},{value:'#7d3c98',label:'紫色'},
];
const HIGHLIGHT_COLORS=[
  {value:'#fff3a3',label:'黄色'},{value:'#c9f2d6',label:'绿色'},{value:'#cce5ff',label:'蓝色'},
  {value:'#ffd6d6',label:'红色'},{value:'#e8dcff',label:'紫色'},{value:'#e6e9ec',label:'灰色'},
];
const SYMBOLS=['→','←','↑','↓','⇒','↔','✓','✗','★','☆','●','○','■','□','◆','▲','※','…','—','·','±','×','÷','≈','≠','≤','≥','∞','°','‰','¥','€','$','£','©','®','™','§','①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','「','」','『','』','【','】','《','》'];
const SHORTCUTS=[
  ['加粗 / 斜体 / 下划线','⌘B / ⌘I / ⌘U'],['删除线 / 高亮','⇧⌘S / ⇧⌘H'],['行内代码','⌘E'],['上标 / 下标','⌘. / ⌘,'],
  ['正文 / 标题 1–6','⌥⌘0 / ⌥⌘1–6'],['左 / 中 / 右 / 两端对齐','⇧⌘L / ⇧⌘E / ⇧⌘R / ⇧⌘J'],['增加 / 减少缩进','⌘] / ⌘['],
  ['有序 / 无序 / 任务列表','⇧⌘7 / ⇧⌘8 / ⇧⌘9'],['引用 / 代码块','⇧⌘B / ⌥⌘C'],['插入链接','⌘K'],['查找与替换','⌘F'],
  ['段内换行','⇧↩'],['撤销 / 重做','⌘Z / ⇧⌘Z'],['导出 Markdown','⌘S'],
];
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};

const LocalImage=Image.extend({
  parseHTML:()=>[{tag:'img[src]',getAttrs:node=>/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(node.getAttribute('src') || '') ? null : false}],
});

function Tool({label,icon:Icon,active=false,disabled=false,onClick,children}) {
  return <button type="button" className={`format-tool ${active?'active':''}`} title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={onClick}><Icon size={16}/>{children}</button>;
}
function ColorTool({label,icon,color,active,disabled,open,onApply,onToggle}) {
  return <span className="split-tool">
    <Tool label={label} icon={icon} active={active} disabled={disabled} onClick={onApply}><i className="color-bar" style={{background:color}}/></Tool>
    <button type="button" className={`split-arrow ${open?'active':''}`} title={`${label}选项`} aria-label={`${label}选项`} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={onToggle}><ChevronDown size={11}/></button>
  </span>;
}
function Swatches({title,colors,current,onPick,onClear,clearLabel,custom,onClose}) {
  return <div className="format-popover swatch-popover" role="dialog" aria-label={title}>
    <span className="popover-title">{title}</span>
    {colors.map(c=><button type="button" key={c.value} className={`swatch ${current===c.value?'selected':''}`} style={{background:c.value}} title={c.label} aria-label={c.label} onMouseDown={e=>e.preventDefault()} onClick={()=>{onPick(c.value);onClose();}}/>)}
    {custom && <label className="custom-color" title="自定义颜色">自定义<input type="color" aria-label="自定义颜色" value={/^#[0-9a-f]{6}$/i.test(current || '')?current:'#172b4d'} onChange={e=>onPick(e.target.value,false)}/></label>}
    <button type="button" className="small-button" onMouseDown={e=>e.preventDefault()} onClick={onClear}>{clearLabel}</button>
    <Tool label="关闭格式面板" icon={X} onClick={onClose}/>
  </div>;
}

export default function RichEditor({content,contentVersion,disabled,onChange,onError,onReady,onOutline}) {
  const [panel,setPanel]=useState(''), [link,setLink]=useState(''), [rows,setRows]=useState(3), [cols,setCols]=useState(3);
  const [textColor,setTextColor]=useState('#c0392b'), [highlightColor,setHighlightColor]=useState('#fff3a3');
  const [painter,setPainter]=useState(null), [status,setStatus]=useState({text:'进行中',color:'blue'});
  const [replacement,setReplacement]=useState('');
  const imageInput=useRef(), findInput=useRef(), callbacks=useRef({}), painterRef=useRef(null);
  const loadedVersion=useRef(contentVersion);
  callbacks.current={onChange,onError,onOutline};
  painterRef.current=painter;
  const emit=editor=>{
    const html=editor.getHTML();
    callbacks.current.onChange({html,source:toMarkdown(html)});
    updateOutline(editor);
  };
  const updateOutline=editor=>{
    const headings=[];
    editor.state.doc.descendants((node,pos)=>{if(node.type.name==='heading') headings.push({text:node.textContent,level:node.attrs.level,pos});});
    callbacks.current.onOutline(headings);
  };
  const insertImages=async(editor,files)=>{
    try {
      for(const file of files) {
        if(!/^image\/(png|jpeg|gif|webp)$/.test(file.type) || file.size>6*1024*1024) throw new Error('图片仅支持 PNG、JPEG、GIF、WebP，单张最大 6 MB。');
        const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('无法读取图片。'));reader.readAsDataURL(file);});
        if(!editor.isDestroyed && editor.isEditable) editor.chain().focus().setImage({src,alt:file.name}).run();
      }
    } catch(error){callbacks.current.onError(error.message);}
  };
  const editor=useEditor({
    extensions:[
      StarterKit.configure({link:{openOnClick:false,autolink:false},heading:{levels:[1,2,3,4,5,6]}}),
      LocalImage.configure({allowBase64:true}),
      TableKit.configure({table:{resizable:false}}),
      TaskList,TaskItem.configure({nested:true}),
      TextAlign.configure({types:['heading','paragraph']}),
      Highlight.configure({multicolor:true}),Subscript,Superscript,
      TextStyle,Color,Indent,Panel,Status,SearchReplace,
      TableOfContents,
    ],
    content,
    immediatelyRender:false,
    editorProps:{
      attributes:{class:'prose-editor','aria-label':'文档可视化编辑器',role:'textbox','aria-multiline':'true',spellcheck:'false'},
      handlePaste:(_view,event)=>{
        const files=[...(event.clipboardData?.files || [])].filter(file=>file.type.startsWith('image/'));
        if(!files.length)return false;
        if(disabled)return true;
        event.preventDefault();insertImages(editor,files);return true;
      },
      handleDrop:(_view,event,_slice,moved)=>{
        if(moved)return false;
        const files=[...(event.dataTransfer?.files || [])].filter(file=>file.type.startsWith('image/'));
        if(!files.length)return false;
        event.preventDefault();event.stopPropagation();insertImages(editor,files);return true;
      },
    },
    onUpdate:({editor})=>emit(editor),
    onCreate:({editor})=>updateOutline(editor),
  });
  const state=useEditorState({editor,selector:({editor:e})=>{
    if(!e)return {};
    const {selection,doc}=e.state, search=getSearch(e);
    const selected=selection.empty?'':doc.textBetween(selection.from,selection.to,'\n',' ');
    return {
      bold:e.isActive('bold'),italic:e.isActive('italic'),underline:e.isActive('underline'),
      strike:e.isActive('strike'),highlight:e.isActive('highlight'),code:e.isActive('code'),
      bulletList:e.isActive('bulletList'),orderedList:e.isActive('orderedList'),taskList:e.isActive('taskList'),
      blockquote:e.isActive('blockquote'),codeBlock:e.isActive('codeBlock'),link:e.isActive('link'),
      subscript:e.isActive('subscript'),superscript:e.isActive('superscript'),table:e.isActive('table'),
      panel:e.isActive('panel')?e.getAttributes('panel').type:'',
      status:e.isActive('status')?e.getAttributes('status'):null,
      color:e.getAttributes('textStyle').color || '',highlightColor:e.getAttributes('highlight').color || '',
      heading:e.getAttributes('heading').level || 0,align:e.getAttributes('paragraph').textAlign || e.getAttributes('heading').textAlign || 'left',
      canUndo:e.can().undo(),canRedo:e.can().redo(),canMerge:e.can().mergeCells(),canSplit:e.can().splitCell(),
      canIndent:e.can().indent(),canOutdent:e.can().outdent(),
      count:countWords(doc.textBetween(0,doc.content.size,'\n',' ')),selected:selected?countWords(selected).words:0,
      search:{term:search.term,caseSensitive:search.caseSensitive,index:search.index,total:search.results.length},
    };
  }});
  useEffect(()=>{if(editor){editor.setEditable(!disabled,false);if(disabled){setPanel('');setPainter(null);}}},[editor,disabled]);
  useEffect(()=>{
    if(!editor)return;
    if(loadedVersion.current===contentVersion)return;
    loadedVersion.current=contentVersion;
    editor.commands.setContent(content,{emitUpdate:false});
    updateOutline(editor);
  },[editor,contentVersion]);
  useEffect(()=>{if(editor)onReady(editor);return()=>onReady(null);},[editor]);
  useEffect(()=>{
    if(!editor)return;
    const dom=editor.view.dom;
    // Apply copied formatting once the drag-selection is final.
    const paint=()=>setTimeout(()=>{
      const marks=painterRef.current;
      if(!marks || editor.isDestroyed || !editor.isEditable)return;
      const {from,to,empty}=editor.state.selection;
      if(empty)return;
      const tr=editor.state.tr;
      Object.values(editor.schema.marks).forEach(type=>{if(type.name!=='link')tr.removeMark(from,to,type);});
      marks.forEach(mark=>tr.addMark(from,to,mark));
      editor.view.dispatch(tr);setPainter(null);
    });
    dom.addEventListener('mouseup',paint);
    return()=>dom.removeEventListener('mouseup',paint);
  },[editor]);
  const openPanel=name=>{
    if(name==='link')setLink(editor.getAttributes('link').href || '');
    if(name==='find') {
      const {from,to,empty}=editor.state.selection;
      const selected=empty?'':editor.state.doc.textBetween(from,to,' ',' ');
      if(selected && !selected.includes('\n') && selected.length<=200)updateSearch(editor,{term:selected,index:0});
      setTimeout(()=>{findInput.current?.focus();findInput.current?.select();});
    }
    if(panel==='find' && name!=='find')updateSearch(editor,{term:''});
    setPanel(name);
  };
  const closePanel=()=>openPanel('');
  const togglePanel=name=>openPanel(panel===name?'':name);
  useEffect(()=>{
    if(!editor)return;
    const keys=e=>{
      if(e.key==='Escape'){setPainter(null);if(panel)closePanel();return;}
      if(!(e.metaKey || e.ctrlKey) || e.altKey || !editor.view.dom.offsetParent)return;
      const key=e.key.toLowerCase(), inside=editor.view.dom.closest('.rich-editor').contains(window.document.activeElement);
      if(key==='f' && !e.shiftKey){e.preventDefault();openPanel('find');}
      else if(key==='k' && !e.shiftKey && inside && editor.isEditable){e.preventDefault();openPanel('link');}
    };
    window.addEventListener('keydown',keys);
    return()=>window.removeEventListener('keydown',keys);
  },[editor,panel]);
  if(!editor)return null;
  const run=command=>{command(editor.chain().focus()).run();};
  const saveLink=event=>{
    event.preventDefault();
    if(link && !/^(https?:\/\/|mailto:|#)/i.test(link)){onError('链接请使用 http://、https://、mailto: 或页内锚点。');return;}
    if(link && editor.state.selection.empty && !editor.isActive('link')) {
      editor.chain().focus().insertContent({type:'text',text:link,marks:[{type:'link',attrs:{href:link}}]}).run();
      setPanel('');return;
    }
    const chain=editor.chain().focus().extendMarkRange('link');
    if(link)chain.setLink({href:link}).run();else chain.unsetLink().run();
    setPanel('');
  };
  const copyFormat=()=>{
    if(painter){setPainter(null);return;}
    const {from,empty,$from}=editor.state.selection, node=!empty && editor.state.doc.nodeAt(from);
    setPainter((node?.isText?node.marks:editor.state.storedMarks || $from.marks()).filter(mark=>mark.type.name!=='link'));
  };
  const applyColor=(value,focus=true)=>{setTextColor(value);(focus?editor.chain().focus():editor.chain()).setColor(value).run();};
  // Replacing an atom node drops the node selection, so reselect it to keep the status bar open.
  const editStatus=attrs=>{const {from}=editor.state.selection;editor.chain().updateAttributes('status',attrs).setNodeSelection(from).run();};
  const applyHighlight=value=>{setHighlightColor(value);run(c=>c.setHighlight({color:value}));};
  const insertStatus=event=>{
    event.preventDefault();
    const text=status.text.trim().slice(0,40);
    if(!text){onError('请输入状态文字。');return;}
    editor.chain().focus().insertContent([{type:'status',attrs:{text,color:status.color}},{type:'text',text:' '}]).run();
    setPanel('');
  };
  const search=state.search || {};
  const off=disabled;
  return <div className={`rich-editor ${painter?'painting':''}`}>
    <div className="format-toolbar" role="toolbar" aria-label="文字格式">
      <div className="format-group">
        <Tool label="撤销 (⌘Z)" icon={Undo2} disabled={off || !state.canUndo} onClick={()=>editor.chain().focus().undo().run()}/>
        <Tool label="重做 (⇧⌘Z)" icon={Redo2} disabled={off || !state.canRedo} onClick={()=>editor.chain().focus().redo().run()}/>
        <Tool label={painter?'格式刷已就绪：拖选目标文字（Esc 取消）':'格式刷：复制当前文字格式'} icon={Paintbrush} active={!!painter} disabled={off} onClick={copyFormat}/>
        <Tool label="清除格式" icon={RemoveFormatting} disabled={off} onClick={()=>run(c=>c.unsetAllMarks().clearNodes().unsetTextAlign().updateAttributes('paragraph',{indent:0}))}/>
      </div>
      <div className="format-group">
        <select aria-label="段落样式" value={state.heading} disabled={off} onChange={e=>{const level=Number(e.target.value);level?editor.chain().focus().setHeading({level}).run():editor.chain().focus().setParagraph().run();}}>
          <option value="0">正文</option>{[1,2,3,4,5,6].map(n=><option key={n} value={n}>标题 {n}</option>)}
        </select>
      </div>
      <div className="format-group">
        <Tool label="加粗 (⌘B)" icon={Bold} active={state.bold} disabled={off} onClick={()=>run(c=>c.toggleBold())}/>
        <Tool label="斜体 (⌘I)" icon={Italic} active={state.italic} disabled={off} onClick={()=>run(c=>c.toggleItalic())}/>
        <Tool label="下划线 (⌘U)" icon={Underline} active={state.underline} disabled={off} onClick={()=>run(c=>c.toggleUnderline())}/>
        <Tool label="删除线 (⇧⌘S)" icon={Strikethrough} active={state.strike} disabled={off} onClick={()=>run(c=>c.toggleStrike())}/>
        <Tool label="上标 (⌘.)" icon={SupIcon} active={state.superscript} disabled={off} onClick={()=>run(c=>c.toggleSuperscript())}/>
        <Tool label="下标 (⌘,)" icon={SubIcon} active={state.subscript} disabled={off} onClick={()=>run(c=>c.toggleSubscript())}/>
        <Tool label="行内代码 (⌘E)" icon={Code} active={state.code} disabled={off} onClick={()=>run(c=>c.toggleCode())}/>
      </div>
      <div className="format-group">
        <ColorTool label="文字颜色" icon={Baseline} color={textColor} active={!!state.color} disabled={off} open={panel==='color'} onApply={()=>applyColor(textColor)} onToggle={()=>togglePanel('color')}/>
        <ColorTool label="背景高亮" icon={Highlighter} color={highlightColor} active={state.highlight} disabled={off} open={panel==='highlight'} onApply={()=>state.highlight && (state.highlightColor || '#fff3a3')===highlightColor?run(c=>c.unsetHighlight()):applyHighlight(highlightColor)} onToggle={()=>togglePanel('highlight')}/>
      </div>
      <div className="format-group">
        <Tool label="左对齐 (⇧⌘L)" icon={AlignLeft} active={state.align==='left'} disabled={off} onClick={()=>run(c=>c.setTextAlign('left'))}/>
        <Tool label="居中 (⇧⌘E)" icon={AlignCenter} active={state.align==='center'} disabled={off} onClick={()=>run(c=>c.setTextAlign('center'))}/>
        <Tool label="右对齐 (⇧⌘R)" icon={AlignRight} active={state.align==='right'} disabled={off} onClick={()=>run(c=>c.setTextAlign('right'))}/>
        <Tool label="两端对齐 (⇧⌘J)" icon={AlignJustify} active={state.align==='justify'} disabled={off} onClick={()=>run(c=>c.setTextAlign('justify'))}/>
        <Tool label="减少缩进 (⌘[)" icon={IndentDecrease} disabled={off || !state.canOutdent} onClick={()=>run(c=>c.outdent())}/>
        <Tool label="增加缩进 (⌘])" icon={IndentIncrease} disabled={off || !state.canIndent} onClick={()=>run(c=>c.indent())}/>
      </div>
      <div className="format-group">
        <Tool label="无序列表 (⇧⌘8)" icon={List} active={state.bulletList} disabled={off} onClick={()=>run(c=>c.toggleBulletList())}/>
        <Tool label="有序列表 (⇧⌘7)" icon={ListOrdered} active={state.orderedList} disabled={off} onClick={()=>run(c=>c.toggleOrderedList())}/>
        <Tool label="任务列表 (⇧⌘9)" icon={ListTodo} active={state.taskList} disabled={off} onClick={()=>run(c=>c.toggleTaskList())}/>
        <Tool label="引用 (⇧⌘B)" icon={Quote} active={state.blockquote} disabled={off} onClick={()=>run(c=>c.toggleBlockquote())}/>
        <Tool label="提示面板" icon={Info} active={!!state.panel || panel==='panel'} disabled={off} onClick={()=>togglePanel('panel')}/>
        <Tool label="代码块 (⌥⌘C)" icon={SquareCode} active={state.codeBlock} disabled={off} onClick={()=>run(c=>c.toggleCodeBlock())}/>
        <Tool label="分隔线" icon={Minus} disabled={off} onClick={()=>run(c=>c.setHorizontalRule())}/>
      </div>
      <div className="format-group">
        <Tool label="链接 (⌘K)" icon={Link2} active={state.link || panel==='link'} disabled={off} onClick={()=>togglePanel('link')}/>
        <Tool label="插入图片" icon={ImagePlus} disabled={off} onClick={()=>imageInput.current.click()}/>
        <Tool label="插入表格" icon={Table2} active={panel==='table'} disabled={off} onClick={()=>togglePanel('table')}/>
        <Tool label="插入目录" icon={ListTree} disabled={off} onClick={()=>editor.chain().focus().insertContent({type:'tableOfContents'}).run()}/>
        <Tool label="状态标签" icon={Tag} active={panel==='status'} disabled={off} onClick={()=>togglePanel('status')}/>
        <Tool label="特殊符号与日期" icon={Omega} active={panel==='symbols'} disabled={off} onClick={()=>togglePanel('symbols')}/>
      </div>
      <div className="format-group">
        <Tool label="查找与替换 (⌘F)" icon={Search} active={panel==='find'} onClick={()=>togglePanel('find')}/>
        <Tool label="快捷键" icon={Keyboard} active={panel==='help'} onClick={()=>togglePanel('help')}/>
      </div>
    </div>
    {panel==='link' && <form className="format-popover link-popover" onSubmit={saveLink}><Link2 size={15}/><input aria-label="链接地址" autoFocus type="text" value={link} onChange={e=>setLink(e.target.value)} placeholder="https://"/><Tool label="移除链接" icon={Unlink} onClick={()=>{editor.chain().focus().extendMarkRange('link').unsetLink().run();setPanel('');}}/><button className="icon-button" title="应用链接" aria-label="应用链接" type="submit"><Check size={16}/></button><Tool label="关闭格式面板" icon={X} onClick={closePanel}/></form>}
    {panel==='table' && <div className="format-popover table-popover"><label>行<input type="number" aria-label="表格行数" min="2" max="20" value={rows} onChange={e=>setRows(e.target.value)}/></label><span>×</span><label>列<input type="number" aria-label="表格列数" min="2" max="10" value={cols} onChange={e=>setCols(e.target.value)}/></label><button className="small-button" disabled={rows<2 || rows>20 || cols<2 || cols>10} onClick={()=>{editor.chain().focus().insertTable({rows:Number(rows),cols:Number(cols),withHeaderRow:true}).run();setPanel('');}}>插入表格</button><Tool label="关闭格式面板" icon={X} onClick={closePanel}/></div>}
    {panel==='color' && <Swatches title="文字颜色" colors={TEXT_COLORS} current={state.color} custom onPick={applyColor} onClear={()=>{run(c=>c.unsetColor());setPanel('');}} clearLabel="默认颜色" onClose={closePanel}/>}
    {panel==='highlight' && <Swatches title="背景高亮" colors={HIGHLIGHT_COLORS} current={state.highlightColor} onPick={applyHighlight} onClear={()=>{run(c=>c.unsetHighlight());setPanel('');}} clearLabel="无高亮" onClose={closePanel}/>}
    {panel==='panel' && <div className="format-popover panel-popover" role="dialog" aria-label="提示面板"><span className="popover-title">提示面板</span>{PANEL_TYPES.map(p=><button type="button" key={p.type} className={`panel-choice ${state.panel===p.type?'selected':''}`} data-panel={p.type} onMouseDown={e=>e.preventDefault()} onClick={()=>{run(c=>c.setPanel(p.type));setPanel('');}}>{p.label}</button>)}<span className="popover-hint">选中段落后点击类型，转换为 Confluence 原生面板</span><Tool label="关闭格式面板" icon={X} onClick={closePanel}/></div>}
    {panel==='status' && <form className="format-popover status-popover" onSubmit={insertStatus}><span className="popover-title">状态标签</span><input aria-label="状态文字" autoFocus maxLength={40} value={status.text} onChange={e=>setStatus({...status,text:e.target.value})}/>{STATUS_COLORS.map(s=><button type="button" key={s.color} className={`status-choice ${status.color===s.color?'selected':''}`} data-pageport-status={s.color} title={s.label} onClick={()=>setStatus({...status,color:s.color})}>{status.text.trim() || '状态'}</button>)}<button className="small-button" type="submit">插入</button><Tool label="关闭格式面板" icon={X} onClick={closePanel}/></form>}
    {panel==='symbols' && <div className="format-popover symbol-popover" role="dialog" aria-label="特殊符号">{SYMBOLS.map(symbol=><button type="button" key={symbol} className="symbol" onMouseDown={e=>e.preventDefault()} onClick={()=>run(c=>c.insertContent(symbol))}>{symbol}</button>)}<button type="button" className="small-button" onMouseDown={e=>e.preventDefault()} onClick={()=>{run(c=>c.insertContent(today()));setPanel('');}}><CalendarDays size={13}/>今天 {today()}</button><Tool label="关闭格式面板" icon={X} onClick={closePanel}/></div>}
    {panel==='find' && <div className="format-popover find-popover" role="search">
      <Search size={14}/>
      <input ref={findInput} aria-label="查找内容" placeholder="查找" value={search.term || ''} onChange={e=>updateSearch(editor,{term:e.target.value,index:0},true)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();stepSearch(editor,e.shiftKey?-1:1);}}}/>
      <span className="find-count">{search.term?(search.total?`${search.index+1}/${search.total}`:'无结果'):''}</span>
      <Tool label="上一个 (⇧↩)" icon={ArrowUp} disabled={!search.total} onClick={()=>stepSearch(editor,-1)}/>
      <Tool label="下一个 (↩)" icon={ArrowDown} disabled={!search.total} onClick={()=>stepSearch(editor,1)}/>
      <Tool label="区分大小写" icon={CaseSensitive} active={search.caseSensitive} onClick={()=>updateSearch(editor,{caseSensitive:!search.caseSensitive,index:0},true)}/>
      <input aria-label="替换为" placeholder="替换为" value={replacement} disabled={off} onChange={e=>setReplacement(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();replaceMatches(editor,replacement);}}}/>
      <Tool label="替换当前" icon={Replace} disabled={off || !search.total} onClick={()=>replaceMatches(editor,replacement)}/>
      <Tool label="全部替换" icon={ReplaceAll} disabled={off || !search.total} onClick={()=>replaceMatches(editor,replacement,true)}/>
      <Tool label="关闭查找" icon={X} onClick={closePanel}/>
    </div>}
    {panel==='help' && <div className="format-popover shortcut-popover" role="dialog" aria-label="快捷键"><dl>{SHORTCUTS.map(([name,keys])=><div key={name}><dt>{name}</dt><dd>{keys}</dd></div>)}</dl><Tool label="关闭格式面板" icon={X} onClick={closePanel}/></div>}
    {state.panel && !off && <div className="table-context" role="toolbar" aria-label="提示面板操作">
      <span>提示面板</span>
      {PANEL_TYPES.map(p=><button key={p.type} className={`panel-choice ${state.panel===p.type?'selected':''}`} data-panel={p.type} onMouseDown={e=>e.preventDefault()} onClick={()=>run(c=>c.setPanel(p.type))}>{p.label}</button>)}
      <button onMouseDown={e=>e.preventDefault()} onClick={()=>run(c=>c.unsetPanel())}>移除面板</button>
    </div>}
    {state.status && !off && <div className="table-context" role="toolbar" aria-label="状态标签操作">
      <span>状态标签</span>
      <input aria-label="编辑状态文字" maxLength={40} value={state.status.text} onChange={e=>editStatus({text:e.target.value})}/>
      {STATUS_COLORS.map(s=><button key={s.color} className={`status-choice ${state.status.color===s.color?'selected':''}`} data-pageport-status={s.color} title={s.label} onMouseDown={e=>e.preventDefault()} onClick={()=>editStatus({color:s.color})}>{s.label}</button>)}
      <Tool label="删除状态标签" icon={Trash2} onClick={()=>run(c=>c.deleteSelection())}/>
    </div>}
    {state.table && <div className="table-context" role="toolbar" aria-label="表格操作">
      <span>表格</span>
      <Tool label="在上方插入行" icon={BetweenHorizontalStart} disabled={off} onClick={()=>run(c=>c.addRowBefore())}/>
      <Tool label="在下方插入行" icon={BetweenHorizontalEnd} disabled={off} onClick={()=>run(c=>c.addRowAfter())}/>
      <Tool label="在左侧插入列" icon={BetweenVerticalStart} disabled={off} onClick={()=>run(c=>c.addColumnBefore())}/>
      <Tool label="在右侧插入列" icon={BetweenVerticalEnd} disabled={off} onClick={()=>run(c=>c.addColumnAfter())}/>
      <button disabled={off} onMouseDown={e=>e.preventDefault()} onClick={()=>run(c=>c.deleteRow())}>删除行</button>
      <button disabled={off} onMouseDown={e=>e.preventDefault()} onClick={()=>run(c=>c.deleteColumn())}>删除列</button>
      <Tool label="合并单元格" icon={Combine} disabled={off || !state.canMerge} onClick={()=>run(c=>c.mergeCells())}/>
      <Tool label="拆分单元格" icon={Split} disabled={off || !state.canSplit} onClick={()=>run(c=>c.splitCell())}/>
      <Tool label="表头行" icon={PanelTop} disabled={off} onClick={()=>run(c=>c.toggleHeaderRow())}/>
      <Tool label="表头列" icon={PanelLeft} disabled={off} onClick={()=>run(c=>c.toggleHeaderColumn())}/>
      <Tool label="删除表格" icon={Trash2} disabled={off} onClick={()=>run(c=>c.deleteTable())}/>
    </div>}
    {state.codeBlock && <div className="code-context"><SquareCode size={14}/><label htmlFor="code-language">代码语言</label><select id="code-language" value={editor.getAttributes('codeBlock').language || ''} disabled={off} onChange={e=>editor.chain().focus().updateAttributes('codeBlock',{language:e.target.value || null}).run()}>{['','javascript','typescript','json','python','bash','html','css','sql','yaml','java','go','rust','text'].map(language=><option value={language} key={language}>{language || '纯文本'}</option>)}</select></div>}
    <input ref={imageInput} className="hidden" type="file" accept=".png,.jpg,.jpeg,.gif,.webp" multiple onChange={e=>{insertImages(editor,[...e.target.files]);e.target.value='';}}/>
    <BubbleMenu editor={editor} className="bubble-toolbar" options={{placement:'top',offset:8}} shouldShow={({editor:e,view,state:s})=>e.isEditable && view.hasFocus() && !s.selection.empty && s.selection instanceof TextSelection && !e.isActive('codeBlock')}>
      <Tool label="加粗" icon={Bold} active={state.bold} onClick={()=>run(c=>c.toggleBold())}/>
      <Tool label="斜体" icon={Italic} active={state.italic} onClick={()=>run(c=>c.toggleItalic())}/>
      <Tool label="下划线" icon={Underline} active={state.underline} onClick={()=>run(c=>c.toggleUnderline())}/>
      <Tool label="删除线" icon={Strikethrough} active={state.strike} onClick={()=>run(c=>c.toggleStrike())}/>
      <Tool label={`文字颜色`} icon={Baseline} active={!!state.color} onClick={()=>applyColor(textColor)}><i className="color-bar" style={{background:textColor}}/></Tool>
      <Tool label="背景高亮" icon={Highlighter} active={state.highlight} onClick={()=>state.highlight?run(c=>c.unsetHighlight()):applyHighlight(highlightColor)}><i className="color-bar" style={{background:highlightColor}}/></Tool>
      <Tool label="链接" icon={Link2} active={state.link} onClick={()=>openPanel('link')}/>
      <Tool label="格式刷" icon={Paintbrush} active={!!painter} onClick={copyFormat}/>
      <Tool label="清除格式" icon={RemoveFormatting} onClick={()=>run(c=>c.unsetAllMarks())}/>
    </BubbleMenu>
    <div className="rich-document-scroll"><EditorContent editor={editor}/></div>
    <div className="editor-status" aria-live="polite">
      <span>{painter?'格式刷：拖选要套用格式的文字，Esc 取消':state.selected?`已选 ${state.selected.toLocaleString()} 字`:''}</span>
      <span>字数 {(state.count?.words || 0).toLocaleString()}<i/>字符 {(state.count?.characters || 0).toLocaleString()}</span>
    </div>
  </div>;
}
