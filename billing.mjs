import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadState, mutateState, settings, yooRequest } from './app.mjs';

const PERIOD_MS = 30 * 864e5;

export function dueSubscriptions(state, now = new Date()) {
  return Object.values(state.visitors || {}).filter(visitor => {
    const sub = visitor.subscription;
    return sub?.status === 'active' && sub.autoRenew === true && new Date(sub.expiresAt) <= now;
  });
}

function stableKey(visitor) {
  return createHash('sha256').update(`odinkod:${visitor.id}:${visitor.subscription.expiresAt}`).digest('hex');
}

function renewalPayload(config, visitor) {
  const sub = visitor.subscription;
  return {
    amount: { value: config.priceRub.toFixed(2), currency: 'RUB' },
    capture: true,
    payment_method_id: sub.paymentMethodId,
    description: 'Продление подписки «ОдинКод» на 30 дней',
    metadata: { visitor_id: visitor.id, product: 'subscription_renewal', period_start: sub.expiresAt },
    receipt: {
      customer: { email: sub.email },
      items: [{
        description: 'Доступ к каталогу промокодов на 30 дней', quantity: '1.00',
        amount: { value: config.priceRub.toFixed(2), currency: 'RUB' },
        vat_code: 1, payment_mode: 'full_payment', payment_subject: 'service'
      }]
    }
  };
}

export async function runBilling({ config, now = new Date(), charge } = {}) {
  const appConfig = config || await settings();
  const due = dueSubscriptions(await loadState(), now);
  const results = [];
  for (const visitor of due) {
    const sub = visitor.subscription;
    if (sub.demo || appConfig.paymentMode === 'demo') {
      await mutateState(current => {
        const active = current.visitors[visitor.id]?.subscription;
        if (!active?.autoRenew || active.expiresAt !== sub.expiresAt) return;
        active.expiresAt = new Date(new Date(active.expiresAt).getTime() + PERIOD_MS).toISOString();
        active.lastPaidAt = now.toISOString(); active.lastPaymentId = 'demo-renewal';
      });
      results.push({ visitorId: visitor.id, status: 'demo-renewed' });
      continue;
    }
    if (!sub.paymentMethodId || !sub.email) {
      await mutateState(current => {
        const active = current.visitors[visitor.id]?.subscription;
        if (active) { active.autoRenew = false; active.renewalError = 'Нет сохранённого способа оплаты или почты'; }
      });
      results.push({ visitorId: visitor.id, status: 'disabled-missing-payment-data' });
      continue;
    }
    try {
      const key = stableKey(visitor);
      const payment = charge ? await charge(visitor, key) : await yooRequest(appConfig, 'POST', '/payments', renewalPayload(appConfig, visitor), key);
      await mutateState(current => { current.payments[payment.id] = { visitorId: visitor.id, email: sub.email, status: payment.status, renewal: true, createdAt: now.toISOString() }; });
      results.push({ visitorId: visitor.id, status: payment.status, paymentId: payment.id });
    } catch (error) {
      await mutateState(current => { const active = current.visitors[visitor.id]?.subscription; if (active) active.renewalError = error.message; });
      results.push({ visitorId: visitor.id, status: 'error', error: error.message });
    }
  }
  return results;
}

function selfTest() {
  const now = new Date('2026-09-03T00:00:00Z');
  const state = { visitors: {
    due: { id:'due', subscription:{ status:'active', autoRenew:true, expiresAt:'2026-09-02T00:00:00Z' } },
    future: { id:'future', subscription:{ status:'active', autoRenew:true, expiresAt:'2026-10-02T00:00:00Z' } },
    canceled: { id:'canceled', subscription:{ status:'active', autoRenew:false, expiresAt:'2026-09-02T00:00:00Z' } }
  }};
  const due = dueSubscriptions(state, now);
  if (due.length !== 1 || due[0].id !== 'due') throw new Error('Проверка срока продления не пройдена');
  if (stableKey(due[0]) !== stableKey(due[0])) throw new Error('Ключ идемпотентности нестабилен');
  console.log('BILLING_SELF_TEST_OK: выбрана только просроченная активная подписка с автопродлением.');
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  if (process.argv.includes('--self-test')) { try { selfTest(); } catch(error) { console.error(error); process.exitCode=1; } }
  else runBilling().then(results => console.log(JSON.stringify(results, null, 2))).catch(error => { console.error(error); process.exitCode=1; });
}

