import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { 
  Trophy, Target, TrendingUp, Users, Calendar, 
  ChevronRight, Loader2, Plus, CheckCircle, Clock, Medal,
  Flame, Award, Video, MapPin, Star
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { toast } from 'sonner';
import axios from 'axios';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * The Impact Zone - Career Hub for Competitive Surfers
 * Features: Competition Stats, Rankings, Contest Calendar, Heat Analysis, Comp Crew
 */
export const ImpactZoneHub = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  
  const [_competitionStats, setCompetitionStats] = useState(null);
  const [upcomingContests, setUpcomingContests] = useState([]);
  const [competitionResults, setCompetitionResults] = useState([]);
  const [rankings, setRankings] = useState(null);
  const [_compCrewMembers, setCompCrewMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddResultModal, setShowAddResultModal] = useState(false);

  const isLight = theme === 'light';
  const cardBg = isLight ? 'bg-white border-gray-200' : 'bg-zinc-900 border-zinc-800';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';

  useEffect(() => {
    if (user?.id) {
      fetchCompetitionData();
    }
  }, [user?.id]);

  const fetchCompetitionData = async () => {
    setLoading(true);
    try {
      const [statsRes, contestsRes, resultsRes, rankingsRes, crewRes] = await Promise.all([
        axios.get(`${API}/career/stats/${user.id}`).catch(() => ({ data: null })),
        axios.get(`${API}/career/upcoming-contests`).catch(() => ({ data: { contests: [] } })),
        axios.get(`${API}/career/competition-results/${user.id}`).catch(() => ({ data: { results: [] } })),
        axios.get(`${API}/career/rankings/${user.id}`).catch(() => ({ data: null })),
        axios.get(`${API}/social/followers/${user.id}?filter=comp`).catch(() => ({ data: [] }))
      ]);
      
      setCompetitionStats(statsRes.data);
      setUpcomingContests(contestsRes.data?.contests || mockUpcomingContests);
      setCompetitionResults(resultsRes.data?.results || []);
      setRankings(rankingsRes.data || mockRankings);
      setCompCrewMembers(crewRes.data?.slice?.(0, 5) || []);
    } catch (error) {
      logger.error('Failed to fetch competition data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Mock data for upcoming contests
  const mockUpcomingContests = [
    { id: 1, name: "Regional QS 1000", location: "Huntington Beach, CA", date: "Apr 15-17, 2026", division: "Men's Open", status: "registered" },
    { id: 2, name: "Local Club Championship", location: "Trestles, CA", date: "Apr 22, 2026", division: "Men's Open", status: "pending" },
    { id: 3, name: "State Championships", location: "Santa Cruz, CA", date: "May 5-8, 2026", division: "Men's Open", status: "open" },
  ];

  // Mock rankings data
  const mockRankings = {
    regional: { rank: 24, total: 156, points: 1250 },
    local: { rank: 8, total: 42, points: 890 },
    club: { rank: 3, total: 28, points: 450 }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className={`text-2xl font-bold ${textPrimary} flex items-center gap-2`}>
            <Target className="w-7 h-7 text-orange-500" />
            The Impact Zone
          </h1>
          <p className={`${textSecondary} text-sm mt-1`}>Your competitive surfing hub</p>
        </div>
        <Badge className="bg-gradient-to-r from-orange-500 to-red-500 text-white border-0">
          <Flame className="w-3 h-3 mr-1" /> Competitor
        </Badge>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className={`${cardBg}`}>
          <CardContent className="p-4 text-center">
            <Trophy className="w-6 h-6 mx-auto mb-2 text-yellow-500" />
            <p className={`text-2xl font-bold ${textPrimary}`}>{competitionResults.length || 0}</p>
            <p className={`text-xs ${textSecondary}`}>Competitions</p>
          </CardContent>
        </Card>
        <Card className={`${cardBg}`}>
          <CardContent className="p-4 text-center">
            <Medal className="w-6 h-6 mx-auto mb-2 text-orange-500" />
            <p className={`text-2xl font-bold ${textPrimary}`}>{rankings?.regional?.rank || '--'}</p>
            <p className={`text-xs ${textSecondary}`}>Regional Rank</p>
          </CardContent>
        </Card>
        <Card className={`${cardBg}`}>
          <CardContent className="p-4 text-center">
            <TrendingUp className="w-6 h-6 mx-auto mb-2 text-green-500" />
            <p className={`text-2xl font-bold ${textPrimary}`}>{rankings?.regional?.points || 0}</p>
            <p className={`text-xs ${textSecondary}`}>Points</p>
          </CardContent>
        </Card>
      </div>

      {/* Rankings Card */}
      <Card className={`${cardBg}`}>
        <CardHeader className="pb-2">
          <CardTitle className={`${textPrimary} text-lg flex items-center gap-2`}>
            <TrendingUp className="w-5 h-5 text-orange-500" />
            Your Rankings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rankings && (
            <>
              <div className="flex items-center justify-between p-3 bg-orange-500/10 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
                    <Trophy className="w-5 h-5 text-orange-400" />
                  </div>
                  <div>
                    <p className={`font-medium ${textPrimary}`}>Regional</p>
                    <p className={`text-xs ${textSecondary}`}>{rankings.regional.points} pts</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-orange-400">#{rankings.regional.rank}</p>
                  <p className={`text-xs ${textSecondary}`}>of {rankings.regional.total}</p>
                </div>
              </div>
              
              <div className="flex items-center justify-between p-3 bg-cyan-500/10 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center">
                    <MapPin className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div>
                    <p className={`font-medium ${textPrimary}`}>Local</p>
                    <p className={`text-xs ${textSecondary}`}>{rankings.local.points} pts</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-cyan-400">#{rankings.local.rank}</p>
                  <p className={`text-xs ${textSecondary}`}>of {rankings.local.total}</p>
                </div>
              </div>
              
              <div className="flex items-center justify-between p-3 bg-purple-500/10 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                    <Users className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <p className={`font-medium ${textPrimary}`}>Club</p>
                    <p className={`text-xs ${textSecondary}`}>{rankings.club.points} pts</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-purple-400">#{rankings.club.rank}</p>
                  <p className={`text-xs ${textSecondary}`}>of {rankings.club.total}</p>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Upcoming Contests */}
      <Card className={`${cardBg}`}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className={`${textPrimary} text-lg flex items-center gap-2`}>
              <Calendar className="w-5 h-5 text-yellow-500" />
              Upcoming Contests
            </CardTitle>
            <Button variant="ghost" size="sm" className="text-orange-400" onClick={() => navigate('/contest-calendar')}>
              View All <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {upcomingContests.map((contest) => (
            <div key={contest.id} className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  contest.status === 'registered' ? 'bg-green-500/20' : 
                  contest.status === 'pending' ? 'bg-yellow-500/20' : 'bg-zinc-700'
                }`}>
                  <Trophy className={`w-5 h-5 ${
                    contest.status === 'registered' ? 'text-green-400' : 
                    contest.status === 'pending' ? 'text-yellow-400' : 'text-gray-400'
                  }`} />
                </div>
                <div>
                  <p className={`font-medium ${textPrimary}`}>{contest.name}</p>
                  <p className={`text-xs ${textSecondary}`}>{contest.location}</p>
                  <p className={`text-xs ${textSecondary}`}>{contest.date}</p>
                </div>
              </div>
              <div className="text-right">
                {contest.status === 'registered' && (
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                    <CheckCircle className="w-3 h-3 mr-1" /> Registered
                  </Badge>
                )}
                {contest.status === 'pending' && (
                  <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                    <Clock className="w-3 h-3 mr-1" /> Pending
                  </Badge>
                )}
                {contest.status === 'open' && (
                  <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white">
                    Register
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Competition Results */}
      <Card className={`${cardBg}`}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className={`${textPrimary} text-lg flex items-center gap-2`}>
              <Award className="w-5 h-5 text-purple-500" />
              Competition Results
            </CardTitle>
            <Button 
              variant="outline" 
              size="sm" 
              className="border-orange-500/50 text-orange-400 hover:bg-orange-500/10"
              onClick={() => setShowAddResultModal(true)}
            >
              <Plus className="w-4 h-4 mr-1" /> Add Result
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {competitionResults.length > 0 ? (
            <div className="space-y-3">
              {competitionResults.map((result, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      result.placement <= 3 ? 'bg-yellow-500/20' : 'bg-zinc-700'
                    }`}>
                      {result.placement <= 3 ? (
                        <Medal className="w-5 h-5 text-yellow-400" />
                      ) : (
                        <Trophy className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                    <div>
                      <p className={`font-medium ${textPrimary}`}>{result.contest_name}</p>
                      <p className={`text-xs ${textSecondary}`}>{result.date}</p>
                    </div>
                  </div>
                  <Badge className={
                    result.placement === 1 ? 'bg-yellow-500/20 text-yellow-400' :
                    result.placement === 2 ? 'bg-gray-400/20 text-gray-300' :
                    result.placement === 3 ? 'bg-amber-600/20 text-amber-500' :
                    'bg-zinc-700 text-gray-400'
                  }>
                    {result.placement === 1 ? '1st' : 
                     result.placement === 2 ? '2nd' : 
                     result.placement === 3 ? '3rd' : 
                     `${result.placement}th`}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Trophy className="w-12 h-12 mx-auto mb-3 text-zinc-600" />
              <p className={textSecondary}>No competition results yet</p>
              <p className={`text-xs ${textSecondary} mt-1`}>Add your first result to track your progress</p>
              <Button 
                className="mt-4 bg-orange-500 hover:bg-orange-600"
                onClick={() => setShowAddResultModal(true)}
              >
                <Plus className="w-4 h-4 mr-2" /> Add Competition Result
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Heat Analysis */}
      <Card className={`${cardBg}`}>
        <CardHeader className="pb-2">
          <CardTitle className={`${textPrimary} text-lg flex items-center gap-2`}>
            <Video className="w-5 h-5 text-cyan-500" />
            Heat Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <Video className="w-12 h-12 mx-auto mb-3 text-zinc-600" />
            <p className={textSecondary}>Study winning heats and improve your strategy</p>
            <Button 
              className="mt-4 bg-cyan-500 hover:bg-cyan-600"
              onClick={() => navigate('/heat-analysis')}
            >
              Browse Heat Videos
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3">
        <Button 
          variant="outline" 
          className="h-auto py-4 border-orange-500/30 hover:bg-orange-500/10 flex flex-col items-center gap-2"
          onClick={() => navigate('/explore?filter=comp')}
        >
          <Users className="w-6 h-6 text-orange-400" />
          <span className={textPrimary}>Comp Crew</span>
        </Button>
        <Button 
          variant="outline" 
          className="h-auto py-4 border-yellow-500/30 hover:bg-yellow-500/10 flex flex-col items-center gap-2"
          onClick={() => navigate('/stoked')}
        >
          <Star className="w-6 h-6 text-yellow-400" />
          <span className={textPrimary}>Stoked Credits</span>
        </Button>
      </div>

      {/* Add Result Modal */}
      <Dialog open={showAddResultModal} onOpenChange={setShowAddResultModal}>
        <DialogContent className="bg-zinc-900 border-zinc-800">
          <DialogHeader>
            <DialogTitle className="text-white">Add Competition Result</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm text-gray-400">Contest Name</label>
              <Input 
                placeholder="e.g., Regional QS 1000"
                className="mt-1 bg-zinc-800 border-zinc-700"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400">Placement</label>
              <Input 
                type="number"
                placeholder="e.g., 5"
                className="mt-1 bg-zinc-800 border-zinc-700"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400">Date</label>
              <Input 
                type="date"
                className="mt-1 bg-zinc-800 border-zinc-700"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowAddResultModal(false)}>
              Cancel
            </Button>
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => {
              toast.success('Competition result added!');
              setShowAddResultModal(false);
            }}>
              Save Result
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ImpactZoneHub;
