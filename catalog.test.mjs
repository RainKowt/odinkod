import test from 'node:test';
import assert from 'node:assert/strict';
import { selectProducts, balanced } from './public/catalog.js';
import { parseProducts } from './product-sync.mjs';
import { retailCategory, safeProduct } from './product-quality.mjs';
import { createApp } from './app-fixed.mjs';

const products = [
  {id:'1',title:'Blue cotton shirt',merchant:'Style',category:'Fashion',price:20,oldPrice:40,currency:'USD',firstSeenAt:'2026-09-01'},
  {id:'2',title:'Cotton blue jacket',merchant:'Style',category:'Fashion',price:60,currency:'USD',firstSeenAt:'2026-09-03'},
  {id:'3',title:'Desk lamp',merchant:'Home',category:'Home',price:30,oldPrice:35,currency:'USD',firstSeenAt:'2026-09-02'},
];
test('search matches reordered words; combined filters and zero maximum work',()=>{
  assert.deepEqual(selectProducts(products,{query:'shirt BLUE'}).map(p=>p.id),['1']);
  assert.deepEqual(selectProducts(products,{sale:true,max:'35',category:'Fashion'}).map(p=>p.id),['1']);
  assert.equal(selectProducts(products,{max:'0'}).length,0);
  assert.deepEqual(selectProducts(products,{saved:true,favorites:['3']}).map(p=>p.id),['3']);
  assert.equal(selectProducts(products,{min:'70',max:'20'}).length,0);
});
test('discovery is diverse and newest uses timestamps',()=>{
  assert.deepEqual(balanced(products).map(p=>p.id),['1','3','2']);
  assert.deepEqual(selectProducts(products,{sort:'newest'}).map(p=>p.id),['2','3','1']);
  assert.deepEqual(selectProducts(products,{sort:'discount'}).map(p=>p.id),['1','3','2']);
});
test('product feeds respect stock attributes, Google currency and formatted prices',()=>{
  const offer=(id,attr,body)=>`<offer id="${id}" ${attr}><name>Desk lamp</name><picture>https://example.com/lamp.jpg</picture><url>https://example.com/product/lamp-${id}</url>${body}</offer>`;
  const xml=offer('a','available="false"','<price>10</price>')+offer('b','available="true"','<g:price>1,299.00 USD</g:price><g:sale_price>999.00 USD</g:sale_price>')+offer('c','','<availability>out_of_stock</availability><price>3</price>');
  const parsed=parseProducts(xml,'Example');assert.equal(parsed.length,1);assert.equal(parsed[0].price,999);assert.equal(parsed[0].oldPrice,1299);assert.equal(parsed[0].inStock,true);assert.equal(parsed[0].currency,'USD');
  assert.equal(retailCategory('','Office chair'),'Home & Living');
  assert.equal(retailCategory('','Cat Eye Gel Nail Polish'),'Beauty');
  assert.equal(retailCategory('','Homme Sport perfume'),'Beauty');
  assert.equal(safeProduct({...parsed[0],title:'Dermal filler'}),false);
  assert.equal(safeProduct({...parsed[0],title:'Dermal  Filler'}),false);
  assert.equal(safeProduct({...parsed[0],affiliateUrl:'https://example.com/'}),false);
});
test('catalog module is served as JavaScript and private files stay private',async()=>{
  const server=await createApp({port:0,config:{sessionSecret:'catalog-test',paymentMode:'demo'}});
  try{const base=`http://127.0.0.1:${server.address().port}`;const r=await fetch(base+'/catalog.js');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/javascript/);assert.equal((await fetch(base+'/product-quality.mjs')).status,404)}finally{await new Promise(resolve=>server.close(resolve))}
});
