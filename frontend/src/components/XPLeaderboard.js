import React, { useState, useEffect } from 'react';
import { Trophy, Medal, Crown, Star, ChevronRight, Users, Camera, Waves } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * XP Leaderboard Component
 * Shows top XP earners in the community
 */
export const XPLeaderboard = ({ compact = false, limit = 10 }) => {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('all'); // 'week', 'month', 'all'
  const [category, setCategory] = useState('all'); // 'all', 'patrons', 'workhorses'

  const isLight = theme === 'light';
  const cardBg = isLight ? 'bg-white border-gray-200' : 'bg-card border-border';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';

  useEffect(() => {
    fetchLeaderboard();
  }, [timeRange, category, limit]);

  const fetchLeaderboard = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/gamification/leaderboard`, {
        params: { time_range: timeRange, category, limit }
      });
      setLeaderboard(response.data.leaderboard || []);
    } catch (error) {
      logger.error('Failed to fetch leaderboard:', error);
      // Use mock data if API fails
      setLeaderboard(getMockLeaderboard());
    } finally {
      setLoading(false);
    }
  };

  // Mock data for development/fallback
  const getMockLeaderboard = () => [
    { id: '1', name: 'Kelly Waters', avatar: null, xp: 2450, rank: 1, badge: 'the_patron', badge_tier: 'gold' },
    { id: '2', name: 'Sarah Waves', avatar: null, xp: 1890, rank: 2, badge: 'the_workhorse', badge_tier: 'silver' },
    { id: '3', name: 'Mike Shooter', avatar: null, xp: 1560, rank: 3, badge: 'the_patron', badge_tier: 'silver' },
    { id: '4', name: 'Lisa Surf', avatar: null, xp: 1230, rank: 4, badge: null, badge_tier: null },
    { id: '5', name: 'Tom Tube', avatar: null, xp: 980, rank: 5, badge: null, badge_tier: null },
  ];

  const getRankIcon = (rank) => {
    switch (rank) {
      case 1:
        return <Crown className="w-6 h-6 text-yellow-400" />;
      case 2:
        return <Medal className="w-5 h-5 text-gray-300" />;
      case 3:
        return <Medal className="w-5 h-5 text-amber-600" />;
      default:
        return <span className={`w-6 text-center font-bold ${textSecondary}`}>#{rank}</span>;
    }
  };

  const getRankBg = (rank) => {
    switch (rank) {
      case 1:
        return 'bg-gradient-to-r from-yellow-500/20 to-amber-500/20 border-yellow-500/30';
      case 2:
        return 'bg-gradient-to-r from-gray-400/20 to-gray-500/20 border-gray-400/30';
      case 3:
        return 'bg-gradient-to-r from-amber-600/20 to-orange-600/20 border-amber-600/30';
      default:
        return isLight ? 'bg-gray-50' : 'bg-zinc-800/50';
    }
  };

  const getBadgeInfo = (badge, _tier) => {
    const badges = {
      'the_patron': { label: 'Patron', icon: Users, color: 'cyan' },
      'the_workhorse': { label: 'Workhorse', icon: Camera, color: 'orange' },
      'the_benefactor': { label: 'Benefactor', icon: Star, color: 'emerald' },
      'sharpshooter': { label: 'Sharpshooter', icon: Waves, color: 'blue' }
    };
    return badges[badge] || null;
  };

  if (compact) {
    // Compact view for sidebar or widget
    return (
      <Card className={cardBg}>
        <CardHeader className="pb-2">
          <CardTitle className={`${textPrimary} text-sm flex items-center gap-2`}>
            <Trophy className="w-4 h-4 text-yellow-400" />
            Top Earners
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2">
            {(loading ? Array(3).fill({}) : leaderboard.slice(0, 3)).map((user, index) => (
              <div key={user.id || index} className="flex items-center gap-2">
                {getRankIcon(index + 1)}
                <Avatar className="w-6 h-6">
                  <AvatarImage src={user.avatar} />
                  <AvatarFallback className="text-xs bg-zinc-700 text-cyan-400">
                    {user.name?.charAt(0) || '?'}
                  </AvatarFallback>
                </Avatar>
                <span className={`text-sm flex-1 truncate ${textPrimary}`}>
                  {user.name || 'Loading...'}
                </span>
                <span className="text-xs text-cyan-400 font-bold">{user.xp || 0} XP</span>
              </div>
            ))}
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full mt-2 text-cyan-400"
            onClick={() => navigate('/leaderboard')}
          >
            View All <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Full leaderboard view
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className={`text-2xl font-bold ${textPrimary} flex items-center gap-2`}>
          <Trophy className="w-7 h-7 text-yellow-400" />
          XP Leaderboard
        </h2>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Time Range */}
        <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-1">
          {[
            { value: 'week', label: 'This Week' },
            { value: 'month', label: 'This Month' },
            { value: 'all', label: 'All Time' }
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setTimeRange(opt.value)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                timeRange === opt.value
                  ? 'bg-cyan-400 text-black'
                  : `${textSecondary} hover:text-white`
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Category */}
        <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-1">
          {[
            { value: 'all', label: 'All', icon: Trophy },
            { value: 'patrons', label: 'Patrons', icon: Users },
            { value: 'workhorses', label: 'Workhorses', icon: Camera }
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setCategory(opt.value)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ${
                category === opt.value
                  ? 'bg-cyan-400 text-black'
                  : `${textSecondary} hover:text-white`
              }`}
            >
              <opt.icon className="w-4 h-4" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Leaderboard List */}
      <div className="space-y-2">
        {(loading ? Array(limit).fill({}) : leaderboard).map((user, index) => {
          const badgeInfo = getBadgeInfo(user.badge, user.badge_tier);
          
          return (
            <div
              key={user.id || index}
              onClick={() => user.id && navigate(`/profile/${user.id}`)}
              className={`flex items-center gap-4 p-4 rounded-xl border transition-all cursor-pointer hover:scale-[1.01] ${getRankBg(user.rank || index + 1)}`}
            >
              {/* Rank */}
              <div className="w-8 flex justify-center">
                {getRankIcon(user.rank || index + 1)}
              </div>

              {/* Avatar */}
              <Avatar className="w-12 h-12 border-2 border-zinc-700">
                <AvatarImage src={user.avatar} />
                <AvatarFallback className="bg-zinc-800 text-cyan-400 text-lg">
                  {user.name?.charAt(0) || '?'}
                </AvatarFallback>
              </Avatar>

              {/* Name & Badge */}
              <div className="flex-1">
                <div className={`font-bold ${textPrimary}`}>
                  {user.name || 'Loading...'}
                </div>
                {badgeInfo && (
                  <div className={`flex items-center gap-1 text-xs text-${badgeInfo.color}-400`}>
                    <badgeInfo.icon className="w-3 h-3" />
                    {badgeInfo.label} ({user.badge_tier})
                  </div>
                )}
              </div>

              {/* XP */}
              <div className="text-right">
                <div className="text-xl font-bold text-cyan-400">
                  {user.xp?.toLocaleString() || 0}
                </div>
                <div className={`text-xs ${textSecondary}`}>XP</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {!loading && leaderboard.length === 0 && (
        <div className="text-center py-12">
          <Trophy className="w-16 h-16 mx-auto text-zinc-600 mb-4" />
          <p className={textSecondary}>No rankings yet. Be the first to earn XP!</p>
        </div>
      )}
    </div>
  );
};

export default XPLeaderboard;
