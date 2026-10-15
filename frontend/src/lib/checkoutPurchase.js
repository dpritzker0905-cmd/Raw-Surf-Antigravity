import apiClient from './apiClient';

const prefix = ownerId => `raw-surf:checkout:${encodeURIComponent(ownerId)}:`;
const canonical = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.keys(item).sort().reduce((result, key) => ({ ...result, [key]: item[key] }), {}) : item);
const comparable = body => {
  const { payment_window_expires: _deadline, ...details } = body;
  return canonical(details); // Computed crew deadline is frozen with the first request.
};

export const checkoutErrorMessage = (error, fallback = 'Checkout could not be confirmed. Retry this purchase.') => {
  const detail = error?.response?.data?.detail;
  return typeof detail === 'string' ? detail : detail?.message || error?.message || fallback;
};

export async function checkoutPurchase({ ownerId, kind, scope, route, body }) {
  if (!ownerId || !scope || !['scheduled', 'live'].includes(kind)) throw new Error('Sign in before checkout.');
  const key = `${prefix(ownerId)}${kind}:${encodeURIComponent(scope)}`;
  let record;
  try {
    const stored = sessionStorage.getItem(key);
    record = stored ? JSON.parse(stored) : null;
    if (!record) {
      record = { requestKey: window.crypto.randomUUID(), route, body, fingerprint: comparable(body) };
      sessionStorage.setItem(key, JSON.stringify(record)); // Persist BEFORE any network side effect.
    }
  } catch (_) {
    throw new Error('Checkout recovery could not be saved. Enable browser storage before paying.');
  }
  if (record.route !== route || record.fingerprint !== comparable(body)) {
    throw new Error('A previous purchase uses different details. Check your bookings before starting another.');
  }
  try {
    const response = record.intentId
      ? await apiClient.post(`/payments/checkout-intents/${encodeURIComponent(record.intentId)}/resume`)
      : await apiClient.post(record.route, record.body, { headers: { 'Idempotency-Key': record.requestKey } });
    const data = response.data;
    if (kind === 'live' && data.subscription_covered === true && !data.requires_payment) {
      sessionStorage.removeItem(key);
      return response;
    }
    record.intentId = data.checkout_intent_id || record.intentId;
    record.sessionId = data.session_id || record.sessionId;
    sessionStorage.setItem(key, JSON.stringify(record));
    if (!data.checkout_url) throw new Error('Checkout is pending. Retry this purchase; do not create another.');
    return response;
  } catch (error) {
    const detail = error?.response?.data?.detail;
    if (!record.intentId && error?.response?.status >= 400 && error.response.status < 500
        && detail?.checkout_intent_created === false) {
      sessionStorage.removeItem(key); // Server proved this request never prepared a purchase.
    }
    if (detail?.checkout_intent_id) {
      record.intentId = detail.checkout_intent_id;
      sessionStorage.setItem(key, JSON.stringify(record));
    }
    throw error;
  }
}

// Clear only a receipt the authenticated return handler has actually confirmed.
export function forgetConfirmedCheckout(ownerId, kind, sessionId) {
  const ownerPrefix = `${prefix(ownerId)}${kind}:`;
  let keys;
  try { keys = Object.keys(sessionStorage); } catch (_) { return; }
  for (const key of keys) {
    if (!key.startsWith(ownerPrefix)) continue;
    try {
      if (JSON.parse(sessionStorage.getItem(key))?.sessionId === sessionId) sessionStorage.removeItem(key);
    } catch (_) { /* A damaged unrelated record is never grounds for a new purchase. */ }
  }
}
