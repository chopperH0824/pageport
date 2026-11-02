import test from 'node:test';
import assert from 'node:assert/strict';
import { navigateToHeading } from '../src/heading-navigation.js';

test('heading navigation scrolls the document container without waiting for an animation frame',()=>{
  const calls=[];
  const scroller={scrollTop:80,getBoundingClientRect:()=>({top:100}),scrollTo:value=>calls.push(value)};
  const editor={
    isDestroyed:false,
    commands:{
      setTextSelection:pos=>calls.push(pos),
      focus:(pos,options)=>calls.push(options),
    },
    view:{
      nodeDOM:pos=>{assert.equal(pos,12);return {getBoundingClientRect:()=>({top:800})};},
      dom:{closest:selector=>{assert.equal(selector,'.rich-document-scroll');return scroller;}},
    },
  };
  navigateToHeading(editor,12);
  assert.deepEqual(calls,[13,{scrollIntoView:false},{top:760}]);
  editor.isDestroyed=true;
  navigateToHeading(editor,12);
  navigateToHeading(null,12);
  assert.equal(calls.length,3);
});
