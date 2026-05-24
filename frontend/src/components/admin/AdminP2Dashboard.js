import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import apiClient from '../../lib/apiClient';
import {
  DollarSign, Gift, Flag as FlagIcon, Bell,
  Loader2
} from 'lucide-react';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import logger from '../../utils/logger';

import { AdminP2RevenueTab } from './p2/AdminP2RevenueTab';
import { AdminP2PromoTab } from './p2/AdminP2PromoTab';
import { AdminP2FlagsTab } from './p2/AdminP2FlagsTab';
import { AdminP2CampaignsTab } from './p2/AdminP2CampaignsTab';
import { AdminP2Modals } from './p2/AdminP2Modals';

export const AdminP2Dashboard = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [activeSubTab, setActiveSubTab] = useState('revenue');
  const [loading, setLoading] = useState(true);
  
  const [revenueData, setRevenueData] = useState(null);
  const [cohortData, setCohortData] = useState(null);
  const [funnelData, setFunnelData] = useState(null);
  
  const [promoCodes, setPromoCodes] = useState([]);
  const [showCreatePromo, setShowCreatePromo] = useState(false);
  const [newPromo, setNewPromo] = useState({
    code: '',
    code_type: 'percentage',
    discount_value: 10,
    max_uses: null,
    campaign_name: ''
  });
  
  const [featureFlags, setFeatureFlags] = useState([]);
  const [showCreateFlag, setShowCreateFlag] = useState(false);
  const [newFlag, setNewFlag] = useState({
    key: '',
    name: '',
    description: '',
    rollout_percentage: 0,
    category: 'general'
  });
  
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
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-card/50 border-border';
  const textClass = isLight ? 'text-gray-900' : 'text-foreground';
  const textSecondary = isLight ? 'text-gray-600' : 'text-muted-foreground';

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
    try { const r = await apiClient.get(`/admin/revenue/overview?days=30`); setRevenueData(r.data); }
    catch (e) { logger.error('Failed to load revenue data:', e); } finally { setLoading(false); }
  };
  const fetchCohortData = async () => {
    try { const r = await apiClient.get(`/admin/revenue/cohort?months=6`); setCohortData(r.data); }
    catch (e) { logger.error('Failed to load cohort data:', e); }
  };
  const fetchFunnelData = async () => {
    try { const r = await apiClient.get(`/admin/funnel/detailed?days=30`); setFunnelData(r.data); }
    catch (e) { logger.error('Failed to load funnel data:', e); }
  };
  const fetchPromoCodes = async () => {
    setLoading(true);
    try { const r = await apiClient.get(`/admin/promo-codes`); setPromoCodes(r.data.promo_codes || []); }
    catch (e) { toast.error('Failed to load promo codes'); } finally { setLoading(false); }
  };
  const fetchFeatureFlags = async () => {
    setLoading(true);
    try { const r = await apiClient.get(`/admin/feature-flags`); setFeatureFlags(r.data.feature_flags || []); }
    catch (e) { toast.error('Failed to load feature flags'); } finally { setLoading(false); }
  };
  const fetchCampaigns = async () => {
    setLoading(true);
    try { const r = await apiClient.get(`/admin/notification-campaigns`); setCampaigns(r.data.campaigns || []); }
    catch (e) { toast.error('Failed to load campaigns'); } finally { setLoading(false); }
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
    try { await apiClient.put(`/admin/promo-codes/${codeId}/toggle`); toast.success('Promo code updated'); fetchPromoCodes(); }
    catch (e) { toast.error('Failed to toggle promo code'); }
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
    try { await apiClient.put(`/admin/feature-flags/${flagId}?is_enabled=${!currentState}`); toast.success('Feature flag updated'); fetchFeatureFlags(); }
    catch (e) { toast.error('Failed to toggle feature flag'); }
  };
  const handleUpdateRollout = async (flagId, percentage) => {
    try { await apiClient.put(`/admin/feature-flags/${flagId}?rollout_percentage=${percentage}`); toast.success('Rollout updated'); fetchFeatureFlags(); }
    catch (e) { toast.error('Failed to update rollout'); }
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

  const formatCurrency = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  const formatDate = (dateStr) => !dateStr ? '-' : new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="space-y-4" data-testid="admin-p2-dashboard">
      <div className="flex gap-2 overflow-x-auto pb-2">
        {[
          { id: 'revenue', label: 'Revenue & Cohorts', icon: DollarSign },
          { id: 'promo', label: 'Promo Codes', icon: Gift },
          { id: 'flags', label: 'Feature Flags', icon: FlagIcon },
          { id: 'campaigns', label: 'Push Campaigns', icon: Bell },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-200 border flex-shrink-0 ${
              activeSubTab === tab.id 
                ? 'bg-green-600 text-white border-green-600 shadow-md shadow-green-600/10' 
                : theme === 'beach'
                  ? 'bg-amber-100/50 text-amber-900 border-amber-200/60 hover:bg-amber-200/60 hover:text-amber-950'
                  : isLight
                    ? 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-100 hover:text-black'
                    : 'bg-zinc-900/50 text-zinc-400 border-zinc-800 hover:bg-zinc-800/50 hover:text-zinc-100'
            }`}
            data-testid={`p2-tab-${tab.id}`}
          >
            <tab.icon className="w-4 h-4 mr-1.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {activeSubTab === 'revenue' && revenueData && (
            <AdminP2RevenueTab
              revenueData={revenueData}
              funnelData={funnelData}
              cohortData={cohortData}
              cardBgClass={cardBgClass}
              textClass={textClass}
              textSecondary={textSecondary}
              formatCurrency={formatCurrency}
            />
          )}

          {activeSubTab === 'promo' && (
            <AdminP2PromoTab
              promoCodes={promoCodes}
              setShowCreatePromo={setShowCreatePromo}
              handleTogglePromo={handleTogglePromo}
              cardBgClass={cardBgClass}
              textClass={textClass}
              textSecondary={textSecondary}
              formatDate={formatDate}
            />
          )}

          {activeSubTab === 'flags' && (
            <AdminP2FlagsTab
              featureFlags={featureFlags}
              setShowCreateFlag={setShowCreateFlag}
              handleUpdateRollout={handleUpdateRollout}
              handleToggleFlag={handleToggleFlag}
              cardBgClass={cardBgClass}
              textClass={textClass}
              textSecondary={textSecondary}
            />
          )}

          {activeSubTab === 'campaigns' && (
            <AdminP2CampaignsTab
              campaigns={campaigns}
              setShowCreateCampaign={setShowCreateCampaign}
              handleSendCampaign={handleSendCampaign}
              actionLoading={actionLoading}
              cardBgClass={cardBgClass}
              textClass={textClass}
              textSecondary={textSecondary}
              formatDate={formatDate}
            />
          )}
        </>
      )}

      <AdminP2Modals
        showCreatePromo={showCreatePromo}
        setShowCreatePromo={setShowCreatePromo}
        newPromo={newPromo}
        setNewPromo={setNewPromo}
        handleCreatePromo={handleCreatePromo}
        showCreateFlag={showCreateFlag}
        setShowCreateFlag={setShowCreateFlag}
        newFlag={newFlag}
        setNewFlag={setNewFlag}
        handleCreateFlag={handleCreateFlag}
        showCreateCampaign={showCreateCampaign}
        setShowCreateCampaign={setShowCreateCampaign}
        newCampaign={newCampaign}
        setNewCampaign={setNewCampaign}
        handleCreateCampaign={handleCreateCampaign}
        actionLoading={actionLoading}
      />
    </div>
  );
};

export default AdminP2Dashboard;
