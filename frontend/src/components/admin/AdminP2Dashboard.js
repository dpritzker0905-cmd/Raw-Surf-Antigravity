import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import apiClient, { BACKEND_URL } from '../../lib/apiClient';
import {
  DollarSign, TrendingUp, Percent, Gift, Flag as FlagIcon, Bell, BarChart3,
  Loader2, Plus, Check, Copy, Send,
  Users, Eye
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


export const AdminP2Dashboard = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [activeSubTab, setActiveSubTab] = useState('revenue');
  const [loading, setLoading] = useState(true);
  
  // Revenue state
  const [revenueData, setRevenueData] = useState(null);
  const [cohortData, setCohortData] = useState(null);
  const [funnelData, setFunnelData] = useState(null);
  
  // Promo Codes state
  const [promoCodes, setPromoCodes] = useState([]);
  const [showCreatePromo, setShowCreatePromo] = useState(false);
  const [newPromo, setNewPromo] = useState({
    code: '',
    code_type: 'percentage',
    discount_value: 10,
    max_uses: null,
    campaign_name: ''
  });
  
  // Feature Flags state
  const [featureFlags, setFeatureFlags] = useState([]);
  const [showCreateFlag, setShowCreateFlag] = useState(false);
  const [newFlag, setNewFlag] = useState({
    key: '',
    name: '',
    description: '',
    rollout_percentage: 0,
    category: 'general'
  });
  
  // Notification Campaigns state
  const [campaigns, setCampaigns] = useState([]);
  const [showCreateCampaign, setShowCreateCampaign] = useState(false);
  const [newCampaign, setNewCampaign] = useState({
    name: '',
    title: '',
    body: '',
    target_all_users: false,
    target_roles: []
  });
  
  const [actionLoading, setActionLoading] = useState(false);

  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/50 border-zinc-800';
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';

  useEffect(() => {
    if (user?.id) {
      if (activeSubTab === 'revenue') {
        fetchRevenueData();
        fetchCohortData();
        fetchFunnelData();
      } else if (activeSubTab === 'promo') {
        fetchPromoCodes();
      } else if (activeSubTab === 'flags') {
        fetchFeatureFlags();
      } else if (activeSubTab === 'campaigns') {
        fetchCampaigns();
      }
    }
  }, [user?.id, activeSubTab]);

  const fetchRevenueData = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/admin/revenue/overview?days=30`);
      setRevenueData(response.data);
    } catch (error) {
      logger.error('Failed to load revenue data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCohortData = async () => {
    try {
      const response = await apiClient.get(`/admin/revenue/cohort?months=6`);
      setCohortData(response.data);
    } catch (error) {
      logger.error('Failed to load cohort data:', error);
    }
  };

  const fetchFunnelData = async () => {
    try {
      const response = await apiClient.get(`/admin/funnel/detailed?days=30`);
      setFunnelData(response.data);
    } catch (error) {
      logger.error('Failed to load funnel data:', error);
    }
  };

  const fetchPromoCodes = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/admin/promo-codes`);
      setPromoCodes(response.data.promo_codes || []);
    } catch (error) {
      toast.error('Failed to load promo codes');
    } finally {
      setLoading(false);
    }
  };

  const fetchFeatureFlags = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/admin/feature-flags`);
      setFeatureFlags(response.data.feature_flags || []);
    } catch (error) {
      toast.error('Failed to load feature flags');
    } finally {
      setLoading(false);
    }
  };

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/admin/notification-campaigns`);
      setCampaigns(response.data.campaigns || []);
    } catch (error) {
      toast.error('Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePromo = async () => {
    if (!newPromo.code || !newPromo.discount_value) {
      toast.error('Please fill in required fields');
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.post(`/admin/promo-codes`, newPromo);
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
      await apiClient.put(`/admin/promo-codes/${codeId}/toggle`);
      toast.success('Promo code updated');
      fetchPromoCodes();
    } catch (error) {
      toast.error('Failed to toggle promo code');
    }
  };

  const handleCreateFlag = async () => {
    if (!newFlag.key || !newFlag.name) {
      toast.error('Please fill in required fields');
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.post(`/admin/feature-flags`, newFlag);
      toast.success('Feature flag created');
      setShowCreateFlag(false);
      setNewFlag({ key: '', name: '', description: '', rollout_percentage: 0, category: 'general' });
      fetchFeatureFlags();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create feature flag');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleFlag = async (flagId, currentState) => {
    try {
      await apiClient.put(`/admin/feature-flags/${flagId}?is_enabled=${!currentState}`);
      toast.success('Feature flag updated');
      fetchFeatureFlags();
    } catch (error) {
      toast.error('Failed to toggle feature flag');
    }
  };

  const handleUpdateRollout = async (flagId, percentage) => {
    try {
      await apiClient.put(`/admin/feature-flags/${flagId}?rollout_percentage=${percentage}`);
      toast.success('Rollout updated');
      fetchFeatureFlags();
    } catch (error) {
      toast.error('Failed to update rollout');
    }
  };

  const handleCreateCampaign = async () => {
    if (!newCampaign.name || !newCampaign.title || !newCampaign.body) {
      toast.error('Please fill in required fields');
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.post(`/admin/notification-campaigns`, newCampaign);
      toast.success('Campaign created');
      setShowCreateCampaign(false);
      setNewCampaign({ name: '', title: '', body: '', target_all_users: false, target_roles: [] });
      fetchCampaigns();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create campaign');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendCampaign = async (campaignId) => {
    if (!confirm('Are you sure you want to send this campaign now?')) return;
    setActionLoading(true);
    try {
      const response = await apiClient.post(`/admin/notification-campaigns/${campaignId}/send`);
      toast.success(`Sent to ${response.data.total_sent} users`);
      fetchCampaigns();
    } catch (error) {
      toast.error('Failed to send campaign');
    } finally {
      setActionLoading(false);
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  };

  return (
    <div className="space-y-4" data-testid="admin-p2-dashboard">
      {/* Sub-tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {[
          { id: 'revenue', label: 'Revenue & Cohorts', icon: DollarSign },
          { id: 'promo', label: 'Promo Codes', icon: Gift },
          { id: 'flags', label: 'Feature Flags', icon: FlagIcon },
          { id: 'campaigns', label: 'Push Campaigns', icon: Bell },
        ].map(tab => (
          <Button
            key={tab.id}
            variant={activeSubTab === tab.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveSubTab(tab.id)}
            className={activeSubTab === tab.id ? 'bg-green-500 hover:bg-green-600' : ''}
            data-testid={`p2-tab-${tab.id}`}
          >
            <tab.icon className="w-4 h-4 mr-1.5" />
            {tab.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {/* REVENUE TAB */}
          {activeSubTab === 'revenue' && revenueData && (
            <div className="space-y-4">
              {/* Key Metrics */}
              <div className="grid grid-cols-4 gap-3">
                <Card className={`${cardBgClass} border-green-500/30`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`text-xs ${textSecondary}`}>GMV (30d)</p>
                        <p className="text-2xl font-bold text-green-400">
                          {formatCurrency(revenueData.gmv)}
                        </p>
                        <p className={`text-xs ${revenueData.gmv_change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {revenueData.gmv_change >= 0 ? '+' : ''}{revenueData.gmv_change}% vs prev
                        </p>
                      </div>
                      <TrendingUp className="w-8 h-8 text-green-500/50" />
                    </div>
                  </CardContent>
                </Card>

                <Card className={`${cardBgClass} border-blue-500/30`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`text-xs ${textSecondary}`}>Platform Revenue</p>
                        <p className="text-2xl font-bold text-blue-400">
                          {formatCurrency(revenueData.platform_revenue)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {revenueData.take_rate}% take rate
                        </p>
                      </div>
                      <DollarSign className="w-8 h-8 text-blue-500/50" />
                    </div>
                  </CardContent>
                </Card>

                <Card className={`${cardBgClass} border-purple-500/30`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`text-xs ${textSecondary}`}>MRR</p>
                        <p className="text-2xl font-bold text-purple-400">
                          {formatCurrency(revenueData.mrr)}
                        </p>
                        <p className="text-xs text-gray-500">Subscriptions</p>
                      </div>
                      <BarChart3 className="w-8 h-8 text-purple-500/50" />
                    </div>
                  </CardContent>
                </Card>

                <Card className={`${cardBgClass} border-orange-500/30`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`text-xs ${textSecondary}`}>Conversion Rate</p>
                        <p className="text-2xl font-bold text-orange-400">
                          {funnelData?.overall_conversion_rate || 0}%
                        </p>
                        <p className="text-xs text-gray-500">Booking funnel</p>
                      </div>
                      <Percent className="w-8 h-8 text-orange-500/50" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Revenue by Type */}
              <Card className={cardBgClass}>
                <CardHeader className="pb-2">
                  <CardTitle className={`text-sm ${textClass}`}>Revenue by Type</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-2">
                    {Object.entries(revenueData.breakdown_by_type || {}).map(([type, data]) => (
                      <div key={type} className="p-3 bg-zinc-800 rounded-lg">
                        <p className="text-xs text-gray-500 capitalize">{type.replace(/_/g, ' ')}</p>
                        <p className="text-lg font-bold text-white">{formatCurrency(data.revenue)}</p>
                        <p className="text-xs text-gray-400">{data.transactions} txns</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Funnel */}
              {funnelData && (
                <Card className={cardBgClass}>
                  <CardHeader className="pb-2">
                    <CardTitle className={`text-sm ${textClass}`}>Booking Funnel</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {funnelData.funnel?.map((stage, _idx) => (
                        <div key={stage.stage} className="flex items-center gap-3">
                          <div className="w-32 text-xs text-gray-400">{stage.stage}</div>
                          <div className="flex-1 relative h-6 bg-zinc-800 rounded-full overflow-hidden">
                            <div 
                              className="absolute inset-y-0 left-0 bg-gradient-to-r from-green-500 to-teal-500 rounded-full transition-all"
                              style={{ width: `${stage.conversion_rate}%` }}
                            />
                            <span className="absolute inset-0 flex items-center justify-center text-xs text-white font-medium">
                              {stage.count} ({stage.conversion_rate}%)
                            </span>
                          </div>
                          {stage.drop_off > 0 && (
                            <div className="text-xs text-red-400">-{stage.drop_off}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Cohort Analysis */}
              {cohortData?.cohorts && cohortData.cohorts.length > 0 && (
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
                              <td className="p-2 text-white">{cohort.cohort_month}</td>
                              <td className="p-2 text-center text-gray-400">{cohort.cohort_size}</td>
                              {[0,1,2,3,4,5].map(m => {
                                const retention = cohort.retention[`month_${m}`];
                                return (
                                  <td key={m} className="p-2 text-center">
                                    {retention !== undefined ? (
                                      <span className={`px-2 py-0.5 rounded ${
                                        retention >= 50 ? 'bg-green-500/20 text-green-400' :
                                        retention >= 25 ? 'bg-yellow-500/20 text-yellow-400' :
                                        'bg-red-500/20 text-red-400'
                                      }`}>
                                        {retention}%
                                      </span>
                                    ) : '-'}
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

          {/* PROMO CODES TAB */}
          {activeSubTab === 'promo' && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className={`font-medium ${textClass}`}>Promo Codes</h3>
                <Button size="sm" onClick={() => setShowCreatePromo(true)} className="bg-green-500 hover:bg-green-600">
                  <Plus className="w-4 h-4 mr-1" /> Create Code
                </Button>
              </div>

              {promoCodes.length === 0 ? (
                <Card className={cardBgClass}>
                  <CardContent className="py-12 text-center">
                    <Gift className="w-12 h-12 mx-auto text-gray-500 mb-3" />
                    <p className={textSecondary}>No promo codes yet</p>
                  </CardContent>
                </Card>
              ) : (
                promoCodes.map(promo => (
                  <Card key={promo.id} className={cardBgClass}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="p-2 bg-green-500/20 rounded-lg">
                            <Gift className="w-6 h-6 text-green-400" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <code className="text-lg font-bold text-white bg-zinc-800 px-2 py-0.5 rounded">
                                {promo.code}
                              </code>
                              <Button 
                                size="sm" 
                                variant="ghost" 
                                className="h-6 w-6 p-0"
                                onClick={() => { navigator.clipboard.writeText(promo.code); toast.success('Copied!'); }}
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            </div>
                            <p className={`text-sm ${textSecondary}`}>
                              {promo.code_type === 'percentage' ? `${promo.discount_value}% off` :
                               promo.code_type === 'fixed_amount' ? `$${promo.discount_value} off` :
                               `${promo.discount_value} free credits`}
                              {promo.campaign_name && ` • ${promo.campaign_name}`}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-sm text-white">
                              {promo.current_uses} / {promo.max_uses || '∞'} uses
                            </p>
                            {promo.valid_until && (
                              <p className="text-xs text-gray-500">
                                Expires {formatDate(promo.valid_until)}
                              </p>
                            )}
                          </div>
                          <Switch
                            checked={promo.is_active}
                            onCheckedChange={() => handleTogglePromo(promo.id)}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* FEATURE FLAGS TAB */}
          {activeSubTab === 'flags' && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className={`font-medium ${textClass}`}>Feature Flags</h3>
                <Button size="sm" onClick={() => setShowCreateFlag(true)} className="bg-blue-500 hover:bg-blue-600">
                  <Plus className="w-4 h-4 mr-1" /> Create Flag
                </Button>
              </div>

              {featureFlags.length === 0 ? (
                <Card className={cardBgClass}>
                  <CardContent className="py-12 text-center">
                    <FlagIcon className="w-12 h-12 mx-auto text-gray-500 mb-3" />
                    <p className={textSecondary}>No feature flags yet</p>
                  </CardContent>
                </Card>
              ) : (
                featureFlags.map(flag => (
                  <Card key={flag.id} className={`${cardBgClass} ${flag.kill_switch_enabled ? 'border-red-500/50' : ''}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <code className="text-sm font-mono text-white bg-zinc-800 px-2 py-0.5 rounded">
                              {flag.key}
                            </code>
                            {flag.is_experiment && (
                              <Badge className="bg-purple-500/20 text-purple-400">Experiment</Badge>
                            )}
                            {flag.kill_switch_enabled && (
                              <Badge className="bg-red-500/20 text-red-400">Kill Switch ON</Badge>
                            )}
                          </div>
                          <p className={`text-sm ${textClass} mt-1`}>{flag.name}</p>
                          {flag.description && (
                            <p className={`text-xs ${textSecondary}`}>{flag.description}</p>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-4">
                          {/* Rollout slider */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">Rollout:</span>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={flag.rollout_percentage}
                              onChange={(e) => handleUpdateRollout(flag.id, parseInt(e.target.value))}
                              className="w-20 h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer"
                            />
                            <span className="text-xs text-white w-8">{flag.rollout_percentage}%</span>
                          </div>
                          
                          <Switch
                            checked={flag.is_enabled}
                            onCheckedChange={() => handleToggleFlag(flag.id, flag.is_enabled)}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* PUSH CAMPAIGNS TAB */}
          {activeSubTab === 'campaigns' && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className={`font-medium ${textClass}`}>Push Notification Campaigns</h3>
                <Button size="sm" onClick={() => setShowCreateCampaign(true)} className="bg-purple-500 hover:bg-purple-600">
                  <Plus className="w-4 h-4 mr-1" /> Create Campaign
                </Button>
              </div>

              {campaigns.length === 0 ? (
                <Card className={cardBgClass}>
                  <CardContent className="py-12 text-center">
                    <Bell className="w-12 h-12 mx-auto text-gray-500 mb-3" />
                    <p className={textSecondary}>No campaigns yet</p>
                  </CardContent>
                </Card>
              ) : (
                campaigns.map(campaign => (
                  <Card key={campaign.id} className={cardBgClass}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className={`font-medium ${textClass}`}>{campaign.name}</p>
                            <Badge className={`text-xs ${
                              campaign.status === 'sent' ? 'bg-green-500/20 text-green-400' :
                              campaign.status === 'scheduled' ? 'bg-blue-500/20 text-blue-400' :
                              campaign.status === 'cancelled' ? 'bg-gray-500/20 text-gray-400' :
                              'bg-yellow-500/20 text-yellow-400'
                            }`}>
                              {campaign.status}
                            </Badge>
                          </div>
                          <p className={`text-sm ${textSecondary}`}>
                            <strong>{campaign.title}</strong>: {campaign.body}
                          </p>
                          
                          {campaign.status === 'sent' && (
                            <div className="flex gap-4 mt-2 text-xs">
                              <span className="text-gray-400">
                                <Users className="w-3 h-3 inline mr-1" />
                                {campaign.stats.targeted} targeted
                              </span>
                              <span className="text-green-400">
                                <Check className="w-3 h-3 inline mr-1" />
                                {campaign.stats.delivered} delivered
                              </span>
                              <span className="text-blue-400">
                                <Eye className="w-3 h-3 inline mr-1" />
                                {campaign.stats.open_rate}% opened
                              </span>
                            </div>
                          )}
                        </div>
                        
                        <div className="shrink-0 flex flex-col items-end gap-2">
                          <p className={`text-xs ${textSecondary}`}>
                            {campaign.sent_at ? `Sent ${formatDate(campaign.sent_at)}` : 
                             campaign.scheduled_at ? `Scheduled ${formatDate(campaign.scheduled_at)}` :
                             formatDate(campaign.created_at)}
                          </p>
                          {campaign.status === 'draft' && (
                            <Button
                              size="sm"
                              onClick={() => handleSendCampaign(campaign.id)}
                              disabled={actionLoading}
                              className="bg-green-500 hover:bg-green-600"
                            >
                              <Send className="w-3 h-3 mr-1" /> Send Now
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}
        </>
      )}

      {/* Create Promo Code Modal */}
      <Dialog open={showCreatePromo} onOpenChange={setShowCreatePromo}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle>Create Promo Code</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-400">Code</label>
              <Input
                value={newPromo.code}
                onChange={(e) => setNewPromo({ ...newPromo, code: e.target.value.toUpperCase() })}
                placeholder="SUMMER2026"
                className="bg-zinc-800 border-zinc-700 mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-400">Type</label>
                <Select value={newPromo.code_type} onValueChange={(v) => setNewPromo({ ...newPromo, code_type: v })}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage Off</SelectItem>
                    <SelectItem value="fixed_amount">Fixed Amount</SelectItem>
                    <SelectItem value="free_credits">Free Credits</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-gray-400">
                  {newPromo.code_type === 'percentage' ? 'Percentage' : 'Amount'}
                </label>
                <Input
                  type="number"
                  value={newPromo.discount_value}
                  onChange={(e) => setNewPromo({ ...newPromo, discount_value: parseFloat(e.target.value) })}
                  className="bg-zinc-800 border-zinc-700 mt-1"
                />
              </div>
            </div>
            <div>
              <label className="text-sm text-gray-400">Max Uses (optional)</label>
              <Input
                type="number"
                value={newPromo.max_uses || ''}
                onChange={(e) => setNewPromo({ ...newPromo, max_uses: e.target.value ? parseInt(e.target.value) : null })}
                placeholder="Unlimited"
                className="bg-zinc-800 border-zinc-700 mt-1"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400">Campaign Name (optional)</label>
              <Input
                value={newPromo.campaign_name}
                onChange={(e) => setNewPromo({ ...newPromo, campaign_name: e.target.value })}
                placeholder="Summer Sale 2026"
                className="bg-zinc-800 border-zinc-700 mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreatePromo(false)}>Cancel</Button>
            <Button onClick={handleCreatePromo} disabled={actionLoading} className="bg-green-500 hover:bg-green-600">
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Feature Flag Modal */}
      <Dialog open={showCreateFlag} onOpenChange={setShowCreateFlag}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle>Create Feature Flag</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-400">Key (snake_case)</label>
              <Input
                value={newFlag.key}
                onChange={(e) => setNewFlag({ ...newFlag, key: e.target.value.toLowerCase().replace(/\s/g, '_') })}
                placeholder="new_booking_flow"
                className="bg-zinc-800 border-zinc-700 mt-1 font-mono"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400">Name</label>
              <Input
                value={newFlag.name}
                onChange={(e) => setNewFlag({ ...newFlag, name: e.target.value })}
                placeholder="New Booking Flow"
                className="bg-zinc-800 border-zinc-700 mt-1"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400">Description</label>
              <Textarea
                value={newFlag.description}
                onChange={(e) => setNewFlag({ ...newFlag, description: e.target.value })}
                placeholder="What does this flag control?"
                className="bg-zinc-800 border-zinc-700 mt-1"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400">Initial Rollout %</label>
              <Input
                type="number"
                min="0"
                max="100"
                value={newFlag.rollout_percentage}
                onChange={(e) => setNewFlag({ ...newFlag, rollout_percentage: parseInt(e.target.value) })}
                className="bg-zinc-800 border-zinc-700 mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateFlag(false)}>Cancel</Button>
            <Button onClick={handleCreateFlag} disabled={actionLoading} className="bg-blue-500 hover:bg-blue-600">
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Campaign Modal */}
      <Dialog open={showCreateCampaign} onOpenChange={setShowCreateCampaign}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle>Create Push Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-400">Campaign Name</label>
              <Input
                value={newCampaign.name}
                onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })}
                placeholder="Summer Promo Announcement"
                className="bg-zinc-800 border-zinc-700 mt-1"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400">Notification Title</label>
              <Input
                value={newCampaign.title}
                onChange={(e) => setNewCampaign({ ...newCampaign, title: e.target.value })}
                placeholder="🏄 Don't miss out!"
                className="bg-zinc-800 border-zinc-700 mt-1"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400">Notification Body</label>
              <Textarea
                value={newCampaign.body}
                onChange={(e) => setNewCampaign({ ...newCampaign, body: e.target.value })}
                placeholder="Book your next session and get 20% off..."
                className="bg-zinc-800 border-zinc-700 mt-1"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={newCampaign.target_all_users}
                onCheckedChange={(v) => setNewCampaign({ ...newCampaign, target_all_users: v })}
              />
              <label className="text-sm text-gray-400">Send to all users</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateCampaign(false)}>Cancel</Button>
            <Button onClick={handleCreateCampaign} disabled={actionLoading} className="bg-purple-500 hover:bg-purple-600">
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminP2Dashboard;
