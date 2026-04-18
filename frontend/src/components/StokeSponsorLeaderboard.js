import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { 

  Heart, Trophy, Medal, Loader2, 
  Baby, Crown, ChevronRight
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import logger from '../utils/logger';

const getFullUrl = (url) => {
  if (!url) return url;
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('http')) return url;
  return `\\`;
};



/**
 * Stoke Sponsor Leaderboard - Top photographers supporting surfers
 * Shows rankings, total contributions, and grom support percentages
 */
export const StokeSponsorLeaderboard = ({ compact = false }) => {
  const { theme } = useTheme();
  const navigate = useNavigate();
  
  const [leaderboard, setLeaderboard] = useState([]);
  const [stats, setStats] = useState({ total_contributed: 0, total_to_groms: 0, total_sponsors: 0 });
  const [timeRange, setTimeRange] = useState('all');
  const [loading, setLoading] = useState(true);

  const isLight = theme === 'light';
  const cardBg = isLight ? 'bg-white border-gray-200' : 'bg-card border-border';
  const textPrimary = isLight ? 'text-gray-900' : 'text-foreground';
  const textSecondary = isLight ? 'text-gray-600' : 'text-muted-foreground';

  useEffect(() => {
    fetchLeaderboard();
  }, [timeRange]);

  const fetchLeaderboard = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`/career/stoke-sponsor/leaderboard?time_range=${timeRange}`);
      setLeaderboard(res.data?.leaderboard || []);
      setStats(res.data?.stats || { total_contributed: 0, total_to_groms: 0, total_sponsors: 0 });
    } catch (error) {
      logger.error('Failed to fetch stoke leaderboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const getRankDisplay = (rank) => {
    if (rank === 1) return <Crown className="w-6 h-6 text-yellow-400" />;
    if (rank === 2) return <Medal className="w-6 h-6 text-gray-300" />;
    if (rank === 3) return <Medal className="w-6 h-6 text-amber-600" />;
    return <span className={`text-lg font-bold ${textSecondary}`}>#{rank}</span>;
  };

  const getRankBg = (rank) => {
    if (rank === 1) return 'bg-gradient-to-r from-yellow-500/20 to-amber-500/20 border-yellow-500/40';
    if (rank === 2) return 'bg-gradient-to-r from-gray-400/10 to-gray-500/10 border-gray-400/30';
    if (rank === 3) return 'bg-gradient-to-r from-amber-600/10 to-orange-600/10 border-amber-600/30';
    return 'bg-zinc-800/50';
  };

  // Compact mode for embedding
  if (compact) {
    return (
      <Card className={`${cardBg} border-2 border-pink-500/30`}>
        <CardHeader className="pb-2">
          <CardTitle className={`${textPrimary} flex items-center gap-2 text-base`}>
            <Heart className="w-5 h-5 text-pink-400" />
            Stoke Sponsors
            <Badge className="ml-auto bg-pink-500/20 text-pink-400 border-0 text-xs">TOP</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-6 h-6 text-pink-400 animate-spin" />
            </div>
          ) : leaderboard.length > 0 ? (
            <>
              {leaderboard.slice(0, 3).map((sponsor) => (
                <div 
                  key={sponsor.photographer_id}
                  className={`flex items-center gap-2 p-2 rounded-lg border ${getRankBg(sponsor.rank)}`}
                >
                  <div className="w-8 flex justify-center">
                    {getRankDisplay(sponsor.rank)}
                  </div>
                  <Avatar 
                    className="w-8 h-8 cursor-pointer"
                    onClick={() => navigate(`/profile/${sponsor.photographer_id}`)}
                  >
                    <AvatarImage src={getFullUrl(sponsor.avatar_url)} />
                    <AvatarFallback className="bg-pink-500/20 text-pink-400 text-xs">
                      {sponsor.full_name?.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium ${textPrimary} text-sm truncate`}>{sponsor.full_name}</div>
                  </div>
                  <div className="text-pink-400 font-bold text-sm">${sponsor.total_contributed.toFixed(0)}</div>
                </div>
              ))}
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full text-pink-400 hover:bg-pink-500/10"
                onClick={() => navigate('/career/stoke-leaderboard')}
              >
                View Full Leaderboard <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </>
          ) : (
            <p className={`text-center ${textSecondary} py-4 text-sm`}>
              No stoke sponsors yet. Be the first!
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // Full page mode
  return (
    <div 
      className="space-y-6 pb-24 md:pb-6" 
      data-testid="stoke-sponsor-leaderboard"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)' }}
    >
      {/* Header */}
      <div className="text-center">
        <h1 className={`text-3xl font-bold ${textPrimary} flex items-center justify-center gap-2`} style={{ fontFamily: 'Oswald' }}>
          <Heart className="w-8 h-8 text-pink-400" />
          Stoke Sponsor Leaderboard
        </h1>
        <p className={`${textSecondary} mt-1`}>Photographers who give back to the surf community</p>
      </div>

      {/* Community Stats */}
      <Card className={`${cardBg} border-2 border-pink-500/30 bg-gradient-to-br from-pink-500/5 to-red-500/5`}>
        <CardContent className="pt-6">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-pink-400">${stats.total_contributed.toFixed(0)}</div>
              <div className={`text-xs ${textSecondary}`}>Total Given</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-cyan-400">${stats.total_to_groms.toFixed(0)}</div>
              <div className={`text-xs ${textSecondary}`}>To Groms</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-400">{stats.total_sponsors}</div>
              <div className={`text-xs ${textSecondary}`}>Sponsors</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Time Range Filter */}
      <div className="flex justify-center gap-2">
        <Button
          variant={timeRange === 'week' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTimeRange('week')}
          className={timeRange === 'week' ? 'bg-pink-500 text-white' : 'border-zinc-700'}
        >
          This Week
        </Button>
        <Button
          variant={timeRange === 'month' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTimeRange('month')}
          className={timeRange === 'month' ? 'bg-pink-500 text-white' : 'border-zinc-700'}
        >
          This Month
        </Button>
        <Button
          variant={timeRange === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTimeRange('all')}
          className={timeRange === 'all' ? 'bg-pink-500 text-white' : 'border-zinc-700'}
        >
          All Time
        </Button>
      </div>

      {/* Leaderboard */}
      <Card className={cardBg}>
        <CardHeader>
          <CardTitle className={`${textPrimary} flex items-center gap-2`}>
            <Trophy className="w-5 h-5 text-yellow-400" />
            Top Stoke Sponsors
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-8 h-8 text-pink-400 animate-spin" />
            </div>
          ) : leaderboard.length > 0 ? (
            leaderboard.map((sponsor) => (
              <div 
                key={sponsor.photographer_id}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-all hover:scale-[1.01] ${getRankBg(sponsor.rank)}`}
              >
                <div className="w-10 flex justify-center">
                  {getRankDisplay(sponsor.rank)}
                </div>
                <Avatar 
                  className="w-12 h-12 border-2 border-pink-500/30 cursor-pointer"
                  onClick={() => navigate(`/profile/${sponsor.photographer_id}`)}
                >
                  <AvatarImage src={getFullUrl(sponsor.avatar_url)} />
                  <AvatarFallback className="bg-pink-500/20 text-pink-400">
                    {sponsor.full_name?.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className={`font-medium ${textPrimary}`}>{sponsor.full_name}</div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className={`text-xs ${textSecondary}`}>
                      {sponsor.contribution_count} contributions
                    </span>
                    {sponsor.grom_percentage > 0 && (
                      <Badge className="bg-cyan-500/20 text-cyan-400 border-0 text-xs">
                        <Baby className="w-3 h-3 mr-1" />
                        {sponsor.grom_percentage}% to groms
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-pink-400">${sponsor.total_contributed.toFixed(0)}</div>
                  <div className={`text-xs ${textSecondary}`}>contributed</div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8">
              <Heart className="w-12 h-12 text-pink-400/30 mx-auto mb-3" />
              <p className={`${textSecondary}`}>No stoke sponsors yet</p>
              <p className={`text-sm ${textSecondary}`}>Be the first to support the surf community!</p>
              <Button 
                className="mt-4 bg-pink-500 text-white hover:bg-pink-400"
                onClick={() => navigate('/career/stoke-sponsor')}
              >
                <Heart className="w-4 h-4 mr-2" />
                Become a Stoke Sponsor
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default StokeSponsorLeaderboard;
