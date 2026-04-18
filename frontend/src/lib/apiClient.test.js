/**
 * apiClient.test.js — Unit tests for the centralized apiClient.
 * Tests the BACKEND_URL export and the shared getFullUrl helper logic.
 */

import { BACKEND_URL } from '../lib/apiClient';


describe('BACKEND_URL export', () => {
  test('exports a string (environment URL from .env or empty string)', () => {
    // BACKEND_URL is set at module load time from REACT_APP_BACKEND_URL.
    // In CI/test this may be the real env value or undefined — just verify type.
    expect(typeof BACKEND_URL).toBe('string');
  });
});


// ─── getFullUrl helper (used in PostCard, Profile, MessagesPage) ───────────────

/**
 * This function is duplicated in several components. These tests validate the
 * shared logic so any future consolidation has coverage.
 */
const getFullUrl = (url, backendUrl = 'http://test-backend:8000') => {
  if (!url) return url;
  if (url.startsWith('data:')) return url;   // base64 data URIs
  if (url.startsWith('blob:')) return url;   // local blob URLs
  if (url.startsWith('//')) return url;      // protocol-relative CDN URLs
  if (url.startsWith('http')) return url;    // absolute http/https URLs
  return `${backendUrl}${url}`;              // relative /uploads paths
};

describe('getFullUrl()', () => {
  test('returns relative path prefixed with backend URL', () => {
    expect(getFullUrl('/uploads/photo.jpg')).toBe('http://test-backend:8000/uploads/photo.jpg');
  });

  test('passes through absolute http URLs unchanged', () => {
    expect(getFullUrl('https://cdn.rawsurf.com/img.jpg')).toBe('https://cdn.rawsurf.com/img.jpg');
  });

  test('passes through blob URLs unchanged', () => {
    expect(getFullUrl('blob:http://localhost/abc')).toBe('blob:http://localhost/abc');
  });

  test('passes through data URIs unchanged', () => {
    const dataUri = 'data:image/jpeg;base64,/9j/4AA';
    expect(getFullUrl(dataUri)).toBe(dataUri);
  });

  test('passes through protocol-relative URLs unchanged', () => {
    expect(getFullUrl('//cdn.example.com/img.png')).toBe('//cdn.example.com/img.png');
  });

  test('returns falsy value as-is', () => {
    expect(getFullUrl(null)).toBe(null);
    expect(getFullUrl(undefined)).toBe(undefined);
    expect(getFullUrl('')).toBe('');
  });
});
