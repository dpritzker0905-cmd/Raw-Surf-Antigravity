// Synthetic in-memory services only. No requests, storage, messages or real users.
export const BACKEND_URL = window.location.origin;
const rows = Array.from({ length: 51 }, (_, index) => ({
  id: String(100 - index), type: 'new_follower',
  title: index === 50 ? 'Older unread fixture' : `Notification fixture ${index + 1}`,
  body: 'Disposable browser verification', data: null, is_read: index !== 50,
  created_at: new Date(Date.UTC(2026, 9, 29, 12) - index * 60000).toISOString(),
}));
window.__consistencyFixture = { rows, calls: [] };
const snapshot = data => Promise.resolve({ data: JSON.parse(JSON.stringify(data)) });
export default {
  get(url, options = {}) {
    window.__consistencyFixture.calls.push({ method: 'GET', url, params: options.params });
    if (url.includes('/unread-count')) return snapshot({ unread_count: rows.filter(row => !row.is_read).length });
    if (url.startsWith('/messages/')) return snapshot({ total: 0 });
    if (url.startsWith('/notifications/')) {
      const p = options.params || {};
      return snapshot(rows.filter(row => !p.before_created_at || row.created_at < p.before_created_at ||
        (row.created_at === p.before_created_at && row.id < p.before_id)).slice(0, p.limit || 50));
    }
    if (url.startsWith('/reviews/')) return snapshot({
      average_rating: 4.8, total_reviews: 1, recent_reviews: [{
        id: 'fixture-review', reviewer_name: 'Synthetic reviewer', rating: 5,
        created_at: '2026-10-29T12:00:00Z', comment: 'Disposable browser verification.',
      }],
    });
    throw new Error(`Unexpected fixture request: ${url}`);
  },
  post(url) {
    window.__consistencyFixture.calls.push({ method: 'POST', url });
    if (url.endsWith('/read-all')) rows.forEach(row => { row.is_read = true; });
    else if (url.endsWith('/read')) {
      const row = rows.find(item => item.id === url.split('/')[2]);
      if (row) row.is_read = true;
    } else throw new Error(`Unexpected fixture write: ${url}`);
    return snapshot({ message: 'Synthetic read complete' });
  },
};
