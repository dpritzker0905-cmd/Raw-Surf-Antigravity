/**
 * Paging for the admin spot tables (Spots, Precision Queue, Candidates).
 *
 * Owner, 2026-11-18: "We should allow more spots on a table too in the admin, so we can have pagination to see them
 * all in the table better." The Spots table loaded up to 5,000 rows and showed the first 50; the Precision Queue
 * showed the first 20 of about 1,700. Both now ask the server for one page and its true total.
 *
 * Ships ON. Kill switch (before the admin console loads): `window.__RAW_DISABLE_ADMIN_SPOT_PAGING__ = true` puts
 * the Spots table and the Precision Queue back to their old single-view behaviour and hides the Candidates tab.
 */
export const PAGE_SIZES = [25, 50, 100, 200];
export const DEFAULT_PAGE_SIZE = 50;

export const adminSpotPagingDisabled = () =>
  typeof window !== 'undefined' && window.__RAW_DISABLE_ADMIN_SPOT_PAGING__ === true;

/**
 * Where a page sits in a list: `{ page, pages, from, to, total }`, 1-based and clamped, so a page number past the
 * end (rows were deleted, a filter narrowed) reads as the last page instead of an empty one.
 */
export const pageWindow = (page, pageSize, total) => {
  const size = Math.max(1, Math.floor(Number(pageSize)) || 1);
  const count = Math.max(0, Math.floor(Number(total)) || 0);
  const pages = Math.max(1, Math.ceil(count / size));
  const current = Math.min(pages, Math.max(1, Math.floor(Number(page)) || 1));
  if (count === 0) return { page: 1, pages: 1, from: 0, to: 0, total: 0 };
  return { page: current, pages, from: (current - 1) * size + 1, to: Math.min(count, current * size), total: count };
};
