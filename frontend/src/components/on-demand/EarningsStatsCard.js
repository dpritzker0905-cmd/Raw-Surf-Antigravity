/**
 * EarningsStatsCard Daily earnings summary with streak tracking.
 * 
 * Extracted from OnDemandSessionManager.js for maintainability.
 */
import React from 'react';
import { Wallet, Flame } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
const EarningsStatsCard = ({ stats, cardBg, textPrimary, textSecondary, _sectionBg, borderClass }) => {
  const hasStreak = (stats.streak || 0) >= 3;
  
  return (
    <Card className={cardBg} data-testid="earnings-stats-card">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className={`font-bold text-lg ${textPrimary} flex items-center gap-2`}>
            <Wallet className="w-5 h-5 text-green-400" />
            Today's Earnings
          </h3>
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            {stats.sessions_today || 0} sessions
          </Badge>
        </div>
        
        <div className="text-center py-6">
          <p className="text-5xl font-bold text-green-400">${(stats.earnings_today || 0).toFixed(2)}</p>
          <p className={`text-sm ${textSecondary} mt-2`}>Net earnings after fees</p>
        </div>
        
        <div className={`grid grid-cols-3 gap-3 pt-4 border-t ${borderClass}`}>
          <div className="text-center">
            <p className={`text-xl font-bold ${textPrimary}`}>{stats.sessions_week || 0}</p>
            <p className={`text-xs ${textSecondary}`}>This Week</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-amber-400">{stats.streak || 0}</p>
            <p className={`text-xs ${textSecondary}`}>Day Streak</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-purple-400">{stats.total_sessions || 0}</p>
            <p className={`text-xs ${textSecondary}`}>All Time</p>
          </div>
        </div>
        
        {/* Streak Bonus Indicator */}
        {hasStreak && (
          <div className={`mt-4 p-4 rounded-xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-400/30`}>
            <div className="flex items-center gap-3">
              <Flame className="w-6 h-6 text-amber-400" />
              <div>
                <p className="text-amber-400 font-bold">Hot Streak Active!</p>
                <p className={`text-sm ${textSecondary}`}>2x XP on all sessions</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default EarningsStatsCard;

