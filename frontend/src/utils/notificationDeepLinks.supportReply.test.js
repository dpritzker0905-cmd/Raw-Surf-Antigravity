import { getNotificationDeepLink } from './notificationDeepLinks';
import logger from './logger';

jest.mock('./logger', () => ({ warn: jest.fn() }));

const ticketId = 'abcdef01-2345-6789-abcd-ef0123456789';
const messageId = '12345678-abcd-ef01-2345-6789abcdef01';
const recipientId = 'fedcba98-7654-3210-fedc-ba9876543210';
const otherUserId = '00000000-0000-0000-0000-000000000001';
const payload = () => ({ ticket_id: ticketId, message_id: messageId, recipient_id: recipientId });
const supportReply = data => ({ type: 'support_reply', data });
const destination = { route: `/support/tickets/${ticketId}` };

beforeEach(() => jest.clearAllMocks());

describe('support reply recipient-bound deep links', () => {
  it.each([
    ['object', () => payload()],
    ['JSON', () => JSON.stringify(payload())],
  ])('opens the ticket for its recipient from %s metadata', (_label, makeData) => {
    expect(getNotificationDeepLink(supportReply(makeData()), recipientId)).toEqual(destination);
  });

  it('compares UUIDs case-insensitively and normalizes the ticket route', () => {
    const data = Object.fromEntries(Object.entries(payload()).map(([key, value]) => [key, value.toUpperCase()]));
    expect(getNotificationDeepLink(supportReply(data), recipientId)).toEqual(destination);
    expect(getNotificationDeepLink(supportReply(payload()), recipientId.toUpperCase())).toEqual(destination);
  });

  it('returns only the ticket route without leaking metadata or navigation state', () => {
    const notification = { ...supportReply(payload()), user_id: otherUserId, id: messageId };
    expect(getNotificationDeepLink(notification, recipientId)).toStrictEqual(destination);
  });

  it.each(['ticket_id', 'message_id', 'recipient_id'])('rejects missing %s', key => {
    const data = payload();
    delete data[key];
    expect(getNotificationDeepLink(supportReply(data), recipientId)).toBeNull();
  });

  const invalidIds = [
    ['null', null],
    ['number', 1],
    ['array', [ticketId]],
    ['object', { id: ticketId }],
    ['empty', ''],
    ['unhyphenated', ticketId.replace(/-/g, '')],
    ['nonhex', ticketId.replace('a', 'g')],
    ['leading whitespace', ` ${ticketId}`],
    ['trailing newline', `${ticketId}\n`],
    ['path', `../${ticketId}`],
    ['URL', `https://example.invalid/${ticketId}`],
    ['query', `${ticketId}?next=/admin`],
  ];
  it.each(['ticket_id', 'message_id', 'recipient_id'].flatMap(key =>
    invalidIds.map(([label, value]) => [key, label, value])
  ))('rejects %s containing %s', (key, _label, value) => {
    expect(getNotificationDeepLink(supportReply({ ...payload(), [key]: value }), recipientId)).toBeNull();
  });

  it.each(['user_id', 'booking_id', 'conversation_id', 'post_id', 'route', 'unexpected'])('rejects extra %s without generic fallback', key => {
    expect(getNotificationDeepLink(supportReply({ ...payload(), [key]: otherUserId }), recipientId)).toBeNull();
  });

  it('rejects non-enumerable extra own properties', () => {
    const data = Object.defineProperty(payload(), 'extra', { value: true });
    expect(getNotificationDeepLink(supportReply(data), recipientId)).toBeNull();
  });

  it('rejects symbol extra own properties', () => {
    const data = { ...payload(), [Symbol('extra')]: true };
    expect(getNotificationDeepLink(supportReply(data), recipientId)).toBeNull();
  });

  it('does not accept inherited fields as required metadata', () => {
    const data = Object.assign(Object.create({ recipient_id: recipientId }), {
      ticket_id: ticketId, message_id: messageId,
    });
    expect(getNotificationDeepLink(supportReply(data), recipientId)).toBeNull();
  });

  it.each([
    ['missing', undefined], ['null', null], ['array', []], ['number', 42], ['boolean', true],
    ['empty string', ''], ['malformed JSON', '{bad'], ['JSON null', 'null'], ['JSON array', '[]'],
    ['JSON number', '42'], ['JSON boolean', 'true'], ['JSON string', JSON.stringify(ticketId)],
  ])('rejects %s payloads', (_label, data) => {
    expect(getNotificationDeepLink(supportReply(data), recipientId)).toBeNull();
  });

  it.each([
    ['missing', undefined], ['null', null], ['wrong recipient', otherUserId], ['number', 1],
    ['empty', ''], ['whitespace', ` ${recipientId}`], ['newline', `${recipientId}\n`],
    ['path', `/${recipientId}`], ['malformed', 'not-a-uuid'],
  ])('requires a current authenticated UUID: %s', (_label, userId) => {
    expect(getNotificationDeepLink(supportReply(payload()), userId)).toBeNull();
  });

  it('cannot substitute envelope ownership for a missing metadata recipient', () => {
    const data = payload();
    delete data.recipient_id;
    expect(getNotificationDeepLink({ ...supportReply(data), user_id: recipientId }, recipientId)).toBeNull();
  });

  it('keeps malformed JSON logging', () => {
    expect(getNotificationDeepLink(supportReply('{bad'), recipientId)).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('Failed to parse notification data:', expect.any(SyntaxError));
  });
});

describe('existing notification mappings', () => {
  it.each([
    [{ type: 'booking_confirmed', data: { booking_id: 'booking-1' } }, { route: '/bookings', state: { bookingId: 'booking-1' } }],
    [{ type: 'mention', data: JSON.stringify({ post_id: 'post-1' }) }, { route: '/post/post-1' }],
    [{ type: 'mention' }, { route: '/feed' }],
    [{ type: 'surf_alert', data: { alert_id: 'alert-1' } }, { route: '/alerts?alert_id=alert-1' }],
    [{ type: 'new_pro_application', data: { applicant_id: 'applicant', verification_request_id: 'request' } },
      { route: '/admin', state: { tab: 'verification', applicantId: 'applicant', verificationRequestId: 'request' } }],
    [{ type: 'legacy_unknown', data: { user_id: 'profile-1' } }, { route: '/profile/profile-1' }],
    [{ type: 'legacy_unknown', data: { booking_id: 'booking-2' } }, { route: '/bookings', state: { bookingId: 'booking-2' } }],
    [{ type: 'legacy_unknown', data: {} }, null],
  ])('preserves legacy destination %# with or without a viewer argument', (notification, expected) => {
    expect(getNotificationDeepLink(notification)).toEqual(expected);
    expect(getNotificationDeepLink(notification, recipientId)).toEqual(expected);
    expect(getNotificationDeepLink(notification, 'not-a-uuid')).toEqual(expected);
  });

  it('retains malformed legacy JSON logging and fallback behavior', () => {
    expect(getNotificationDeepLink({ type: 'mention', data: '{bad' })).toEqual({ route: '/feed' });
    expect(logger.warn).toHaveBeenCalledWith('Failed to parse notification data:', expect.any(SyntaxError));
  });
});
