import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('.', import.meta.url);

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
    merchant: item.campaign?.name || 'Магазин',
    title: item.name || item.short_name || 'Промокод',
    code: item.promocode,
    category: item.categories?.[0]?.name || 'Другое',
    audience: item.customer_type === 'new_customers' ? 'Новые пользователи' : 'Все пользователи',
    discount: item.discount || 'Выгода по условиям акции',
    terms: item.description || 'Условия на сайте магазина',
    validUntil: item.date_end ? item.date_end.slice(0, 10) : null,
    verifiedAt: now.toISOString().slice(0, 10),
    sourceName: 'Admitad',
    sourceUrl: item.gotolink || item.promolink,
    affiliateUrl: item.gotolink || item.promolink,
    demo: false
  }));
}

export async function fetchAdmitadCoupons({ token, website, now = new Date() } = {}) {
  if (!token || !website) throw new Error('Укажите ADMITAD_ACCESS_TOKEN и ADMITAD_WEBSITE_ID в .env');
  const url = new URL('https://api.admitad.com/coupons/');
  url.searchParams.set('website', website);
  url.searchParams.set('region', 'RU');
  url.searchParams.set('limit', '500');
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Admitad API: ${response.status} ${await response.text()}`);
  return normalizeCoupons(await response.json(), now);
}

export async function sync() {
  try { loadEnv(await readFile(new URL('.env', ROOT), 'utf8')); } catch {}
  const token = process.env.ADMITAD_ACCESS_TOKEN;
  const website = process.env.ADMITAD_WEBSITE_ID;
  const promos = await fetchAdmitadCoupons({ token, website });
  const target = new URL('data/promos.live.json', ROOT);
  const temp = new URL('data/promos.live.tmp.json', ROOT);
  await writeFile(temp, JSON.stringify(promos, null, 2), 'utf8');
  await rename(temp, target);
  console.log(`Загружено активных промокодов: ${promos.length}`);
  return promos;
}

function selfTest() {
  const rows = normalizeCoupons({ results: [
    { id: 1, status: 'active', promocode: 'LIVE10', date_end: '2099-01-01T00:00:00Z', name: 'Скидка', campaign: { name: 'Магазин' }, categories: [{ name: 'Дом' }], gotolink: 'https://example.com' },
    { id: 2, status: 'expired', promocode: 'OLD', date_end: '2020-01-01T00:00:00Z' },
    { id: 3, status: 'active', date_end: '2099-01-01T00:00:00Z' }
  ]}, new Date('2026-09-03T00:00:00Z'));
  if (rows.length !== 1 || rows[0].code !== 'LIVE10' || rows[0].demo) throw new Error('Нормализация купонов не прошла тест');
  console.log('ADMITAD_SELF_TEST_OK: остаются только активные, неистёкшие купоны с кодом.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    try { selfTest(); } catch (error) { console.error(error.message); process.exitCode = 1; }
  } else sync().catch(error => { console.error(error.message); process.exitCode = 1; });
}
