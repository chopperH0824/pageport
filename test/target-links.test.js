import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTarget, createConfluenceClient, validateSnapshot } from '../server/confluence.js';

const hosts=['wiki.example.com'];
const auth={username:'test',password:'mock-only'};
const named=path=>parseTarget(`https://wiki.example.com${path}`,hosts);
test('name links decode Chinese, spaces, literal plus and numeric titles without guessing IDs',()=>{
  assert.equal(named('/display/TEST/1').title,'1');
  assert.equal(named('/display/TEST/%E4%BA%A7%E5%93%81+PRD%2Bv2#section').title,'产品 PRD+v2');
  assert.equal(named('/display/TEST/A%2FB').title,'A/B');
  for(const path of ['/display/TEST/','/display/TEST/%FF','/display/TEST/%0A']) assert.throws(()=>named(path));
});

test('name resolution uses authenticated bounded REST lookup and a canonical ID',async()=>{
  const target=named('/display/TEST/A%2BB+%26+C');
  const client=createConfluenceClient(auth,target,async(address,options)=>{
    const url=new URL(address);
    assert.equal(url.origin,'https://wiki.example.com');
    assert.equal(url.pathname,'/rest/api/content');
    assert.equal(url.searchParams.get('title'),'A+B & C');
    assert.equal(url.searchParams.get('spaceKey'),'TEST');
    assert.equal(url.searchParams.get('limit'),'2');
    assert.equal(options.redirect,'error');
    assert.ok(options.headers.Authorization.startsWith('Basic '));
    return Response.json({results:[{id:'12',title:target.title,type:'page',status:'current'}]});
  });
  const resolved=await client.resolve();
  assert.equal(resolved.id,'12');
  assert.equal(resolved.url,'https://wiki.example.com/pages/viewpage.action?pageId=12');
  assert.throws(()=>validateSnapshot({id:'12',type:'page',status:'current',title:target.title,space:{key:'OTHER'},version:{number:1},body:{storage:{value:''}}},resolved),/空间或名称/);
});

test('missing, ambiguous, mismatched and malformed name results never become publish targets',async()=>{
  const target=named('/display/TEST/Page');
  const page={id:'12',title:'Page',type:'page',status:'current'};
  for(const result of [{results:[]},{results:[page,page]},{results:[page],_links:{next:'/more'}},{results:[{...page,title:'Other'}]},{results:[{...page,id:'../12'}]},{results:[{...page,status:'draft'}]},{}]) {
    await assert.rejects(createConfluenceClient(auth,target,async()=>Response.json(result)).resolve());
  }
  for(const status of [401,403,404]) await assert.rejects(createConfluenceClient(auth,target,async()=>new Response('{}',{status})).resolve());
  const direct=named('/pages/viewpage.action?pageId=12');
  assert.deepEqual(await createConfluenceClient(auth,direct,()=>assert.fail('ID targets need no lookup')).resolve(),direct);
});
