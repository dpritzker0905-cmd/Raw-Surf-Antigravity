/**
 * OnDemandSessionCards.js
 * Re-export shim -- individual card components extracted to separate files (v81).
 * Maintains backward-compatible import path.
 */
export { default as IncomingRequestCard } from './IncomingRequestCard';
export { default as ActiveSessionCard } from './ActiveSessionCard';
export { default as EarningsStatsCard } from './EarningsStatsCard';

// Re-export getImageUrl helper for any consumers
const getImageUrl = (url) => {
  if (!url) return null;
  if (url.startsWith('/api')) {
    return `${process.env.REACT_APP_BACKEND_URL}${url}`;
  }
  return url;
};

export { getImageUrl };
