import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { fetchAdmitadToken } from './admitad-sync.mjs';
import { unsuitableProduct, retailCategory, safeProduct } from './product-quality.mjs';

const ROOT = new URL('.', import.meta.url);
const MAX_FEED_BYTES = 8_000_000;

function loadEnv(text) { for (const raw of text.split(/\r?\n/)) { const line=raw.trim(); const i=line.indexOf('='); if(line&&!line.startsWith('#')&&i>0&&!(line.slice(0,i) in process.env)) process.env[line.slice(0,i)]=line.slice(i+1).trim(); } }
function decode(value='') { return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim(); }
function field(block, names) { for(const name of names){ const m=block.match(new RegExp(`<(?:(?:g):)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:g):)?${name}>`,'i')); if(m)return decode(m[1]); } return ''; }
function attr(block, name) { const m=block.match(new RegExp(`\\s${name}=["']([^"']+)["']`,'i')); return m?decode(m[1]):''; }
function https(value){ if(!value)return null; if(value.startsWith('//'))return 'https:'+value; return /^https?:\/\//i.test(value)?value.replace(/^http:/i,'https:'):null; }
function money(value){ const m=String(value).replace(/\s/g,'').match(/[\d.,]+/);if(!m)return 0;let n=m[0];if(n.includes(',')&&n.includes('.'))n=n.lastIndexOf(',')>n.lastIndexOf('.')?n.replace(/\./g,'').replace(',','.'):n.replace(/,/g,'');else if(/^\d{1,3}(,\d{3})+$/.test(n))n=n.replace(/,/g,'');else n=n.replace(',','.');return Number(n)||0; }
function inferredMerchant(merchant, affiliateUrl='') {
  const value=String(affiliateUrl).toLowerCase();
  if(value.includes('alibaba.com')||value.includes('offer.alibaba.com'))return 'Alibaba';
  if(value.includes('aliexpress.com'))return 'AliExpress';
  return merchant;
}

export function parseProducts(xml, merchant='Store', limit=120) {
  const blocks=[...(xml.match(/<offer\b[\s\S]*?<\/offer>/gi)||[]),...(xml.match(/<item\b[\s\S]*?<\/item>/gi)||[]),...(xml.match(/<entry\b[\s\S]*?<\/entry>/gi)||[])];
  const seen=new Set(); const products=[];
  for(const block of blocks){
    const availability=(field(block,['availability','available'])||attr(block,'available')).toLowerCase().trim();
    if(/out[ _]of[ _]stock|sold out|unavailable|discontinued|^(?:false|no|0)$|pre.?order|backorder/.test(availability))continue;
    const minimum=money(field(block,['minimum_order_quantity','min_order_quantity','min_quantity','minimum_order','min_order','moq']));
    if(minimum>1)continue;
    const id=attr(block,'id')||field(block,['id','offer_id']); const title=field(block,['name','title','model']); const imageUrl=https(field(block,['picture','image_link','image','photo'])); const affiliateUrl=https(field(block,['url','link'])); const regularPrice=money(field(block,['price'])); const salePrice=money(field(block,['sale_price'])); const price=salePrice||regularPrice; const oldPrice=salePrice&&regularPrice>salePrice?regularPrice:money(field(block,['oldprice','old_price']));
    const terms=field(block,['description','sales_notes']).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();if(!id||!title||!imageUrl||!affiliateUrl||!price||seen.has(id)||unsuitableProduct(title+' '+terms))continue; seen.add(id);
    const discount=oldPrice>price?Math.round((1-price/oldPrice)*100):null;
    const inStock=/^(?:in[ _]?stock|available|true|yes|1)$/.test(availability)?true:null;
    const currency=(field(block,['currencyId','currency'])||(field(block,['sale_price','price']).match(/\b[A-Z]{3}\b/)||[])[0]||'USD').toUpperCase();
    const item={id:`product-${encodeURIComponent(inferredMerchant(merchant,affiliateUrl))}-${id}`,merchant:inferredMerchant(merchant,affiliateUrl),title,category:retailCategory(field(block,['product_type','categoryId']),title),imageUrl,affiliateUrl,price,oldPrice:oldPrice>price?oldPrice:null,currency,discount:discount?`${discount}% off`:null,terms:terms.slice(0,1500),availability:availability||null,inStock,sourceName:'Admitad product feed'};
    if(safeProduct(item))products.push(item);
    if(products.length>=limit)break;
  }
  return products;
}

async function limitedText(rawUrl){ const url=String(rawUrl).replace(/&amp;/g,'&').replace(/^http:/i,'https:'); const r=await fetch(url,{headers:{accept:'application/xml,text/xml;q=0.9,*/*;q=0.5','user-agent':'Mozilla/5.0 OneCode product catalog'},signal:AbortSignal.timeout(30000)}); if(!r.ok)throw new Error(`Product feed HTTP ${r.status}`); const reader=r.body.getReader(); let size=0,text=''; const decoder=new TextDecoder(); while(true){const {done,value}=await reader.read(); if(done)break; size+=value.length; text+=decoder.decode(value,{stream:true}); if(size>=MAX_FEED_BYTES){await reader.cancel();break;}} return text; }
async function saveProducts(products){
  const target=new URL('data/products.live.json',ROOT),temp=new URL('data/products.live.tmp.json',ROOT);
  let previous=[];try{previous=JSON.parse(await readFile(target,'utf8'))}catch{}
  const seen=new Map(previous.map(item=>[item.affiliateUrl,item.firstSeenAt]));const now=new Date().toISOString();
  const snapshot=products.map(item=>({...item,firstSeenAt:item.firstSeenAt||seen.get(item.affiliateUrl)||now,updatedAt:now}));
  await writeFile(temp,JSON.stringify(snapshot));await rename(temp,target);
}

// Reserve space across stores before applying the catalog cap.
export function mergeProductGroups(groups,limit=3000){
  const seen=new Set(),stores=new Map();
  for(const item of groups.flat()){
    if(seen.has(item.affiliateUrl))continue;seen.add(item.affiliateUrl);
    if(!stores.has(item.merchant))stores.set(item.merchant,[]);
    stores.get(item.merchant).push(item);
  }
  const rows=[...stores.values()],result=[];
  for(let i=0;result.length<limit&&rows.some(row=>i<row.length);i++)for(const row of rows){if(row[i])result.push(row[i]);if(result.length===limit)break}
  return result;
}

export async function syncProducts(){
  try{loadEnv(await readFile(new URL('.env',ROOT),'utf8'))}catch{}
  const clientId=process.env.ADMITAD_CLIENT_ID, clientSecret=process.env.ADMITAD_CLIENT_SECRET, website=process.env.ADMITAD_WEBSITE_ID;
  const manualFeeds=(process.env.ADMITAD_PRODUCT_FEED_URLS||process.env.ADMITAD_PRODUCT_FEED_URL||'').split(/[\r\n,]+/).map(value=>value.trim()).filter(Boolean);
  const namedFeeds=JSON.parse(process.env.PRODUCT_FEEDS_JSON||'[]');
  if(!Array.isArray(namedFeeds)||namedFeeds.some(feed=>!feed.merchant||!https(feed.url)))throw new Error('PRODUCT_FEEDS_JSON must contain merchant and HTTPS feed URL pairs');
  const groups=[];
  let hasSnapshot=false;try{hasSnapshot=JSON.parse(await readFile(new URL('data/products.live.json',ROOT),'utf8')).length>0}catch{}
  const merge=()=>mergeProductGroups(groups);
  for(const feed of namedFeeds){try{const items=parseProducts(await limitedText(feed.url),feed.merchant,800);groups.push(items);console.log(`Product feed ${feed.merchant}: ${items.length} usable products`)}catch(error){console.warn(`Product feed ${feed.merchant}: ${error.message}`)}}
  if(merge().length&&!hasSnapshot){await saveProducts(merge());hasSnapshot=true}
  if(manualFeeds.length){
    for(const feed of manualFeeds){try{groups.push(parseProducts(await limitedText(feed),'AliExpress',2000))}catch(error){console.warn(`Manual product feed: ${error.message}`)}}
    const initial=merge();
    if(initial.length&&!hasSnapshot){await saveProducts(initial);hasSnapshot=true}
  }
  if(clientId&&clientSecret&&website){
    const token=await fetchAdmitadToken({clientId,clientSecret,scope:'advcampaigns_for_website'});
    const url=new URL(`https://api.admitad.com/advcampaigns/website/${website}/`); url.searchParams.set('connection_status','active');url.searchParams.set('has_tool','products');url.searchParams.set('limit','100');url.searchParams.set('language','en');
    const response=await fetch(url,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)}); if(!response.ok)throw new Error(`Admitad programs: ${response.status} ${await response.text()}`);
    const programs=(await response.json()).results||[];
    const feeds=programs.flatMap(program=>[...(program.feeds_info||[]).map(f=>f.xml_link),program.products_xml_link].filter(Boolean).slice(0,1).map(link=>({link,program:program.name})));
    for(const feed of feeds){try{groups.push(parseProducts(await limitedText(feed.link),feed.program,200));if(!hasSnapshot&&merge().length){await saveProducts(merge());hasSnapshot=true}}catch(error){console.warn(`${feed.program}: ${error.message}`)}}
  }
  const products=merge();
  if(!products.length)throw new Error('No configured product feed returned usable products');
  await saveProducts(products);console.log(`Товарный каталог обновлён: ${products.length} позиций, ${new Set(products.map(p=>p.merchant)).size} магазинов.`);return products;
}

function selfTest(){const xml='<shop><offers><offer id="7"><name>Phone</name><available>true</available><price>799</price><oldprice>999</oldprice><currencyId>USD</currencyId><picture>https://img.test/phone.jpg</picture><url>https://www.alibaba.com/product-detail/phone_7.html</url></offer><offer id="8"><name>Gone</name><available>false</available><price>1</price><picture>https://img.test/gone.jpg</picture><url>https://shop.test/gone</url></offer><offer id="9"><name>Custom logo factory hoodie 100 pcs</name><available>true</available><price>4</price><picture>https://img.test/bulk.jpg</picture><url>https://shop.test/bulk</url></offer></offers></shop>';const p=parseProducts(xml,'AliExpress');if(p.length!==1||p[0].discount!=='20% off'||p[0].imageUrl!=='https://img.test/phone.jpg'||p[0].merchant!=='Alibaba'||p[0].inStock!==true)throw new Error('product parser failed');console.log('PRODUCT_SYNC_SELF_TEST_OK')}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv.includes('--self-test'))selfTest();else syncProducts().catch(e=>{console.error(e.message);process.exitCode=1})}
