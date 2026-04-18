import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { usePersona } from '../contexts/PersonaContext';
import { 
  Zap, Trophy, Users, TrendingUp, Loader2, Target, Sparkles,
  DollarSign, Calendar, ChevronRight, Award, Heart, Medal,
  Waves, ShoppingBag, Plane, Banknote,
  Gift, Camera, GraduationCap, ArrowRight
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { CrewLeaderboard } from './CrewLeaderboard';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import logger from '../utils/logger';
import { ROLES } from '../constants/roles';


/**
 * Stoked Dashboard - Surfer's Impact & Progress Tracking
 * Shows: Total Sessions Joined, XP Progress, Competitive Stats, Sponsorship Credits
 * Role-specific spending options: Cash Out (Pro), Travel (Comp), Gear (Grom)
 */
export const StokedDashboard = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { getEffectiveRole } = usePersona();
  const navigate = useNavigate();
  
  // Get effective role for role-specific options
  const effectiveRole = getEffectiveRole(user?.role);
  const isGrom = effectiveRole === ROLES.GROM;
  const isCompSurfer = effectiveRole === ROLES.COMP_SURFER;
  const isPro = effectiveRole === ROLES.PRO;
  
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalSessions: 0,
    totalXp: 0,
    xpRank: null,
    competitionResults: [],
    stokeIncome: { total_received: 0, supporter_count: 0 },
    recentSessions: [],
    badges: []
  });

  const isLight = theme === 'light';
  const cardBg = isLight ? 'bg-white border-gray-200' : 'bg-card border-border';
  const textPrimary = isLight ? 'text-gray-900' : 'text-foreground';
  const textSecondary = isLight ? 'text-gray-600' : 'text-muted-foreground';

  useEffect(() => {
    if (user?.id) {
      fetchStokedData();
    }
  }, [user?.id]);

  const fetchStokedData = async () => {
    setLoading(true);
    try {
      const [gamificationRes, careerRes, stokeRes, sessionsRes] = await Promise.all([
        apiClient.get(`/gamification/${user.id}`).catch(() => ({ data: { total_xp: 0, badges: [] } })),
        apiClient.get(`/career/stats/${user.id}`).catch(() => ({ data: null })),
        apiClient.get(`/career/stoke-sponsor/income/${user.id}`).catch(() => ({ data: null })),
        apiClient.get(`/sessions/surfer/${user.id}?limit=5`).catch(() => ({ data: { sessions: [] } }))
      ]);
      
      setStats({
        totalXp: gamificationRes.data?.total_xp || 0,
        badges: gamificationRes.data?.badges || [],
        competitionResults: careerRes.data?.results || [],
        totalWins: careerRes.data?.total_wins || 0,
        totalPodiums: careerRes.data?.total_podiums || 0,
        careerPoints: careerRes.data?.career_points || 0,
        stokeIncome: stokeRes.data || { total_received: 0, supporter_count: 0 },
        recentSessions: sessionsRes.data?.sessions || [],
        totalSessions: sessionsRes.data?.total_count || sessionsRes.data?.sessions?.length || 0
      });
    } catch (error) {
      logger.error('Failed to fetch stoked data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate XP level
  const getXpLevel = (xp) => {
    if (xp < 100) return { level: 1, title: 'Wave Watcher', next: 100 };
    if (xp < 500) return { level: 2, title: 'Paddle Pusher', next: 500 };
    if (xp < 1000) return { level: 3, title: 'Line Up Regular', next: 1000 };
    if (xp < 2500) return { level: 4, title: 'Barrel Hunter', next: 2500 };
    if (xp < 5000) return { level: 5, title: 'Swell Chaser', next: 5000 };
    if (xp < 10000) return { level: 6, title: 'Dawn Patrol', next: 10000 };
    return { level: 7, title: 'Surf Legend', next: null };
  };

  const xpInfo = getXpLevel(stats.totalXp);
  const xpProgress = xpInfo.next ? Math.min((stats.totalXp / xpInfo.next) * 100, 100) : 100;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-yellow-400 animate-spin" />
      </div>
    );
  }

  return (
    <div 
      className="space-y-6 pb-24 md:pb-6" 
      data-testid="stoked-dashboard"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)' }}
    >
      {/* Header */}
      <div className="text-center">
        <h1 className={`text-3xl font-bold ${textPrimary} flex items-center justify-center gap-2`} style={{ fontFamily: 'Oswald' }}>
          <Zap className="w-8 h-8 text-yellow-400" />
          Stoked
        </h1>
        <p className={`${textSecondary} mt-1`}>Your Surf Journey & Impact</p>
      </div>

      {/* Stoked Credit Balance - Buying Power */}
      <Card className={`${cardBg} border-2 border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-cyan-500/5`}>
        <CardHeader className="pb-2">
          <CardTitle className={`${textPrimary} flex items-center gap-2 text-base`}>
            <DollarSign className="w-5 h-5 text-emerald-400" />
            Buying Power
            <Badge className="ml-auto bg-emerald-500/20 text-emerald-400 border-0 text-xs">SURF CREDITS</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center mb-4">
            <div className="text-4xl font-bold text-emerald-400">
              ${(stats.stokeIncome?.total_received || 0).toFixed(2)}
            </div>
            <div className={`text-xs ${textSecondary} mt-1`}>
              Powered by photographers & brands who believe in you
            </div>
          </div>
          
          <div className="mt-4 p-2 bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 rounded-lg text-center">
            <p className={`text-xs text-emerald-300`}>
              Your community fuels your surf career
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Role-Specific Spending Options Card */}
      <Card className={`${cardBg} border-2 border-yellow-500/30`}>
        <CardHeader className="pb-2">
          <CardTitle className={`${textPrimary} flex items-center gap-2 text-base`}>
            <Gift className="w-5 h-5 text-yellow-400" />
            Use Your Credits
            <Badge className="ml-auto bg-yellow-500/20 text-yellow-400 border-0 text-xs">
              {isPro ? 'PRO OPTIONS' : isCompSurfer ? 'COMP OPTIONS' : isGrom ? 'GROM OPTIONS' : 'SPENDING'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* PRO SURFER OPTIONS */}
          {isPro && (
            <>
              <Button 
                variant="outline" 
                className="w-full justify-start h-auto py-4 border-emerald-500/30 hover:bg-emerald-500/10"
                onClick={() => navigate('/wallet')}
              >
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center mr-3">
                  <Banknote className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="text-left flex-1">
                  <div className={`font-semibold ${textPrimary}`}>Cash Out</div>
                  <div className={`text-xs ${textSecondary}`}>Withdraw to your bank account</div>
                </div>
                <ArrowRight className="w-5 h-5 text-emerald-400" />
              </Button>
              
              <Button 
                variant="outline" 
                className="w-full justify-start h-auto py-4 border-pink-500/30 hover:bg-pink-500/10"
                onClick={() => navigate('/impact')}
              >
                <div className="w-10 h-10 rounded-full bg-pink-500/20 flex items-center justify-center mr-3">
                  <Heart className="w-5 h-5 text-pink-400" />
                </div>
                <div className="text-left flex-1">
                  <div className={`font-semibold ${textPrimary}`}>Pay It Forward</div>
                  <div className={`text-xs ${textSecondary}`}>Support other surfers in your community</div>
                </div>
                <ArrowRight className="w-5 h-5 text-pink-400" />
              </Button>
              
              <Button 
                variant="outline" 
                className="w-full justify-start h-auto py-4 border-cyan-500/30 hover:bg-cyan-500/10"
                onClick={() => navigate('/gear-hub')}
              >
                <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center mr-3">
                  <ShoppingBag className="w-5 h-5 text-cyan-400" />
                </div>
                <div className="text-left flex-1">
                  <div className={`font-semibold ${textPrimary}`}>Premium Gear</div>
                  <div className={`text-xs ${textSecondary}`}>Top-tier equipment from our partners</div>
                </div>
                <ArrowRight className="w-5 h-5 text-cyan-400" />
              </Button>
            </>
          )}
          
          {/* COMP SURFER OPTIONS */}
          {isCompSurfer && (
            <>
              <Button 
                variant="outline" 
                className="w-full justify-start h-auto py-4 border-purple-500/30 hover:bg-purple-500/10"
                onClick={() => navigate('/explore')}
              >
                <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center mr-3">
                  <Plane className="w-5 h-5 text-purple-400" />
                </div>
                <div className="text-left flex-1">
                  <div className={`font-semibold ${textPrimary}`}>Travel & Contests</div>
                  <div className={`text-xs ${textSecondary}`}>Competition travel and entry fees</div>
                </div>
                <ArrowRight className="w-5 h-5 text-purple-400" />
              </Button>
              
              <Button 
                variant="outline" 
                className="w-full justify-start h-auto py-4 border-cyan-500/30 hover:bg-cyan-500/10"
                onClick={() => navigate('/gear-hub')}
              >
                <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center mr-3">
                  <ShoppingBag className="w-5 h-5 text-cyan-400" />
                </div>
                <div className="text-left flex-1">
                  <div className={`font-semibold ${textPrimary}`}>Pro Equipment</div>
                  <div className={`text-xs ${textSecondary}`}>High-performance boards and gear</div>
                </div>
                <ArrowRight className="w-5 h-5 text-cyan-400" />
              </Button>
            </>
          )}
          
          {/* GROM OPTIONS */}
          {isGrom && (
            <>
              <Button 
                variant="outline" 
                className="w-full justify-start h-auto py-4 border-cyan-500/30 hover:bg-cyan-500/10"
                onClick={() => navigate('/gear-hub')}
              >
                <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center mr-3">
                  <ShoppingBag className="w-5 h-5 text-cyan-400" />
                </div>
                <div className="text-left flex-1">
                  <div className={`font-semibold ${textPrimary}`}>Gear & Equipment</div>
                  <div className={`text-xs ${textSecondary}`}>Boards, wetsuits, and accessories</div>
                </div>
                <ArrowRight className="w-5 h-5 text-cyan-400" />
              </Button>
              
              <Button 
                variant="outline" 
                className="w-full justify-start h-auto py-4 border-green-500/30 hover:bg-green-500/10"
                onClick={() => navigate('/map')}
              >
                <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center mr-3">
                  <GraduationCap className="w-5 h-5 text-green-400" />
                </div>
                <div className="text-left flex-1">
                  <div className={`font-semibold ${textPrimary}`}>Surf Lessons</div>
                  <div className={`text-xs ${textSecondary}`}>Training with local coaches</div>
                </div>
                <ArrowRight className="w-5 h-5 text-green-400" />
              </Button>
              
              <Button 
                variant="outline" 
                className="w-full justify-start h-auto py-4 border-yellow-500/30 hover:bg-yellow-500/10"
                onClick={() => navigate('/explore')}
              >
                <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center mr-3">
                  <Trophy className="w-5 h-5 text-yellow-400" />
                </div>
                <div className="text-left flex-1">
                  <div className={`font-semibold ${textPrimary}`}>Competition Entry</div>
                  <div className={`text-xs ${textSecondary}`}>Local and regional contests</div>
                </div>
                <ArrowRight className="w-5 h-5 text-yellow-400" />
              </Button>
            </>
          )}
          
          {/* DEFAULT OPTIONS (fallback for regular Surfer if they somehow see this) */}
          {!isPro && !isCompSurfer && !isGrom && (
            <>
              <Button 
                variant="outline" 
                className="w-full justify-start h-auto py-4 border-cyan-500/30 hover:bg-cyan-500/10"
                onClick={() => navigate('/gear-hub')}
              >
                <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center mr-3">
                  <ShoppingBag className="w-5 h-5 text-cyan-400" />
                </div>
                <div className="text-left flex-1">
                  <div className={`font-semibold ${textPrimary}`}>Gear & Equipment</div>
                  <div className={`text-xs ${textSecondary}`}>Boards, wetsuits, and accessories</div>
                </div>
                <ArrowRight className="w-5 h-5 text-cyan-400" />
              </Button>
              
              <Button 
                variant="outline" 
                className="w-full justify-start h-auto py-4 border-yellow-500/30 hover:bg-yellow-500/10"
                onClick={() => navigate('/map')}
              >
                <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center mr-3">
                  <Camera className="w-5 h-5 text-yellow-400" />
                </div>
                <div className="text-left flex-1">
                  <div className={`font-semibold ${textPrimary}`}>Photo Sessions</div>
                  <div className={`text-xs ${textSecondary}`}>Book pro photographers</div>
                </div>
                <ArrowRight className="w-5 h-5 text-yellow-400" />
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* XP Progress Card */}
      <Card className={`${cardBg} border-2 border-yellow-500/30 bg-gradient-to-br from-yellow-500/5 to-orange-500/5`}>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-r from-yellow-400 to-orange-400 flex items-center justify-center text-2xl font-bold text-black">
              {xpInfo.level}
            </div>
            <div className="flex-1">
              <div className={`font-bold ${textPrimary}`}>{xpInfo.title}</div>
              <div className="text-yellow-400 font-bold text-xl">{stats.totalXp.toLocaleString()} XP</div>
            </div>
            <div className="text-right">
              <Sparkles className="w-6 h-6 text-yellow-400" />
            </div>
          </div>
          
          {xpInfo.next && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className={textSecondary}>Progress to Level {xpInfo.level + 1}</span>
                <span className="text-yellow-400 font-medium">{Math.round(xpProgress)}%</span>
              </div>
              <Progress value={xpProgress} className="h-2 bg-zinc-800" />
              <div className={`text-xs ${textSecondary} text-center`}>
                {(xpInfo.next - stats.totalXp).toLocaleString()} XP to next level
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Sessions Joined */}
        <Card className={cardBg}>
          <CardContent className="pt-4 text-center">
            <Users className="w-8 h-8 text-cyan-400 mx-auto mb-2" />
            <div className="text-2xl font-bold text-cyan-400">{stats.totalSessions}</div>
            <div className={`text-xs ${textSecondary}`}>Sessions Joined</div>
          </CardContent>
        </Card>
        
        {/* Badges Earned */}
        <Card className={cardBg}>
          <CardContent className="pt-4 text-center">
            <Award className="w-8 h-8 text-purple-400 mx-auto mb-2" />
            <div className="text-2xl font-bold text-purple-400">{stats.badges?.length || 0}</div>
            <div className={`text-xs ${textSecondary}`}>Badges Earned</div>
          </CardContent>
        </Card>
        
        {/* Competition Wins */}
        <Card className={cardBg}>
          <CardContent className="pt-4 text-center">
            <Trophy className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
            <div className="text-2xl font-bold text-yellow-400">{stats.totalWins || 0}</div>
            <div className={`text-xs ${textSecondary}`}>Event Wins</div>
          </CardContent>
        </Card>
        
        {/* Stoke Sponsor Income */}
        <Card className={cardBg}>
          <CardContent className="pt-4 text-center">
            <Heart className="w-8 h-8 text-pink-400 mx-auto mb-2" />
            <div className="text-2xl font-bold text-pink-400">${stats.stokeIncome?.total_received?.toFixed(0) || 0}</div>
            <div className={`text-xs ${textSecondary}`}>Sponsor Support</div>
          </CardContent>
        </Card>
      </div>

      {/* Stoke Sponsor Support */}
      {stats.stokeIncome?.total_received > 0 && (
        <Card className={`${cardBg} border-2 border-pink-500/30`}>
          <CardHeader className="pb-2">
            <CardTitle className={`${textPrimary} flex items-center gap-2 text-base`}>
              <Heart className="w-5 h-5 text-pink-400" />
              Photographer Support
              <Badge className="ml-auto bg-pink-500/20 text-pink-400 border-0 text-xs">
                {stats.stokeIncome.supporter_count} supporters
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-3 bg-pink-500/10 rounded-lg">
              <div>
                <div className={`text-sm ${textSecondary}`}>Total Received</div>
                <div className="text-xl font-bold text-pink-400">
                  ${stats.stokeIncome.total_received.toFixed(2)}
                </div>
              </div>
              <Button 
                variant="outline" 
                size="sm"
                className="border-pink-500/50 text-pink-400 hover:bg-pink-500/10"
                onClick={() => navigate('/wallet')}
              >
                View in Wallet <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Competition Stats */}
      {(stats.totalWins > 0 || stats.totalPodiums > 0 || stats.careerPoints > 0) && (
        <Card className={cardBg}>
          <CardHeader className="pb-2">
            <CardTitle className={`${textPrimary} flex items-center gap-2 text-base`}>
              <Medal className="w-5 h-5 text-amber-400" />
              Competition Record
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-xl font-bold text-amber-400">{stats.totalWins || 0}</div>
                <div className={`text-xs ${textSecondary}`}>Wins</div>
              </div>
              <div>
                <div className="text-xl font-bold text-gray-300">{stats.totalPodiums || 0}</div>
                <div className={`text-xs ${textSecondary}`}>Podiums</div>
              </div>
              <div>
                <div className="text-xl font-bold text-emerald-400">{stats.careerPoints || 0}</div>
                <div className={`text-xs ${textSecondary}`}>Points</div>
              </div>
            </div>
            <Button 
              variant="outline" 
              className="w-full mt-4 border-zinc-700"
              onClick={() => navigate('/career/the-peak')}
            >
              <Trophy className="w-4 h-4 mr-2" />
              View Full Career Stats
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Badges */}
      {stats.badges?.length > 0 && (
        <Card className={cardBg}>
          <CardHeader className="pb-2">
            <CardTitle className={`${textPrimary} flex items-center gap-2 text-base`}>
              <Award className="w-5 h-5 text-purple-400" />
              Earned Badges
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {stats.badges.slice(0, 6).map((badge, index) => (
                <Badge 
                  key={index}
                  className="bg-purple-500/20 text-purple-400 border border-purple-500/30 py-1 px-3"
                >
                  {badge.badge_type}
                </Badge>
              ))}
            </div>
            {stats.badges.length > 6 && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full mt-2 text-purple-400"
                onClick={() => navigate('/profile')}
              >
                View all {stats.badges.length} badges
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Quick Actions */}
      <Card className={cardBg}>
        <CardHeader className="pb-2">
          <CardTitle className={`${textPrimary} flex items-center gap-2 text-base`}>
            <Target className="w-5 h-5 text-cyan-400" />
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button 
            className="w-full bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold justify-start"
            onClick={() => navigate('/map')}
          >
            <Waves className="w-4 h-4 mr-2" />
            Find Live Sessions
          </Button>
          <Button 
            variant="outline" 
            className="w-full border-zinc-700 justify-start"
            onClick={() => navigate('/leaderboard')}
          >
            <TrendingUp className="w-4 h-4 mr-2" />
            XP Leaderboard
          </Button>
          <Button 
            variant="outline" 
            className="w-full border-zinc-700 justify-start"
            onClick={() => navigate('/bookings')}
          >
            <Calendar className="w-4 h-4 mr-2" />
            My Bookings
          </Button>
          <Button 
            variant="outline" 
            className="w-full border-zinc-700 justify-start"
            onClick={() => navigate('/gear-hub')}
            data-testid="stoked-gear-hub-btn"
          >
            <ShoppingBag className="w-4 h-4 mr-2" />
            Gear Hub
          </Button>
        </CardContent>
      </Card>
      
      {/* Crew Leaderboard Section */}
      <Card className={cardBg} data-testid="crew-leaderboard-section">
        <CardHeader className="pb-2">
          <CardTitle className={`flex items-center gap-2 ${textPrimary}`}>
            <Users className="w-5 h-5 text-cyan-400" />
            Crew Stats & Leaderboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CrewLeaderboard 
            userId={user?.id} 
            variant="full"
            showPrivacyControls={true}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default StokedDashboard;
