/**
 * Shared time formatting utilities.
 * Consolidates duplicated formatTimeAgo implementations from:
 *   PostCard, PostModal, MessagesPage, ConversationItem, 
 *   Feed, SinglePost, SurferRosterCard
 */

/**
 * Formats a date/ISO-8601 string into a human-readable relative time.
 * Examples: "just now", "5m", "3h", "2d", "4w", "Jan 2025"
 * 
 * @param {string|Date} dateInput - ISO date string or Date object
 * @returns {string} Relative time string
 */
export const formatTimeAgo = (dateInput) => {
  if (!dateInput) return '';
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  if (diffWeeks < 52) return `${diffWeeks}w`;
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

/**
 * Compact variant for tight UI spaces (e.g. message lists).
 * Uses "now" instead of "just now".
 * 
 * @param {string|Date} dateInput - ISO date string or Date object
 * @returns {string} Compact relative time string
 */
export const formatTimeAgoCompact = (dateInput) => {
  if (!dateInput) return '';
  const diff = Date.now() - new Date(dateInput).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};
