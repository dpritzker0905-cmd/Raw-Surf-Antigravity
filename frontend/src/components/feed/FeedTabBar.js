/**
 * FeedTabBar G Extracted from Feed.js (v103)
 * Three-tab strip (For You / Waves / Following) with sliding gradient indicator.
 */
import React from 'react';
import { Play } from 'lucide-react';

const FEED_TABS = ['for_you', 'waves', 'following'];

const FeedTabBar = ({ activeTab, setActiveTab, textPrimaryClass, textSecondaryClass, borderClass }) => {
  const activeTabIndex = FEED_TABS.indexOf(activeTab);

  return (
    <div className={`relative flex border-b ${borderClass}`}>
      <button
        onClick={() => setActiveTab('for_you')}
        className={`flex-1 py-3 text-sm font-medium transition-colors ${
          activeTab === 'for_you' ? textPrimaryClass : textSecondaryClass
        }`}
        data-testid="tab-for-you"
        aria-label="For You feed tab"
      >
        For You
      </button>
      <button aria-label="Play"
        onClick={() => setActiveTab('waves')}
        className={`flex-1 py-3 text-sm font-medium transition-colors ${
          activeTab === 'waves' ? textPrimaryClass : textSecondaryClass
        }`}
        data-testid="tab-waves"
        aria-label="Waves video tab"
      >
        <span className="flex items-center justify-center gap-1">
          <Play className="w-3.5 h-3.5" />
          Waves
        </span>
      </button>
      <button
        onClick={() => setActiveTab('following')}
        className={`flex-1 py-3 text-sm font-medium transition-colors ${
          activeTab === 'following' ? textPrimaryClass : textSecondaryClass
        }`}
        data-testid="tab-following"
        aria-label="Following feed tab"
      >
        Following
      </button>
      {/* Sliding indicator - transitions smoothly between tabs */}
      <div
        className="absolute bottom-0 h-0.5 rounded-full transition-all duration-300 ease-out"
        style={{
          width: `${100 / FEED_TABS.length}%`,
          left: `${(activeTabIndex * 100) / FEED_TABS.length}%`,
          background: activeTab === 'waves'
            ? 'linear-gradient(to right, #22d3ee, #3b82f6)'
            : 'linear-gradient(to right, #facc15, #f97316)',
        }}
      />
    </div>
  );
};

export default FeedTabBar;
