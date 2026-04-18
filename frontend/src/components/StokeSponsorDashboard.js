import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { 
  Heart, Users, TrendingUp, DollarSign, Loader2, Search, Gift, Zap, Medal, Baby,
  Trophy
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { toast } from 'sonner';
import axios from 'axios';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Stoke Sponsor Dashboard - Photographers supporting Surfers
 * Features: Browse eligible surfers, make contributions, track impact
 */
export const StokeSponsorDashboard = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  
  const [eligibleSurfers, setEligibleSurfers] = useState([]);
  const [contributions, setContributions] = useState({ total: 0, count: 0, list: [] });
  const [loading, setLoading] = useState(true);
  const [selectedSurfer, setSelectedSurfer] = useState(null);
  const [showContributeModal, setShowContributeModal] = useState(false);
  const [tierFilter, setTierFilter] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const isLight = theme === 'light';
  const cardBg = isLight ? 'bg-white border-gray-200' : 'bg-card border-border';
  const textPrimary = isLight ? 'text-gray-900' : 'text-foreground';
  const textSecondary = isLight ? 'text-gray-600' : 'text-muted-foreground';

  useEffect(() => {
    if (user?.id) {
      fetchData();
    }
  }, [user?.id, tierFilter]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const filterParam = tierFilter ? `&tier_filter=${tierFilter}` : '';
      const [surfersRes, contributionsRes] = await Promise.all([
        axios.get(`${API}/career/stoke-sponsor/eligible-surfers?photographer_id=${user.id}${filterParam}`),
        axios.get(`${API}/career/stoke-sponsor/my-contributions/${user.id}`)
      ]);
      
      setEligibleSurfers(surfersRes.data?.eligible_surfers || []);
      setContributions({
        total: contributionsRes.data?.total_contributed || 0,
        count: contributionsRes.data?.contribution_count || 0,
        list: contributionsRes.data?.contributions || []
      });
    } catch (error) {
      logger.error('Failed to fetch stoke sponsor data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getRoleBadge = (role) => {
    const badges = {
      'Grom': { color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30', icon: Baby, label: 'Grom' },
      'Comp Surfer': { color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: Trophy, label: 'Competitive' },
      'Pro': { color: 'bg-amber-500/20 text-amber-400 border-amber-500/30', icon: Medal, label: 'Pro' }
    };
    const badge = badges[role] || { color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: Users, label: 'Surfer' };
    const Icon = badge.icon;
    
    return (
      <Badge className={`${badge.color} border text-xs`}>
        <Icon className="w-3 h-3 mr-1" /> {badge.label}
      </Badge>
    );
  };

  const filteredSurfers = eligibleSurfers.filter(surfer => 
    !searchQuery || 
    surfer.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    surfer.home_break?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-pink-400 animate-spin" />
      </div>
    );
  }

  return (
    <div 
      className="space-y-6 pb-24 md:pb-6" 
      data-testid="stoke-sponsor-dashboard"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)' }}
    >
      {/* Header */}
      <div className="text-center">
        <h1 className={`text-3xl font-bold ${textPrimary} flex items-center justify-center gap-2`} style={{ fontFamily: 'Oswald' }}>
          <Heart className="w-8 h-8 text-pink-400" />
          Stoke Sponsor
        </h1>
        <p className={`${textSecondary} mt-1`}>Support the Next Generation of Surf</p>
      </div>

      {/* Impact Stats */}
      <Card className={`${cardBg} border-2 border-pink-500/30 bg-gradient-to-br from-pink-500/5 to-red-500/5`}>
        <CardContent className="pt-6">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-pink-400">${contributions.total.toFixed(2)}</div>
              <div className={`text-xs ${textSecondary}`}>Total Given</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-400">{contributions.count}</div>
              <div className={`text-xs ${textSecondary}`}>Sponsorships</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-400">{contributions.count * 2}</div>
              <div className={`text-xs ${textSecondary}`}>XP Earned</div>
            </div>
          </div>
          <p className={`text-center text-sm ${textSecondary} mt-4`}>
            You earn 2 XP for every $1 you contribute
          </p>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card className={cardBg}>
        <CardContent className="pt-4">
          <div className="flex flex-col gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search surfers by name or home break..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-zinc-800 border-zinc-700"
              />
            </div>
            
            {/* Tier Filters */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant={tierFilter === null ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTierFilter(null)}
                className={tierFilter === null ? 'bg-pink-500 text-white' : 'border-zinc-700'}
              >
                All
              </Button>
              <Button
                variant={tierFilter === 'grom_rising' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTierFilter('grom_rising')}
                className={tierFilter === 'grom_rising' ? 'bg-cyan-500 text-black' : 'border-zinc-700'}
              >
                <Baby className="w-3 h-3 mr-1" /> Groms
              </Button>
              <Button
                variant={tierFilter === 'competitive' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTierFilter('competitive')}
                className={tierFilter === 'competitive' ? 'bg-yellow-500 text-black' : 'border-zinc-700'}
              >
                <Trophy className="w-3 h-3 mr-1" /> Competitive
              </Button>
              <Button
                variant={tierFilter === 'pro_elite' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTierFilter('pro_elite')}
                className={tierFilter === 'pro_elite' ? 'bg-amber-500 text-black' : 'border-zinc-700'}
              >
                <Medal className="w-3 h-3 mr-1" /> Pro
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Eligible Surfers */}
      <Card className={cardBg}>
        <CardHeader>
          <CardTitle className={`${textPrimary} flex items-center gap-2`}>
            <Users className="w-5 h-5 text-pink-400" />
            Surfers to Support ({filteredSurfers.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {filteredSurfers.length > 0 ? (
            filteredSurfers.slice(0, 20).map((surfer) => (
              <div 
                key={surfer.id}
                className="flex items-center gap-3 p-3 bg-zinc-800/50 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                <Avatar 
                  className="w-12 h-12 border-2 border-pink-500/30 cursor-pointer"
                  onClick={() => navigate(`/profile/${surfer.id}`)}
                >
                  <AvatarImage src={surfer.avatar_url} />
                  <AvatarFallback className="bg-pink-500/20 text-pink-400">
                    {surfer.full_name?.charAt(0) || 'S'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className={`font-medium ${textPrimary} truncate`}>{surfer.full_name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {getRoleBadge(surfer.role)}
                    {surfer.home_break && (
                      <span className={`text-xs ${textSecondary}`}>{surfer.home_break}</span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setSelectedSurfer(surfer);
                    setShowContributeModal(true);
                  }}
                  className="bg-pink-500 hover:bg-pink-400 text-white"
                >
                  <Gift className="w-4 h-4 mr-1" />
                  Sponsor
                </Button>
              </div>
            ))
          ) : (
            <p className={`text-center ${textSecondary} py-4`}>
              No surfers found matching your criteria
            </p>
          )}
        </CardContent>
      </Card>

      {/* Recent Contributions */}
      {contributions.list.length > 0 && (
        <Card className={cardBg}>
          <CardHeader>
            <CardTitle className={`${textPrimary} flex items-center gap-2`}>
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              Your Recent Contributions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {contributions.list.slice(0, 5).map((contrib) => (
              <div 
                key={contrib.id}
                className="flex items-center justify-between p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Heart className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <div className={`font-medium ${textPrimary}`}>${contrib.amount.toFixed(2)}</div>
                    <div className={`text-xs ${textSecondary}`}>
                      {new Date(contrib.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                {contrib.shaka_sent && (
                  <Badge className="bg-yellow-500/20 text-yellow-400 border-0 text-xs">
                    Shaka Received
                  </Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Contribute Modal */}
      <ContributeModal
        isOpen={showContributeModal}
        onClose={() => {
          setShowContributeModal(false);
          setSelectedSurfer(null);
        }}
        surfer={selectedSurfer}
        photographerId={user?.id}
        userCredits={user?.withdrawable_credits || 0}
        onSuccess={() => {
          setShowContributeModal(false);
          setSelectedSurfer(null);
          fetchData();
          toast.success('Stoke Sponsor contribution sent!');
        }}
      />
    </div>
  );
};

// Contribute Modal Component
const ContributeModal = ({ isOpen, onClose, surfer, photographerId, userCredits, onSuccess }) => {
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const presetAmounts = [5, 10, 25, 50, 100];

  const handleSubmit = async () => {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (numAmount > userCredits) {
      toast.error(`Insufficient credits. You have $${userCredits.toFixed(2)} available.`);
      return;
    }

    setLoading(true);
    try {
      await axios.post(`${API}/career/stoke-sponsor/contribute?photographer_id=${photographerId}`, {
        surfer_id: surfer.id,
        amount: numAmount,
        message: message || null
      });
      onSuccess();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send contribution');
    } finally {
      setLoading(false);
    }
  };

  if (!surfer) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-pink-400" />
            Sponsor {surfer.full_name}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Surfer Info */}
          <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-lg">
            <Avatar className="w-12 h-12">
              <AvatarImage src={surfer.avatar_url} />
              <AvatarFallback className="bg-pink-500/20 text-pink-400">
                {surfer.full_name?.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="font-medium">{surfer.full_name}</div>
              <div className="text-sm text-gray-400">{surfer.role}</div>
            </div>
          </div>

          {/* Fee Info */}
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Platform fee:</span>
              <span className="text-emerald-400">{surfer.role === 'Grom' ? '5%' : '10%'}</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Lower fees for supporting young surfers
            </div>
          </div>

          {/* Your Credits */}
          <div className="p-3 bg-zinc-800 rounded-lg">
            <div className="text-sm text-gray-400">Your Available Credits</div>
            <div className="text-xl font-bold text-emerald-400">${userCredits.toFixed(2)}</div>
          </div>

          {/* Preset Amounts */}
          <div className="grid grid-cols-5 gap-2">
            {presetAmounts.map((preset) => (
              <Button
                key={preset}
                variant="outline"
                size="sm"
                onClick={() => setAmount(preset.toString())}
                className={`border-zinc-700 ${amount === preset.toString() ? 'bg-pink-500 text-white border-pink-500' : ''}`}
              >
                ${preset}
              </Button>
            ))}
          </div>

          {/* Custom Amount */}
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="number"
              placeholder="Custom amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="pl-10 bg-zinc-800 border-zinc-700"
            />
          </div>

          {/* Message */}
          <Input
            placeholder="Add a message (optional)"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="bg-zinc-800 border-zinc-700"
          />

          {/* XP Preview */}
          {amount && parseFloat(amount) > 0 && (
            <div className="flex items-center justify-center gap-2 p-2 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
              <Zap className="w-4 h-4 text-cyan-400" />
              <span className="text-cyan-400 font-medium">
                You'll earn {Math.floor(parseFloat(amount) * 2)} XP!
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-zinc-700">
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={loading || !amount || parseFloat(amount) <= 0}
            className="bg-pink-500 text-white hover:bg-pink-400"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
              <>
                <Heart className="w-4 h-4 mr-2" />
                Send ${amount || '0'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default StokeSponsorDashboard;
