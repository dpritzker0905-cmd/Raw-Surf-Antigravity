import React, { useState, useCallback } from 'react';

/**
 * AvatarImage — A robust avatar <img> wrapper with automatic broken-image fallback.
 *
 * Usage:
 *   <AvatarImage src={user.avatar_url} alt={user.name} className="w-10 h-10 rounded-full" />
 *
 * When the image fails to load, it displays the user's initial (from `alt`)
 * inside a gradient circle, preventing the broken-image icon.
 */
const AvatarImage = ({
  src,
  alt = '',
  className = '',
  fallbackClassName = '',
  size,
  ...rest
}) => {
  const [hasError, setHasError] = useState(false);

  const handleError = useCallback(() => {
    setHasError(true);
  }, []);

  // Extract initials from alt text
  const initial = alt?.charAt(0)?.toUpperCase() || '?';

  // If no src or load failed, show fallback
  if (!src || hasError) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-violet-500 to-cyan-500 text-white font-bold select-none ${className} ${fallbackClassName}`}
        style={size ? { width: size, height: size } : undefined}
        title={alt}
        role="img"
        aria-label={alt}
      >
        <span style={{ fontSize: size ? `${size * 0.4}px` : undefined }}>
          {initial}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={handleError}
      loading="lazy"
      {...rest}
    />
  );
};

export default AvatarImage;
