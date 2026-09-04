import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(ROOT, 'public');
const STATE_FILE = resolve(ROOT, 'data/state.json');
const LIVE_PROMOS = resolve(ROOT, 'data/promos.live.json');
const DEMO_PROMOS = resolve(ROOT, 'data/promos.demo.json');
const SESSION_SECONDS = 180;
let writeQueue = Promise.resolve();

function loadEnv(text) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const split = line.indexOf('=');
    if (split > 0 && !(line.slice(0, split) in process.env)) process.env[line.slice(0, split)] = line.slice(split + 1).trim();
  }
}

export async function settings() {
  try { loadEnv(await readFile(resolve(ROOT, '.env'), 'utf8')); } catch {}
  return {
    port: Number(process.env.PORT || 8010),
    host: process.env.HOST || '127.0.0.1',
    baseUrl: process.env.BASE_URL || 'http://localhost:8010',
    sessionSecret: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
    priceRub: Number(process.env.SUBSCRIPTION_PRICE_RUB || 10),
    paymentMode: process.env.PAYMENT_MODE || 'demo',
    shopId: process.env.YOOKASSA_SHOP_ID,
    secretKey: process.env.YOOKASSA_SECRET_KEY,
    autoJobs: process.env.AUTO_JOBS !== 'false',
    promoSyncMinutes: Math.max(15, Number(process.env.PROMO_SYNC_MINUTES || 60)),
    billingMinutes: Math.max(5, Number(process.env.BILLING_INTERVAL_MINUTES || 15))
  };
}

export async function loadState() {
  try { return JSON.parse(await readFile(STATE_FILE, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return { visitors: {}, payments: {} };
    throw error;
  }
}

export async function mutateState(mutator) {
  let result;
  writeQueue = writeQueue.then(async () => {
    const state = await loadState();
    result = await mutator(state);
    await mkdir(dirname(STATE_FILE), { recursive: true });
    const temp = STATE_FILE + '.tmp';
    await writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
    await rename(temp, STATE_FILE);
  });
  await writeQueue;
  return result;
}

async function loadPromos() {
  let source = LIVE_PROMOS;
  try { await stat(source); } catch { source = DEMO_PROMOS; }
  const promos = JSON.parse(await readFile(source, 'utf8'));
  const today = new Date().toISOString().slice(0, 10);
  return promos.filter(item => !item.validUntil || item.validUntil >= today);
}

function sign(id, secret) { return createHmac('sha256', secret).update(id).digest('base64url'); }
function parseCookies(header = '') { return Object.fromEntries(header.split(';').map(v => v.trim().split('=').map(decodeURIComponent)).filter(v => v.length === 2)); }
function visitorId(request, secret) {
  const value = parseCookies(request.headers.cookie).ok_session;
  if (!value) return null;
  const [id, signature] = value.split('.');
  if (!id || !signature) return null;
  const expected = Buffer.from(sign(id, secret));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? id : null;
}
function sessionCookie(id, secret) { return `ok_session=${encodeURIComponent(id + '.' + sign(id, secret))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`; }

function json(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store', ...headers });
  response.end(payload);
}

async function body(request, limit = 20_000) {
  let text = '';
  for await (const chunk of request) { text += chunk; if (Buffer.byteLength(text) > limit) throw new Error('TOO_LARGE'); }
  return JSON.parse(text || '{}');
}

export function activeSubscription(visitor, now = new Date()) { return visitor.subscription?.status === 'active' && new Date(visitor.subscription.expiresAt) > now; }
function publicPromo(promo) { const { code, ...safe } = promo; return safe; }

async function ensureVisitor(request, response, config) {
  let id = visitorId(request, config.sessionSecret);
  let created = false;
  if (!id) { id = randomUUID(); created = true; }
  const visitor = await mutateState(state => {
    if (!state.visitors[id]) state.visitors[id] = { id, startedAt: new Date().toISOString(), freeClaimed: false };
    return state.visitors[id];
  });
  return { id, visitor, cookie: created ? sessionCookie(id, config.sessionSecret) : null };
}

export async function yooRequest(config, method, path, payload, idempotenceKey = randomUUID()) {
  if (!config.shopId || !config.secretKey) throw new Error('ЮKassa не настроена');
  const headers = { authorization: 'Basic ' + Buffer.from(`${config.shopId}:${config.secretKey}`).toString('base64') };
  if (payload) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['idempotence-key'] = idempotenceKey;
  const response = await fetch('https://api.yookassa.ru/v3' + path, {
    method,
    headers,
    body: payload ? JSON.stringify(payload) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.description || `ЮKassa ${response.status}`);
  return data;
}

async function createCheckout(config, visitorId, email) {
  const payment = await yooRequest(config, 'POST', '/payments', {
    amount: { value: config.priceRub.toFixed(2), currency: 'RUB' }, capture: true, save_payment_method: true,
    confirmation: { type: 'redirect', return_url: config.baseUrl + '/?payment=return' },
    description: `Подписка «ОдинКод»: ${config.priceRub} ₽ за 30 дней`,
    metadata: { visitor_id: visitorId, product: 'subscription_30d' },
    receipt: { customer: { email }, items: [{ description: 'Доступ к каталогу промокодов на 30 дней', quantity: '1.00', amount: { value: config.priceRub.toFixed(2), currency: 'RUB' }, vat_code: 1, payment_mode: 'full_payment', payment_subject: 'service' }] }
  });
  await mutateState(state => {
    state.payments[payment.id] = { visitorId, email, status: payment.status, createdAt: new Date().toISOString() };
    state.visitors[visitorId].pendingPaymentId = payment.id;
  });
  return payment.confirmation?.confirmation_url;
}

async function verifyAndActivate(config, paymentId) {
  const payment = await yooRequest(config, 'GET', '/payments/' + encodeURIComponent(paymentId));
  if (payment.status !== 'succeeded' || !['subscription_30d', 'subscription_renewal'].includes(payment.metadata?.product)) return false;
  const id = payment.metadata.visitor_id;
  await mutateState(state => {
    if (state.payments[payment.id]?.status === 'succeeded') return;
    const visitor = state.visitors[id];
    if (!visitor) return;
    const prior = visitor.subscription || {};
    const base = Math.max(Date.now(), new Date(prior.expiresAt || 0).getTime());
    visitor.subscription = {
      ...prior,
      status: 'active', autoRenew: prior.autoRenew !== false,
      startedAt: prior.startedAt || new Date().toISOString(),
      expiresAt: new Date(base + 30 * 864e5).toISOString(),
      email: prior.email || state.payments[payment.id]?.email,
      paymentMethodId: payment.payment_method?.saved ? payment.payment_method.id : prior.paymentMethodId,
      lastPaymentId: payment.id, lastPaidAt: new Date().toISOString()
    };
    delete visitor.pendingPaymentId;
    state.payments[payment.id] = { ...state.payments[payment.id], visitorId: id, status: 'succeeded', verifiedAt: new Date().toISOString() };
  });
  return true;
}

async function recordCanceledPayment(config, paymentId) {
  const payment = await yooRequest(config, 'GET', '/payments/' + encodeURIComponent(paymentId));
  if (payment.status !== 'canceled') return false;
  await mutateState(state => {
    const saved = state.payments[payment.id] || {};
    const visitor = state.visitors[payment.metadata?.visitor_id || saved.visitorId];
    state.payments[payment.id] = { ...saved, status: 'canceled', cancellationDetails: payment.cancellation_details, verifiedAt: new Date().toISOString() };
    if (visitor?.pendingPaymentId === payment.id) delete visitor.pendingPaymentId;
    if (saved.renewal && visitor?.subscription) {
      visitor.subscription.renewalError = payment.cancellation_details?.reason || 'Платёж отклонён';
      if (payment.cancellation_details?.reason === 'permission_revoked') visitor.subscription.autoRenew = false;
    }
  });
  return true;
}

async function serveStatic(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const name = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  if (!['index.html'].includes(name)) return response.writeHead(404).end('Not found');
  const path = resolve(PUBLIC, name);
  if (!path.startsWith(PUBLIC + sep)) return response.writeHead(404).end('Not found');
  const info = await stat(path);
  response.writeHead(200, { 'content-type': extname(path) === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream', 'content-length': info.size, 'x-content-type-options': 'nosniff' });
  createReadStream(path).pipe(response);
}

export async function createApp({ port, host = '127.0.0.1', config: provided } = {}) {
  const config = provided || await settings();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true, product: 'ОдинКод', paymentMode: config.paymentMode });
      if (request.method === 'GET' && url.pathname === '/api/catalog') {
        const { visitor, cookie } = await ensureVisitor(request, response, config);
        const promos = await loadPromos();
        return json(response, 200, { promos: promos.map(publicPromo), session: { startedAt: visitor.startedAt, expiresAt: new Date(new Date(visitor.startedAt).getTime() + SESSION_SECONDS * 1000).toISOString(), freeClaimed: visitor.freeClaimed, subscribed: activeSubscription(visitor), subscription: visitor.subscription || null }, priceRub: config.priceRub, paymentMode: config.paymentMode, demoData: promos.some(p => p.demo) }, cookie ? { 'set-cookie': cookie } : {});
      }
      if (request.method === 'POST' && url.pathname === '/api/reveal') {
        const id = visitorId(request, config.sessionSecret);
        if (!id) return json(response, 401, { error: 'Обновите страницу' });
        const input = await body(request); const promos = await loadPromos(); const promo = promos.find(p => p.id === input.promoId);
        if (!promo) return json(response, 404, { error: 'Промокод больше недоступен' });
        const result = await mutateState(state => {
          const visitor = state.visitors[id]; if (!visitor) return { status: 401, body: { error: 'Обновите страницу' } };
          const subscribed = activeSubscription(visitor); const expired = Date.now() > new Date(visitor.startedAt).getTime() + SESSION_SECONDS * 1000;
          if (!subscribed && (visitor.freeClaimed || expired)) return { status: 402, body: { error: expired ? 'Бесплатная сессия завершена' : 'Бесплатный код уже выбран', subscribe: true } };
          if (!subscribed) { visitor.freeClaimed = true; visitor.freePromoId = promo.id; visitor.freeClaimedAt = new Date().toISOString(); }
          return { status: 200, body: { promo: { ...publicPromo(promo), code: promo.code }, subscribed } };
        });
        return json(response, result.status, result.body);
      }
      if (request.method === 'POST' && url.pathname === '/api/checkout') {
        const id = visitorId(request, config.sessionSecret); if (!id) return json(response, 401, { error: 'Обновите страницу' });
        const input = await body(request); const email = String(input.email || '').trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(response, 400, { error: 'Введите корректную почту для чека' });
        if (!input.consent) return json(response, 400, { error: 'Нужно подтвердить условия автопродления' });
        if (config.paymentMode === 'demo') {
          await mutateState(state => { state.visitors[id].subscription = { status: 'active', autoRenew: true, demo: true, email, startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 864e5).toISOString() }; });
          return json(response, 200, { demo: true, activated: true });
        }
        const confirmationUrl = await createCheckout(config, id, email);
        return json(response, 200, { confirmationUrl });
      }
      if (request.method === 'POST' && url.pathname === '/api/payment/verify') {
        const id = visitorId(request, config.sessionSecret); if (!id) return json(response, 401, { error: 'Обновите страницу' });
        const state = await loadState(); const paymentId = state.visitors[id]?.pendingPaymentId;
        if (!paymentId) return json(response, 200, { activated: activeSubscription(state.visitors[id] || {}) });
        const activated = await verifyAndActivate(config, paymentId);
        return json(response, 200, { activated, pending: !activated });
      }
      if (request.method === 'POST' && url.pathname === '/api/subscription/cancel') {
        const id = visitorId(request, config.sessionSecret); if (!id) return json(response, 401, { error: 'Обновите страницу' });
        await mutateState(state => { const sub = state.visitors[id]?.subscription; if (sub) { sub.autoRenew = false; sub.canceledAt = new Date().toISOString(); } });
        return json(response, 200, { canceled: true, message: 'Автопродление отключено. Доступ сохранится до конца оплаченного периода.' });
      }
      if (request.method === 'POST' && url.pathname === '/api/webhooks/yookassa') {
        const event = await body(request); const paymentId = event.object?.id;
        if (event.event === 'payment.succeeded' && paymentId) await verifyAndActivate(config, paymentId);
        if (event.event === 'payment.canceled' && paymentId) await recordCanceledPayment(config, paymentId);
        return json(response, 200, { ok: true });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'Метод не поддерживается' });
      return serveStatic(request, response);
    } catch (error) {
      if (error instanceof SyntaxError) return json(response, 400, { error: 'Некорректный JSON' });
      console.error(error); return json(response, 500, { error: 'Внутренняя ошибка' });
    }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port ?? config.port, host, ok); });
  return server;
}

async function startBackgroundJobs(config) {
  if (!config.autoJobs) return;
  const runPromoSync = async () => {
    try { const { syncAllPromos } = await import('./promo-sync.mjs'); await syncAllPromos(); }
    catch (error) { console.error('Автообновление промокодов:', error.message); }
  };
  const runRenewals = async () => {
    try { const { runBilling } = await import('./billing.mjs'); const result = await runBilling({ config }); if (result.length) console.log('Автопродления:', result); }
    catch (error) { console.error('Автопродления:', error.message); }
  };
  if (true) {
    runPromoSync();
    setInterval(runPromoSync, config.promoSyncMinutes * 60_000).unref();
  }
  if (config.paymentMode === 'yookassa') {
    runRenewals();
    setInterval(runRenewals, config.billingMinutes * 60_000).unref();
  }
}

async function selfTest() {
  const config = { port: 0, baseUrl: 'http://localhost', sessionSecret: 'test-secret-that-is-long-enough-123456', priceRub: 10, paymentMode: 'demo' };
  const server = await createApp({ port: 0, config }); const address = server.address(); const base = `http://127.0.0.1:${address.port}`;
  try {
    const catalogResponse = await fetch(base + '/api/catalog'); const cookie = catalogResponse.headers.get('set-cookie').split(';')[0]; const catalog = await catalogResponse.json();
    if (catalog.promos.length < 10 || !catalog.demoData || 'code' in catalog.promos[0]) throw new Error('catalog masking failed');
    const reveal = await fetch(base + '/api/reveal', { method:'POST', headers:{'content-type':'application/json',cookie}, body:JSON.stringify({promoId:catalog.promos[0].id}) });
    if (!reveal.ok || !(await reveal.json()).promo.code) throw new Error('free reveal failed');
    const second = await fetch(base + '/api/reveal', { method:'POST', headers:{'content-type':'application/json',cookie}, body:JSON.stringify({promoId:catalog.promos[1].id}) });
    if (second.status !== 402) throw new Error('free limit failed');
    const subscribe = await fetch(base + '/api/checkout', { method:'POST', headers:{'content-type':'application/json',cookie}, body:JSON.stringify({email:'test@example.com',consent:true}) });
    if (!(await subscribe.json()).activated) throw new Error('demo subscription failed');
    const unlimited = await fetch(base + '/api/reveal', { method:'POST', headers:{'content-type':'application/json',cookie}, body:JSON.stringify({promoId:catalog.promos[1].id}) });
    if (!unlimited.ok) throw new Error('subscriber access failed');
    const cancel = await fetch(base + '/api/subscription/cancel', { method:'POST', headers:{cookie} });
    if (!(await cancel.json()).canceled) throw new Error('cancel failed');
    const privateFile = await fetch(base + '/.env.example'); if (privateFile.status !== 404) throw new Error('private file exposed');
    console.log('SELF_TEST_OK: каталог, 1 бесплатный код, подписка, безлимит, отмена и защита файлов работают.');
  } finally { await new Promise(done => server.close(done)); }
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  if (process.argv.includes('--self-test')) selfTest().catch(error => { console.error(error); process.exitCode = 1; });
  else settings().then(async config => {
    const server = await createApp({ config, host: config.host }); const a = server.address();
    console.log(`ОдинКод запущен: http://${a.address}:${a.port}`);
    await startBackgroundJobs(config);
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
