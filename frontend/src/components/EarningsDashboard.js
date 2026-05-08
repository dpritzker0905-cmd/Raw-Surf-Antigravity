import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { usePersona } from '../contexts/PersonaContext';
import { useEarningsSync, usePhotographerActivitySync } from '../hooks/useWebSocket';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';
import { 
  DollarSign, TrendingUp, Camera, Users, 
  Settings, Sparkles, Award, Heart,
  Wallet, ShoppingBag, Plane, PieChart, Wifi,
  BarChart3, Eye, Target
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { getCommissionRate, ProgressRing, RevenueBarChart } from './earnings/EarningsHelpers';
import { SplitPocketModal, GearGoalModal } from './earnings/EarningsModals';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';



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
        toast.success(`💰 New sale: +$${amount}`, { 
          description: details.item_title ? `"${details.item_title}" purchased by ${details.buyer_name}` : undefined,
          duration: 5000 
        });
        setLoading(true);
        break;
      case 'booking_paid':
        toast.success(`💰 Booking payment: +$${amount}`, {
          description: `${details.buyer_name} joined your session at ${details.booking_location}`,
          duration: 5000
        });
        setLoading(true);
        break;
      case 'tip_received':
        toast.success(`💝 Tip received: +$${amount}`, {
          description: `From ${details.donor_name}`,
          duration: 5000
        });
        setLoading(true);
        break;
      case 'payout_complete':
        toast.success(`✅ Payout complete: $${amount} transferred`, { duration: 4000 });
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
      const response = await apiClient.get(`/photographer/${user?.id}/earnings-history?months=12`);
      setEarningsHistory(response.data);
    } catch (error) {
      logger.error('Error fetching earnings history:', error);
      setEarningsHistory({ history: [], summary: {} });
    }
  };

  const fetchEarnings = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/photographer/${user?.id}/earnings-breakdown?days=${timeRange}`);
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
      const response = await apiClient.get(`/credits/${user?.id}/balance`);
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
          const response = await apiClient.get(`/profiles/${user.id}`);
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
            <h1 className={`text-3xl font-bold ${textPrimaryClass} font-oswald`} >
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
                  <Button aria-label="Settings"
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
                  <button className={`p-3 rounded-xl ${isLight ? 'bg-gray-100 hover:bg-gray-200' : 'bg-zinc-800 hover:bg-zinc-700'} transition-colors`} aria-label="Camera">
                    <Camera className={`w-5 h-5 mx-auto mb-1 ${textSecondaryClass}`} />
                    <p className={`text-xs ${textSecondaryClass}`}>Sessions</p>
                  </button>
                  <button className={`p-3 rounded-xl ${isLight ? 'bg-gray-100 hover:bg-gray-200' : 'bg-zinc-800 hover:bg-zinc-700'} transition-colors`} aria-label="Like">
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
                    aria-expanded={showHistoryChart} onClick={() => setShowHistoryChart(!showHistoryChart)}
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
