/**
 * Shared error-handling utilities.
 *
 * Extracts a human-readable message from Axios/FastAPI error responses.
 * Used across gallery, booking, and admin components.
 */

/**
 * Safely extract an error message from an API response.
 *
 * Handles the three shapes FastAPI may return for `detail`:
 *   - string        → returned as-is
 *   - array of objs → joined msg/message fields
 *   - object        → msg/message field
 *
 * @param {Error|Object} error    Axios error (or anything with response.data.detail)
 * @param {string}       fallback Fallback text when no detail is found
 * @returns {string}
 */
export const getErrorMessage = (error, fallback = 'An error occurred') => {
  const detail = error?.response?.data?.detail;
  if (!detail) return error?.message || fallback;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map(e => e.msg || e.message || JSON.stringify(e)).join(', ');
  }
  if (typeof detail === 'object') {
    return detail.msg || detail.message || JSON.stringify(detail);
  }
  return fallback;
};
