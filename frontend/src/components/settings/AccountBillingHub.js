/**
 * AccountBillingHub - Subscription & Status Management
 * Location: Settings > Account & Billing
 * 
 * Features:
 * - Surfer Status Toggle (Regular ↔ Competitive for 18+)
 * - Plan Management (Tier 1/2/3 with Stripe)
 * - Grom Management for Parents
 * - Parent-Surfer Hybrid toggle
 * 
 * IMPORTANT: Uses centralized subscriptionPlans.config.js as SINGLE SOURCE OF TRUTH
 * This ensures plan parity between Signup and Settings
 */
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import apiClient, { BACKEND_URL } from '../../lib/apiClient';
import { 
  CreditCard, Trophy, Users, Loader2, Check, 
  Clock, AlertCircle, Waves, UserPlus, Crown, Shield, Coins, Plus
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import { toast } from 'sonner';
// Import from centralized config - SINGLE SOURCE OF TRUTH
import { 
  SURFER_PLANS, 
  GROM_PLANS, 
  PHOTOGRAPHER_PLANS,
  subscriptionTierToTierId,
  getPlanByTierId
} from '../../config/subscriptionPlans.config';
import logger from '../../utils/logger';

const API = process.env.REACT_APP_BACKEND_URL;

/**
 * Get the appropriate plans based on user role
 */
const getPlansForRole = (role) => {
  const photographerRoles = ['Photographer', 'Hobbyist', 'Approved Pro'];
  const gromRoles = ['Grom'];
  
  if (gromRoles.includes(role)) {
    return GROM_PLANS.monthly;
  } else if (photographerRoles.includes(role)) {
    return PHOTOGRAPHER_PLANS.monthly;
  }
  return SURFER_PLANS.monthly;
};

export const AccountBillingHub = () => {
  const { user, refreshUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [accountData, setAccountData] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [upgrading, setUpgrading] = useState(null);
  const [expandedGrom, setExpandedGrom] = useState(null);
  const [_showCreditPayment, setShowCreditPayment] = useState(null); // tier_id or 'grom-{id}-{tier}'
  const [_creditPaymentInfo, setCreditPaymentInfo] = useState(null);

  useEffect(() => {
    if (user?.id) {
      fetchAccountBilling();
    }
  }, [user?.id]);

  const fetchAccountBilling = async () => {
    try {
      const response = await apiClient.get(`/api/subscriptions/account-billing/${user.id}`);
      setAccountData(response.data);
    } catch (error) {
      logger.error('Failed to fetch account billing:', error);
      toast.error('Failed to load account settings');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusToggle = async (newStatus) => {
    setToggling(true);
    try {
      await apiClient.post(`/api/subscriptions/toggle-status/${user.id}`, {
        status: newStatus
      });
      toast.success(`Status changed to ${newStatus === 'competitive' ? 'Competitive' : 'Regular'} Surfer`);
      await fetchAccountBilling();
      if (refreshUser) refreshUser();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update status');
    } finally {
      setToggling(false);
    }
  };

  const handleTierUpgrade = async (tierId, useCredits = false) => {
    // If using credits, first check if user can afford it
    if (useCredits) {
      setUpgrading(tierId);
      try {
        const response = await apiClient.post(`/api/subscriptions/pay-with-credits/${user.id}`, {
          tier_id: tierId,
          use_credits: true
        });
        
        if (response.data.insufficient_credits) {
          // Show insufficient credits dialog
          setCreditPaymentInfo(response.data);
          setShowCreditPayment(tierId);
          return;
        }
        
        toast.success(response.data.message);
        await fetchAccountBilling();
        if (refreshUser) refreshUser();
      } catch (error) {
        toast.error(error.response?.data?.detail || 'Failed to process credit payment');
      } finally {
        setUpgrading(null);
      }
      return;
    }
    
    // Standard Stripe checkout
    setUpgrading(tierId);
    try {
      const response = await apiClient.post(`/api/subscriptions/upgrade-tier/${user.id}`, {
        tier_id: tierId,
        origin_url: window.location.origin
      });
      
      if (response.data.checkout_url) {
        window.location.href = response.data.checkout_url;
      } else {
        toast.success(response.data.message);
        await fetchAccountBilling();
        if (refreshUser) refreshUser();
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to process upgrade');
    } finally {
      setUpgrading(null);
    }
  };

  const handleGromTierChange = async (gromId, tierId, useCredits = false) => {
    const upgradeKey = `grom-${gromId}-${tierId}`;
    
    // If using credits for Grom subscription
    if (useCredits) {
      setUpgrading(upgradeKey);
      try {
        const response = await apiClient.post(`/api/subscriptions/grom-pay-with-credits/${user.id}`, {
          grom_id: gromId,
          tier_id: tierId,
          use_credits: true
        });
        
        if (response.data.insufficient_credits) {
          setCreditPaymentInfo(response.data);
          setShowCreditPayment(upgradeKey);
          return;
        }
        
        toast.success(response.data.message);
        await fetchAccountBilling();
      } catch (error) {
        toast.error(error.response?.data?.detail || 'Failed to process credit payment');
      } finally {
        setUpgrading(null);
      }
      return;
    }
    
    // Standard Stripe checkout for Grom
    setUpgrading(upgradeKey);
    try {
      const response = await apiClient.post(`/api/subscriptions/grom-tier/${user.id}`, {
        grom_id: gromId,
        tier_id: tierId,
        origin_url: window.location.origin
      });
      
      if (response.data.checkout_url) {
        window.location.href = response.data.checkout_url;
      } else {
        toast.success(response.data.message);
        await fetchAccountBilling();
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update Grom subscription');
    } finally {
      setUpgrading(null);
    }
  };

  const handleApplyForPro = async () => {
    setToggling(true);
    try {
      const response = await apiClient.post(`/api/subscriptions/apply-pro/${user.id}`);
      toast.success(response.data.message);
      await fetchAccountBilling();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to apply for Pro status');
    } finally {
      setToggling(false);
    }
  };

  const handleParentSurferMode = async (enabled) => {
    setToggling(true);
    try {
      await apiClient.post(`/api/subscriptions/parent-surfer-mode/${user.id}`, {
        active_surfer_mode: enabled
      });
      toast.success(`Active Surfer Mode ${enabled ? 'enabled' : 'disabled'}`);
      await fetchAccountBilling();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update mode');
    } finally {
      setToggling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (!accountData) {
    return (
      <div className="text-center py-8 text-gray-400">
        <AlertCircle className="w-12 h-12 mx-auto mb-4" />
        <p>Failed to load account settings</p>
      </div>
    );
  }

  const isSurfer = ['Surfer', 'Comp Surfer', 'Pro'].includes(accountData.role);
  const isGromParent = accountData.role === 'Grom Parent';
  const isPhotographer = ['Photographer', 'Hobbyist', 'Approved Pro'].includes(accountData.role);
  const isCompetitive = accountData.current_status === 'competitive';

  return (
    <div className="space-y-4" data-testid="account-billing-hub">
      {/* Surfer Status Toggle - Only for 18+ Surfers */}
      {isSurfer && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-400" />
              Surfer Status
              {accountData.is_pending_pro && (
                <Badge className="ml-auto bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                  <Clock className="w-3 h-3 mr-1" />
                  Pro Pending
                </Badge>
              )}
              {accountData.is_approved_pro && (
                <Badge className="ml-auto bg-purple-500/20 text-purple-400 border-purple-500/30">
                  <Crown className="w-3 h-3 mr-1" />
                  Pro Verified
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Your identity in the surf community. Competitive status unlocks Tips, Sponsorship tabs, and Leaderboard placement.
            </p>
            
            <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-full ${isCompetitive ? 'bg-yellow-500/20' : 'bg-gray-500/20'}`}>
                  {isCompetitive ? (
                    <Trophy className="w-5 h-5 text-yellow-400" />
                  ) : (
                    <Waves className="w-5 h-5 text-gray-400" />
                  )}
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    {isCompetitive ? 'Competitive Surfer' : 'Regular Surfer'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {isCompetitive ? 'Tips, Sponsorship, Leaderboards active' : 'Standard surf experience'}
                  </p>
                </div>
              </div>
              <Switch
                checked={isCompetitive}
                onCheckedChange={(checked) => handleStatusToggle(checked ? 'competitive' : 'regular')}
                disabled={toggling || accountData.is_approved_pro}
                data-testid="surfer-status-toggle"
              />
            </div>

            {/* Apply for Pro - Only for Competitive Surfers not yet approved */}
            {isCompetitive && !accountData.is_approved_pro && !accountData.is_pending_pro && (
              <Button
                onClick={handleApplyForPro}
                disabled={toggling}
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
                data-testid="apply-pro-btn"
              >
                {toggling ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Crown className="w-4 h-4 mr-2" />}
                Apply for Pro Surfer Vetting
              </Button>
            )}

            {accountData.is_pending_pro && (
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <p className="text-sm text-yellow-400">
                  <Clock className="w-4 h-4 inline mr-1" />
                  Your Pro application is under review. You have full Competitive access while pending.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Parent-Surfer Hybrid Toggle */}
      {isGromParent && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Waves className="w-5 h-5 text-cyan-400" />
              Active Surfer Mode
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enable to add your own surfer stats and athletic tracking to your profile. You can still manage your Grom's activities.
            </p>
            
            <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-cyan-500/20">
                  <Waves className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Active Surfer Mode</p>
                  <p className="text-xs text-muted-foreground">Track your own sessions & stats</p>
                </div>
              </div>
              <Switch
                checked={accountData.is_active_surfer}
                onCheckedChange={handleParentSurferMode}
                disabled={toggling}
                data-testid="parent-surfer-mode-toggle"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plan Management - Uses centralized config as SINGLE SOURCE OF TRUTH */}
      <Card className="bg-card border-border overflow-hidden">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-green-400" />
            Your Plan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 overflow-hidden">
          <p className="text-sm text-muted-foreground">
            Manage your subscription tier. Higher tiers unlock more storage, lower commission rates, and Gold-Pass booking access.
          </p>

          {/* Current Plan Badge - from centralized config */}
          {(() => {
            const currentTierId = subscriptionTierToTierId(accountData.subscription_tier);
            const currentPlan = getPlanByTierId(currentTierId, isPhotographer ? 'photographer' : 'surfer');
            const TierIcon = currentPlan?.icon || CreditCard;
            
            return (
              <div className="p-4 bg-muted rounded-lg">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-full ${currentPlan?.bgColor || 'bg-gray-500/20'}`}>
                    <TierIcon className={`w-6 h-6 ${currentPlan?.iconColor || 'text-gray-400'}`} />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      {currentPlan?.name || 'Free'} Plan
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {currentPlan?.description}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Tier Options - from centralized config (mirrors Signup exactly) */}
          <div className="grid gap-3 w-full">
            {getPlansForRole(accountData.role).map((plan) => {
              const currentTierId = subscriptionTierToTierId(accountData.subscription_tier);
              const isCurrentTier = plan.tier_id === currentTierId;
              const TierIcon = plan.icon || CreditCard;
              const creditsRequired = Math.ceil(plan.price); // 1:1 ratio - 1 credit = $1
              const canAffordWithCredits = (user?.credit_balance || 0) >= creditsRequired;
              
              return (
                <div
                  key={plan.tier_id}
                  className={`p-3 rounded-lg border transition-all overflow-hidden ${
                    isCurrentTier 
                      ? 'border-cyan-500 bg-cyan-500/10' 
                      : 'border-border hover:border-cyan-500/50'
                  }`}
                  data-testid={`tier-option-${plan.tier_id}`}
                >
                  <div className="flex items-start justify-between gap-2 w-full">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <div className={`p-2 rounded-full flex-shrink-0 ${plan.bgColor}`}>
                        <TierIcon className={`w-4 h-4 ${plan.iconColor}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-medium text-foreground text-sm">{plan.name}</p>
                          {plan.badge && (
                            <Badge className="bg-yellow-500/20 text-yellow-400 text-[10px] px-1.5 py-0">
                              {plan.badge}
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {plan.storage_gb === -1 ? 'Unlimited' : plan.storage_gb ? `${plan.storage_gb}GB` : '5GB'}
                          {plan.commission_rate && ` • ${Math.round(plan.commission_rate * 100)}%`}
                          {plan.gold_pass && ' • Gold'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 whitespace-nowrap">
                      {plan.price === 0 ? (
                        <span className="text-green-400 font-bold text-sm">Free</span>
                      ) : (
                        <>
                          <p className="text-foreground font-bold text-sm">${plan.price}/mo</p>
                          <p className="text-[11px] text-muted-foreground">{creditsRequired} cr</p>
                        </>
                      )}
                    </div>
                  </div>
                  
                  {/* Payment Options - only for non-current paid tiers */}
                  {!isCurrentTier && plan.price > 0 && (
                    <div className="mt-2 pt-2 border-t border-border flex gap-2 w-full">
                      <Button
                        onClick={() => handleTierUpgrade(plan.tier_id, false)}
                        disabled={upgrading === plan.tier_id}
                        className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-black text-xs px-2"
                        size="sm"
                      >
                        {upgrading === plan.tier_id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <>
                            <CreditCard className="w-3 h-3 mr-1" />
                            Card
                          </>
                        )}
                      </Button>
                      <Button
                        onClick={() => handleTierUpgrade(plan.tier_id, true)}
                        disabled={upgrading === plan.tier_id}
                        variant="outline"
                        className={`flex-1 text-xs px-2 ${
                          canAffordWithCredits 
                            ? 'border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10' 
                            : 'border-border text-muted-foreground'
                        }`}
                        size="sm"
                      >
                        <Coins className="w-3 h-3 mr-1" />
                        {canAffordWithCredits ? 'Credits' : `+${creditsRequired - (user?.credit_balance || 0)}`}
                      </Button>
                    </div>
                  )}

                  {/* Free tier - instant switch */}
                  {!isCurrentTier && plan.price === 0 && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <Button
                        onClick={() => handleTierUpgrade(plan.tier_id, false)}
                        disabled={upgrading === plan.tier_id}
                        className="w-full bg-green-500 hover:bg-green-600 text-white text-xs"
                        size="sm"
                      >
                        {upgrading === plan.tier_id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          'Switch to Free'
                        )}
                      </Button>
                    </div>
                  )}

                  {/* Current tier indicator */}
                  {isCurrentTier && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <Badge className="bg-cyan-500/20 text-cyan-400 w-full justify-center py-1 text-xs">
                        <Check className="w-3 h-3 mr-1" />
                        Current Plan
                      </Badge>
                    </div>
                  )}
                  
                  {/* Feature list - matches Signup exactly */}
                  {plan.popular && !isCurrentTier && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <div className="flex flex-wrap gap-2">
                        {plan.features.filter(f => f.included && f.highlight).slice(0, 3).map((feature, idx) => (
                          <span key={idx} className="text-xs text-cyan-400 flex items-center gap-1">
                            <Check className="w-3 h-3" />
                            {feature.text}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Credit Balance Display */}
          <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-yellow-400">
                <Coins className="w-5 h-5" />
                <span className="font-medium">Stoked Credits</span>
              </div>
              <div className="text-right">
                <p className="font-bold text-yellow-400">{user?.credit_balance || 0} credits</p>
                <p className="text-xs text-muted-foreground">${(user?.credit_balance || 0).toFixed(2)} value</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2 border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10"
              onClick={() => window.location.href = '/wallet'}
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Credits
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Grom Management - Parent Only */}
      {isGromParent && accountData.linked_groms?.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Users className="w-5 h-5 text-purple-400" />
              Manage Grom Plans
              <Badge className="ml-auto bg-purple-500/20 text-purple-400">
                {accountData.linked_groms.length} Grom{accountData.linked_groms.length > 1 ? 's' : ''}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Manage subscription plans for your linked Groms. You control their billing.
            </p>

            {accountData.linked_groms.map((grom) => (
              <div 
                key={grom.id} 
                className="p-4 bg-muted rounded-lg space-y-3"
                data-testid={`grom-card-${grom.id}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {grom.avatar_url ? (
                      <img 
                        src={grom.avatar_url} 
                        alt={grom.full_name}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                        <UserPlus className="w-5 h-5 text-purple-400" />
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-foreground">{grom.full_name}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {grom.subscription_tier || 'Free'}
                        </Badge>
                        {grom.elite_tier === 'grom_rising' && (
                          <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">
                            <Trophy className="w-3 h-3 mr-1" />
                            Competes
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setExpandedGrom(expandedGrom === grom.id ? null : grom.id)}
                    className="border-border"
                  >
                    {expandedGrom === grom.id ? 'Close' : 'Change Plan'}
                  </Button>
                </div>

                {/* Expanded Tier Selection - Uses GROM_PLANS from config */}
                {expandedGrom === grom.id && (
                  <div className="grid gap-2 mt-3 pt-3 border-t border-border">
                    {GROM_PLANS.monthly.map((plan) => {
                      const gromTierId = subscriptionTierToTierId(grom.subscription_tier);
                      const isCurrentTier = plan.tier_id === gromTierId;
                      const isUpgrading = upgrading === `grom-${grom.id}-${plan.tier_id}`;
                      const TierIcon = plan.icon || CreditCard;
                      
                      return (
                        <button
                          key={plan.tier_id}
                          onClick={() => !isCurrentTier && handleGromTierChange(grom.id, plan.tier_id)}
                          disabled={isCurrentTier || isUpgrading}
                          className={`w-full p-3 rounded-lg border transition-all text-left flex items-center justify-between ${
                            isCurrentTier 
                              ? 'border-cyan-500 bg-cyan-500/10' 
                              : 'border-border hover:border-cyan-500/50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <TierIcon className={`w-4 h-4 ${plan.iconColor}`} />
                            <span className="text-foreground text-sm">{plan.name}</span>
                            {plan.badge && (
                              <Badge className="bg-purple-500/20 text-purple-400 text-xs">{plan.badge}</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {plan.price === 0 ? (
                              <span className="text-green-400 text-sm">Free</span>
                            ) : (
                              <span className="text-foreground text-sm">${plan.price}/mo</span>
                            )}
                            {isCurrentTier && <Check className="w-4 h-4 text-cyan-400" />}
                            {isUpgrading && <Loader2 className="w-4 h-4 animate-spin" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Photographer Status - For photographers */}
      {isPhotographer && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Trophy className="w-5 h-5 text-orange-400" />
              Photographer Status
              {accountData.is_approved_pro && (
                <Badge className="ml-auto bg-purple-500/20 text-purple-400 border-purple-500/30">
                  <Crown className="w-3 h-3 mr-1" />
                  Vetted Pro
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-full ${accountData.role === 'Hobbyist' ? 'bg-blue-500/20' : accountData.is_approved_pro ? 'bg-purple-500/20' : 'bg-orange-500/20'}`}>
                  {accountData.role === 'Hobbyist' ? (
                    <Shield className="w-5 h-5 text-blue-400" />
                  ) : accountData.is_approved_pro ? (
                    <Crown className="w-5 h-5 text-purple-400" />
                  ) : (
                    <Trophy className="w-5 h-5 text-orange-400" />
                  )}
                </div>
                <div>
                  <p className="font-medium text-foreground">{accountData.role}</p>
                  <p className="text-xs text-muted-foreground">
                    {accountData.role === 'Hobbyist' 
                      ? 'Earnings locked to Contribution Only (Groms, Gear, Causes)' 
                      : accountData.is_approved_pro 
                        ? 'Full Pro features with Bank Transfer enabled'
                        : 'Bank Transfer enabled. Apply for Pro vetting to unlock premium features'}
                  </p>
                </div>
              </div>
            </div>

            {/* Apply for Vetted Pro - Only for Working Photographers */}
            {accountData.role === 'Photographer' && !accountData.is_approved_pro && (
              <Button
                onClick={handleApplyForPro}
                disabled={toggling}
                className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white"
                data-testid="apply-pro-photographer-btn"
              >
                {toggling ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Crown className="w-4 h-4 mr-2" />}
                Apply for Vetted Pro Photographer
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AccountBillingHub;
