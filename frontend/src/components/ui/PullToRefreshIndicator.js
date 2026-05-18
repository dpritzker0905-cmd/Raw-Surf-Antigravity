/**
 * PullToRefreshIndicator G Visual indicator for pull-to-refresh gesture.
 *
 * Usage:
 *   <PullToRefreshIndicator isPulling={isPulling} progress={pullProgress} isRefreshing={isRefreshing} />
 */
import React from 'react';

export const PullToRefreshIndicator = ({ isPulling, progress, isRefreshing }) => {
  if (!isPulling && !isRefreshing) return null;

  const rotation = progress * 360;
  const opacity = Math.min(progress * 1.5, 1);
  const translateY = isRefreshing ? 40 : progress * 50;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: '50%',
        transform: `translateX(-50%) translateY(${translateY}px)`,
        zIndex: 50,
        opacity,
        transition: isRefreshing ? 'none' : 'transform 0.1s ease-out',
        pointerEvents: 'none'
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'rgba(6, 182, 212, 0.15)',
          border: '2px solid rgba(6, 182, 212, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(8px)',
          animation: isRefreshing ? 'spin 0.8s linear infinite' : 'none',
          transform: isRefreshing ? 'none' : `rotate(${rotation}deg)`
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#06b6d4"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          <polyline points="21 3 21 12 12 12" />
        </svg>
      </div>
    </div>
  );
};

export default PullToRefreshIndicator;
