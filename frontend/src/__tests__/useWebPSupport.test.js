/**
 * useWebPSupport.test.js — Unit tests for WebP detection hook.
 */
import { renderHook, act } from '@testing-library/react';
import useWebPSupport from '../../hooks/useWebPSupport';
import { getOptimizedImageUrl } from '../../hooks/useWebPSupport';

describe('useWebPSupport', () => {
  it('returns a boolean value', () => {
    const { result } = renderHook(() => useWebPSupport());
    expect(typeof result.current).toBe('boolean');
  });
});

describe('getOptimizedImageUrl', () => {
  it('returns null/undefined for empty inputs', () => {
    expect(getOptimizedImageUrl(null)).toBeNull();
    expect(getOptimizedImageUrl(undefined)).toBeUndefined();
    expect(getOptimizedImageUrl('')).toBe('');
  });

  it('does not modify data: URLs', () => {
    const dataUrl = 'data:image/png;base64,iVBOR...';
    expect(getOptimizedImageUrl(dataUrl, { width: 100 })).toBe(dataUrl);
  });

  it('does not modify blob: URLs', () => {
    const blobUrl = 'blob:http://localhost/abc';
    expect(getOptimizedImageUrl(blobUrl, { width: 100 })).toBe(blobUrl);
  });

  it('appends width and quality params', () => {
    const url = 'https://example.com/image.jpg';
    const result = getOptimizedImageUrl(url, { width: 640, quality: 80 });
    expect(result).toContain('w=640');
    expect(result).toContain('q=80');
  });

  it('appends format param when specified', () => {
    const url = 'https://example.com/image.jpg';
    const result = getOptimizedImageUrl(url, { format: 'webp' });
    expect(result).toContain('format=webp');
  });

  it('uses & separator for URLs with existing query params', () => {
    const url = 'https://example.com/image.jpg?token=abc';
    const result = getOptimizedImageUrl(url, { width: 320 });
    expect(result).toContain('&w=320');
    expect(result).not.toContain('?w=320');
  });
});
