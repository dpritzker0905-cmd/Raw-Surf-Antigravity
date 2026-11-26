import { getCheckoutUrl } from './checkoutUrl';

// A checkout session is a pending purchase, not a live-session participant.
export function liveSessionJoinOutcome(data) {
  if (!data || typeof data.session_id !== 'string' || !data.session_id.trim()) {
    throw new Error('The session response is incomplete. Please try again.');
  }
  if (data.requires_payment === true) {
    const url = getCheckoutUrl(data.checkout_url);
    if (!url) {
      throw new Error('Checkout is unavailable. Please try again.');
    }
    return { type: 'checkout', url, sessionId: data.session_id };
  }
  if (data.check_in_created !== true) {
    throw new Error('Your session entry has not been confirmed. Please try again.');
  }
  return { type: 'joined' };
}
