/**
 * LastUpdatedBanner GÇö Thin status banner for cached / stale data.
 *
 * Shows when:
 *  - Device is offline
 *  - Data is stale (> staleThresholdMs, default 2 min)
 *
 * Provides a "tap to refresh" action.
 */
import React, { useMemo } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';

const formatElapsed = (ms) => {
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} min${mins !== 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hr${hrs !== 1 ? 's' : ''} ago`;
};

const LastUpdatedBanner = ({
  lastUpdatedAt,
  isOnline = true,
  onRefresh,
  staleThresholdMs = 120_000, // 2 minutes
  className = '',
}) => {
  const elapsed = useMemo(() => {
    if (!lastUpdatedAt) return null;
    return Date.now() - new Date(lastUpdatedAt).getTime();
  }, [lastUpdatedAt]);

  // Determine if we should show the banner
  const isOffline = !isOnline;
  const isStale = elapsed != null && elapsed > staleThresholdMs;

  if (!isOffline && !isStale) return null;

  return (
    <button
      onClick={onRefresh}
      className={`
        w-full flex items-center justify-center gap-2 px-3 py-1.5
        text-xs font-medium transition-colors
        ${isOffline
          ? 'bg-red-500/10 text-red-400 border-b border-red-500/20'
          : 'bg-yellow-500/10 text-yellow-400 border-b border-yellow-500/20'
        }
        hover:opacity-80 active:scale-[0.995]
        ${className}
      `}
      data-testid="last-updated-banner"
    >
      {isOffline ? (
        <WifiOff className="w-3.5 h-3.5 shrink-0" />
      ) : (
        <RefreshCw className="w-3.5 h-3.5 shrink-0" />
      )}
      <span>
        {isOffline
          ? `You're offline -+ Showing cached data${elapsed != null ? ` from ${formatElapsed(elapsed)}` : ''}`
          : `Last updated ${formatElapsed(elapsed)} -+ Tap to refresh`
        }
      </span>
    </button>
  );
};

export default LastUpdatedBanner;
