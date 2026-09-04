import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { fetchAdmitadToken } from './admitad-sync.mjs';

const ROOT = new URL('.', import.meta.url);
const MAX_FEED_BYTES = 32_000_000;

function loadEnv(text) { for (const raw of text.split(/\r?\n/)) { const line=raw.trim(); const i=line.indexOf('='); if(line&&!line.startsWith('#')&&i>0&&!(line.slice(0,i) in process.env)) process.env[line.slice(0,i)]=line.slice(i+1).trim(); } }
function decode(value='') { return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim(); }
function field(block, names) { for(const name of names){ const m=block.match(new RegExp(`<(?:(?:g):)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:g):)?${name}>`,'i')); if(m)return decode(m[1]); } return ''; }
function attr(block, name) { const m=block.match(new RegExp(`\\s${name}=["']([^"']+)["']`,'i')); return m?decode(m[1]):''; }
function https(value){ if(!value)return null; if(value.startsWith('//'))return 'https:'+value; return /^https?:\/\//i.test(value)?value.replace(/^http:/i,'https:'):null; }
function money(value){ const m=String(value).match(/[\d.,]+/); return m?Number(m[0].replace(',','.')):0; }

export function parseProducts(xml, merchant='Store', limit=120) {
  const blocks=[...(xml.match(/<offer\b[\s\S]*?<\/offer>/gi)||[]),...(xml.match(/<item\b[\s\S]*?<\/item>/gi)||[]),...(xml.match(/<entry\b[\s\S]*?<\/entry>/gi)||[])];
  const seen=new Set(); const products=[];
  for(const block of blocks){
    const id=attr(block,'id')||field(block,['id','offer_id']); const title=field(block,['name','title','model']); const imageUrl=https(field(block,['picture','image_link','image','photo'])); const affiliateUrl=https(field(block,['url','link'])); const regularPrice=money(field(block,['price'])); const salePrice=money(field(block,['sale_price'])); const price=salePrice||regularPrice; const oldPrice=salePrice&&regularPrice>salePrice?regularPrice:money(field(block,['oldprice','old_price']));
    if(!id||!title||!imageUrl||!affiliateUrl||!price||seen.has(id))continue; seen.add(id);
    const discount=oldPrice>price?Math.round((1-price/oldPrice)*100):null;
    products.push({id:`product-${id}`,merchant,title,category:field(block,['categoryId','product_type'])||'Products',imageUrl,affiliateUrl,price,oldPrice:oldPrice||null,currency:field(block,['currencyId'])||'USD',discount:discount?`${discount}% off`:null,terms:field(block,['description','sales_notes']),sourceName:'Admitad product feed'});
    if(products.length>=limit)break;
  }
  return products;
}

async function limitedText(rawUrl){ const url=String(rawUrl).replace(/&amp;/g,'&').replace(/^http:/i,'https:'); const r=await fetch(url,{headers:{accept:'application/xml,text/xml;q=0.9,*/*;q=0.5','user-agent':'Mozilla/5.0 OneCode product catalog'},signal:AbortSignal.timeout(30000)}); if(!r.ok)throw new Error(`Product feed HTTP ${r.status}`); const reader=r.body.getReader(); let size=0,text=''; const decoder=new TextDecoder(); while(true){const {done,value}=await reader.read(); if(done)break; size+=value.length; text+=decoder.decode(value,{stream:true}); if(size>=MAX_FEED_BYTES){await reader.cancel();break;}} return text; }

export async function syncProducts(){
  try{loadEnv(await readFile(new URL('.env',ROOT),'utf8'))}catch{}
  const clientId=process.env.ADMITAD_CLIENT_ID, clientSecret=process.env.ADMITAD_CLIENT_SECRET, website=process.env.ADMITAD_WEBSITE_ID;
  const manualFeed=process.env.ADMITAD_PRODUCT_FEED_URL;
  if(manualFeed){
    const products=parseProducts(await limitedText(manualFeed),'AliExpress',1200);
    if(!products.length)throw new Error('The configured Admitad product feed returned no products');
    const target=new URL('data/products.live.json',ROOT),temp=new URL('data/products.live.tmp.json',ROOT); await writeFile(temp,JSON.stringify(products,null,2));await rename(temp,target);console.log(`Товарный каталог обновлён: ${products.length} позиций.`);return products;
  }
  if(!clientId||!clientSecret||!website)throw new Error('Admitad product feeds are not configured');
  const token=await fetchAdmitadToken({clientId,clientSecret,scope:'advcampaigns_for_website'});
  const url=new URL(`https://api.admitad.com/advcampaigns/website/${website}/`); url.searchParams.set('connection_status','active');url.searchParams.set('has_tool','products');url.searchParams.set('limit','100');url.searchParams.set('language','en');
  const response=await fetch(url,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)}); if(!response.ok)throw new Error(`Admitad programs: ${response.status} ${await response.text()}`);
  const programs=(await response.json()).results||[]; const groups=[];
  for(const program of programs){ const links=[...(program.feeds_info||[]).map(f=>f.xml_link),program.products_xml_link].filter(Boolean); for(const link of links.slice(0,2)){try{groups.push(parseProducts(await limitedText(link),program.name,80))}catch(error){console.warn(`${program.name}: ${error.message}`)}} }
  const products=groups.flat().slice(0,300); if(!products.length)throw new Error('Connected programs returned no product feeds');
  const target=new URL('data/products.live.json',ROOT),temp=new URL('data/products.live.tmp.json',ROOT); await writeFile(temp,JSON.stringify(products,null,2));await rename(temp,target);console.log(`Товарный каталог обновлён: ${products.length} позиций.`);return products;
}

function selfTest(){const xml='<shop><offers><offer id="7"><name>Phone</name><price>799</price><oldprice>999</oldprice><currencyId>USD</currencyId><picture>https://img.test/phone.jpg</picture><url>https://shop.test/phone</url></offer></offers></shop>';const p=parseProducts(xml,'Shop');if(p.length!==1||p[0].discount!=='20% off'||p[0].imageUrl!=='https://img.test/phone.jpg')throw new Error('product parser failed');console.log('PRODUCT_SYNC_SELF_TEST_OK')}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv.includes('--self-test'))selfTest();else syncProducts().catch(e=>{console.error(e.message);process.exitCode=1})}
