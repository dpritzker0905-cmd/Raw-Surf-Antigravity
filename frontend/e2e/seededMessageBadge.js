/**
 * The UI suites seed synthetic users, not verified backend accounts. Their incidental
 * message badge cannot authenticate against the repaired owner-only messaging API.
 * Stub only this GET for the two declared fixture identities; weather/spot/auth APIs
 * remain real. Backend authority is covered separately by real HTTP/route controls.
 */
const { URL } = require('node:url');

async function stubSeededMessageBadge(page, userIds) {
  let fulfilled = 0;
  const origin = new URL(process.env.REACT_APP_BACKEND_URL || 'https://raw-surf-antigravity.onrender.com').origin;
  for (const id of userIds) {
    if (!['test-surfer-id', 'admin-user-id'].includes(id)) {
      throw new Error('Message badge fixture requires a declared synthetic UI identity');
    }
    const path = `/api/messages/unread-counts/${id}`;
    await page.route(url => url.origin === origin && url.pathname === path, route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        json: { total: 0, primary: 0, requests: 0, grom_zone: 0 },
        headers: { 'x-rawsurf-e2e-fixture': 'synthetic-message-badge' },
      }).then(() => { fulfilled += 1; });
    });
  }
  return () => fulfilled;
}

module.exports = { stubSeededMessageBadge };
