import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('.', import.meta.url);

function absoluteUrl(value) {
  if (!value) return null;
  if (value.startsWith('//')) return `https:${value}`;
  return /^https?:\/\//i.test(value) ? value.replace(/^http:/i, 'https:') : null;
}

function loadEnv(text) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const split = line.indexOf('=');
    if (split > 0 && !(line.slice(0, split) in process.env)) process.env[line.slice(0, split)] = line.slice(split + 1).trim();
  }
}

export function normalizeCoupons(payload, now = new Date()) {
  const items = Array.isArray(payload) ? payload : payload.results || [];
  return items.filter(item => item.status === 'active' && item.promocode && (!item.date_end || new Date(item.date_end) > now)).map(item => ({
    id: `admitad-${item.id}`,
    merchant: item.campaign?.name || 'Store',
    title: item.name || item.short_name || 'Promo code',
    code: item.promocode,
    category: item.categories?.[0]?.name || 'Other',
    audience: item.customer_type === 'new_customers' ? 'New customers' : 'All customers',
    discount: item.discount || 'See offer terms',
    terms: item.description || 'See the merchant website for terms',
    validUntil: item.date_end ? item.date_end.slice(0, 10) : null,
    verifiedAt: now.toISOString().slice(0, 10),
    sourceName: 'Admitad',
    imageUrl: absoluteUrl(item.image || item.picture || item.logo || item.campaign?.image),
    sourceUrl: absoluteUrl(item.goto_link || item.gotolink || item.promolink || item.frameset_link),
    affiliateUrl: absoluteUrl(item.goto_link || item.gotolink || item.promolink || item.frameset_link),
    demo: false
  }));
}

let cachedToken = null;

export async function fetchAdmitadToken({ clientId, clientSecret, fetchImpl = fetch } = {}) {
  if (!clientId || !clientSecret) throw new Error('Укажите ADMITAD_CLIENT_ID и ADMITAD_CLIENT_SECRET');
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    scope: 'coupons_for_website'
  });
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetchImpl('https://api.admitad.com/token/', {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
    },
    body
  });
  if (!response.ok) throw new Error(`Admitad OAuth: ${response.status} ${await response.text()}`);
  const payload = await response.json();
  if (!payload.access_token) throw new Error('Admitad OAuth не вернул access_token');
  cachedToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 3600)) * 1000
  };
  return cachedToken.value;
}

export async function fetchAdmitadCoupons({ token, clientId, clientSecret, website, region = 'US', now = new Date(), fetchImpl = fetch } = {}) {
  if (!website) throw new Error('Укажите ADMITAD_WEBSITE_ID в .env');
  const accessToken = token || await fetchAdmitadToken({ clientId, clientSecret, fetchImpl });
  const url = new URL(`https://api.admitad.com/coupons/website/${encodeURIComponent(website)}/`);
  url.searchParams.set('region', region);
  url.searchParams.set('language', 'en');
  url.searchParams.set('limit', '500');
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`Admitad API: ${response.status} ${await response.text()}`);
  return normalizeCoupons(await response.json(), now);
}

export async function sync() {
  try { loadEnv(await readFile(new URL('.env', ROOT), 'utf8')); } catch {}
  const token = process.env.ADMITAD_ACCESS_TOKEN;
  const clientId = process.env.ADMITAD_CLIENT_ID;
  const clientSecret = process.env.ADMITAD_CLIENT_SECRET;
  const website = process.env.ADMITAD_WEBSITE_ID;
  const region = process.env.ADMITAD_REGION || 'US';
  const promos = await fetchAdmitadCoupons({ token, clientId, clientSecret, website, region });
  const target = new URL('data/promos.live.json', ROOT);
  const temp = new URL('data/promos.live.tmp.json', ROOT);
  await writeFile(temp, JSON.stringify(promos, null, 2), 'utf8');
  await rename(temp, target);
  console.log(`Загружено активных промокодов: ${promos.length}`);
  return promos;
}

async function selfTest() {
  const rows = normalizeCoupons({ results: [
    { id: 1, status: 'active', promocode: 'LIVE10', date_end: '2099-01-01T00:00:00Z', name: 'Скидка', campaign: { name: 'Магазин' }, categories: [{ name: 'Дом' }], goto_link: 'http://example.com', image: '//cdn.example.com/product.jpg' },
    { id: 2, status: 'expired', promocode: 'OLD', date_end: '2020-01-01T00:00:00Z' },
    { id: 3, status: 'active', date_end: '2099-01-01T00:00:00Z' }
  ]}, new Date('2026-09-03T00:00:00Z'));
  if (rows.length !== 1 || rows[0].code !== 'LIVE10' || rows[0].demo || rows[0].affiliateUrl !== 'https://example.com' || rows[0].imageUrl !== 'https://cdn.example.com/product.jpg') throw new Error('Нормализация купонов не прошла тест');
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/token/')) return { ok: true, json: async () => ({ access_token: 'test-token', expires_in: 3600 }) };
    return { ok: true, json: async () => ({ results: [{ id: 4, status: 'active', promocode: 'RU10', date_end: '2099-01-01T00:00:00Z' }] }) };
  };
  const fetched = await fetchAdmitadCoupons({ clientId: 'client', clientSecret: 'secret', website: '2991802', fetchImpl, now: new Date('2026-09-03T00:00:00Z') });
  if (fetched.length !== 1 || calls.length !== 2 || !calls[1].url.includes('/coupons/website/2991802/') || !calls[1].url.includes('region=US')) throw new Error('OAuth/API маршрут Admitad не прошёл тест');
  console.log('ADMITAD_SELF_TEST_OK: остаются только активные, неистёкшие купоны с кодом.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    selfTest().catch(error => { console.error(error.message); process.exitCode = 1; });
  } else sync().catch(error => { console.error(error.message); process.exitCode = 1; });
}
