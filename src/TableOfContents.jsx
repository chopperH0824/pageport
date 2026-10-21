import React from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, useEditorState } from '@tiptap/react';
import { ListTree, Trash2 } from 'lucide-react';

function ContentsView({editor,node,updateAttributes,deleteNode}) {
  const headings=useEditorState({editor,selector:({editor:e})=>{
    const result=[];
    e.state.doc.descendants((child,pos)=>{
      if(child.type.name==='heading')result.push({text:child.textContent,level:child.attrs.level,pos});
    });
    return result;
  }});
  const visible=headings.filter(h=>h.level>=node.attrs.minLevel && h.level<=node.attrs.maxLevel);
  return <NodeViewWrapper className="contents-node" contentEditable={false}>
    <div className="contents-heading"><span><ListTree size={16}/>目录</span><div className="contents-controls">
      <label>标题层级<select aria-label="目录起始层级" disabled={!editor.isEditable} value={node.attrs.minLevel} onChange={e=>{if(!editor.isEditable)return;const minLevel=Number(e.target.value);updateAttributes({minLevel,maxLevel:Math.max(minLevel,node.attrs.maxLevel)});}}>{[1,2,3,4,5,6].map(level=><option value={level} key={level}>{level}</option>)}</select></label>
      <span>至</span><select aria-label="目录结束层级" disabled={!editor.isEditable} value={node.attrs.maxLevel} onChange={e=>{if(!editor.isEditable)return;const maxLevel=Number(e.target.value);updateAttributes({maxLevel,minLevel:Math.min(maxLevel,node.attrs.minLevel)});}}>{[1,2,3,4,5,6].map(level=><option value={level} key={level}>{level}</option>)}</select>
      <button type="button" className="icon-button" title="删除目录" aria-label="删除目录" disabled={!editor.isEditable} onClick={()=>{if(editor.isEditable)deleteNode();}}><Trash2 size={14}/></button>
    </div></div>
    <nav aria-label="正文目录">{visible.length?visible.map((heading,index)=><button type="button" key={index} style={{paddingLeft:12+(heading.level-node.attrs.minLevel)*16}} onClick={()=>editor.chain().focus().setTextSelection(heading.pos+1).scrollIntoView().run()}>{heading.text || '未命名标题'}</button>):<p className="contents-empty">暂无符合层级的标题</p>}</nav>
  </NodeViewWrapper>;
}

export const TableOfContents=Node.create({
  name:'tableOfContents',
  group:'block',
  atom:true,
  selectable:true,
  addAttributes:()=>({
    minLevel:{default:1,parseHTML:element=>Math.min(6,Math.max(1,Number(element.getAttribute('data-min-level')) || 1)),renderHTML:attrs=>({'data-min-level':attrs.minLevel})},
    maxLevel:{default:6,parseHTML:element=>Math.min(6,Math.max(1,Number(element.getAttribute('data-max-level')) || 6)),renderHTML:attrs=>({'data-max-level':attrs.maxLevel})},
  }),
  parseHTML:()=>[{tag:'div[data-pageport-toc="true"]'}],
  renderHTML:({HTMLAttributes})=>['div',mergeAttributes(HTMLAttributes,{'data-pageport-toc':'true'})],
  addNodeView:()=>ReactNodeViewRenderer(ContentsView),
});
