/**
 * FeedActionBar G Extracted from Feed.js (v103)
 * Check-in button, streak counter, and create-post FAB.
 */
import React from 'react';
import { MapPin, Flame, Plus, Check } from 'lucide-react';

const FeedActionBar = ({
  streak,
  isLight,
  borderClass,
  onCheckIn,
  onCreatePost,
}) => {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b ${borderClass}`}>
      <button
        onClick={onCheckIn}
        disabled={streak.checked_in_today}
        className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm transition-colors ${
          streak.checked_in_today
            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
            : isLight ? 'bg-gray-100 hover:bg-gray-200 text-gray-800' : 'bg-zinc-800 hover:bg-zinc-700 text-white'
        }`}
        data-testid="check-in-btn"
      >
        {streak.checked_in_today ? (
          <Check className="w-4 h-4" />
        ) : (
          <MapPin className="w-4 h-4" />
        )}
        {streak.checked_in_today ? 'Checked In' : 'Check In'}
      </button>

      <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500/20 to-red-500/20 border border-orange-500/30 rounded-full">
        <Flame className="w-4 h-4 text-orange-400" />
        <span className="text-sm text-orange-400 font-medium">
          {streak.current_streak} day{streak.current_streak !== 1 ? 's' : ''}
        </span>
      </div>

      <button aria-label="Add"
        onClick={onCreatePost}
        className="ml-auto flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 rounded-full text-sm text-black font-medium transition-colors"
        data-testid="create-post-btn"
      >
        <Plus className="w-4 h-4" />
        Post
      </button>
    </div>
  );
};

export default FeedActionBar;
