import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { 
  Trophy, Star, TrendingUp, Award, Users, Camera, Calendar, 
  ChevronRight, Loader2, Plus, CheckCircle, Clock, Medal,
  Target, Sparkles, Crown, Waves, Heart, DollarSign, Lock
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { toast } from 'sonner';
import axios from 'axios';
import { GoldPassSlotCard } from './GoldPassSlotCard';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * The Peak - Career Hub for Pro-Elite (⭐+) and Competitive (🏄) surfers
 * Features: Competition Stats, Sponsorship Manager, Gold-Pass Booking, Elite Talent Feed
 */
export const ThePeakHub = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  
  const [careerStats, setCareerStats] = useState(null);
  const [sponsorships, setSponsorships] = useState([]);
  const [competitionResults, setCompetitionResults] = useState([]);
  const [elitePhotographers, setElitePhotographers] = useState([]);
  const [goldPassSlots, setGoldPassSlots] = useState([]);
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
      fetchCareerData();
    }
  }, [user?.id]);

  const fetchCareerData = async () => {
    setLoading(true);
    try {
      const [statsRes, sponsorsRes, resultsRes, photographersRes, slotsRes, stokeRes] = await Promise.all([
        axios.get(`${API}/career/stats/${user.id}`).catch(() => ({ data: null })),
        axios.get(`${API}/career/sponsorships/${user.id}`).catch(() => ({ data: { sponsorships: [] } })),
        axios.get(`${API}/career/competition-results/${user.id}`).catch(() => ({ data: { results: [] } })),
        axios.get(`${API}/career/elite-photographers`).catch(() => ({ data: { elite_photographers: [] } })),
        axios.get(`${API}/career/gold-pass/available?surfer_id=${user.id}`).catch(() => ({ data: { slots: [] } })),
        axios.get(`${API}/career/stoke-sponsor/income/${user.id}`).catch(() => ({ data: null }))
      ]);
      
      setCareerStats(statsRes.data);
      setSponsorships(sponsorsRes.data?.sponsorships || []);
      setCompetitionResults(resultsRes.data?.results || []);
      setElitePhotographers(photographersRes.data?.elite_photographers || []);
      setGoldPassSlots(slotsRes.data?.slots || []);
      setStokeIncome(stokeRes.data);
    } catch (error) {
      logger.error('Failed to fetch career data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTierBadge = (tier) => {
    if (tier === 'pro_elite') {
      return (
        <Badge className="bg-gradient-to-r from-yellow-400 to-amber-500 text-black border-0">
          <Star className="w-3 h-3 mr-1" /> Pro-Elite
        </Badge>
      );
    }
    if (tier === 'competitive') {
      return (
        <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30">
          <Waves className="w-3 h-3 mr-1" /> Competitive
        </Badge>
      );
    }
    return null;
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
      data-testid="the-peak-hub"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)' }}
    >
      {/* Header */}
      <div className="text-center">
        <h1 className={`text-3xl font-bold ${textPrimary} flex items-center justify-center gap-2`} style={{ fontFamily: 'Oswald' }}>
          <Crown className="w-8 h-8 text-yellow-400" />
          The Peak
        </h1>
        <p className={`${textSecondary} mt-1`}>Your Pro Career Dashboard</p>
        {careerStats?.elite_tier && (
          <div className="mt-2">{getTierBadge(careerStats.elite_tier)}</div>
        )}
      </div>

      {/* Career Stats Card */}
      <Card className={`${cardBg} border-2 border-yellow-500/30 bg-gradient-to-br from-yellow-500/5 to-orange-500/5`}>
        <CardHeader>
          <CardTitle className={`${textPrimary} flex items-center gap-2`}>
            <Trophy className="w-5 h-5 text-yellow-400" />
            Competition Stats
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 bg-zinc-800/50 rounded-lg">
              <div className="text-2xl font-bold text-yellow-400">{careerStats?.stats?.event_wins || 0}</div>
              <div className={`text-xs ${textSecondary}`}>Event Wins</div>
            </div>
            <div className="text-center p-3 bg-zinc-800/50 rounded-lg">
              <div className="text-2xl font-bold text-amber-400">{careerStats?.stats?.podium_finishes || 0}</div>
              <div className={`text-xs ${textSecondary}`}>Podiums</div>
            </div>
            <div className="text-center p-3 bg-zinc-800/50 rounded-lg">
              <div className="text-2xl font-bold text-cyan-400">{careerStats?.stats?.total_heat_wins || 0}</div>
              <div className={`text-xs ${textSecondary}`}>Heat Wins</div>
            </div>
            <div className="text-center p-3 bg-zinc-800/50 rounded-lg">
              <div className="text-2xl font-bold text-emerald-400">{careerStats?.stats?.avg_wave_score || '-'}</div>
              <div className={`text-xs ${textSecondary}`}>Avg Score</div>
            </div>
          </div>
          
          {careerStats?.world_ranking && (
            <div className="mt-4 p-3 bg-gradient-to-r from-yellow-500/20 to-amber-500/20 rounded-lg text-center">
              <div className="text-sm text-yellow-400">World Ranking</div>
              <div className="text-3xl font-bold text-white">#{careerStats.world_ranking}</div>
            </div>
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

      {/* Recent Results */}
      {competitionResults.length > 0 && (
        <Card className={cardBg}>
          <CardHeader>
            <CardTitle className={`${textPrimary} flex items-center gap-2`}>
              <Medal className="w-5 h-5 text-amber-400" />
              Recent Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
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
                    <div className={`text-xs ${textSecondary}`}>{result.event_date} • {result.event_location}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getVerificationBadge(result.verification_status)}
                  {result.xp_awarded > 0 && (
                    <Badge className="bg-cyan-500/20 text-cyan-400 border-0 text-xs">
                      +{result.xp_awarded} XP
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Sponsorship Manager */}
      <Card className={cardBg}>
        <CardHeader>
          <CardTitle className={`${textPrimary} flex items-center gap-2`}>
            <Award className="w-5 h-5 text-emerald-400" />
            Sponsorship Manager
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sponsorships.length > 0 ? (
            <div className="space-y-3">
              {sponsorships.map((sponsor) => (
                <div key={sponsor.id} className="flex items-center gap-3 p-3 bg-zinc-800/50 rounded-lg">
                  {sponsor.sponsor_logo_url ? (
                    <img src={sponsor.sponsor_logo_url} alt={sponsor.sponsor_name} className="w-12 h-12 rounded-lg object-contain bg-white p-1" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                      <Award className="w-6 h-6 text-emerald-400" />
                    </div>
                  )}
                  <div className="flex-1">
                    <div className={`font-medium ${textPrimary}`}>{sponsor.sponsor_name}</div>
                    <div className={`text-xs ${textSecondary}`}>{sponsor.sponsorship_tier || 'Sponsor'}</div>
                  </div>
                  {sponsor.auto_pay_enabled && (
                    <Badge className="bg-emerald-500/20 text-emerald-400 border-0 text-xs">Auto-Pay</Badge>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className={`text-center ${textSecondary} py-4`}>No sponsorships yet</p>
          )}
          <Button 
            onClick={() => setShowAddSponsorModal(true)}
            variant="outline" 
            className="w-full mt-4 border-zinc-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Sponsor
          </Button>
        </CardContent>
      </Card>

      {/* Stoke Sponsor Income - Money from Photographers */}
      {stokeIncome && stokeIncome.total_received > 0 && (
        <Card className={`${cardBg} border-2 border-pink-500/30 bg-gradient-to-br from-pink-500/5 to-red-500/5`}>
          <CardHeader>
            <CardTitle className={`${textPrimary} flex items-center gap-2`}>
              <Heart className="w-5 h-5 text-pink-400" />
              Stoke Sponsor Income
              <Badge className="ml-auto bg-pink-500/20 text-pink-400 border-0 text-xs">NEW</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="text-center p-3 bg-zinc-800/50 rounded-lg">
                <div className="text-2xl font-bold text-pink-400">${stokeIncome.total_received.toFixed(2)}</div>
                <div className={`text-xs ${textSecondary}`}>Total Received</div>
              </div>
              <div className="text-center p-3 bg-zinc-800/50 rounded-lg">
                <div className="text-2xl font-bold text-emerald-400">{stokeIncome.supporter_count}</div>
                <div className={`text-xs ${textSecondary}`}>Supporters</div>
              </div>
            </div>
            
            {stokeIncome.income_records?.length > 0 && (
              <div className="space-y-2">
                <div className={`text-sm font-medium ${textSecondary} mb-2`}>Recent Support</div>
                {stokeIncome.income_records.slice(0, 3).map((record) => (
                  <div 
                    key={record.id}
                    className="flex items-center gap-3 p-2 bg-pink-500/10 border border-pink-500/20 rounded-lg"
                  >
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={record.donor_avatar} />
                      <AvatarFallback className="bg-pink-500/20 text-pink-400 text-xs">
                        {record.donor_name?.charAt(0) || 'P'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium ${textPrimary} truncate`}>{record.donor_name}</div>
                      <div className={`text-xs ${textSecondary}`}>
                        {new Date(record.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-pink-400 font-medium">+${record.net_amount.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            )}
            
            <p className={`text-xs ${textSecondary} mt-3 text-center`}>
              Photographers in the ecosystem are supporting your surf career!
            </p>
          </CardContent>
        </Card>
      )}

      {/* Gold-Pass Booking Slots - Using the proper component */}
      {goldPassSlots.length > 0 && (
        <Card className={`${cardBg} border-2 border-yellow-500/30`}>
          <CardHeader>
            <CardTitle className={`${textPrimary} flex items-center gap-2`}>
              <Crown className="w-5 h-5 text-yellow-400" />
              Gold Pass Bookings
              <Badge className="ml-auto bg-gradient-to-r from-yellow-400 to-amber-500 text-black border-0 text-xs">
                {user?.subscription_tier === 'tier_3' ? 'ACTIVE' : 'LOCKED'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-sm ${textSecondary} mb-3`}>
              {user?.subscription_tier === 'tier_3'
                ? `${goldPassSlots.length} exclusive slots available for early booking`
                : 'Upgrade to Premium for 2-hour early access to all slots'}
            </p>
            <div className="space-y-3">
              {goldPassSlots.slice(0, 3).map((slot) => (
                <GoldPassSlotCard
                  key={slot.id}
                  slot={slot}
                  hasGoldPass={user?.subscription_tier === 'tier_3'}
                  onBook={async (s) => {
                    try {
                      await axios.post(`${API}/career/gold-pass/${s.id}/book?surfer_id=${user.id}`);
                      toast.success('Slot booked successfully!');
                      fetchCareerData();
                    } catch (error) {
                      toast.error(error.response?.data?.detail || 'Failed to book slot');
                    }
                  }}
                  showPhotographer={true}
                />
              ))}
            </div>
            {goldPassSlots.length > 3 && (
              <Button 
                variant="ghost" 
                className="w-full mt-3 text-yellow-400 hover:bg-yellow-500/10"
                onClick={() => navigate('/bookings')}
              >
                View All {goldPassSlots.length} Slots
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Elite Photographers Directory */}
      <Card className={`${cardBg} border-2 border-yellow-500/30`}>
        <CardHeader>
          <CardTitle className={`${textPrimary} flex items-center gap-2`}>
            <Sparkles className="w-5 h-5 text-yellow-400" />
            Elite Talent Feed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className={`text-sm ${textSecondary} mb-3`}>
            Vetted photographers who shoot world-class talent
          </p>
          <div className="space-y-3">
            {elitePhotographers.slice(0, 3).map((photographer) => (
              <div 
                key={photographer.id}
                className="flex items-center gap-3 p-3 bg-gradient-to-r from-yellow-500/10 to-amber-500/10 border border-yellow-500/20 rounded-lg cursor-pointer hover:border-yellow-500/50 transition-colors"
                onClick={() => navigate(`/profile/${photographer.id}`)}
              >
                <Avatar className="w-12 h-12 border-2 border-yellow-500/50">
                  <AvatarImage src={photographer.avatar_url} />
                  <AvatarFallback className="bg-yellow-500/20 text-yellow-400">
                    {photographer.full_name?.charAt(0) || 'P'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className={`font-medium ${textPrimary}`}>{photographer.full_name}</div>
                  <div className={`text-xs ${textSecondary}`}>
                    {photographer.is_verified && <CheckCircle className="w-3 h-3 inline mr-1 text-cyan-400" />}
                    Elite Photographer
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-yellow-400" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Add Competition Result Modal */}
      <AddCompetitionResultModal
        isOpen={showAddResultModal}
        onClose={() => setShowAddResultModal(false)}
        userId={user?.id}
        onSuccess={() => {
          setShowAddResultModal(false);
          fetchCareerData();
          toast.success('Competition result added!');
        }}
      />

      {/* Add Sponsor Modal */}
      <AddSponsorModal
        isOpen={showAddSponsorModal}
        onClose={() => setShowAddSponsorModal(false)}
        userId={user?.id}
        onSuccess={() => {
          setShowAddSponsorModal(false);
          fetchCareerData();
          toast.success('Sponsor added!');
        }}
      />
    </div>
  );
};

// Add Competition Result Modal
const AddCompetitionResultModal = ({ isOpen, onClose, userId, onSuccess }) => {
  const [formData, setFormData] = useState({
    event_name: '',
    event_date: '',
    event_location: '',
    event_tier: 'Local',
    placing: '',
    total_competitors: '',
    heat_wins: '',
    avg_wave_score: '',
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
      await axios.post(`${API}/career/competition-results?surfer_id=${userId}`, {
        ...formData,
        placing: parseInt(formData.placing),
        total_competitors: formData.total_competitors ? parseInt(formData.total_competitors) : null,
        heat_wins: formData.heat_wins ? parseInt(formData.heat_wins) : 0,
        avg_wave_score: formData.avg_wave_score ? parseFloat(formData.avg_wave_score) : null
      });
      onSuccess();
    } catch (error) {
      toast.error('Failed to add result');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle>Add Competition Result</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            placeholder="Event Name *"
            value={formData.event_name}
            onChange={(e) => setFormData({ ...formData, event_name: e.target.value })}
            className="bg-zinc-800 border-zinc-700"
          />
          <Input
            type="date"
            placeholder="Event Date *"
            value={formData.event_date}
            onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
            className="bg-zinc-800 border-zinc-700"
          />
          <Input
            placeholder="Location"
            value={formData.event_location}
            onChange={(e) => setFormData({ ...formData, event_location: e.target.value })}
            className="bg-zinc-800 border-zinc-700"
          />
          <select
            value={formData.event_tier}
            onChange={(e) => setFormData({ ...formData, event_tier: e.target.value })}
            className="w-full p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white"
          >
            <option value="WSL_CT">WSL Championship Tour</option>
            <option value="WSL_QS">WSL Qualifying Series</option>
            <option value="Regional">Regional</option>
            <option value="Local">Local</option>
            <option value="Grom_Series">Grom Series</option>
          </select>
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
              placeholder="Total Competitors"
              value={formData.total_competitors}
              onChange={(e) => setFormData({ ...formData, total_competitors: e.target.value })}
              className="bg-zinc-800 border-zinc-700"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              type="number"
              placeholder="Heat Wins"
              value={formData.heat_wins}
              onChange={(e) => setFormData({ ...formData, heat_wins: e.target.value })}
              className="bg-zinc-800 border-zinc-700"
            />
            <Input
              type="number"
              step="0.1"
              placeholder="Avg Wave Score"
              value={formData.avg_wave_score}
              onChange={(e) => setFormData({ ...formData, avg_wave_score: e.target.value })}
              className="bg-zinc-800 border-zinc-700"
            />
          </div>
          <Input
            placeholder="Proof Image URL (trophy/bracket photo)"
            value={formData.proof_image_url}
            onChange={(e) => setFormData({ ...formData, proof_image_url: e.target.value })}
            className="bg-zinc-800 border-zinc-700"
          />
          <p className="text-xs text-gray-400">Upload a photo of your trophy or bracket to earn "Community Verified" badge</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-zinc-700">Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading} className="bg-yellow-500 text-black hover:bg-yellow-400">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add Result'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// Add Sponsor Modal
const AddSponsorModal = ({ isOpen, onClose, userId, onSuccess }) => {
  const [formData, setFormData] = useState({
    sponsor_name: '',
    sponsor_type: 'brand',
    sponsor_logo_url: '',
    sponsor_website: '',
    sponsorship_tier: 'supporting'
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!formData.sponsor_name) {
      toast.error('Please enter sponsor name');
      return;
    }

    setLoading(true);
    try {
      await axios.post(`${API}/career/sponsorships?surfer_id=${userId}`, formData);
      onSuccess();
    } catch (error) {
      toast.error('Failed to add sponsor');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle>Add Sponsor</DialogTitle>
        </DialogHeader>
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
            <option value="brand">Brand</option>
            <option value="local_shop">Local Shop</option>
            <option value="stoke_sponsor">Stoke Sponsor</option>
          </select>
          <select
            value={formData.sponsorship_tier}
            onChange={(e) => setFormData({ ...formData, sponsorship_tier: e.target.value })}
            className="w-full p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white"
          >
            <option value="title">Title Sponsor</option>
            <option value="major">Major Sponsor</option>
            <option value="supporting">Supporting Sponsor</option>
            <option value="stoke">Stoke Sponsor</option>
          </select>
          <Input
            placeholder="Logo URL"
            value={formData.sponsor_logo_url}
            onChange={(e) => setFormData({ ...formData, sponsor_logo_url: e.target.value })}
            className="bg-zinc-800 border-zinc-700"
          />
          <Input
            placeholder="Website URL"
            value={formData.sponsor_website}
            onChange={(e) => setFormData({ ...formData, sponsor_website: e.target.value })}
            className="bg-zinc-800 border-zinc-700"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-zinc-700">Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading} className="bg-emerald-500 text-black hover:bg-emerald-400">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add Sponsor'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ThePeakHub;
