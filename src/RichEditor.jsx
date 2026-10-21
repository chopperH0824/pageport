import React, { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import {
  Undo2, Redo2, Bold, Italic, Underline, Strikethrough, Highlighter, Code,
  List, ListOrdered, ListTodo, Quote, SquareCode, Minus, Link2, Unlink,
  ImagePlus, Table2, Rows3, Columns3, Trash2, Combine, Split, ListTree,
  AlignLeft, AlignCenter, AlignRight, Subscript as SubIcon, Superscript as SupIcon,
  IndentIncrease, IndentDecrease, RemoveFormatting, X, Check, ChevronDown,
} from 'lucide-react';
import { toMarkdown } from './markdown.js';
import { TableOfContents } from './TableOfContents.jsx';
import './rich-editor.css';

const LocalImage=Image.extend({
  parseHTML:()=>[{tag:'img[src]',getAttrs:node=>/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(node.getAttribute('src') || '') ? null : false}],
});

function Tool({label,icon:Icon,active=false,disabled=false,onClick}) {
  return <button type="button" className={`format-tool ${active?'active':''}`} title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={onClick}><Icon size={16}/></button>;
}

export default function RichEditor({content,contentVersion,disabled,onChange,onError,onReady,onOutline}) {
  const [panel,setPanel]=useState(''), [link,setLink]=useState(''), [rows,setRows]=useState(3), [cols,setCols]=useState(3);
  const imageInput=useRef(), callbacks=useRef({});
  const loadedVersion=useRef(contentVersion);
  callbacks.current={onChange,onError,onOutline};
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
      Highlight.configure({multicolor:false}),Subscript,Superscript,
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
  const state=useEditorState({editor,selector:({editor:e})=>e ? {
    bold:e.isActive('bold'),italic:e.isActive('italic'),underline:e.isActive('underline'),
    strike:e.isActive('strike'),highlight:e.isActive('highlight'),code:e.isActive('code'),
    bulletList:e.isActive('bulletList'),orderedList:e.isActive('orderedList'),taskList:e.isActive('taskList'),
    blockquote:e.isActive('blockquote'),codeBlock:e.isActive('codeBlock'),link:e.isActive('link'),
    subscript:e.isActive('subscript'),superscript:e.isActive('superscript'),table:e.isActive('table'),
    heading:e.getAttributes('heading').level || 0,align:e.getAttributes('paragraph').textAlign || e.getAttributes('heading').textAlign || 'left',
    language:e.getAttributes('codeBlock').language || '',
    canUndo:e.can().undo(),canRedo:e.can().redo(),canMerge:e.can().mergeCells(),canSplit:e.can().splitCell(),
  } : {}});
  useEffect(()=>{if(editor){editor.setEditable(!disabled,false);if(disabled)setPanel('');}},[editor,disabled]);
  useEffect(()=>{
    if(!editor)return;
    if(loadedVersion.current===contentVersion)return;
    loadedVersion.current=contentVersion;
    editor.commands.setContent(content,{emitUpdate:false});
    updateOutline(editor);
  },[editor,contentVersion]);
  useEffect(()=>{if(editor)onReady(editor);return()=>onReady(null);},[editor]);
  useEffect(()=>{
    const close=e=>{if(e.key==='Escape')setPanel('');};
    window.addEventListener('keydown',close);
    return()=>window.removeEventListener('keydown',close);
  },[]);
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
  return <div className="rich-editor">
    <div className="format-toolbar" role="toolbar" aria-label="文字格式">
      <div className="format-group">
        <Tool label="撤销 (⌘Z)" icon={Undo2} disabled={disabled || !state.canUndo} onClick={()=>editor.chain().focus().undo().run()}/>
        <Tool label="重做 (⇧⌘Z)" icon={Redo2} disabled={disabled || !state.canRedo} onClick={()=>editor.chain().focus().redo().run()}/>
      </div>
      <div className="format-group">
        <select aria-label="段落样式" value={state.heading} disabled={disabled} onChange={e=>{const level=Number(e.target.value);level?editor.chain().focus().setHeading({level}).run():editor.chain().focus().setParagraph().run();}}>
          <option value="0">正文</option>{[1,2,3,4,5,6].map(n=><option key={n} value={n}>标题 {n}</option>)}
        </select>
        <Tool label="加粗 (⌘B)" icon={Bold} active={state.bold} disabled={disabled} onClick={()=>run(c=>c.toggleBold())}/>
        <Tool label="斜体 (⌘I)" icon={Italic} active={state.italic} disabled={disabled} onClick={()=>run(c=>c.toggleItalic())}/>
        <Tool label="下划线 (⌘U)" icon={Underline} active={state.underline} disabled={disabled} onClick={()=>run(c=>c.toggleUnderline())}/>
        <Tool label="删除线" icon={Strikethrough} active={state.strike} disabled={disabled} onClick={()=>run(c=>c.toggleStrike())}/>
        <Tool label="高亮" icon={Highlighter} active={state.highlight} disabled={disabled} onClick={()=>run(c=>c.toggleHighlight())}/>
        <Tool label="行内代码" icon={Code} active={state.code} disabled={disabled} onClick={()=>run(c=>c.toggleCode())}/>
      </div>
      <div className="format-group">
        <Tool label="无序列表" icon={List} active={state.bulletList} disabled={disabled} onClick={()=>run(c=>c.toggleBulletList())}/>
        <Tool label="有序列表" icon={ListOrdered} active={state.orderedList} disabled={disabled} onClick={()=>run(c=>c.toggleOrderedList())}/>
        <Tool label="任务列表" icon={ListTodo} active={state.taskList} disabled={disabled} onClick={()=>run(c=>c.toggleTaskList())}/>
        <Tool label="引用" icon={Quote} active={state.blockquote} disabled={disabled} onClick={()=>run(c=>c.toggleBlockquote())}/>
        <Tool label="代码块" icon={SquareCode} active={state.codeBlock} disabled={disabled} onClick={()=>run(c=>c.toggleCodeBlock())}/>
      </div>
      <div className="format-group">
        <Tool label="链接" icon={Link2} active={state.link || panel==='link'} disabled={disabled} onClick={()=>{setLink(editor.getAttributes('link').href || '');setPanel(panel==='link'?'':'link');}}/>
        <Tool label="插入图片" icon={ImagePlus} disabled={disabled} onClick={()=>imageInput.current.click()}/>
        <Tool label="插入表格" icon={Table2} active={panel==='table'} disabled={disabled} onClick={()=>setPanel(panel==='table'?'':'table')}/>
        <Tool label="插入目录" icon={ListTree} disabled={disabled} onClick={()=>editor.chain().focus().insertContent({type:'tableOfContents'}).run()}/>
        <Tool label="更多格式" icon={ChevronDown} active={panel==='more'} disabled={disabled} onClick={()=>setPanel(panel==='more'?'':'more')}/>
      </div>
    </div>
    {panel==='link' && <form className="format-popover link-popover" onSubmit={saveLink}><Link2 size={15}/><input aria-label="链接地址" autoFocus type="text" value={link} onChange={e=>setLink(e.target.value)} placeholder="https://"/><Tool label="移除链接" icon={Unlink} onClick={()=>{editor.chain().focus().extendMarkRange('link').unsetLink().run();setPanel('');}}/><button className="icon-button" title="应用链接" aria-label="应用链接" type="submit"><Check size={16}/></button><Tool label="关闭格式面板" icon={X} onClick={()=>setPanel('')}/></form>}
    {panel==='table' && <div className="format-popover table-popover"><label>行<input type="number" aria-label="表格行数" min="2" max="20" value={rows} onChange={e=>setRows(e.target.value)}/></label><span>×</span><label>列<input type="number" aria-label="表格列数" min="2" max="10" value={cols} onChange={e=>setCols(e.target.value)}/></label><button className="small-button" disabled={rows<2 || rows>20 || cols<2 || cols>10} onClick={()=>{editor.chain().focus().insertTable({rows:Number(rows),cols:Number(cols),withHeaderRow:true}).run();setPanel('');}}>插入表格</button><Tool label="关闭格式面板" icon={X} onClick={()=>setPanel('')}/></div>}
    {panel==='more' && <div className="format-popover">
      <Tool label="左对齐" icon={AlignLeft} active={state.align==='left'} onClick={()=>run(c=>c.setTextAlign('left'))}/>
      <Tool label="居中对齐" icon={AlignCenter} active={state.align==='center'} onClick={()=>run(c=>c.setTextAlign('center'))}/>
      <Tool label="右对齐" icon={AlignRight} active={state.align==='right'} onClick={()=>run(c=>c.setTextAlign('right'))}/>
      <span className="format-separator"/>
      <Tool label="下标" icon={SubIcon} active={state.subscript} onClick={()=>run(c=>c.toggleSubscript())}/>
      <Tool label="上标" icon={SupIcon} active={state.superscript} onClick={()=>run(c=>c.toggleSuperscript())}/>
      <Tool label="增加列表缩进" icon={IndentIncrease} disabled={!editor.can().sinkListItem(state.taskList?'taskItem':'listItem')} onClick={()=>run(c=>c.sinkListItem(state.taskList?'taskItem':'listItem'))}/>
      <Tool label="减少列表缩进" icon={IndentDecrease} disabled={!editor.can().liftListItem(state.taskList?'taskItem':'listItem')} onClick={()=>run(c=>c.liftListItem(state.taskList?'taskItem':'listItem'))}/>
      <Tool label="分隔线" icon={Minus} onClick={()=>run(c=>c.setHorizontalRule())}/>
      <Tool label="清除格式" icon={RemoveFormatting} onClick={()=>run(c=>c.unsetAllMarks().clearNodes())}/>
      <Tool label="关闭格式面板" icon={X} onClick={()=>setPanel('')}/>
    </div>}
    {state.table && <div className="table-context" role="toolbar" aria-label="表格操作">
      <span>表格</span>
      <Tool label="在下方插入行" icon={Rows3} disabled={disabled} onClick={()=>run(c=>c.addRowAfter())}/>
      <Tool label="在右侧插入列" icon={Columns3} disabled={disabled} onClick={()=>run(c=>c.addColumnAfter())}/>
      <button disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>run(c=>c.deleteRow())}>删除行</button>
      <button disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>run(c=>c.deleteColumn())}>删除列</button>
      <Tool label="合并单元格" icon={Combine} disabled={disabled || !state.canMerge} onClick={()=>run(c=>c.mergeCells())}/>
      <Tool label="拆分单元格" icon={Split} disabled={disabled || !state.canSplit} onClick={()=>run(c=>c.splitCell())}/>
      <button disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>run(c=>c.toggleHeaderRow())}>表头行</button>
      <Tool label="删除表格" icon={Trash2} disabled={disabled} onClick={()=>run(c=>c.deleteTable())}/>
    </div>}
    {state.codeBlock && <div className="code-context"><SquareCode size={14}/><label htmlFor="code-language">代码语言</label><select id="code-language" value={editor.getAttributes('codeBlock').language || ''} disabled={disabled} onChange={e=>editor.chain().focus().updateAttributes('codeBlock',{language:e.target.value || null}).run()}>{['','javascript','typescript','json','python','bash','html','css','sql','yaml','java','go','rust','text'].map(language=><option value={language} key={language}>{language || '纯文本'}</option>)}</select></div>}
    <input ref={imageInput} className="hidden" type="file" accept=".png,.jpg,.jpeg,.gif,.webp" multiple onChange={e=>{insertImages(editor,[...e.target.files]);e.target.value='';}}/>
    <div className="rich-document-scroll"><EditorContent editor={editor}/></div>
  </div>;
}
