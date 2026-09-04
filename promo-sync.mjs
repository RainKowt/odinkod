import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { fetchAdmitadCoupons } from './admitad-sync.mjs';

const ROOT = new URL('.', import.meta.url);

function loadEnv(text) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const split = line.indexOf('=');
    if (split > 0 && !(line.slice(0, split) in process.env)) process.env[line.slice(0, split)] = line.slice(split + 1).trim();
  }
}

export function normalizePartnerFeed(payload, sourceName = 'Партнёр', now = new Date()) {
  const items = Array.isArray(payload) ? payload : payload.results || payload.promos || [];
  return items.filter(item => {
    const expires = item.validUntil || item.date_end;
    return item.code && (item.status === undefined || item.status === 'active') && (!expires || new Date(expires) > now);
  }).map((item, index) => ({
    id: `feed-${sourceName.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-')}-${item.id || index}`,
    merchant: item.merchant || item.service || item.campaign?.name || 'Сервис',
    title: item.title || item.name || 'Промокод',
    code: item.code,
    category: item.category || 'Другое',
    audience: item.audience || 'Все пользователи',
    discount: item.discount || 'Выгода по условиям акции',
    terms: item.terms || item.description || 'Проверьте условия на сайте сервиса',
    validUntil: (item.validUntil || item.date_end || '').slice(0, 10) || null,
    verifiedAt: now.toISOString().slice(0, 10),
    sourceName,
    sourceUrl: item.sourceUrl || item.url || null,
    affiliateUrl: item.affiliateUrl || item.url || null,
    demo: false
  }));
}

function feedConfigs(raw = '') {
  if (!raw.trim()) return [];
  const configs = JSON.parse(raw);
  if (!Array.isArray(configs)) throw new Error('PARTNER_FEEDS_JSON должен содержать JSON-массив');
  return configs.filter(item => item?.name && /^https:\/\//.test(item?.url || ''));
}

async function fetchFeed(config, now) {
  const token = config.tokenEnv ? process.env[config.tokenEnv] : null;
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(config.url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${config.name}: HTTP ${response.status}`);
  return normalizePartnerFeed(await response.json(), config.name, now);
}

export function mergePromos(groups) {
  const unique = new Map();
  for (const promo of groups.flat()) {
    const key = `${promo.merchant}`.toLocaleLowerCase('ru') + '|' + `${promo.code}`.toLocaleUpperCase('ru');
    if (!unique.has(key) || new Date(promo.verifiedAt) > new Date(unique.get(key).verifiedAt)) unique.set(key, promo);
  }
  return [...unique.values()].sort((a, b) => a.merchant.localeCompare(b.merchant, 'ru'));
}

export async function syncAllPromos({ now = new Date(), logger = console } = {}) {
  try { loadEnv(await readFile(new URL('.env', ROOT), 'utf8')); } catch {}
  const jobs = [];
  try {
    const approved = JSON.parse(await readFile(new URL('data/promos.approved.json', ROOT), 'utf8'));
    jobs.push({ name: 'Проверенные предложения', run: async () => normalizePartnerFeed(approved, 'Admitad Tracking Promo', now) });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const admitadConfigured = process.env.ADMITAD_ACCESS_TOKEN || (process.env.ADMITAD_CLIENT_ID && process.env.ADMITAD_CLIENT_SECRET);
  if (admitadConfigured && process.env.ADMITAD_WEBSITE_ID) {
    jobs.push({ name: 'Admitad', run: () => fetchAdmitadCoupons({
      token: process.env.ADMITAD_ACCESS_TOKEN,
      clientId: process.env.ADMITAD_CLIENT_ID,
      clientSecret: process.env.ADMITAD_CLIENT_SECRET,
      website: process.env.ADMITAD_WEBSITE_ID,
      region: process.env.ADMITAD_REGION || 'US',
      now
    }) });
  }
  for (const config of feedConfigs(process.env.PARTNER_FEEDS_JSON)) jobs.push({ name: config.name, run: () => fetchFeed(config, now) });
  if (!jobs.length) return { skipped: true, count: 0, sources: [], errors: [] };

  const settled = await Promise.allSettled(jobs.map(job => job.run()));
  const groups = settled.filter(item => item.status === 'fulfilled').map(item => item.value);
  const errors = settled.flatMap((item, index) => item.status === 'rejected' ? [`${jobs[index].name}: ${item.reason.message}`] : []);
  const promos = mergePromos(groups);
  if (!promos.length) throw new Error(`Источники не вернули активных промокодов${errors.length ? ': ' + errors.join('; ') : ''}`);
  const target = new URL('data/promos.live.json', ROOT);
  const temp = new URL('data/promos.live.tmp.json', ROOT);
  await writeFile(temp, JSON.stringify(promos, null, 2), 'utf8');
  await rename(temp, target);
  logger.log(`Каталог обновлён: ${promos.length} кодов из ${groups.length} источников.`);
  for (const error of errors) logger.warn(error);
  return { skipped: false, count: promos.length, sources: groups.length, errors };
}

function selfTest() {
  const now = new Date('2026-09-03T00:00:00Z');
  const promos = normalizePartnerFeed({ promos: [
    { id: 1, status: 'active', merchant: 'Яндекс Еда', title: 'Скидка', code: 'FOOD10', validUntil: '2099-01-01', url: 'https://example.com' },
    { id: 2, status: 'expired', merchant: 'Магнит', code: 'OLD' },
    { id: 3, merchant: 'Пятёрочка', code: 'FIVE', validUntil: '2020-01-01' }
  ]}, 'Тест', now);
  if (promos.length !== 1 || promos[0].merchant !== 'Яндекс Еда' || promos[0].demo) throw new Error('Нормализация партнёрской ленты не прошла тест');
  if (mergePromos([promos, promos]).length !== 1) throw new Error('Дедупликация не прошла тест');
  console.log('PROMO_SYNC_SELF_TEST_OK: фильтрация, названия сервисов и дедупликация работают.');
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  if (process.argv.includes('--self-test')) { try { selfTest(); } catch (error) { console.error(error); process.exitCode = 1; } }
  else syncAllPromos().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
