const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SUPPORT_RETURN = new RegExp(`^/support(?:/tickets/${UUID})?$`, 'i');
const TICKET_UUID = new RegExp(`^${UUID}$`, 'i');

export const canonicalSupportTicketId = value => typeof value === 'string' && TICKET_UUID.test(value) ? value.toLowerCase() : value;
export const supportReturnPath = value => typeof value === 'string' && SUPPORT_RETURN.test(value) ? value.toLowerCase() : null;
export const supportAuthParams = (current, next) => {
  const redirect = supportReturnPath(current.get('redirect'));
  return redirect ? { ...next, redirect } : next;
};
export const newSupportRequestId = () => {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
