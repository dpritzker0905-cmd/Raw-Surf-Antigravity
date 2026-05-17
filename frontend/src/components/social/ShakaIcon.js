/**
 * ShakaIcon.js - Shared shaka/hang-loose reaction icon.
 * Used by PostCard, PostModal, Feed, and MessagesPage.
 * Extracted from PostCard.js to reduce God component sizes.
 */
import React from 'react';

var ShakaIcon = ({ filled, size = 28 }) => (
  <img loading="lazy" decoding="async"
    src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f919.svg"
    alt="shaka"
    style={{
      width: `${size}px`,
      height: `${size}px`,
      filter: filled ? 'none' : 'grayscale(100%) brightness(1.5)',
      transition: 'filter 0.2s ease, transform 0.2s ease'
    }}
    draggable="false"
  />
);

export default ShakaIcon;
