/**
 * media.test.js — Tests for the shared media URL utility
 *
 * Covers all URL forms that getFullUrl must handle correctly.
 */
import { getFullUrl, getThumbnailUrl, getVideoPoster } from '../utils/media';

// Mock BACKEND_URL for deterministic tests
jest.mock('../lib/apiClient', () => ({
  __esModule: true,
  BACKEND_URL: 'https://api.rawsurf.com',
  default: {},
}));

describe('getFullUrl()', () => {
  test('prepends BACKEND_URL to relative /api/uploads/ paths', () => {
    expect(getFullUrl('/api/uploads/avatars/user.jpg'))
      .toBe('https://api.rawsurf.com/api/uploads/avatars/user.jpg');
  });

  test('prepends BACKEND_URL to any root-relative path', () => {
    expect(getFullUrl('/uploads/photo.jpg'))
      .toBe('https://api.rawsurf.com/uploads/photo.jpg');
  });

  test('passes through absolute https URLs unchanged', () => {
    const url = 'https://cdn.rawsurf.com/image.jpg';
    expect(getFullUrl(url)).toBe(url);
  });

  test('passes through absolute http URLs unchanged', () => {
    const url = 'http://localhost:8000/uploads/img.jpg';
    expect(getFullUrl(url)).toBe(url);
  });

  test('passes through protocol-relative CDN URLs unchanged', () => {
    const url = '//cdn.cloudfront.net/image.jpg';
    expect(getFullUrl(url)).toBe(url);
  });

  test('passes through data: URIs unchanged (base64 camera captures)', () => {
    const dataUri = 'data:image/jpeg;base64,/9j/4AA...';
    expect(getFullUrl(dataUri)).toBe(dataUri);
  });

  test('passes through blob: URLs unchanged (FileReader / camera)', () => {
    const blobUrl = 'blob:http://localhost/123-abc';
    expect(getFullUrl(blobUrl)).toBe(blobUrl);
  });

  test('returns null as-is (no avatar case)', () => {
    expect(getFullUrl(null)).toBeNull();
  });

  test('returns undefined as-is', () => {
    expect(getFullUrl(undefined)).toBeUndefined();
  });

  test('returns empty string as-is', () => {
    expect(getFullUrl('')).toBe('');
  });
});

describe('getThumbnailUrl()', () => {
  test('prefers thumbnailUrl when provided', () => {
    expect(getThumbnailUrl('/api/uploads/thumbs/t.jpg', '/api/uploads/full/f.jpg'))
      .toBe('https://api.rawsurf.com/api/uploads/thumbs/t.jpg');
  });

  test('falls back to fullUrl when thumbnailUrl is null', () => {
    expect(getThumbnailUrl(null, '/api/uploads/full/f.jpg'))
      .toBe('https://api.rawsurf.com/api/uploads/full/f.jpg');
  });

  test('returns null when both are null', () => {
    expect(getThumbnailUrl(null, null)).toBeNull();
  });
});

describe('getVideoPoster()', () => {
  test('prefers thumbnail_url from post object', () => {
    const post = { thumbnail_url: '/api/uploads/thumb.jpg', media_url: '/api/uploads/video.mp4' };
    expect(getVideoPoster(post)).toBe('https://api.rawsurf.com/api/uploads/thumb.jpg');
  });

  test('falls back to media_url when no thumbnail', () => {
    const post = { thumbnail_url: null, media_url: '/api/uploads/video.mp4' };
    expect(getVideoPoster(post)).toBe('https://api.rawsurf.com/api/uploads/video.mp4');
  });

  test('handles null post gracefully', () => {
    expect(getVideoPoster(null)).toBeUndefined();
  });
});
