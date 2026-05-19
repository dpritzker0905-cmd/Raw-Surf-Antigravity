import React from 'react';
import { Award } from 'lucide-react';

/**
 * Badge + XP display section -- shared between Swell and Crew tabs.
 * Previously duplicated as identical JSX blocks in Profile.js.
 */
export const BadgeSection = ({ gamificationStats }) => {
  if (!gamificationStats?.badges?.length && !gamificationStats?.total_xp) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-bold flex items-center gap-2">
          <Award className="w-5 h-5 text-yellow-400" />
          Badges
        </h3>
        <span className="text-sm text-gray-400">{gamificationStats.badges?.length || 0} earned</span>
      </div>

      {/* XP Bar */}
      {gamificationStats.total_xp > 0 && (
        <div className="bg-zinc-800/50 rounded-xl p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-400">Level {gamificationStats.level || 1}</span>
            <span className="text-sm text-yellow-400">{gamificationStats.total_xp} XP</span>
          </div>
          <div className="w-full h-2 bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-yellow-500 to-orange-500"
              style={{ width: `${Math.min(100, (gamificationStats.total_xp % 1000) / 10)}%` }}
            />
          </div>
        </div>
      )}

      {/* Badge Grid */}
      {gamificationStats.badges?.length > 0 && (
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
          {gamificationStats.badges.map((badge, idx) => (
            <div
              key={badge.id || idx}
              className="flex flex-col items-center p-2 rounded-xl bg-zinc-800/50 hover:bg-zinc-700/50 transition-colors"
              title={badge.description}
            >
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center mb-1">
 {badge.icon_emoji || '='}
              </div>
              <span className="text-[10px] text-gray-400 text-center truncate w-full">{badge.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Divider */}
      <div className="border-t border-zinc-800 pt-3" />
    </div>
  );
};
