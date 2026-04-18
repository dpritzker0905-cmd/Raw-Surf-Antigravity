import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import axios from 'axios';
import {
  DollarSign, TrendingUp, Gift, Flag as FlagIcon, Bell, BarChart3,
  Loader2, Plus, RefreshCw, Send, Activity, Target, Zap,
  ArrowUpRight, ArrowDownRight, MapPin, Star, Clock, Heart
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import { toast } from 'sonner';
import logger from '../../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * AdminUnifiedAnalytics - Enhanced Analytics Dashboard
 * Based on marketplace best practices research:
 * - LTV/CAC metrics
 * - Marketplace liquidity & health
 * - Supply/Demand balance
 * - Top performers
 * - Growth tools (promo codes, campaigns, feature flags)
 */
export const AdminUnifiedAnalytics = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [activeSubTab, setActiveSubTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('30d');
  
  // Overview/Metrics state
  const [revenueData, setRevenueData] = useState(null);
  const [ltvCacData, setLtvCacData] = useState(null);
  const [healthScore, setHealthScore] = useState(null);
  
  // Marketplace Health state
  const [liquidityData, setLiquidityData] = useState(null);
  const [supplyDemandData, setSupplyDemandData] = useState(null);
  const [topPerformers, setTopPerformers] = useState(null);
  
  // Funnel & Cohorts state
  const [funnelData, setFunnelData] = useState(null);
  const [cohortData, setCohortData] = useState(null);
  
  // Growth Tools state
  const [promoCodes, setPromoCodes] = useState([]);
  const [featureFlags, setFeatureFlags] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  
  // Modals
  const [showCreatePromo, setShowCreatePromo] = useState(false);
  const [showCreateFlag, setShowCreateFlag] = useState(false);
  const [showCreateCampaign, setShowCreateCampaign] = useState(false);
  
  const [newPromo, setNewPromo] = useState({ code: '', code_type: 'percentage', discount_value: 10, max_uses: null, campaign_name: '' });
  const [newFlag, setNewFlag] = useState({ key: '', name: '', description: '', rollout_percentage: 0, is_experiment: false });
  const [newCampaign, setNewCampaign] = useState({ name: '', title: '', body: '', target_all_users: true });
  
  const [actionLoading, setActionLoading] = useState(false);

  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/50 border-zinc-800';
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';

  const getDays = () => {
    switch(timeRange) {
      case '7d': return 7;
      case '90d': return 90;
      default: return 30;
    }
  };

  useEffect(() => {
    if (user?.id) {
      fetchDataForTab();
    }
  }, [user?.id, activeSubTab, timeRange]);

  const fetchDataForTab = async () => {
    setLoading(true);
    try {
      if (activeSubTab === 'overview') {
        await Promise.all([fetchOverviewData(), fetchHealthScore()]);
      } else if (activeSubTab === 'health') {
        await Promise.all([fetchLiquidityData(), fetchSupplyDemandData(), fetchTopPerformers()]);
      } else if (activeSubTab === 'funnel') {
        await Promise.all([fetchFunnelData(), fetchCohortData()]);
      } else if (activeSubTab === 'growth') {
        await Promise.all([fetchPromoCodes(), fetchFeatureFlags(), fetchCampaigns()]);
      }
    } catch (error) {
      logger.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchOverviewData = async () => {
    const [revenueRes, ltvCacRes] = await Promise.all([
      axios.get(`${API}/admin/revenue/overview?admin_id=${user.id}&days=${getDays()}`),
      axios.get(`${API}/admin/analytics/ltv-cac?admin_id=${user.id}&days=${getDays() * 3}`)
    ]);
    setRevenueData(revenueRes.data);
    setLtvCacData(ltvCacRes.data);
  };

  const fetchHealthScore = async () => {
    const res = await axios.get(`${API}/admin/analytics/health-score?admin_id=${user.id}`);
    setHealthScore(res.data);
  };

  const fetchLiquidityData = async () => {
    const res = await axios.get(`${API}/admin/analytics/liquidity?admin_id=${user.id}&days=${getDays()}`);
    setLiquidityData(res.data);
  };

  const fetchSupplyDemandData = async () => {
    const res = await axios.get(`${API}/admin/analytics/supply-demand?admin_id=${user.id}&days=${getDays()}&limit=8`);
    setSupplyDemandData(res.data);
  };

  const fetchTopPerformers = async () => {
    const res = await axios.get(`${API}/admin/analytics/top-performers?admin_id=${user.id}&days=${getDays()}&limit=5`);
    setTopPerformers(res.data);
  };

  const fetchFunnelData = async () => {
    const res = await axios.get(`${API}/admin/funnel/detailed?admin_id=${user.id}&days=${getDays()}`);
    setFunnelData(res.data);
  };

  const fetchCohortData = async () => {
    const res = await axios.get(`${API}/admin/revenue/cohort?admin_id=${user.id}&months=6`);
    setCohortData(res.data);
  };

  const fetchPromoCodes = async () => {
    const res = await axios.get(`${API}/admin/promo-codes?admin_id=${user.id}`);
    setPromoCodes(res.data.promo_codes || []);
  };

  const fetchFeatureFlags = async () => {
    const res = await axios.get(`${API}/admin/feature-flags?admin_id=${user.id}`);
    setFeatureFlags(res.data.feature_flags || []);
  };

  const fetchCampaigns = async () => {
    const res = await axios.get(`${API}/admin/notification-campaigns?admin_id=${user.id}`);
    setCampaigns(res.data.campaigns || []);
  };

  // CRUD handlers
  const handleCreatePromo = async () => {
    if (!newPromo.code) { toast.error('Please enter a code'); return; }
    setActionLoading(true);
    try {
      await axios.post(`${API}/admin/promo-codes?admin_id=${user.id}`, newPromo);
      toast.success('Promo code created');
      setShowCreatePromo(false);
      setNewPromo({ code: '', code_type: 'percentage', discount_value: 10, max_uses: null, campaign_name: '' });
      fetchPromoCodes();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create promo code');
    } finally {
      setActionLoading(false);
    }
  };

  const handleTogglePromo = async (codeId) => {
    try {
      await axios.put(`${API}/admin/promo-codes/${codeId}/toggle?admin_id=${user.id}`);
      fetchPromoCodes();
    } catch (error) {
      toast.error('Failed to toggle');
    }
  };

  const handleCreateFlag = async () => {
    if (!newFlag.key || !newFlag.name) { toast.error('Please fill required fields'); return; }
    setActionLoading(true);
    try {
      await axios.post(`${API}/admin/feature-flags?admin_id=${user.id}`, newFlag);
      toast.success('Feature flag created');
      setShowCreateFlag(false);
      setNewFlag({ key: '', name: '', description: '', rollout_percentage: 0, is_experiment: false });
      fetchFeatureFlags();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create flag');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleFlag = async (flagId, currentState) => {
    try {
      await axios.put(`${API}/admin/feature-flags/${flagId}?admin_id=${user.id}&is_enabled=${!currentState}`);
      fetchFeatureFlags();
    } catch (error) {
      toast.error('Failed to toggle');
    }
  };

  const handleCreateCampaign = async () => {
    if (!newCampaign.name || !newCampaign.title) { toast.error('Please fill required fields'); return; }
    setActionLoading(true);
    try {
      await axios.post(`${API}/admin/notification-campaigns?admin_id=${user.id}`, newCampaign);
      toast.success('Campaign created');
      setShowCreateCampaign(false);
      setNewCampaign({ name: '', title: '', body: '', target_all_users: true });
      fetchCampaigns();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create campaign');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendCampaign = async (campaignId) => {
    if (!confirm('Send this campaign now?')) return;
    try {
      const res = await axios.post(`${API}/admin/notification-campaigns/${campaignId}/send?admin_id=${user.id}`);
      toast.success(`Sent to ${res.data.total_sent} users`);
      fetchCampaigns();
    } catch (error) {
      toast.error('Failed to send');
    }
  };

  const formatCurrency = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
  const formatPercent = (value) => `${(value || 0).toFixed(1)}%`;

  const getStatusColor = (status) => {
    switch(status) {
      case 'healthy': case 'excellent': case 'good': return 'text-green-400 bg-green-500/20';
      case 'warning': case 'needs_attention': return 'text-yellow-400 bg-yellow-500/20';
      case 'critical': return 'text-red-400 bg-red-500/20';
      default: return 'text-gray-400 bg-gray-500/20';
    }
  };

  const HealthIndicator = ({ score, status, label }) => (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${
        status === 'healthy' || status === 'excellent' || status === 'good' ? 'bg-green-400' :
        status === 'warning' || status === 'needs_attention' ? 'bg-yellow-400' : 'bg-red-400'
      }`} />
      <span className="text-xs text-gray-400">{label}</span>
      <span className={`text-xs font-medium ${
        status === 'healthy' || status === 'excellent' || status === 'good' ? 'text-green-400' :
        status === 'warning' || status === 'needs_attention' ? 'text-yellow-400' : 'text-red-400'
      }`}>{score}</span>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="admin-unified-analytics">
      {/* Header with tabs and time range */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {[
            { id: 'overview', label: 'Overview', icon: Activity },
            { id: 'health', label: 'Marketplace Health', icon: Heart },
            { id: 'funnel', label: 'Funnel & Retention', icon: BarChart3 },
            { id: 'growth', label: 'Growth Tools', icon: Zap },
          ].map(tab => (
            <Button
              key={tab.id}
              variant={activeSubTab === tab.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveSubTab(tab.id)}
              className={`text-xs ${activeSubTab === tab.id ? 'bg-gradient-to-r from-cyan-500 to-teal-500 border-0' : ''}`}
              data-testid={`analytics-tab-${tab.id}`}
            >
              <tab.icon className="w-3.5 h-3.5 mr-1" />
              {tab.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-24 bg-zinc-800 border-zinc-700 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">7 days</SelectItem>
              <SelectItem value="30d">30 days</SelectItem>
              <SelectItem value="90d">90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={fetchDataForTab} className="h-8">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        </div>
      ) : (
        <>
          {/* OVERVIEW TAB - Key KPIs + LTV/CAC + Health Score */}
          {activeSubTab === 'overview' && (
            <div className="space-y-4">
              {/* Health Score Card */}
              {healthScore && (
                <Card className={`${cardBgClass} border-l-4 ${
                  healthScore.status === 'excellent' || healthScore.status === 'good' ? 'border-l-green-500' :
                  healthScore.status === 'needs_attention' ? 'border-l-yellow-500' : 'border-l-red-500'
                }`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-500">Platform Health Score</p>
                        <div className="flex items-baseline gap-2">
                          <span className={`text-3xl font-bold ${
                            healthScore.status === 'excellent' || healthScore.status === 'good' ? 'text-green-400' :
                            healthScore.status === 'needs_attention' ? 'text-yellow-400' : 'text-red-400'
                          }`}>{healthScore.overall_score}</span>
                          <span className="text-sm text-gray-500">/ 100</span>
                          <Badge className={`ml-2 ${getStatusColor(healthScore.status)}`}>
                            {healthScore.status.replace('_', ' ')}
                          </Badge>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                        <HealthIndicator 
                          score={healthScore.components.unit_economics.ltv_cac_ratio.toFixed(1) + ':1'} 
                          status={healthScore.components.unit_economics.status} 
                          label="LTV/CAC" 
                        />
                        <HealthIndicator 
                          score={formatPercent(healthScore.components.liquidity.match_rate)} 
                          status={healthScore.components.liquidity.status} 
                          label="Match Rate" 
                        />
                        <HealthIndicator 
                          score={healthScore.components.satisfaction.avg_rating.toFixed(1) + '★'} 
                          status={healthScore.components.satisfaction.status} 
                          label="Satisfaction" 
                        />
                        <HealthIndicator 
                          score={formatPercent(healthScore.components.retention.repeat_booking_rate)} 
                          status={healthScore.components.retention.status} 
                          label="Repeat Rate" 
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Key Metrics */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {revenueData && (
                  <>
                    <Card className={`${cardBgClass} border-green-500/30`}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className={`text-xs ${textSecondary}`}>GMV ({timeRange})</p>
                            <p className="text-2xl font-bold text-green-400">{formatCurrency(revenueData.gmv)}</p>
                            <p className={`text-xs ${revenueData.gmv_change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {revenueData.gmv_change >= 0 ? <ArrowUpRight className="inline w-3 h-3" /> : <ArrowDownRight className="inline w-3 h-3" />}
                              {Math.abs(revenueData.gmv_change)}% vs prev
                            </p>
                          </div>
                          <DollarSign className="w-8 h-8 text-green-500/30" />
                        </div>
                      </CardContent>
                    </Card>

                    <Card className={`${cardBgClass} border-blue-500/30`}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className={`text-xs ${textSecondary}`}>Platform Revenue</p>
                            <p className="text-2xl font-bold text-blue-400">{formatCurrency(revenueData.platform_revenue)}</p>
                            <p className="text-xs text-gray-500">{revenueData.take_rate}% take rate</p>
                          </div>
                          <TrendingUp className="w-8 h-8 text-blue-500/30" />
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )}

                {ltvCacData && (
                  <>
                    <Card className={`${cardBgClass} ${ltvCacData.ltv_cac_ratio >= 3 ? 'border-green-500/30' : ltvCacData.ltv_cac_ratio >= 1 ? 'border-yellow-500/30' : 'border-red-500/30'}`}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className={`text-xs ${textSecondary}`}>LTV/CAC Ratio</p>
                            <p className={`text-2xl font-bold ${ltvCacData.ltv_cac_ratio >= 3 ? 'text-green-400' : ltvCacData.ltv_cac_ratio >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>
                              {ltvCacData.ltv_cac_ratio.toFixed(1)}:1
                            </p>
                            <p className="text-xs text-gray-500">Target: 3:1+</p>
                          </div>
                          <Target className="w-8 h-8 text-purple-500/30" />
                        </div>
                      </CardContent>
                    </Card>

                    <Card className={`${cardBgClass} border-cyan-500/30`}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className={`text-xs ${textSecondary}`}>CAC Payback</p>
                            <p className="text-2xl font-bold text-cyan-400">{ltvCacData.cac_payback_months.toFixed(1)}mo</p>
                            <p className="text-xs text-gray-500">CAC: {formatCurrency(ltvCacData.cac)}</p>
                          </div>
                          <Clock className="w-8 h-8 text-cyan-500/30" />
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )}
              </div>

              {/* LTV/CAC Details + Revenue Breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {ltvCacData && (
                  <Card className={cardBgClass}>
                    <CardHeader className="pb-2">
                      <CardTitle className={`text-sm ${textClass}`}>Unit Economics</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-zinc-800/50 rounded-lg">
                          <p className="text-xs text-gray-500">Lifetime Value (LTV)</p>
                          <p className="text-xl font-bold text-white">{formatCurrency(ltvCacData.ltv)}</p>
                        </div>
                        <div className="p-3 bg-zinc-800/50 rounded-lg">
                          <p className="text-xs text-gray-500">Acquisition Cost (CAC)</p>
                          <p className="text-xl font-bold text-white">{formatCurrency(ltvCacData.cac)}</p>
                        </div>
                        <div className="p-3 bg-zinc-800/50 rounded-lg">
                          <p className="text-xs text-gray-500">ARPU</p>
                          <p className="text-lg font-bold text-white">{formatCurrency(ltvCacData.arpu)}</p>
                        </div>
                        <div className="p-3 bg-zinc-800/50 rounded-lg">
                          <p className="text-xs text-gray-500">Churn Rate</p>
                          <p className="text-lg font-bold text-white">{ltvCacData.churn_rate}%</p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-gray-500">Active Users: {ltvCacData.active_users}</span>
                        <span className="text-gray-500">New Users: {ltvCacData.new_users}</span>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {revenueData?.breakdown_by_type && (
                  <Card className={cardBgClass}>
                    <CardHeader className="pb-2">
                      <CardTitle className={`text-sm ${textClass}`}>Revenue by Type</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {Object.entries(revenueData.breakdown_by_type).slice(0, 6).map(([type, data]) => (
                          <div key={type} className="flex items-center justify-between p-2 bg-zinc-800/50 rounded">
                            <span className="text-xs text-gray-400 capitalize">{type.replace(/_/g, ' ')}</span>
                            <div className="text-right">
                              <span className="text-sm font-medium text-white">{formatCurrency(data.revenue)}</span>
                              <span className="text-xs text-gray-500 ml-2">({data.transactions} txns)</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}

          {/* MARKETPLACE HEALTH TAB */}
          {activeSubTab === 'health' && (
            <div className="space-y-4">
              {/* Liquidity Metrics */}
              {liquidityData && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <Card className={`${cardBgClass} border-l-4 ${
                    liquidityData.health_status === 'healthy' ? 'border-l-green-500' :
                    liquidityData.health_status === 'warning' ? 'border-l-yellow-500' : 'border-l-red-500'
                  }`}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-3 bg-gradient-to-br from-cyan-500/20 to-teal-500/20 rounded-lg">
                          <Activity className="w-6 h-6 text-cyan-400" />
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">Liquidity Score</p>
                          <p className="text-2xl font-bold text-white">{liquidityData.liquidity_score}</p>
                          <Badge className={getStatusColor(liquidityData.health_status)}>
                            {liquidityData.health_status.replace('_', ' ')}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className={cardBgClass}>
                    <CardContent className="p-4">
                      <p className="text-xs text-gray-500 mb-3">Supply Side</p>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-xs text-gray-400">Total Photographers</span>
                          <span className="text-sm font-medium text-white">{liquidityData.supply.total_photographers}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-gray-400">Active ({timeRange})</span>
                          <span className="text-sm font-medium text-green-400">{liquidityData.supply.active_photographers}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-gray-400">Utilization Rate</span>
                          <span className="text-sm font-medium text-cyan-400">{liquidityData.supply.utilization_rate}%</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className={cardBgClass}>
                    <CardContent className="p-4">
                      <p className="text-xs text-gray-500 mb-3">Demand Side</p>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-xs text-gray-400">Total Bookings</span>
                          <span className="text-sm font-medium text-white">{liquidityData.demand.total_bookings}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-gray-400">Match Rate</span>
                          <span className="text-sm font-medium text-green-400">{liquidityData.demand.match_rate}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-gray-400">Completion Rate</span>
                          <span className="text-sm font-medium text-cyan-400">{liquidityData.demand.completion_rate}%</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Top Performers */}
              {topPerformers && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Card className={cardBgClass}>
                    <CardHeader className="pb-2">
                      <CardTitle className={`text-sm ${textClass} flex items-center gap-2`}>
                        <Star className="w-4 h-4 text-yellow-400" />
                        Top Photographers
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {topPerformers.top_photographers.length === 0 ? (
                        <p className="text-xs text-gray-500 text-center py-4">No data for this period</p>
                      ) : (
                        <div className="space-y-2">
                          {topPerformers.top_photographers.map((p, idx) => (
                            <div key={p.id} className="flex items-center gap-3 p-2 bg-zinc-800/50 rounded">
                              <span className={`w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold ${
                                idx === 0 ? 'bg-yellow-500 text-black' : idx === 1 ? 'bg-gray-400 text-black' : idx === 2 ? 'bg-orange-600 text-white' : 'bg-zinc-700 text-gray-300'
                              }`}>{idx + 1}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-white truncate">{p.name}</p>
                                <p className="text-xs text-gray-500">{p.bookings} bookings</p>
                              </div>
                              <span className="text-sm font-bold text-green-400">{formatCurrency(p.revenue)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className={cardBgClass}>
                    <CardHeader className="pb-2">
                      <CardTitle className={`text-sm ${textClass} flex items-center gap-2`}>
                        <MapPin className="w-4 h-4 text-blue-400" />
                        Top Spots
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {topPerformers.top_spots.length === 0 ? (
                        <p className="text-xs text-gray-500 text-center py-4">No data for this period</p>
                      ) : (
                        <div className="space-y-2">
                          {topPerformers.top_spots.map((s, idx) => (
                            <div key={s.id} className="flex items-center gap-3 p-2 bg-zinc-800/50 rounded">
                              <span className={`w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold ${
                                idx === 0 ? 'bg-blue-500 text-white' : 'bg-zinc-700 text-gray-300'
                              }`}>{idx + 1}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-white truncate">{s.name}</p>
                                <p className="text-xs text-gray-500">{s.location}</p>
                              </div>
                              <span className="text-sm font-bold text-green-400">{formatCurrency(s.revenue)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Supply/Demand by Location */}
              {supplyDemandData && (
                <Card className={cardBgClass}>
                  <CardHeader className="pb-2">
                    <CardTitle className={`text-sm ${textClass}`}>Supply/Demand by Location</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-4 mb-3 text-xs">
                      <span className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-green-400" /> Balanced
                      </span>
                      <span className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-yellow-400" /> Underserved
                      </span>
                      <span className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-blue-400" /> Oversupplied
                      </span>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                      {supplyDemandData.spots.slice(0, 8).map(spot => (
                        <div key={spot.spot_id} className={`p-2 rounded border ${
                          spot.status === 'balanced' ? 'border-green-500/30 bg-green-500/5' :
                          spot.status === 'underserved' ? 'border-yellow-500/30 bg-yellow-500/5' :
                          spot.status === 'oversupplied' ? 'border-blue-500/30 bg-blue-500/5' :
                          'border-zinc-700 bg-zinc-800/50'
                        }`}>
                          <p className="text-xs font-medium text-white truncate">{spot.name}</p>
                          <p className="text-[10px] text-gray-500">{spot.country}</p>
                          <div className="flex justify-between mt-1 text-[10px]">
                            <span className="text-gray-400">D: {spot.demand}</span>
                            <span className="text-gray-400">S: {spot.supply}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* FUNNEL & RETENTION TAB */}
          {activeSubTab === 'funnel' && (
            <div className="space-y-4">
              {/* Conversion Funnel */}
              {funnelData && (
                <Card className={cardBgClass}>
                  <CardHeader className="pb-2">
                    <CardTitle className={`text-sm ${textClass}`}>Booking Conversion Funnel</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {funnelData.funnel?.map((stage, _idx) => (
                        <div key={stage.stage} className="flex items-center gap-3">
                          <div className="w-32 text-xs text-gray-400">{stage.stage}</div>
                          <div className="flex-1 relative h-8 bg-zinc-800 rounded-full overflow-hidden">
                            <div 
                              className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500 to-teal-500 rounded-full transition-all"
                              style={{ width: `${stage.conversion_rate}%` }}
                            />
                            <span className="absolute inset-0 flex items-center justify-center text-xs text-white font-medium">
                              {stage.count} ({stage.conversion_rate}%)
                            </span>
                          </div>
                          {stage.drop_off > 0 && (
                            <div className="w-14 text-xs text-red-400 text-right">
                              <ArrowDownRight className="inline w-3 h-3" /> {stage.drop_off}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Cohort Retention Heatmap */}
              {cohortData?.cohorts?.length > 0 && (
                <Card className={cardBgClass}>
                  <CardHeader className="pb-2">
                    <CardTitle className={`text-sm ${textClass}`}>Cohort Retention</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500">
                            <th className="text-left p-2">Cohort</th>
                            <th className="text-center p-2">Size</th>
                            {[0,1,2,3,4,5].map(m => (
                              <th key={m} className="text-center p-2">M{m}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {cohortData.cohorts.slice(0, 6).map(cohort => (
                            <tr key={cohort.cohort_month} className="border-t border-zinc-800">
                              <td className="p-2 text-white font-medium">{cohort.cohort_month}</td>
                              <td className="p-2 text-center text-gray-400">{cohort.cohort_size}</td>
                              {[0,1,2,3,4,5].map(m => {
                                const retention = cohort.retention[`month_${m}`];
                                const bgOpacity = retention !== undefined ? Math.min(retention / 100, 1) : 0;
                                return (
                                  <td key={m} className="p-2 text-center">
                                    {retention !== undefined ? (
                                      <span 
                                        className="px-2 py-1 rounded text-white font-medium"
                                        style={{ 
                                          backgroundColor: `rgba(34, 211, 238, ${bgOpacity * 0.5})`,
                                          color: retention >= 50 ? '#fff' : retention >= 25 ? '#d1d5db' : '#9ca3af'
                                        }}
                                      >
                                        {retention}%
                                      </span>
                                    ) : <span className="text-gray-600">-</span>}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* GROWTH TOOLS TAB */}
          {activeSubTab === 'growth' && (
            <div className="space-y-6">
              {/* Promo Codes */}
              <div>
                <div className="flex justify-between items-center mb-3">
                  <h3 className={`font-medium ${textClass}`}>Promo Codes</h3>
                  <Button size="sm" onClick={() => setShowCreatePromo(true)} className="bg-green-500 hover:bg-green-600">
                    <Plus className="w-4 h-4 mr-1" /> Create Code
                  </Button>
                </div>
                {promoCodes.length === 0 ? (
                  <Card className={cardBgClass}>
                    <CardContent className="py-8 text-center">
                      <Gift className="w-10 h-10 mx-auto text-gray-500 mb-2" />
                      <p className={textSecondary}>No promo codes</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-2">
                    {promoCodes.map(p => (
                      <Card key={p.id} className={cardBgClass}>
                        <CardContent className="p-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Gift className="w-5 h-5 text-green-400" />
                            <div>
                              <code className="font-bold text-white bg-zinc-800 px-2 py-0.5 rounded text-sm">{p.code}</code>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {p.code_type === 'percentage' ? `${p.discount_value}% off` : `$${p.discount_value} off`}
                                {p.campaign_name && ` • ${p.campaign_name}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-400">{p.current_uses}/{p.max_uses || '∞'}</span>
                            <Switch checked={p.is_active} onCheckedChange={() => handleTogglePromo(p.id)} />
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              {/* Feature Flags */}
              <div>
                <div className="flex justify-between items-center mb-3">
                  <h3 className={`font-medium ${textClass}`}>Feature Flags</h3>
                  <Button size="sm" onClick={() => setShowCreateFlag(true)} className="bg-blue-500 hover:bg-blue-600">
                    <Plus className="w-4 h-4 mr-1" /> Create Flag
                  </Button>
                </div>
                {featureFlags.length === 0 ? (
                  <Card className={cardBgClass}>
                    <CardContent className="py-8 text-center">
                      <FlagIcon className="w-10 h-10 mx-auto text-gray-500 mb-2" />
                      <p className={textSecondary}>No feature flags</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-2">
                    {featureFlags.map(f => (
                      <Card key={f.id} className={cardBgClass}>
                        <CardContent className="p-3 flex items-center justify-between">
                          <div>
                            <code className="text-sm font-mono text-white bg-zinc-800 px-2 py-0.5 rounded">{f.key}</code>
                            <p className="text-sm text-gray-300 mt-1">{f.name}</p>
                            <p className="text-xs text-gray-500">Rollout: {f.rollout_percentage}%</p>
                          </div>
                          <Switch checked={f.is_enabled} onCheckedChange={() => handleToggleFlag(f.id, f.is_enabled)} />
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              {/* Push Campaigns */}
              <div>
                <div className="flex justify-between items-center mb-3">
                  <h3 className={`font-medium ${textClass}`}>Push Campaigns</h3>
                  <Button size="sm" onClick={() => setShowCreateCampaign(true)} className="bg-purple-500 hover:bg-purple-600">
                    <Plus className="w-4 h-4 mr-1" /> Create Campaign
                  </Button>
                </div>
                {campaigns.length === 0 ? (
                  <Card className={cardBgClass}>
                    <CardContent className="py-8 text-center">
                      <Bell className="w-10 h-10 mx-auto text-gray-500 mb-2" />
                      <p className={textSecondary}>No campaigns</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-2">
                    {campaigns.map(c => (
                      <Card key={c.id} className={cardBgClass}>
                        <CardContent className="p-3 flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-white">{c.name}</p>
                              <Badge className={`text-xs ${
                                c.status === 'sent' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                              }`}>{c.status}</Badge>
                            </div>
                            <p className="text-xs text-gray-500">{c.title}</p>
                          </div>
                          {c.status === 'draft' && (
                            <Button size="sm" onClick={() => handleSendCampaign(c.id)} className="bg-green-500 hover:bg-green-600">
                              <Send className="w-3 h-3 mr-1" /> Send
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Create Promo Modal */}
      <Dialog open={showCreatePromo} onOpenChange={setShowCreatePromo}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader><DialogTitle>Create Promo Code</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-400">Code</label>
              <Input value={newPromo.code} onChange={(e) => setNewPromo({...newPromo, code: e.target.value.toUpperCase()})} placeholder="SUMMER2026" className="bg-zinc-800 border-zinc-700 mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-400">Type</label>
                <Select value={newPromo.code_type} onValueChange={(v) => setNewPromo({...newPromo, code_type: v})}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage Off</SelectItem>
                    <SelectItem value="fixed_amount">Fixed Amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-gray-400">{newPromo.code_type === 'percentage' ? 'Percentage' : 'Amount'}</label>
                <Input type="number" value={newPromo.discount_value} onChange={(e) => setNewPromo({...newPromo, discount_value: parseFloat(e.target.value) || 0})} className="bg-zinc-800 border-zinc-700 mt-1" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreatePromo(false)}>Cancel</Button>
            <Button onClick={handleCreatePromo} disabled={actionLoading} className="bg-green-500">{actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Flag Modal */}
      <Dialog open={showCreateFlag} onOpenChange={setShowCreateFlag}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader><DialogTitle>Create Feature Flag</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-400">Key (snake_case)</label>
              <Input value={newFlag.key} onChange={(e) => setNewFlag({...newFlag, key: e.target.value.toLowerCase().replace(/\s/g, '_')})} placeholder="new_feature" className="bg-zinc-800 border-zinc-700 mt-1 font-mono" />
            </div>
            <div>
              <label className="text-sm text-gray-400">Name</label>
              <Input value={newFlag.name} onChange={(e) => setNewFlag({...newFlag, name: e.target.value})} placeholder="New Feature" className="bg-zinc-800 border-zinc-700 mt-1" />
            </div>
            <div>
              <label className="text-sm text-gray-400">Rollout %</label>
              <Input type="number" min="0" max="100" value={newFlag.rollout_percentage} onChange={(e) => setNewFlag({...newFlag, rollout_percentage: parseInt(e.target.value) || 0})} className="bg-zinc-800 border-zinc-700 mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateFlag(false)}>Cancel</Button>
            <Button onClick={handleCreateFlag} disabled={actionLoading} className="bg-blue-500">{actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Campaign Modal */}
      <Dialog open={showCreateCampaign} onOpenChange={setShowCreateCampaign}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader><DialogTitle>Create Push Campaign</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-400">Campaign Name</label>
              <Input value={newCampaign.name} onChange={(e) => setNewCampaign({...newCampaign, name: e.target.value})} placeholder="Summer Promo" className="bg-zinc-800 border-zinc-700 mt-1" />
            </div>
            <div>
              <label className="text-sm text-gray-400">Notification Title</label>
              <Input value={newCampaign.title} onChange={(e) => setNewCampaign({...newCampaign, title: e.target.value})} placeholder="Don't miss out!" className="bg-zinc-800 border-zinc-700 mt-1" />
            </div>
            <div>
              <label className="text-sm text-gray-400">Body</label>
              <Textarea value={newCampaign.body} onChange={(e) => setNewCampaign({...newCampaign, body: e.target.value})} placeholder="Your message..." className="bg-zinc-800 border-zinc-700 mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateCampaign(false)}>Cancel</Button>
            <Button onClick={handleCreateCampaign} disabled={actionLoading} className="bg-purple-500">{actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminUnifiedAnalytics;
