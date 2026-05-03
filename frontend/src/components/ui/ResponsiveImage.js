/**
 * ResponsiveImage — Image component with srcSet support for bandwidth savings.
 *
 * Automatically generates srcSet from Supabase storage URLs or serves
 * single-source images with proper loading="lazy" and decoding="async".
 *
 * Usage:
 *   <ResponsiveImage src={imageUrl} alt="Photo" sizes="(max-width: 768px) 100vw, 50vw" />
 */
import React, { useState } from 'react';
import { getFullUrl } from '../../utils/media';
import useWebPSupport from '../../hooks/useWebPSupport';

/**
 * Generate srcSet entries for Supabase transform URLs.
 * If the URL supports Supabase image transforms (?width=X), we generate multiple sizes.
 * Appends format=webp when browser supports it for ~30% bandwidth savings.
 */
function buildSrcSet(src, webpSupported) {
  if (!src) return '';
  const url = getFullUrl(src);
  // Only generate srcSet for Supabase storage URLs with transform support
  if (url.includes('supabase') && url.includes('/storage/')) {
    const widths = [320, 640, 960, 1280, 1920];
    return widths
      .map(w => {
        const separator = url.includes('?') ? '&' : '?';
        const formatParam = webpSupported ? '&format=webp' : '';
        return `${url}${separator}width=${w}${formatParam} ${w}w`;
      })
      .join(', ');
  }
  return '';
}

export const ResponsiveImage = ({
  src,
  alt = '',
  className = '',
  style = {},
  sizes = '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw',
  aspectRatio,
  fallback = null,
  onClick,
  ...props
}) => {
  const [error, setError] = useState(false);
  const webpSupported = useWebPSupport();
  const fullSrc = getFullUrl(src);
  const srcSet = buildSrcSet(src, webpSupported);

  if (error && fallback) return fallback;
  if (!src) return fallback || null;

  return (
    <img
      src={fullSrc}
      srcSet={srcSet || undefined}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      className={className}
      style={{
        ...(aspectRatio ? { aspectRatio } : {}),
        objectFit: 'cover',
        ...style
      }}
      loading="lazy"
      decoding="async"
      onError={() => setError(true)}
      onClick={onClick}
      {...props}
    />
  );
};

export default ResponsiveImage;
