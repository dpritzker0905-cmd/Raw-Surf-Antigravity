import apiClient from './apiClient';
import { checkoutPurchase, forgetConfirmedCheckout } from './checkoutPurchase';

jest.mock('./apiClient', () => ({ __esModule: true, default: { post: jest.fn() } }));
const purchase = { ownerId: 'buyer', kind: 'scheduled', scope: 'pro', route: '/bookings/create-with-stripe',
  body: { photographer_id: 'pro', location: 'Beach', session_date: '2026-11-20T10:00:00Z', apply_credits: 20 } };

beforeEach(() => {
  Object.defineProperty(window, 'crypto', { configurable: true, value: require('crypto').webcrypto });
  sessionStorage.clear(); apiClient.post.mockReset();
});

test('lost response retry keeps the same durable request key across module reload', async () => {
  apiClient.post.mockRejectedValueOnce(new Error('Response lost'));
  await expect(checkoutPurchase(purchase)).rejects.toThrow('Response lost');
  const first = apiClient.post.mock.calls[0];
  expect(first[2]?.headers?.['Idempotency-Key']).toMatch(/^[a-zA-Z0-9_-]{8,128}$/);
  jest.resetModules();
  const reloaded = require('./checkoutPurchase');
  const client = require('./apiClient').default;
  client.post.mockResolvedValue({ data: { checkout_url: 'https://checkout.stripe.com/c/pay/test' } });
  await reloaded.checkoutPurchase(purchase);
  expect(client.post.mock.calls[0][2].headers['Idempotency-Key']).toBe(first[2].headers['Idempotency-Key']);
  expect(client.post.mock.calls[0][1]).toEqual(first[1]);
});

test('known ambiguous intent resumes original purchase instead of creating another', async () => {
  apiClient.post.mockRejectedValueOnce({ response: { status: 502, data: { detail: { checkout_intent_id: 'intent-1' } } } });
  await expect(checkoutPurchase(purchase)).rejects.toBeDefined();
  apiClient.post.mockResolvedValueOnce({ data: { session_id: 'session-1', checkout_url: 'https://checkout.stripe.com/c/pay/test' } });
  await checkoutPurchase(purchase);
  expect(apiClient.post.mock.calls[1][0]).toBe('/payments/checkout-intents/intent-1/resume');
});

test('different details cannot silently start a second purchase after response loss', async () => {
  apiClient.post.mockResolvedValue({ data: {} });
  apiClient.post.mockRejectedValueOnce(new Error('Lost'));
  await expect(checkoutPurchase(purchase)).rejects.toThrow();
  await expect(checkoutPurchase({ ...purchase, body: { ...purchase.body, apply_credits: 5 } })).rejects.toThrow(/previous purchase/i);
  expect(apiClient.post).toHaveBeenCalledTimes(1);
});

test('a card response without a redirect cannot be mistaken for a completed purchase', async () => {
  apiClient.post.mockResolvedValueOnce({ data: { checkout_intent_id: 'intent-1' } });
  await expect(checkoutPurchase(purchase)).rejects.toThrow(/pending/i);
  expect(apiClient.post).toHaveBeenCalledTimes(1);
});

test('confirmed receipt clears only that buyer purchase and allows a new key', async () => {
  apiClient.post.mockResolvedValue({ data: { session_id: 'paid-1', checkout_url: 'https://checkout.stripe.com/c/pay/test' } });
  await checkoutPurchase(purchase);
  const firstKey = apiClient.post.mock.calls[0][2].headers['Idempotency-Key'];
  forgetConfirmedCheckout('another-buyer', 'scheduled', 'paid-1');
  await checkoutPurchase(purchase);
  expect(apiClient.post.mock.calls[1][2].headers['Idempotency-Key']).toBe(firstKey);
  forgetConfirmedCheckout('buyer', 'scheduled', 'paid-1');
  await checkoutPurchase(purchase);
  expect(apiClient.post.mock.calls[2][2].headers['Idempotency-Key']).not.toBe(firstKey);
});

test('computed crew deadline is frozen for a retry while original details stay unchanged', async () => {
  apiClient.post.mockRejectedValueOnce(new Error('Lost'));
  const original = { ...purchase, body: { ...purchase.body, payment_window_expires: '2026-11-01T10:00:00Z' } };
  await expect(checkoutPurchase(original)).rejects.toThrow();
  apiClient.post.mockResolvedValue({ data: { checkout_url: 'https://checkout.stripe.com/c/pay/test' } });
  await checkoutPurchase({ ...original, body: { ...original.body, payment_window_expires: '2026-11-01T10:01:00Z' } });
  expect(apiClient.post.mock.calls[1][1]).toEqual(original.body);
});

test('explicit pre-intent rejection lets corrected details use a fresh purchase key', async () => {
  apiClient.post.mockRejectedValueOnce({ response: { status: 409, data: {
    detail: { message: 'Time slot occupied', checkout_intent_created: false },
  } } });
  await expect(checkoutPurchase(purchase)).rejects.toBeDefined();
  const rejectedKey = apiClient.post.mock.calls[0][2].headers['Idempotency-Key'];
  apiClient.post.mockResolvedValue({ data: { checkout_url: 'https://checkout.stripe.com/c/pay/test' } });
  await checkoutPurchase({ ...purchase, body: { ...purchase.body, session_date: '2026-11-21T10:00:00Z' } });
  expect(apiClient.post.mock.calls[1][2].headers['Idempotency-Key']).not.toBe(rejectedKey);
});

test('card request covered by quota accepts the actual live join response without a success field', async () => {
  apiClient.post.mockResolvedValueOnce({ data: { subscription_covered: true, session_id: 'participant', message: 'Successfully joined session' } });
  const response = await checkoutPurchase({ ...purchase, kind: 'live', route: '/sessions/join?surfer_id=buyer' });
  expect(response.data.subscription_covered).toBe(true);
  expect(Object.keys(sessionStorage)).toHaveLength(0);
});
