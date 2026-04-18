import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { usePersona } from '../contexts/PersonaContext';
import { useEarningsSync, usePhotographerActivitySync } from '../hooks/useWebSocket';
import axios from 'axios';
import logger from '../utils/logger';
import { 
  DollarSign, TrendingUp, Camera, Calendar, Image, Users, 
  Settings, Sparkles, Target, Award, Heart,
  Wallet, ShoppingBag, Plane, PieChart, Wifi,
  BarChart3, Eye
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { Slider } from './ui/slider';
import { toast } from 'sonner';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Helper function to get commission rate based on subscription tier
const getCommissionRate = (subscriptionTier) => {
  // Check localStorage for admin-configured rates first
  const savedRates = localStorage.getItem('admin_commission_rates');
  if (savedRates) {
    try {
      const adminRates = JSON.parse(savedRates);
      const tier = subscriptionTier?.toLowerCase?.() || 'free';
      // Map alternate tier names to standard names
      const tierMap = { 'basic': 'tier_2', 'premium': 'tier_3', 'pro': 'tier_3' };
      const normalizedTier = tierMap[tier] || tier;
      if (adminRates[normalizedTier] !== undefined) {
        return adminRates[normalizedTier] / 100;
      }
    } catch (e) {
      // Fall through to defaults
    }
  }
  
  // Default commission rates by tier (handles multiple naming conventions)
  const COMMISSION_RATES = {
    'free': 0.25,
    'tier_1': 0.25,
    'tier_2': 0.20,
    'basic': 0.20,      // Alias for tier_2
    'tier_3': 0.15,
    'premium': 0.15,    // Alias for tier_3
    'pro': 0.15,        // Alias for tier_3
  };
  
  const tier = subscriptionTier?.toLowerCase?.() || 'free';
  return COMMISSION_RATES[tier] || COMMISSION_RATES.free;
};

// Revenue Stream Colors
const STREAM_COLORS = {
  live_sessions: { bg: 'from-cyan-500 to-blue-500', text: 'text-cyan-400', icon: Camera },
  request_pro: { bg: 'from-purple-500 to-pink-500', text: 'text-purple-400', icon: Users },
  regular_bookings: { bg: 'from-amber-500 to-orange-500', text: 'text-amber-400', icon: Calendar },
  gallery_sales: { bg: 'from-emerald-500 to-green-500', text: 'text-emerald-400', icon: Image }
};

// Progress Ring Component for Gear Fund
const ProgressRing = ({ progress, size = 120, strokeWidth = 8, color = 'cyan' }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;
  
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        <circle
          className="text-zinc-800"
          strokeWidth={strokeWidth}
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        <circle
          className={`text-${color}-400 transition-all duration-500 ease-out`}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-white">{Math.round(progress)}%</span>
        <span className="text-xs text-gray-400">complete</span>
      </div>
    </div>
  );
};

// Revenue Bar Chart Component
const RevenueBarChart = ({ data, maxValue }) => {
  const streams = ['live_sessions', 'request_pro', 'regular_bookings', 'gallery_sales'];
  const labels = ['Live Sessions', 'Request Pro', 'Bookings', 'Gallery'];
  
  return (
    <div className="space-y-3">
      {streams.map((stream, i) => {
        const value = data[stream] || 0;
        const percentage = maxValue > 0 ? (value / maxValue) * 100 : 0;
        const StreamIcon = STREAM_COLORS[stream].icon;
        
        return (
          <div key={stream} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <StreamIcon className={`w-4 h-4 ${STREAM_COLORS[stream].text}`} />
                <span className="text-gray-300">{labels[i]}</span>
              </div>
              <span className="text-white font-medium">${value.toFixed(2)}</span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div 
                className={`h-full bg-gradient-to-r ${STREAM_COLORS[stream].bg} rounded-full transition-all duration-500`}
                style={{ width: `${Math.max(percentage, 2)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Split-Pocket Setup Modal
const SplitPocketModal = ({ isOpen, onClose, currentSplit, onSave, isLight }) => {
  const [splitPercentage, setSplitPercentage] = useState(currentSplit || 0);
  const [gearFundEnabled, setGearFundEnabled] = useState(splitPercentage > 0);
  
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';
  const borderClass = isLight ? 'border-gray-200' : 'border-zinc-700';
  
  const handleSave = () => {
    onSave(gearFundEnabled ? splitPercentage : 0);
    onClose();
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} max-w-md`}>
        <DialogHeader>
          <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
            <Wallet className="w-5 h-5 text-cyan-400" />
            Split-Pocket Setup
          </DialogTitle>
        </DialogHeader>
        
        <div className="py-4 space-y-6">
          <p className={`text-sm ${textSecondaryClass}`}>
            Choose how to split your earnings between cash withdrawal and platform credits for gear, travel, and donations.
          </p>
          
          {/* Enable Toggle */}
          <div className={`flex items-center justify-between p-4 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
            <div className="flex items-center gap-3">
              <ShoppingBag className="w-5 h-5 text-amber-400" />
              <div>
                <p className={`font-medium ${textPrimaryClass}`}>Auto-allocate to Credits</p>
                <p className={`text-xs ${textSecondaryClass}`}>For gear, travel & donations</p>
              </div>
            </div>
            <Switch 
              checked={gearFundEnabled} 
              onCheckedChange={setGearFundEnabled}
            />
          </div>
          
          {/* Split Percentage Slider */}
          {gearFundEnabled && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className={textSecondaryClass}>Allocation Percentage</Label>
                <span className="text-cyan-400 font-bold text-xl">{splitPercentage}%</span>
              </div>
              
              <Slider
                value={[splitPercentage]}
                onValueChange={([val]) => setSplitPercentage(val)}
                min={0}
                max={100}
                step={5}
                className="w-full"
              />
              
              {/* Preview */}
              <div className={`p-4 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                <p className={`text-sm ${textSecondaryClass} mb-3`}>For every $100 earned:</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <DollarSign className="w-6 h-6 mx-auto mb-1 text-green-400" />
                    <p className="text-green-400 text-xl font-bold">${100 - splitPercentage}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Cash Available</p>
                  </div>
                  <div className="text-center">
                    <ShoppingBag className="w-6 h-6 mx-auto mb-1 text-amber-400" />
                    <p className="text-amber-400 text-xl font-bold">${splitPercentage}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Platform Credits</p>
                  </div>
                </div>
              </div>
              
              {/* Spending Paths */}
              <div className={`p-3 rounded-lg ${isLight ? 'bg-blue-50' : 'bg-blue-500/10'} border border-blue-500/30`}>
                <p className={`text-sm ${isLight ? 'text-blue-800' : 'text-blue-400'} font-medium mb-2`}>
                  Credits can be spent on:
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <ShoppingBag className="w-3 h-3 text-amber-400" />
                    <span className={textSecondaryClass}>Gear (Affiliate Shop)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Plane className="w-3 h-3 text-cyan-400" />
                    <span className={textSecondaryClass}>Travel</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Camera className="w-3 h-3 text-purple-400" />
                    <span className={textSecondaryClass}>Session Fees</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Heart className="w-3 h-3 text-pink-400" />
                    <span className={textSecondaryClass}>Grom Sponsorships</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button 
            onClick={handleSave}
            className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-medium"
          >
            Save Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// Gear Goal Setup Modal (for Hobbyists)
const GearGoalModal = ({ isOpen, onClose, currentGoal, onSave, isLight }) => {
  const [goalName, setGoalName] = useState(currentGoal?.name || '');
  const [goalAmount, setGoalAmount] = useState(currentGoal?.amount || 500);
  
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';
  const borderClass = isLight ? 'border-gray-200' : 'border-zinc-700';
  const inputBgClass = isLight ? 'bg-white' : 'bg-zinc-800';
  
  const presetGoals = [
    { name: 'New Camera Lens', amount: 800 },
    { name: 'Wetsuit', amount: 300 },
    { name: 'Surf Trip Fund', amount: 1500 },
    { name: 'Board Bag', amount: 150 },
    { name: 'Custom Goal', amount: 500 }
  ];
  
  const handleSave = () => {
    if (!goalName.trim()) {
      toast.error('Please enter a goal name');
      return;
    }
    onSave({ name: goalName, amount: goalAmount });
    onClose();
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} max-w-md`}>
        <DialogHeader>
          <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
            <Target className="w-5 h-5 text-amber-400" />
            Set Your Gear Goal
          </DialogTitle>
        </DialogHeader>
        
        <div className="py-4 space-y-4">
          <p className={`text-sm ${textSecondaryClass}`}>
            Set a goal for what you're saving up for. Your progress will be tracked as you earn credits.
          </p>
          
          {/* Preset Goals */}
          <div className="space-y-2">
            <Label className={textSecondaryClass}>Quick Select</Label>
            <div className="flex flex-wrap gap-2">
              {presetGoals.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => {
                    setGoalName(preset.name);
                    setGoalAmount(preset.amount);
                  }}
                  className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                    goalName === preset.name
                      ? 'bg-amber-500 text-black font-medium'
                      : `${isLight ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-zinc-800 text-gray-300 hover:bg-zinc-700'}`
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
          
          {/* Custom Name */}
          <div className="space-y-2">
            <Label className={textSecondaryClass}>Goal Name</Label>
            <Input
              value={goalName}
              onChange={(e) => setGoalName(e.target.value)}
              placeholder="e.g., New Camera Lens"
              className={`${inputBgClass} ${textPrimaryClass}`}
            />
          </div>
          
          {/* Amount */}
          <div className="space-y-2">
            <Label className={textSecondaryClass}>Target Amount ($)</Label>
            <Input
              type="number"
              value={goalAmount}
              onChange={(e) => setGoalAmount(parseInt(e.target.value) || 0)}
              min={50}
              max={10000}
              className={`${inputBgClass} ${textPrimaryClass}`}
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button 
            onClick={handleSave}
            className="bg-gradient-to-r from-amber-400 to-orange-500 text-black font-medium"
          >
            Set Goal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const EarningsDashboard = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { getEffectiveRole } = usePersona();
  const [loading, setLoading] = useState(true);
  const [earnings, setEarnings] = useState(null);
  const [timeRange, setTimeRange] = useState(30);
  const [showSplitPocketModal, setShowSplitPocketModal] = useState(false);
  const [showGearGoalModal, setShowGearGoalModal] = useState(false);
  const [earningsHistory, setEarningsHistory] = useState({ history: [], summary: {} });
  const [showHistoryChart, setShowHistoryChart] = useState(true);
  
  // User settings (from profile/localStorage)
  const [splitPercentage, setSplitPercentage] = useState(() => {
    const saved = localStorage.getItem(`splitPocket_${user?.id}`);
    return saved ? parseInt(saved) : 0;
  });
  
  const [gearGoal, setGearGoal] = useState(() => {
    const saved = localStorage.getItem(`gearGoal_${user?.id}`);
    return saved ? JSON.parse(saved) : null;
  });
  
  // Platform credits balance (simulated - would come from wallet)
  const [platformCredits, setPlatformCredits] = useState(0);
  
  // WebSocket: Real-time earnings updates
  const handleEarningsUpdate = useCallback((update) => {
    const amount = update.amount?.toFixed(2) || '0.00';
    const details = update.details || {};
    
    switch (update.type) {
      case 'new_sale':
        toast.success(`?? New sale: +$${amount}`, { 
          description: details.item_title ? `"${details.item_title}" purchased by ${details.buyer_name}` : undefined,
          duration: 5000 
        });
        setLoading(true);
        break;
      case 'booking_paid':
        toast.success(`?? Booking payment: +$${amount}`, {
          description: `${details.buyer_name} joined your session at ${details.booking_location}`,
          duration: 5000
        });
        setLoading(true);
        break;
      case 'tip_received':
        toast.success(`?? Tip received: +$${amount}`, {
          description: `From ${details.donor_name}`,
          duration: 5000
        });
        setLoading(true);
        break;
      case 'payout_complete':
        toast.success(`?? Payout complete: $${amount} transferred`, { duration: 4000 });
        setLoading(true);
        break;
      default:
        toast.info(`Earnings update: +$${amount}`, { duration: 3000 });
        setLoading(true);
    }
  }, []);
  
  // Connect to earnings WebSocket
  const { isConnected: earningsConnected } = useEarningsSync(user?.id, handleEarningsUpdate);
  
  // Real-time activity feed
  const [activityFeed, setActivityFeed] = useState([]);
  const handleActivityUpdate = useCallback((data) => {
    setActivityFeed(prev => [{...data, id: Date.now()}, ...prev.slice(0, 9)]); // Keep last 10
    toast.info(`${data.surfer_name || 'Someone'} ${data.type === 'item_favorited' ? 'favorited' : data.type === 'item_purchased' ? 'purchased' : 'viewed'} your photo!`);
  }, []);
  const { isConnected: activityConnected } = usePhotographerActivitySync(user?.id, handleActivityUpdate);
  
  // ============ THEME CLASSES - Beach Mode Support ============
  // Must match Gallery and Bookings pages exactly
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const mainBgClass = isLight ? 'bg-gray-50' : isBeach ? 'bg-black' : 'bg-zinc-900';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-800/50 border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';
  const _borderClass = isLight ? 'border-gray-200' : isBeach ? 'border-zinc-800' : 'border-zinc-700';
  
  // Get effective role (respects God Mode persona masking)
  const effectiveRole = getEffectiveRole(user?.role);
  
  // Determine user type based on effective role
  const isPro = ['Photographer', 'Approved Pro'].includes(effectiveRole);
  const isHobbyist = ['Hobbyist', 'Grom Parent'].includes(effectiveRole) || (user?.is_grom_parent === true && !['Photographer', 'Approved Pro'].includes(effectiveRole));
  
  // Calculate gear fund progress
  const gearFundProgress = useMemo(() => {
    if (!gearGoal?.amount) return 0;
    return Math.min((platformCredits / gearGoal.amount) * 100, 100);
  }, [platformCredits, gearGoal]);
  
  useEffect(() => {
    if (user?.id) {
      fetchEarnings();
      fetchWalletBalance();
      fetchEarningsHistory();
    }
  }, [user?.id, timeRange]);

  const fetchEarningsHistory = async () => {
    try {
      const response = await axios.get(`${API}/photographer/${user?.id}/earnings-history?months=12`);
      setEarningsHistory(response.data);
    } catch (error) {
      logger.error('Error fetching earnings history:', error);
      setEarningsHistory({ history: [], summary: {} });
    }
  };

  const fetchEarnings = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/photographer/${user?.id}/earnings-breakdown?days=${timeRange}`);
      setEarnings(response.data);
    } catch (error) {
      logger.error('Error fetching earnings:', error);
      // Set default empty data
      setEarnings({
        live_sessions: 0,
        request_pro: 0,
        regular_bookings: 0,
        gallery_sales: 0,
        total: 0,
        split_bookings: []
      });
    } finally {
      setLoading(false);
    }
  };
  
  const fetchWalletBalance = async () => {
    try {
      const response = await axios.get(`${API}/credits/${user?.id}/balance`);
      // For now, use total balance as platform credits
      // In production, this would be a separate "platform_credits" field
      setPlatformCredits(response.data.balance || 0);
    } catch (error) {
      logger.error('Error fetching wallet:', error);
    }
  };
  
  const handleSaveSplitPocket = (percentage) => {
    setSplitPercentage(percentage);
    localStorage.setItem(`splitPocket_${user?.id}`, percentage.toString());
    toast.success(`Split-Pocket updated: ${percentage}% to Platform Credits`);
  };
  
  const handleSaveGearGoal = (goal) => {
    setGearGoal(goal);
    localStorage.setItem(`gearGoal_${user?.id}`, JSON.stringify(goal));
    toast.success(`Goal set: ${goal.name} ($${goal.amount})`);
  };
  
  // Get dynamic commission rate based on user's subscription tier
  // Also fetch fresh subscription_tier if needed
  const [freshSubscriptionTier, setFreshSubscriptionTier] = useState(user?.subscription_tier);
  
  useEffect(() => {
    // Fetch fresh subscription tier from server to ensure it's up to date
    const fetchFreshTier = async () => {
      if (user?.id) {
        try {
          const response = await axios.get(`${API}/profiles/${user.id}`);
          if (response.data?.subscription_tier && response.data.subscription_tier !== user?.subscription_tier) {
            setFreshSubscriptionTier(response.data.subscription_tier);
            // Also update the user context
            const storedUser = localStorage.getItem('raw-surf-user');
            if (storedUser) {
              const parsed = JSON.parse(storedUser);
              parsed.subscription_tier = response.data.subscription_tier;
              localStorage.setItem('raw-surf-user', JSON.stringify(parsed));
            }
          }
        } catch (e) {
          // Keep using existing tier
        }
      }
    };
    fetchFreshTier();
  }, [user?.id, user?.subscription_tier]);
  
  const commissionRate = useMemo(() => {
    const tier = freshSubscriptionTier || user?.subscription_tier;
    return getCommissionRate(tier);
  }, [freshSubscriptionTier, user?.subscription_tier]);
  
  const commissionPercent = Math.round(commissionRate * 100);
  
  // Calculate gross/net with dynamic commission
  const grossEarnings = earnings?.total || 0;
  const platformFee = grossEarnings * commissionRate;
  const netEarnings = grossEarnings - platformFee;
  const creditsAllocated = netEarnings * (splitPercentage / 100);
  const cashAvailable = netEarnings - creditsAllocated;
  
  // Max value for chart scaling
  const maxStreamValue = earnings ? Math.max(
    earnings.live_sessions,
    earnings.request_pro,
    earnings.regular_bookings,
    earnings.gallery_sales,
    1 // Prevent division by zero
  ) : 1;
  
  if (loading) {
    return (
      <div className={`flex items-center justify-center min-h-screen ${mainBgClass}`}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400"></div>
      </div>
    );
  }
  
  return (
    <div className={`pb-20 min-h-screen ${mainBgClass} transition-colors duration-300`} data-testid="earnings-dashboard">
      <div className="max-w-4xl mx-auto p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className={`text-3xl font-bold ${textPrimaryClass}`} style={{ fontFamily: 'Oswald' }}>
              {isPro ? 'Earnings Dashboard' : 'Impact Dashboard'}
            </h1>
            <p className={`${textSecondaryClass} flex items-center gap-2`}>
              {isPro ? 'Track your revenue and manage payouts' : 'Your contributions and gear fund progress'}
              {earningsConnected && (
                <span className="flex items-center gap-1 text-xs text-emerald-400">
                  <Wifi className="w-3 h-3" />
                  Live
                </span>
              )}
            </p>
          </div>
          
          {/* Time Range Selector */}
          <div className="flex items-center gap-2">
            {[7, 30, 90].map((days) => (
              <button
                key={days}
                onClick={() => setTimeRange(days)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  timeRange === days
                    ? 'bg-cyan-500 text-black'
                    : `${isLight ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-zinc-800 text-gray-400 hover:bg-zinc-700'}`
                }`}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>
        
        {/* PRO VIEW: Gross/Net + Split-Pocket */}
        {isPro && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              {/* Gross Earnings */}
              <Card className={cardBgClass}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-5 h-5 text-green-400" />
                    <span className={`text-sm ${textSecondaryClass}`}>Gross Earnings</span>
                  </div>
                  <p className="text-3xl font-bold text-green-400">${grossEarnings.toFixed(2)}</p>
                </CardContent>
              </Card>
              
              {/* Net Earnings */}
              <Card className={cardBgClass}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-5 h-5 text-cyan-400" />
                    <span className={`text-sm ${textSecondaryClass}`}>Net Earnings</span>
                  </div>
                  <p className="text-3xl font-bold text-cyan-400">${netEarnings.toFixed(2)}</p>
                  <p className={`text-xs ${textSecondaryClass}`}>After {commissionPercent}% platform fee</p>
                </CardContent>
              </Card>
              
              {/* Cash Available */}
              <Card className={cardBgClass}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Wallet className="w-5 h-5 text-amber-400" />
                    <span className={`text-sm ${textSecondaryClass}`}>Cash Available</span>
                  </div>
                  <p className="text-3xl font-bold text-amber-400">${cashAvailable.toFixed(2)}</p>
                  {splitPercentage > 0 && (
                    <p className={`text-xs ${textSecondaryClass}`}>${creditsAllocated.toFixed(2)} to credits</p>
                  )}
                </CardContent>
              </Card>
            </div>
            
            {/* Split-Pocket Controls */}
            <Card className={`mb-6 ${cardBgClass}`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
                    <Wallet className="w-5 h-5 text-cyan-400" />
                    Split-Pocket Settings
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowSplitPocketModal(true)}
                    className={isLight ? 'border-gray-300' : 'border-zinc-700'}
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    Configure
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={textPrimaryClass}>
                      {splitPercentage > 0 
                        ? `${splitPercentage}% of earnings go to Platform Credits`
                        : 'All earnings available for cash withdrawal'
                      }
                    </p>
                    <p className={`text-sm ${textSecondaryClass}`}>
                      {splitPercentage > 0 
                        ? 'Use credits for gear, travel, sessions & donations'
                        : 'Enable auto-allocation to save for gear and travel'
                      }
                    </p>
                  </div>
                  {splitPercentage > 0 && (
                    <div className="text-right">
                      <p className="text-amber-400 text-2xl font-bold">${platformCredits.toFixed(2)}</p>
                      <p className={`text-xs ${textSecondaryClass}`}>Platform Credits</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </>
        )}
        
        {/* HOBBYIST VIEW: Gear Fund Progress Ring */}
        {isHobbyist && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* Gear Fund Progress */}
            <Card className={cardBgClass}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
                    <Target className="w-5 h-5 text-amber-400" />
                    Gear Fund
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowGearGoalModal(true)}
                    className={isLight ? 'border-gray-300' : 'border-zinc-700'}
                  >
                    {gearGoal ? 'Edit Goal' : 'Set Goal'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6">
                  <ProgressRing progress={gearFundProgress} color="amber" />
                  <div className="flex-1">
                    {gearGoal ? (
                      <>
                        <p className={`text-lg font-bold ${textPrimaryClass}`}>{gearGoal.name}</p>
                        <p className={textSecondaryClass}>
                          ${platformCredits.toFixed(2)} / ${gearGoal.amount}
                        </p>
                        <div className="mt-2">
                          <Badge className="bg-amber-500/20 text-amber-400">
                            ${(gearGoal.amount - platformCredits).toFixed(2)} to go
                          </Badge>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className={`text-lg ${textPrimaryClass}`}>No goal set</p>
                        <p className={`text-sm ${textSecondaryClass}`}>
                          Set a gear goal to track your progress
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
            
            {/* Platform Credits Balance */}
            <Card className={cardBgClass}>
              <CardHeader>
                <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
                  <ShoppingBag className="w-5 h-5 text-cyan-400" />
                  Platform Credits
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-4">
                  <p className="text-4xl font-bold text-cyan-400 mb-2">${platformCredits.toFixed(2)}</p>
                  <p className={textSecondaryClass}>Available for gear, travel & donations</p>
                </div>
                
                {/* Spending Options */}
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <button className={`p-3 rounded-xl ${isLight ? 'bg-gray-100 hover:bg-gray-200' : 'bg-zinc-800 hover:bg-zinc-700'} transition-colors`}>
                    <ShoppingBag className={`w-5 h-5 mx-auto mb-1 ${textSecondaryClass}`} />
                    <p className={`text-xs ${textSecondaryClass}`}>Gear Shop</p>
                  </button>
                  <button className={`p-3 rounded-xl ${isLight ? 'bg-gray-100 hover:bg-gray-200' : 'bg-zinc-800 hover:bg-zinc-700'} transition-colors`}>
                    <Plane className={`w-5 h-5 mx-auto mb-1 ${textSecondaryClass}`} />
                    <p className={`text-xs ${textSecondaryClass}`}>Travel</p>
                  </button>
                  <button className={`p-3 rounded-xl ${isLight ? 'bg-gray-100 hover:bg-gray-200' : 'bg-zinc-800 hover:bg-zinc-700'} transition-colors`}>
                    <Camera className={`w-5 h-5 mx-auto mb-1 ${textSecondaryClass}`} />
                    <p className={`text-xs ${textSecondaryClass}`}>Sessions</p>
                  </button>
                  <button className={`p-3 rounded-xl ${isLight ? 'bg-gray-100 hover:bg-gray-200' : 'bg-zinc-800 hover:bg-zinc-700'} transition-colors`}>
                    <Heart className={`w-5 h-5 mx-auto mb-1 ${textSecondaryClass}`} />
                    <p className={`text-xs ${textSecondaryClass}`}>Sponsor Grom</p>
                  </button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        
        {/* Revenue Breakdown by Stream */}
        <Card className={`mb-6 ${cardBgClass}`}>
          <CardHeader>
            <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
              <PieChart className="w-5 h-5 text-purple-400" />
              Revenue by Stream
            </CardTitle>
          </CardHeader>
          <CardContent>
            {earnings && (
              <RevenueBarChart data={earnings} maxValue={maxStreamValue} />
            )}
            
            {earnings?.total === 0 && (
              <div className="text-center py-8">
                <Camera className={`w-12 h-12 mx-auto mb-3 ${textSecondaryClass}`} />
                <p className={textPrimaryClass}>No earnings yet</p>
                <p className={`text-sm ${textSecondaryClass}`}>Start a live session to begin earning!</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Earnings History Chart */}
        {earningsHistory.history?.length > 0 && (
          <Card className={`mb-6 ${cardBgClass}`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
                  <BarChart3 className="w-5 h-5 text-cyan-400" />
                  Earnings Trend (12 Months)
                </CardTitle>
                <div className="flex items-center gap-4">
                  {earningsHistory.summary?.month_over_month_change !== 0 && (
                    <Badge className={earningsHistory.summary?.month_over_month_change > 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}>
                      {earningsHistory.summary?.month_over_month_change > 0 ? '+' : ''}{earningsHistory.summary?.month_over_month_change}% vs last month
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowHistoryChart(!showHistoryChart)}
                    className={textSecondaryClass}
                  >
                    {showHistoryChart ? 'Hide' : 'Show'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            {showHistoryChart && (
              <CardContent>
                {/* Summary Stats */}
                <div className="grid grid-cols-4 gap-4 mb-6">
                  <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                    <p className={`text-xs ${textSecondaryClass}`}>Total Earned</p>
                    <p className="text-xl font-bold text-green-400">${earningsHistory.summary?.total_earnings?.toFixed(2) || '0.00'}</p>
                  </div>
                  <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                    <p className={`text-xs ${textSecondaryClass}`}>Monthly Avg</p>
                    <p className="text-xl font-bold text-cyan-400">${earningsHistory.summary?.avg_monthly?.toFixed(2) || '0.00'}</p>
                  </div>
                  <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                    <p className={`text-xs ${textSecondaryClass}`}>This Month</p>
                    <p className="text-xl font-bold text-amber-400">${earningsHistory.summary?.current_month?.toFixed(2) || '0.00'}</p>
                  </div>
                  <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                    <p className={`text-xs ${textSecondaryClass}`}>Best Month</p>
                    <p className="text-xl font-bold text-purple-400">${earningsHistory.summary?.best_month?.total?.toFixed(2) || '0.00'}</p>
                    <p className={`text-[10px] ${textSecondaryClass}`}>{earningsHistory.summary?.best_month?.month_name}</p>
                  </div>
                </div>
                
                {/* Area Chart */}
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={[...earningsHistory.history].reverse()}>
                      <defs>
                        <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorGallery" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={isLight ? '#e5e7eb' : '#374151'} />
                      <XAxis 
                        dataKey="month_name" 
                        tick={{ fill: isLight ? '#6b7280' : '#9ca3af', fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        tick={{ fill: isLight ? '#6b7280' : '#9ca3af', fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `$${value}`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: isLight ? '#fff' : '#18181b', 
                          border: isLight ? '1px solid #e5e7eb' : '1px solid #3f3f46',
                          borderRadius: '8px'
                        }}
                        labelStyle={{ color: isLight ? '#111827' : '#fff' }}
                        formatter={(value, name) => [`$${value?.toFixed(2)}`, name === 'total' ? 'Total' : name === 'gallery_sales' ? 'Gallery' : name === 'live_sessions' ? 'Live' : name]}
                      />
                      <Area type="monotone" dataKey="total" stroke="#06b6d4" fill="url(#colorTotal)" strokeWidth={2} />
                      <Area type="monotone" dataKey="gallery_sales" stroke="#10b981" fill="url(#colorGallery)" strokeWidth={1} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                
                {/* Legend */}
                <div className="flex items-center justify-center gap-6 mt-4">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-cyan-400" />
                    <span className={`text-xs ${textSecondaryClass}`}>Total Earnings</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-400" />
                    <span className={`text-xs ${textSecondaryClass}`}>Gallery Sales</span>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        )}

        {/* Real-Time Activity Feed */}
        <Card className={`mb-6 ${cardBgClass}`}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
                <Wifi className={`w-5 h-5 ${activityConnected ? 'text-green-400' : 'text-gray-400'}`} />
                Live Activity Feed
                {activityConnected && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                )}
              </CardTitle>
              {!activityConnected && (
                <Badge variant="outline" className="text-gray-400">Connecting...</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {activityFeed.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {activityFeed.map((activity) => (
                  <div key={activity.id} className={`flex items-center gap-3 p-2 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-zinc-800/30'} animate-fadeIn`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      activity.type === 'item_favorited' ? 'bg-red-500/20 text-red-400' :
                      activity.type === 'item_purchased' ? 'bg-green-500/20 text-green-400' :
                      'bg-cyan-500/20 text-cyan-400'
                    }`}>
                      {activity.type === 'item_favorited' ? <Heart className="w-4 h-4" /> :
                       activity.type === 'item_purchased' ? <ShoppingBag className="w-4 h-4" /> :
                       <Eye className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${textPrimaryClass}`}>
                        <span className="font-medium">{activity.surfer_name || 'Someone'}</span>
                        {' '}
                        {activity.type === 'item_favorited' ? 'favorited' :
                         activity.type === 'item_purchased' ? 'purchased' : 'viewed'}
                        {' '}
                        <span className={textSecondaryClass}>{activity.item_title || 'your photo'}</span>
                      </p>
                      <p className={`text-xs ${textSecondaryClass}`}>
                        {activity.timestamp ? new Date(activity.timestamp).toLocaleTimeString() : 'just now'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={`text-center py-8 ${textSecondaryClass}`}>
                <Wifi className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Waiting for activity...</p>
                <p className="text-xs mt-1">You'll see real-time updates when surfers interact with your photos</p>
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* Split Bookings (if any) */}
        {earnings?.split_bookings?.length > 0 && (
          <Card className={cardBgClass}>
            <CardHeader>
              <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
                <Users className="w-5 h-5 text-pink-400" />
                Split Bookings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {earnings.split_bookings.map((split, i) => (
                  <div key={i} className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={textPrimaryClass}>
                          {split.contributions?.length || 0} surfers split
                        </p>
                        <p className={`text-xs ${textSecondaryClass}`}>
                          {new Date(split.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <p className="text-cyan-400 font-bold">${split.total_amount?.toFixed(2) || '0.00'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Community Impact Score (for all users) */}
        <Card className={`mt-6 ${cardBgClass}`}>
          <CardHeader>
            <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
              <Sparkles className="w-5 h-5 text-yellow-400" />
              Community Impact
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-sm ${textSecondaryClass} mb-1`}>Your Impact Score</p>
                <p className="text-3xl font-bold text-yellow-400">
                  {Math.round((grossEarnings + platformCredits) / 10)}
                  <span className="text-lg ml-1">XP</span>
                </p>
              </div>
              <div className="text-right">
                <Badge className="bg-gradient-to-r from-yellow-400 to-amber-500 text-black font-bold">
                  <Award className="w-4 h-4 mr-1" />
                  {grossEarnings >= 1000 ? 'Gold' : grossEarnings >= 500 ? 'Silver' : 'Bronze'} Contributor
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Modals */}
      <SplitPocketModal
        isOpen={showSplitPocketModal}
        onClose={() => setShowSplitPocketModal(false)}
        currentSplit={splitPercentage}
        onSave={handleSaveSplitPocket}
        isLight={isLight}
      />
      
      <GearGoalModal
        isOpen={showGearGoalModal}
        onClose={() => setShowGearGoalModal(false)}
        currentGoal={gearGoal}
        onSave={handleSaveGearGoal}
        isLight={isLight}
      />
    </div>
  );
};

export default EarningsDashboard;
