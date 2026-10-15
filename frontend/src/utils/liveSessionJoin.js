// A checkout session is a pending purchase, not a live-session participant.
export function liveSessionJoinOutcome(data) {
  if (!data || typeof data.session_id !== 'string' || !data.session_id.trim()) {
    throw new Error('The session response is incomplete. Please try again.');
  }
  if (data.requires_payment === true) {
    let checkout;
    try { checkout = new URL(data.checkout_url); } catch (_) { /* handled below */ }
    if (!checkout || checkout.protocol !== 'https:' || checkout.username || checkout.password) {
      throw new Error('Checkout is unavailable. Please try again.');
    }
    return { type: 'checkout', url: checkout.href, sessionId: data.session_id };
  }
  if (data.check_in_created !== true) {
    throw new Error('Your session entry has not been confirmed. Please try again.');
  }
  return { type: 'joined' };
}
