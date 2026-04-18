/**
 * CrewLeaderboard - Displays crew statistics, badges, and rankings
 * Shows on Profile page, "Stoked" section, and "The Inside" for competitive surfers
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  Trophy, Users, Flame, DollarSign,
  Medal, Crown, Star, TrendingUp, ChevronRight,
  Eye, EyeOff, Lock
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { toast } from 'sonner';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import logger from '../utils/logger';

const API = process.env.REACT_APP_BACKEND_URL;

// Badge icon mapping
const BADGE_ICONS = {
  frequent_flyers: '✈️',
  dawn_patrol: '🌅',
  sunset_crew: '🌇',
  weekend_warriors: '🏄',
  squad_goals: '👥',
  dynamic_duo: '🤝',
  wolf_pack: '🐺',
  ride_or_die: '💯',
  variety_pack: '🎭',
  local_legends: '📍',
  smart_splitters: '💰',
  budget_bosses: '👑'
};

const TIER_COLORS = {
  1: 'from-amber-600 to-amber-700',   // Bronze
  2: 'from-gray-300 to-gray-400',      // Silver
  3: 'from-yellow-400 to-yellow-500'   // Gold
};

const TIER_NAMES = ['Bronze', 'Silver', 'Gold'];

/**
 * Badge Display Component
 */
const BadgeCard = ({ badge, size = 'md' }) => {
  const sizeClasses = {
    sm: 'w-12 h-12 text-xl',
    md: 'w-16 h-16 text-2xl',
    lg: 'w-20 h-20 text-3xl'
  };
  
  const tierColor = TIER_COLORS[badge.tier] || TIER_COLORS[1];
  
  return (
    <div className="flex flex-col items-center">
      <div className={`${sizeClasses[size]} rounded-full bg-gradient-to-br ${tierColor} flex items-center justify-center shadow-lg`}>
        <span>{BADGE_ICONS[badge.badge_type] || '🏆'}</span>
      </div>
      <p className="text-xs font-medium mt-1 text-center">{badge.badge_name}</p>
      <Badge variant="outline" className="text-xs mt-0.5">
        {TIER_NAMES[badge.tier - 1] || 'Bronze'}
      </Badge>
    </div>
  );
};

/**
 * Crew Card Component
 */
const CrewCard = ({ crew, onClick, isLight }) => {
  const cardBg = isLight ? 'bg-white' : 'bg-zinc-800/50';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  
  return (
    <Card 
      className={`${cardBg} cursor-pointer hover:ring-2 ring-cyan-500/50 transition-all`}
      onClick={onClick}
      data-testid={`crew-card-${crew.crew_hash || crew.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {/* Member Avatars Stack */}
            <div className="flex -space-x-2">
              {crew.members?.slice(0, 4).map((member, idx) => (
                <div 
                  key={member.user_id} 
                  className="w-8 h-8 rounded-full border-2 border-black bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center overflow-hidden"
                  style={{ zIndex: 4 - idx }}
                >
                  {member.avatar_url ? (
                    <img src={member.avatar_url} alt={member.full_name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white text-xs font-bold">
                      {member.full_name?.charAt(0) || '?'}
                    </span>
                  )}
                </div>
              ))}
              {crew.members?.length > 4 && (
                <div className="w-8 h-8 rounded-full border-2 border-black bg-zinc-700 flex items-center justify-center text-xs text-gray-300">
                  +{crew.members.length - 4}
                </div>
              )}
            </div>
            <div>
              <p className={`font-medium ${textPrimary}`}>{crew.name || 'Unnamed Crew'}</p>
              <p className={`text-xs ${textSecondary}`}>
                {crew.crew_size || crew.members?.length || 0} surfers
              </p>
            </div>
          </div>
          
          {!crew.is_public && (
            <Lock className="w-4 h-4 text-gray-500" />
          )}
        </div>
        
        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="text-center">
            <p className="text-lg font-bold text-cyan-400">{crew.total_sessions || 0}</p>
            <p className={`text-xs ${textSecondary}`}>Sessions</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-green-400">${(crew.total_money_saved || 0).toFixed(0)}</p>
            <p className={`text-xs ${textSecondary}`}>Saved</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-yellow-400">{crew.badges_count || 0}</p>
            <p className={`text-xs ${textSecondary}`}>Badges</p>
          </div>
        </div>
        
        <ChevronRight className={`w-4 h-4 ${textSecondary} ml-auto`} />
      </CardContent>
    </Card>
  );
};

/**
 * Leaderboard Entry Component
 */
const LeaderboardEntry = ({ entry, isLight }) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  
  const rankColors = {
    1: 'text-yellow-400',
    2: 'text-gray-300',
    3: 'text-amber-600'
  };
  
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
      {/* Rank */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
        entry.rank <= 3 
          ? `${rankColors[entry.rank]} bg-zinc-900` 
          : `${textSecondary} bg-zinc-800`
      }`}>
        {entry.rank <= 3 ? (
          <Trophy className="w-4 h-4" />
        ) : (
          entry.rank
        )}
      </div>
      
      {/* Crew Info */}
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1">
            {entry.members?.slice(0, 3).map((m, _idx) => (
              <div 
                key={m.user_id}
                className="w-6 h-6 rounded-full border border-black bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center overflow-hidden"
              >
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-white text-xs">{m.full_name?.charAt(0)}</span>
                )}
              </div>
            ))}
          </div>
          <p className={`font-medium ${textPrimary} text-sm`}>{entry.crew_name || 'Crew'}</p>
        </div>
      </div>
      
      {/* Metric Value */}
      <div className="text-right">
        <p className="font-bold text-cyan-400">
          {entry.metric_name?.includes('money') || entry.metric_name?.includes('saved') 
            ? `$${entry.metric_value?.toFixed(0)}` 
            : entry.metric_value}
        </p>
        <p className={`text-xs ${textSecondary}`}>{entry.metric_name}</p>
      </div>
    </div>
  );
};

/**
 * Main Crew Leaderboard Component
 */
export const CrewLeaderboard = ({ 
  userId, 
  variant = 'full',  // 'full', 'compact', 'profile'
  showPrivacyControls = false
}) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  
  const [activeTab, setActiveTab] = useState('my-crews');
  const [leaderboardMetric, setLeaderboardMetric] = useState('total_sessions');
  const [userSummary, setUserSummary] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCrew, setSelectedCrew] = useState(null);
  const [showCrewDetail, setShowCrewDetail] = useState(false);
  
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const cardBg = isLight ? 'bg-white' : 'bg-zinc-900';
  
  const targetUserId = userId || user?.id;
  
  useEffect(() => {
    if (targetUserId) {
      fetchData();
    }
  }, [targetUserId, leaderboardMetric]);
  
  const fetchData = async () => {
    setLoading(true);
    try {
      const [summaryRes, leaderboardRes] = await Promise.all([
        apiClient.get(`/api/users/${targetUserId}/crew-summary`),
        apiClient.get(`/api/crew/leaderboard?metric=${leaderboardMetric}&limit=20`)
      ]);
      
      setUserSummary(summaryRes.data);
      setLeaderboard(leaderboardRes.data.leaderboard || []);
    } catch (error) {
      logger.error('Failed to fetch crew data:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleCrewClick = async (crew) => {
    try {
      const res = await apiClient.get(`/api/crew/stats/${crew.crew_hash}?user_id=${targetUserId}`);
      setSelectedCrew(res.data);
      setShowCrewDetail(true);
    } catch (error) {
      if (error.response?.status === 403) {
        toast.error("This crew's stats are private");
      } else {
        toast.error("Failed to load crew details");
      }
    }
  };
  
  const handlePrivacyToggle = async (crewHash, isPublic) => {
    try {
      await apiClient.put(`/api/crew/${crewHash}/settings?user_id=${targetUserId}`, {
        is_public: isPublic
      });
      toast.success(`Crew is now ${isPublic ? 'public' : 'private'}`);
      fetchData();
    } catch (error) {
      toast.error('Failed to update privacy');
    }
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
      </div>
    );
  }
  
  // Compact variant for embedding in other components
  if (variant === 'compact') {
    return (
      <div className="space-y-3">
        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} text-center`}>
            <Users className="w-5 h-5 mx-auto mb-1 text-cyan-400" />
            <p className="text-lg font-bold text-cyan-400">{userSummary?.total_crew_sessions || 0}</p>
            <p className={`text-xs ${textSecondary}`}>Crew Sessions</p>
          </div>
          <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} text-center`}>
            <DollarSign className="w-5 h-5 mx-auto mb-1 text-green-400" />
            <p className="text-lg font-bold text-green-400">${(userSummary?.total_saved_via_splits || 0).toFixed(0)}</p>
            <p className={`text-xs ${textSecondary}`}>Saved</p>
          </div>
          <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} text-center`}>
            <Medal className="w-5 h-5 mx-auto mb-1 text-yellow-400" />
            <p className="text-lg font-bold text-yellow-400">{userSummary?.badges?.length || 0}</p>
            <p className={`text-xs ${textSecondary}`}>Badges</p>
          </div>
        </div>
        
        {/* Badges Preview */}
        {userSummary?.badges?.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-center">
            {userSummary.badges.slice(0, 4).map((badge, idx) => (
              <BadgeCard key={idx} badge={badge} size="sm" />
            ))}
          </div>
        )}
      </div>
    );
  }
  
  // Profile variant - slightly more detail
  if (variant === 'profile') {
    return (
      <Card className={cardBg}>
        <CardHeader className="pb-2">
          <CardTitle className={`text-lg flex items-center gap-2 ${textPrimary}`}>
            <Users className="w-5 h-5 text-cyan-400" />
            Crew Stats
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-cyan-400">{userSummary?.total_crew_sessions || 0}</p>
              <p className={`text-xs ${textSecondary}`}>Sessions</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-400">{userSummary?.total_unique_buddies || 0}</p>
              <p className={`text-xs ${textSecondary}`}>Buddies</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-yellow-400">${(userSummary?.total_saved_via_splits || 0).toFixed(0)}</p>
              <p className={`text-xs ${textSecondary}`}>Saved</p>
            </div>
          </div>
          
          {/* Favorite Buddy */}
          {userSummary?.favorite_buddy && (
            <div className={`flex items-center gap-3 p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} mb-4`}>
              <Crown className="w-5 h-5 text-yellow-400" />
              <div className="flex items-center gap-2 flex-1">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center overflow-hidden">
                  {userSummary.favorite_buddy.avatar_url ? (
                    <img src={userSummary.favorite_buddy.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white text-sm">{userSummary.favorite_buddy.full_name?.charAt(0)}</span>
                  )}
                </div>
                <div>
                  <p className={`text-sm font-medium ${textPrimary}`}>{userSummary.favorite_buddy.full_name}</p>
                  <p className={`text-xs ${textSecondary}`}>Favorite Buddy</p>
                </div>
              </div>
            </div>
          )}
          
          {/* Badges */}
          {userSummary?.badges?.length > 0 && (
            <div>
              <p className={`text-sm font-medium ${textSecondary} mb-2`}>Badges Earned</p>
              <div className="flex flex-wrap gap-3 justify-center">
                {userSummary.badges.map((badge, idx) => (
                  <BadgeCard key={idx} badge={badge} size="md" />
                ))}
              </div>
            </div>
          )}
          
          {/* Top Crews */}
          {userSummary?.top_crews?.length > 0 && (
            <div className="mt-4">
              <p className={`text-sm font-medium ${textSecondary} mb-2`}>Your Top Crews</p>
              <div className="space-y-2">
                {userSummary.top_crews.slice(0, 3).map((crew, idx) => (
                  <CrewCard 
                    key={idx} 
                    crew={crew} 
                    isLight={isLight}
                    onClick={() => handleCrewClick(crew)}
                  />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }
  
  // Full variant - complete leaderboard experience
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className={`text-xl font-bold ${textPrimary} flex items-center gap-2`}>
          <Trophy className="w-6 h-6 text-yellow-400" />
          Crew Leaderboard
        </h2>
      </div>
      
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full">
          <TabsTrigger value="my-crews" className="flex-1">My Crews</TabsTrigger>
          <TabsTrigger value="leaderboard" className="flex-1">Leaderboard</TabsTrigger>
          <TabsTrigger value="badges" className="flex-1">Badges</TabsTrigger>
        </TabsList>
        
        {/* My Crews Tab */}
        <TabsContent value="my-crews" className="space-y-4">
          {/* Personal Stats */}
          <Card className={cardBg}>
            <CardContent className="p-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <Users className="w-6 h-6 mx-auto mb-1 text-cyan-400" />
                  <p className="text-2xl font-bold text-cyan-400">{userSummary?.total_crew_sessions || 0}</p>
                  <p className={`text-xs ${textSecondary}`}>Crew Sessions</p>
                </div>
                <div className="text-center">
                  <Star className="w-6 h-6 mx-auto mb-1 text-purple-400" />
                  <p className="text-2xl font-bold text-purple-400">{userSummary?.total_unique_buddies || 0}</p>
                  <p className={`text-xs ${textSecondary}`}>Unique Buddies</p>
                </div>
                <div className="text-center">
                  <DollarSign className="w-6 h-6 mx-auto mb-1 text-green-400" />
                  <p className="text-2xl font-bold text-green-400">${(userSummary?.total_saved_via_splits || 0).toFixed(0)}</p>
                  <p className={`text-xs ${textSecondary}`}>Total Saved</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Crews List */}
          <div className="space-y-3">
            <h3 className={`font-medium ${textPrimary}`}>Your Crews</h3>
            {userSummary?.top_crews?.length > 0 ? (
              userSummary.top_crews.map((crew, idx) => (
                <CrewCard 
                  key={idx} 
                  crew={crew} 
                  isLight={isLight}
                  onClick={() => handleCrewClick(crew)}
                />
              ))
            ) : (
              <p className={textSecondary}>No crew sessions yet. Start surfing with friends!</p>
            )}
          </div>
        </TabsContent>
        
        {/* Leaderboard Tab */}
        <TabsContent value="leaderboard" className="space-y-4">
          {/* Metric Filter */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {[
              { value: 'total_sessions', label: 'Sessions', icon: <Flame className="w-4 h-4" /> },
              { value: 'total_money_saved', label: 'Savings', icon: <DollarSign className="w-4 h-4" /> },
              { value: 'current_streak', label: 'Streak', icon: <TrendingUp className="w-4 h-4" /> },
            ].map((metric) => (
              <Button
                key={metric.value}
                variant={leaderboardMetric === metric.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLeaderboardMetric(metric.value)}
                className={leaderboardMetric === metric.value ? 'bg-cyan-500 text-black' : ''}
              >
                {metric.icon}
                <span className="ml-1">{metric.label}</span>
              </Button>
            ))}
          </div>
          
          {/* Leaderboard List */}
          <div className="space-y-2">
            {leaderboard.length > 0 ? (
              leaderboard.map((entry, idx) => (
                <LeaderboardEntry key={idx} entry={entry} isLight={isLight} />
              ))
            ) : (
              <p className={textSecondary}>No crews on the leaderboard yet.</p>
            )}
          </div>
        </TabsContent>
        
        {/* Badges Tab */}
        <TabsContent value="badges" className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {userSummary?.badges?.length > 0 ? (
              userSummary.badges.map((badge, idx) => (
                <div key={idx} className={`p-4 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} text-center`}>
                  <BadgeCard badge={badge} size="lg" />
                  <p className={`text-xs ${textSecondary} mt-2`}>{badge.description}</p>
                  {badge.progress < badge.target && (
                    <div className="mt-2">
                      <div className={`h-1 rounded-full ${isLight ? 'bg-gray-200' : 'bg-zinc-700'}`}>
                        <div 
                          className="h-1 rounded-full bg-cyan-400"
                          style={{ width: `${(badge.progress / badge.target) * 100}%` }}
                        />
                      </div>
                      <p className={`text-xs ${textSecondary} mt-1`}>{badge.progress}/{badge.target}</p>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="col-span-3 text-center py-8">
                <Medal className="w-12 h-12 mx-auto mb-3 text-gray-500" />
                <p className={textSecondary}>No badges earned yet. Keep surfing with your crew!</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
      
      {/* Crew Detail Modal */}
      <Dialog open={showCrewDetail} onOpenChange={setShowCrewDetail}>
        <DialogContent className={`${cardBg} max-w-md`}>
          <DialogHeader>
            <DialogTitle className={textPrimary}>
              {selectedCrew?.name || 'Crew Details'}
            </DialogTitle>
          </DialogHeader>
          
          {selectedCrew && (
            <div className="space-y-4">
              {/* Members */}
              <div>
                <p className={`text-sm font-medium ${textSecondary} mb-2`}>Members</p>
                <div className="flex flex-wrap gap-2">
                  {selectedCrew.members?.map((member, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-zinc-800 rounded-full px-3 py-1">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center overflow-hidden">
                        {member.avatar_url ? (
                          <img src={member.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-white text-xs">{member.full_name?.charAt(0)}</span>
                        )}
                      </div>
                      <span className={`text-sm ${textPrimary}`}>{member.full_name}</span>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                  <p className="text-xl font-bold text-cyan-400">{selectedCrew.stats?.total_sessions || 0}</p>
                  <p className={`text-xs ${textSecondary}`}>Total Sessions</p>
                </div>
                <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                  <p className="text-xl font-bold text-green-400">${(selectedCrew.stats?.total_money_saved || 0).toFixed(0)}</p>
                  <p className={`text-xs ${textSecondary}`}>Total Saved</p>
                </div>
                <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                  <p className="text-xl font-bold text-yellow-400">{selectedCrew.stats?.sunrise_sessions || 0}</p>
                  <p className={`text-xs ${textSecondary}`}>Dawn Patrols</p>
                </div>
                <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                  <p className="text-xl font-bold text-orange-400">{selectedCrew.stats?.sunset_sessions || 0}</p>
                  <p className={`text-xs ${textSecondary}`}>Sunset Sessions</p>
                </div>
              </div>
              
              {/* Badges */}
              {selectedCrew.badges?.length > 0 && (
                <div>
                  <p className={`text-sm font-medium ${textSecondary} mb-2`}>Crew Badges</p>
                  <div className="flex flex-wrap gap-3 justify-center">
                    {selectedCrew.badges.map((badge, idx) => (
                      <BadgeCard key={idx} badge={badge} size="md" />
                    ))}
                  </div>
                </div>
              )}
              
              {/* Privacy Toggle */}
              {showPrivacyControls && selectedCrew.member_ids?.includes(targetUserId) && (
                <div className="flex items-center justify-between pt-3 border-t border-zinc-700">
                  <div className="flex items-center gap-2">
                    {selectedCrew.is_public ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    <Label>Public Crew Stats</Label>
                  </div>
                  <Switch
                    checked={selectedCrew.is_public}
                    onCheckedChange={(checked) => handlePrivacyToggle(selectedCrew.crew_hash, checked)}
                  />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CrewLeaderboard;
