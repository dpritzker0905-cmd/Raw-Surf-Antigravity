/**
 * The UI suites seed synthetic users, not verified backend accounts. Their incidental
 * navigation badges cannot authenticate against owner-only messaging and locker APIs.
 * Stub only these GETs for the two declared fixture identities; weather/spot/auth APIs
 * remain real. Backend authority is covered separately by real HTTP/route controls.
 */
const { URL } = require('node:url');

async function stubSeededUiBadges(page, userIds) {
  let fulfilled = 0;
  const origin = new URL(process.env.REACT_APP_BACKEND_URL || 'https://raw-surf-antigravity.onrender.com').origin;
  // Record only method/path/status, never headers, query strings or browser storage.
  // A refused incidental request can redirect these synthetic sessions away from the subject.
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === origin && response.status() === 401) {
      console.log(`[SEEDED UI AUTH] ${response.request().method()} ${url.pathname} -> 401`);
    }
  });
  for (const id of userIds) {
    if (!['test-surfer-id', 'admin-user-id'].includes(id)) {
      throw new Error('Navigation badge fixture requires a declared synthetic UI identity');
    }
    const badges = [
      { path: `/api/messages/unread-counts/${id}`, name: 'message',
        json: { total: 0, primary: 0, requests: 0, grom_zone: 0 } },
      { path: `/api/notifications/${id}/unread-count`, name: 'notification',
        json: { unread_count: 0 } },
      { path: `/api/surfer-gallery/claim-queue-count/${id}`, name: 'claim-count',
        json: { pending_count: 0 } },
      // AppLayout's ViolationBanner asks on every page. Since #496 (b171ba51c) the route needs the caller's
      // token, so the token-less seeded session got a 401 -> "Session expired" -> /auth?tab=login 2 s later.
      { path: `/api/compliance/violations/user/${id}`, name: 'violations',
        json: { user_id: id, total_strikes: 0, is_suspended: false, is_banned: false,
          suspension_until: null, violations: [] } },
    ];
    for (const badge of badges) {
      await page.route(url => url.origin === origin && url.pathname === badge.path, route => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          json: badge.json,
          headers: { 'x-rawsurf-e2e-fixture': `synthetic-${badge.name}-badge` },
        }).then(() => { fulfilled += 1; });
      });
    }
  }
  return () => fulfilled;
}

module.exports = { stubSeededUiBadges };
