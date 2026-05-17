/**
 * useWebPSupport — Detects if the browser supports WebP format.
 * Returns true if WebP is supported, enabling components to request
 * optimized image formats from the CDN/backend.
 *
 * Usage:
 *   const supportsWebP = useWebPSupport();
 *   const imageUrl = supportsWebP ? `${url}?format=webp` : url;
 */
import { useState, useEffect } from 'react';

var cachedResult = null;

var checkWebPSupport = () => {
  return new Promise((resolve) => {
    if (cachedResult !== null) {
      resolve(cachedResult);
      return;
    }

    const img = new Image();
    img.onload = () => {
      cachedResult = img.width > 0 && img.height > 0;
      resolve(cachedResult);
    };
    img.onerror = () => {
      cachedResult = false;
      resolve(false);
    };
    // Minimal WebP test image (1x1 pixel)
    img.src = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
  });
};

var useWebPSupport = () => {
  const [supported, setSupported] = useState(cachedResult ?? false);

  useEffect(() => {
    checkWebPSupport().then(setSupported);
  }, []);

  return supported;
};

export default useWebPSupport;

/**
 * getOptimizedImageUrl — Returns an optimized image URL based on format support.
 * Can be used outside of React components.
 *
 * @param {string} url - Original image URL
 * @param {Object} options - { width, quality, format }
 * @returns {string} Optimized URL with query params
 */
export var getOptimizedImageUrl = (url, { width, quality = 80, format } = {}) => {
  if (!url) return url;
  // Don't modify data: or blob: URLs
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  
  const params = new URLSearchParams();
  if (width) params.set('w', width);
  if (quality) params.set('q', quality);
  if (format) params.set('format', format);
  
  const queryString = params.toString();
  if (!queryString) return url;
  
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${queryString}`;
};
