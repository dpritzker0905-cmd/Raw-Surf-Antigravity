/**
 * media.js — Shared media URL utilities
 *
 * Centralizes the `getFullUrl` helper that was previously duplicated
 * across 46+ components. All avatar images, post media, and gallery
 * items should pass through this before rendering.
 *
 * WHY: The backend stores relative paths like `/api/uploads/avatars/xyz.jpg`.
 * React (on Netlify) resolves bare relative paths against the Netlify domain,
 * not the Render backend. This helper prepends BACKEND_URL to fix that.
 */
import { BACKEND_URL } from '../lib/apiClient';

/**
 * Resolves a potentially-relative backend media URL to an absolute URL.
 *
 * Handles all URL forms without modification:
 *   - data:   base64 data URIs (from camera captures / previews)
 *   - blob:   local blob URLs (from FileReader / camera)
 *   - //      protocol-relative CDN URLs
 *   - http(s) already-absolute URLs (CDN, Cloudinary, S3, etc.)
 *
 * Only prepends BACKEND_URL when the URL starts with / (relative API path).
 *
 * @param {string|null|undefined} url - The URL to resolve
 * @returns {string|null|undefined} The resolved absolute URL
 */
export const getFullUrl = (url) => {
  if (!url) return url;
  if (url.startsWith('data:')) return url;   // base64 data URIs — local only
  if (url.startsWith('blob:')) return url;   // blob URLs — local object refs
  if (url.startsWith('//')) return url;      // protocol-relative CDN URLs
  if (url.startsWith('http')) return url;    // absolute http/https URLs
  return `${BACKEND_URL || ''}${url}`;       // relative /api/uploads/... paths
};

/**
 * Safely appends a cache-busting query parameter to a URL.
 * Skips data: and blob: URIs since query params corrupt them.
 */
export const cacheBustUrl = (url, bustValue) => {
  if (!url) return url;
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${bustValue || Date.now()}`;
};

/**
 * Safely returns a thumbnail URL, falling back to the full URL if no thumb.
 * Used in gallery grids where backend may provide `thumbnail_url` separately.
 *
 * @param {string|null|undefined} thumbnailUrl
 * @param {string|null|undefined} fullUrl
 * @returns {string|null|undefined}
 */
export const getThumbnailUrl = (thumbnailUrl, fullUrl) =>
  getFullUrl(thumbnailUrl || fullUrl);

/**
 * Returns the video poster/thumbnail for a video post.
 * Prefers `thumbnail_url` (server-generated frame), falls back to `media_url`.
 *
 * @param {Object} post - A post object with media_url and optional thumbnail_url
 * @returns {string|null|undefined}
 */
export const getVideoPoster = (post) =>
  getFullUrl(post?.thumbnail_url || post?.media_url);
