import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { 
  Trophy, Star, Users, Loader2, Plus, CheckCircle, Clock, Medal,
  Target, Sparkles, Rocket, Baby, Heart, Zap, DollarSign
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { toast } from 'sonner';
import { CrewLeaderboard } from './CrewLeaderboard';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import logger from '../utils/logger';


/**
 * The Inside - Career Hub for Grom (🍼) surfers
 * Features: Road to the Peak progress, Grom Series results, Stoke Sponsors, Grom-Friendly coaches
 */
export const TheInsideHub = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  
  const [careerStats, setCareerStats] = useState(null);
  const [sponsorships, setSponsorships] = useState([]);
  const [competitionResults, setCompetitionResults] = useState([]);
  const [gromCoaches, setGromCoaches] = useState([]);
  const [stokeIncome, setStokeIncome] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddResultModal, setShowAddResultModal] = useState(false);
  const [showAddSponsorModal, setShowAddSponsorModal] = useState(false);

  const isLight = theme === 'light';
  const cardBg = isLight ? 'bg-white border-gray-200' : 'bg-card border-border';
  const textPrimary = isLight ? 'text-gray-900' : 'text-foreground';
  const textSecondary = isLight ? 'text-gray-600' : 'text-muted-foreground';

  useEffect(() => {
    if (user?.id) {
      fetchGromData();
    }
  }, [user?.id]);

  const fetchGromData = async () => {
    setLoading(true);
    try {
      const [statsRes, sponsorsRes, resultsRes, stokeRes] = await Promise.all([
        apiClient.get(`/career/stats/${user.id}`).catch(() => ({ data: null })),
        apiClient.get(`/career/sponsorships/${user.id}`).catch(() => ({ data: { sponsorships: [] } })),
        apiClient.get(`/career/competition-results/${user.id}`).catch(() => ({ data: { results: [] } })),
        apiClient.get(`/career/stoke-sponsor/income/${user.id}`).catch(() => ({ data: null }))
      ]);
      
      setCareerStats(statsRes.data);
      setSponsorships(sponsorsRes.data?.sponsorships || []);
      setCompetitionResults(resultsRes.data?.results || []);
      setStokeIncome(stokeRes.data);
      
      // Mock grom-friendly coaches for now
      setGromCoaches([
        { id: '1', name: 'Coach Mike', specialty: 'Grom Development', avatar: null },
        { id: '2', name: 'Sarah Surf School', specialty: 'Beginner Friendly', avatar: null },
      ]);
    } catch (error) {
      logger.error('Failed to fetch grom data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getVerificationBadge = (status) => {
    if (status === 'community_verified') {
      return <CheckCircle className="w-4 h-4 text-emerald-400" title="Community Verified" />;
    }
    if (status === 'api_synced') {
      return <CheckCircle className="w-4 h-4 text-cyan-400" title="Verified Sync" />;
    }
    return <Clock className="w-4 h-4 text-yellow-400" title="Pending Verification" />;
  };

  // Calculate Road to the Peak milestones
  const roadToThePeakProgress = careerStats?.road_to_peak_progress || 0;
  const getMilestoneStatus = (threshold) => {
    if (roadToThePeakProgress >= threshold) return 'completed';
    if (roadToThePeakProgress >= threshold - 20) return 'in_progress';
    return 'locked';
  };

  const milestones = [
    { threshold: 25, label: 'Rising Grom', icon: Star, reward: '+50 XP' },
    { threshold: 50, label: 'Wave Warrior', icon: Trophy, reward: '+100 XP' },
    { threshold: 75, label: 'Junior Champion', icon: Medal, reward: '+150 XP' },
    { threshold: 100, label: 'Ready to Level Up!', icon: Rocket, reward: 'Pro Access' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  return (
    <div 
      className="space-y-6 pb-24 md:pb-6" 
      data-testid="the-inside-hub"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)' }}
    >
      {/* Header */}
      <div className="text-center">
        <h1 className={`text-3xl font-bold ${textPrimary} flex items-center justify-center gap-2`} style={{ fontFamily: 'Oswald' }}>
          <Baby className="w-8 h-8 text-cyan-400" />
          The Inside
        </h1>
        <p className={`${textSecondary} mt-1`}>Your Grom Career Journey</p>
        <Badge className="mt-2 bg-cyan-500/20 text-cyan-400 border-cyan-500/30">
          🍼 Grom Rising
        </Badge>
      </div>

      {/* Road to the Peak - Progress Bar */}
      <Card className={`${cardBg} border-2 border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-blue-500/5`}>
        <CardHeader>
          <CardTitle className={`${textPrimary} flex items-center gap-2`}>
            <Rocket className="w-5 h-5 text-cyan-400" />
            Road to The Peak
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Progress Bar */}
          <div className="relative mb-6">
            <Progress value={roadToThePeakProgress} className="h-4 bg-zinc-800" />
            <div className="absolute -top-1 left-0 right-0 flex justify-between px-1">
              {milestones.map((milestone, idx) => (
                <div
                  key={idx}
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                    getMilestoneStatus(milestone.threshold) === 'completed'
                      ? 'bg-cyan-400 text-black'
                      : getMilestoneStatus(milestone.threshold) === 'in_progress'
                      ? 'bg-yellow-400 text-black animate-pulse'
                      : 'bg-zinc-700 text-gray-400'
                  }`}
                  style={{ marginLeft: idx === 0 ? '0' : 'auto', marginRight: idx === milestones.length - 1 ? '0' : 'auto' }}
                >
                  {getMilestoneStatus(milestone.threshold) === 'completed' ? '✓' : milestone.threshold}
                </div>
              ))}
            </div>
          </div>

          {/* Milestone Cards */}
          <div className="grid grid-cols-2 gap-3">
            {milestones.map((milestone, idx) => {
              const status = getMilestoneStatus(milestone.threshold);
              const MilestoneIcon = milestone.icon;
              
              return (
                <div
                  key={idx}
                  className={`p-3 rounded-lg text-center ${
                    status === 'completed'
                      ? 'bg-cyan-500/20 border border-cyan-500/30'
                      : status === 'in_progress'
                      ? 'bg-yellow-500/20 border border-yellow-500/30'
                      : 'bg-zinc-800/50 border border-zinc-700'
                  }`}
                >
                  <MilestoneIcon className={`w-6 h-6 mx-auto mb-1 ${
                    status === 'completed' ? 'text-cyan-400' :
                    status === 'in_progress' ? 'text-yellow-400' : 'text-gray-500'
                  }`} />
                  <div className={`text-sm font-medium ${status === 'locked' ? 'text-gray-500' : textPrimary}`}>
                    {milestone.label}
                  </div>
                  <div className={`text-xs ${status === 'locked' ? 'text-gray-600' : 'text-cyan-400'}`}>
                    {milestone.reward}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Level Up Alert */}
          {roadToThePeakProgress >= 100 && (
            <div className="mt-4 p-4 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 rounded-lg text-center">
              <Sparkles className="w-8 h-8 text-cyan-400 mx-auto mb-2" />
              <div className={`font-bold ${textPrimary}`}>Ready to Level Up!</div>
              <p className={`text-sm ${textSecondary}`}>
                You've completed The Road to The Peak! Contact your manager to transition to Competitive status.
              </p>
              <Button className="mt-3 bg-cyan-500 text-black hover:bg-cyan-400">
                <Zap className="w-4 h-4 mr-2" />
                Request Promotion
              </Button>
            </div>
          )}

          {/* Current Progress */}
          <div className="mt-4 text-center">
            <div className="text-3xl font-bold text-cyan-400">{roadToThePeakProgress}%</div>
            <div className={`text-sm ${textSecondary}`}>
              {careerStats?.total_xp || 0} XP earned • {careerStats?.verified_results_count || 0} verified results
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Gear Purchase Goal Tracker - NEW */}
      <Card className={`${cardBg} border-2 border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-cyan-500/5`}>
        <CardHeader>
          <CardTitle className={`${textPrimary} flex items-center gap-2`}>
            <Target className="w-5 h-5 text-emerald-400" />
            Gear Goal Tracker
            <Badge className="ml-auto bg-emerald-500/20 text-emerald-400 border-0 text-xs">SAVE</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Example Goal: New Shortboard */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">🏄</span>
                <div>
                  <div className={`font-medium ${textPrimary}`}>New Shortboard</div>
                  <div className={`text-xs ${textSecondary}`}>Target: $450</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-emerald-400 font-bold">
                  ${(stokeIncome?.total_received || 0).toFixed(0)}
                </div>
                <div className={`text-xs ${textSecondary}`}>saved</div>
              </div>
            </div>
            <Progress 
              value={Math.min(((stokeIncome?.total_received || 0) / 450) * 100, 100)} 
              className="h-3 bg-zinc-800" 
            />
            <div className="flex justify-between mt-1">
              <span className={`text-xs ${textSecondary}`}>
                {Math.round(((stokeIncome?.total_received || 0) / 450) * 100)}% Complete
              </span>
              <span className={`text-xs text-emerald-400`}>
                ${Math.max(450 - (stokeIncome?.total_received || 0), 0).toFixed(0)} to go
              </span>
            </div>
          </div>

          {/* Credit Sources */}
          <div className="p-3 bg-zinc-800/50 rounded-lg mb-4">
            <div className={`text-xs font-medium ${textSecondary} mb-2`}>Credits from:</div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Heart className="w-4 h-4 text-pink-400" />
                <span className={`text-sm ${textPrimary}`}>Photographer Sponsors</span>
              </div>
              <span className="text-pink-400 font-medium">
                ${(stokeIncome?.total_received || 0).toFixed(2)}
              </span>
            </div>
          </div>

          <div className="text-center">
            <p className={`text-xs ${textSecondary}`}>
              Complete events and get sponsored to reach your gear goals!
            </p>
            <Button 
              variant="outline"
              size="sm"
              className="mt-2 border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10"
              onClick={() => navigate('/gear-hub')}
            >
              Browse Gear Hub
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Grom Series Results */}
      <Card className={cardBg}>
        <CardHeader>
          <CardTitle className={`${textPrimary} flex items-center gap-2`}>
            <Trophy className="w-5 h-5 text-yellow-400" />
            Grom Series Results
          </CardTitle>
        </CardHeader>
        <CardContent>
          {competitionResults.length > 0 ? (
            <div className="space-y-3">
              {competitionResults.slice(0, 5).map((result) => (
                <div 
                  key={result.id}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    result.placing <= 3 
                      ? 'bg-gradient-to-r from-yellow-500/10 to-amber-500/10 border border-yellow-500/20'
                      : 'bg-zinc-800/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      result.placing === 1 ? 'bg-yellow-500 text-black' :
                      result.placing === 2 ? 'bg-gray-300 text-black' :
                      result.placing === 3 ? 'bg-amber-600 text-white' :
                      'bg-zinc-700 text-white'
                    }`}>
                      {result.placing === 1 ? '🥇' : result.placing === 2 ? '🥈' : result.placing === 3 ? '🥉' : result.placing}
                    </div>
                    <div>
                      <div className={`font-medium ${textPrimary}`}>{result.event_name}</div>
                      <div className={`text-xs ${textSecondary}`}>{result.event_date}</div>
                    </div>
                  </div>
                  {getVerificationBadge(result.verification_status)}
                </div>
              ))}
            </div>
          ) : (
            <p className={`text-center ${textSecondary} py-4`}>No competition results yet. Start competing!</p>
          )}
          <Button 
            onClick={() => setShowAddResultModal(true)}
            className="w-full mt-4 bg-zinc-800 hover:bg-zinc-700 text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Competition Result
          </Button>
        </CardContent>
      </Card>

      {/* Stoke Sponsors */}
      <Card className={cardBg}>
        <CardHeader>
          <CardTitle className={`${textPrimary} flex items-center gap-2`}>
            <Heart className="w-5 h-5 text-pink-400" />
            Stoke Sponsors
            <span className={`text-xs ${textSecondary} ml-2`}>(Parents, Local Shops)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sponsorships.length > 0 ? (
            <div className="space-y-3">
              {sponsorships.map((sponsor) => (
                <div key={sponsor.id} className="flex items-center gap-3 p-3 bg-zinc-800/50 rounded-lg">
                  <div className="w-10 h-10 rounded-full bg-pink-500/20 flex items-center justify-center">
                    <Heart className="w-5 h-5 text-pink-400" />
                  </div>
                  <div className="flex-1">
                    <div className={`font-medium ${textPrimary}`}>{sponsor.sponsor_name}</div>
                    <div className={`text-xs ${textSecondary}`}>{sponsor.sponsor_type === 'parent' ? 'Family Support' : 'Local Stoke'}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={`text-center ${textSecondary} py-4`}>Add your supporters!</p>
          )}
          <Button 
            onClick={() => setShowAddSponsorModal(true)}
            variant="outline" 
            className="w-full mt-4 border-zinc-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Stoke Sponsor
          </Button>
        </CardContent>
      </Card>

      {/* Photographer Support Income */}
      {stokeIncome && stokeIncome.total_received > 0 && (
        <Card className={`${cardBg} border-2 border-pink-500/30 bg-gradient-to-br from-pink-500/5 to-purple-500/5`}>
          <CardHeader>
            <CardTitle className={`${textPrimary} flex items-center gap-2`}>
              <DollarSign className="w-5 h-5 text-emerald-400" />
              Photographer Support Funds
              <Badge className="ml-auto bg-emerald-500/20 text-emerald-400 border-0 text-xs">5% Fee Only</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="text-center p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <div className="text-2xl font-bold text-emerald-400">${stokeIncome.total_received.toFixed(2)}</div>
                <div className={`text-xs ${textSecondary}`}>Funds Received</div>
              </div>
              <div className="text-center p-3 bg-pink-500/10 border border-pink-500/20 rounded-lg">
                <div className="text-2xl font-bold text-pink-400">{stokeIncome.supporter_count}</div>
                <div className={`text-xs ${textSecondary}`}>Pro Supporters</div>
              </div>
            </div>
            
            {stokeIncome.income_records?.length > 0 && (
              <div className="space-y-2">
                <div className={`text-sm font-medium ${textSecondary} mb-2`}>Recent Support from Pros</div>
                {stokeIncome.income_records.slice(0, 3).map((record) => (
                  <div 
                    key={record.id}
                    className="flex items-center gap-3 p-2 bg-gradient-to-r from-emerald-500/10 to-pink-500/10 border border-emerald-500/20 rounded-lg"
                  >
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={record.donor_avatar} />
                      <AvatarFallback className="bg-emerald-500/20 text-emerald-400 text-xs">
                        {record.donor_name?.charAt(0) || 'P'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium ${textPrimary} truncate`}>{record.donor_name}</div>
                      <div className={`text-xs ${textSecondary}`}>
                        {new Date(record.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-emerald-400 font-bold">+${record.net_amount.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            )}
            
            <div className="mt-4 p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-lg text-center">
              <Heart className="w-6 h-6 text-pink-400 mx-auto mb-1" />
              <p className={`text-xs ${textSecondary}`}>
                Pro photographers in your community are helping fund your surf journey! 
                Groms pay only 5% platform fee (vs 10% for others).
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grom-Friendly Coaches & Photographers */}
      <Card className={cardBg}>
        <CardHeader>
          <CardTitle className={`${textPrimary} flex items-center gap-2`}>
            <Users className="w-5 h-5 text-emerald-400" />
            Grom-Friendly Mentors
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className={`text-sm ${textSecondary} mb-3`}>
            Coaches and photographers experienced with young surfers
          </p>
          <div className="space-y-3">
            {gromCoaches.map((coach) => (
              <div 
                key={coach.id}
                className="flex items-center gap-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg"
              >
                <Avatar className="w-10 h-10 border-2 border-emerald-500/50">
                  <AvatarImage src={coach.avatar} />
                  <AvatarFallback className="bg-emerald-500/20 text-emerald-400">
                    {coach.name?.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className={`font-medium ${textPrimary}`}>{coach.name}</div>
                  <div className={`text-xs ${textSecondary}`}>{coach.specialty}</div>
                </div>
                <Badge className="bg-emerald-500/20 text-emerald-400 border-0 text-xs">Grom Friendly</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Crew Stats for The Inside */}
      <Card className={cardBg} data-testid="inside-crew-stats">
        <CardHeader>
          <CardTitle className={`${textPrimary} flex items-center gap-2`}>
            <Users className="w-5 h-5 text-cyan-400" />
            Your Crew Stats
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CrewLeaderboard 
            userId={user?.id} 
            variant="profile"
            showPrivacyControls={true}
          />
        </CardContent>
      </Card>

      {/* Add Competition Result Modal - Reusing from ThePeakHub pattern */}
      <Dialog open={showAddResultModal} onOpenChange={setShowAddResultModal}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Add Grom Series Result</DialogTitle>
          </DialogHeader>
          <AddResultForm
            userId={user?.id}
            defaultTier="Grom_Series"
            onSuccess={() => {
              setShowAddResultModal(false);
              fetchGromData();
              toast.success('Result added!');
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Add Sponsor Modal */}
      <Dialog open={showAddSponsorModal} onOpenChange={setShowAddSponsorModal}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Add Stoke Sponsor</DialogTitle>
          </DialogHeader>
          <AddStokeSponsorForm
            userId={user?.id}
            onSuccess={() => {
              setShowAddSponsorModal(false);
              fetchGromData();
              toast.success('Sponsor added!');
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Add Result Form Component
const AddResultForm = ({ userId, defaultTier, onSuccess }) => {
  const [formData, setFormData] = useState({
    event_name: '',
    event_date: '',
    placing: '',
    heat_wins: '',
    proof_image_url: ''
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!formData.event_name || !formData.event_date || !formData.placing) {
      toast.error('Please fill required fields');
      return;
    }

    setLoading(true);
    try {
      await apiClient.post(`/career/competition-results?surfer_id=${userId}`, {
        ...formData,
        event_tier: defaultTier,
        placing: parseInt(formData.placing),
        heat_wins: formData.heat_wins ? parseInt(formData.heat_wins) : 0
      });
      onSuccess();
    } catch (error) {
      toast.error('Failed to add result');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Input
        placeholder="Event Name *"
        value={formData.event_name}
        onChange={(e) => setFormData({ ...formData, event_name: e.target.value })}
        className="bg-zinc-800 border-zinc-700"
      />
      <Input
        type="date"
        value={formData.event_date}
        onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
        className="bg-zinc-800 border-zinc-700"
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          type="number"
          placeholder="Your Placing *"
          value={formData.placing}
          onChange={(e) => setFormData({ ...formData, placing: e.target.value })}
          className="bg-zinc-800 border-zinc-700"
        />
        <Input
          type="number"
          placeholder="Heat Wins"
          value={formData.heat_wins}
          onChange={(e) => setFormData({ ...formData, heat_wins: e.target.value })}
          className="bg-zinc-800 border-zinc-700"
        />
      </div>
      <Input
        placeholder="Proof Image URL (optional)"
        value={formData.proof_image_url}
        onChange={(e) => setFormData({ ...formData, proof_image_url: e.target.value })}
        className="bg-zinc-800 border-zinc-700"
      />
      <DialogFooter>
        <Button onClick={handleSubmit} disabled={loading} className="w-full bg-cyan-500 text-black hover:bg-cyan-400">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add Result'}
        </Button>
      </DialogFooter>
    </div>
  );
};

// Add Stoke Sponsor Form
const AddStokeSponsorForm = ({ userId, onSuccess }) => {
  const [formData, setFormData] = useState({
    sponsor_name: '',
    sponsor_type: 'stoke_sponsor'
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!formData.sponsor_name) {
      toast.error('Please enter sponsor name');
      return;
    }

    setLoading(true);
    try {
      await apiClient.post(`/career/sponsorships?surfer_id=${userId}`, {
        ...formData,
        sponsorship_tier: 'stoke'
      });
      onSuccess();
    } catch (error) {
      toast.error('Failed to add sponsor');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Input
        placeholder="Sponsor Name *"
        value={formData.sponsor_name}
        onChange={(e) => setFormData({ ...formData, sponsor_name: e.target.value })}
        className="bg-zinc-800 border-zinc-700"
      />
      <select
        value={formData.sponsor_type}
        onChange={(e) => setFormData({ ...formData, sponsor_type: e.target.value })}
        className="w-full p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white"
      >
        <option value="parent">Family Support</option>
        <option value="local_shop">Local Surf Shop</option>
        <option value="stoke_sponsor">Stoke Sponsor</option>
      </select>
      <DialogFooter>
        <Button onClick={handleSubmit} disabled={loading} className="w-full bg-pink-500 text-black hover:bg-pink-400">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add Sponsor'}
        </Button>
      </DialogFooter>
    </div>
  );
};

export default TheInsideHub;
