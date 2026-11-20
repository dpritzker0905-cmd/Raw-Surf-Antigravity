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
 * - string -- returned as-is
 * - array -- joined messages from validation errors
 * - object -- first string in msg, message, or error
 *
 * @param {Error|Object} error    Axios error (or anything with response.data.detail)
 * @param {string}       fallback Fallback text when no detail is found
 * @returns {string}
 */
export const getErrorMessage = (error, fallback = 'An error occurred') => {
  const detail = error?.response?.data?.detail;
  if (detail == null) return messageFrom(error?.message) || fallback;
  if (Array.isArray(detail)) {
    return detail.map(messageFrom).filter(Boolean).join(', ') || fallback;
  }
  return messageFrom(detail) || fallback;
};

function messageFrom(value) {
  if (typeof value === 'string') return value.trim();
  return [value?.msg, value?.message, value?.error]
    .find(message => typeof message === 'string' && message.trim())?.trim();
}
