/**
 * FeedEmptyState GÇö Extracted from Feed.js (v103)
 * Per-tab empty state illustrations (For You / Waves / Following).
 */
import React from 'react';
import { Users, Play, Sparkles } from 'lucide-react';

const FeedEmptyState = ({ activeTab, textPrimaryClass, textSecondaryClass, onNavigateExplore }) => {
  if (activeTab === 'following') {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-6">
        <Users className={`w-12 h-12 mb-3 ${textSecondaryClass} opacity-40`} />
        <p className={`font-semibold text-lg mb-1 ${textPrimaryClass}`}>Your feed is empty</p>
        <p className={`text-sm mb-5 ${textSecondaryClass}`}>Follow photographers and surfers to see their latest posts here.</p>
        <button
          onClick={onNavigateExplore}
          className="px-6 py-2.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 text-white text-sm font-semibold shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all active:scale-95"
          aria-label="Discover photographers to follow"
        >
          Discover Photographers
        </button>
      </div>
    );
  }

  if (activeTab === 'waves') {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-6">
        <Play className={`w-12 h-12 mb-3 ${textSecondaryClass} opacity-40`} />
        <p className={`font-semibold text-lg mb-1 ${textPrimaryClass}`}>No waves yet</p>
        <p className={`text-sm ${textSecondaryClass}`}>Short video clips from the surf community will appear here.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-6">
      <Sparkles className={`w-12 h-12 mb-3 ${textSecondaryClass} opacity-40`} />
      <p className={`font-semibold text-lg mb-1 ${textPrimaryClass}`}>No posts yet</p>
      <p className={`text-sm ${textSecondaryClass}`}>Be the first to share a moment from the water!</p>
    </div>
  );
};

export default FeedEmptyState;
