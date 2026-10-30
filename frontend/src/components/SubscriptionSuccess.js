import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { CheckCircle, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';


export const SubscriptionSuccess = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading, updateUser } = useAuth();
  const userId = user?.id;
  const sessionId = searchParams.get('session_id');
  const [status, setStatus] = useState('checking');
  const [tier, setTier] = useState(null);
  const [purchasedTier, setPurchasedTier] = useState(null);
  const [gromReturn, setGromReturn] = useState(false);
  const identity = useRef(null);
  const updateAccount = useRef(updateUser);
  const retryRefresh = useRef(null);
  identity.current = { userId, sessionId, authLoading };
  updateAccount.current = updateUser;

  useEffect(() => {
    let cancelled = false;
    let timer;
    let attempts = 0;
    let refreshing = false;
    let confirmedGrom = null;
    const isCurrent = () => !cancelled && identity.current.userId === userId &&
      identity.current.sessionId === sessionId && !identity.current.authLoading;
    const knownTier = value => ['free', 'basic', 'premium'].includes(value);
    setTier(null);
    setPurchasedTier(null);
    setGromReturn(false);
    setStatus('checking');
    retryRefresh.current = null;
    if (!userId || authLoading) return () => { cancelled = true; };
    if (!sessionId) { setStatus('error'); return () => { cancelled = true; }; }

    const refreshAccount = async () => {
      if (!isCurrent() || refreshing) return;
      refreshing = true;
      setStatus('checking');
      try {
        const response = await apiClient.get(`/profiles/${encodeURIComponent(userId)}`);
        if (!isCurrent()) return;
        const profile = response.data;
        if (profile?.id !== userId || (!confirmedGrom && !knownTier(profile.subscription_tier))) {
          throw new Error('Current account plan could not be confirmed');
        }
        // A receipt describes a checkout, not the account's current entitlement.
        updateAccount.current(profile);
        setTier(confirmedGrom ? confirmedGrom.currentTier : profile.subscription_tier);
        setStatus('success');
        toast.success(confirmedGrom ? 'Grom subscription confirmed.' : 'Current subscription confirmed.');
      } catch (error) {
        if (isCurrent()) {
          logger.error('Account refresh failed:', error);
          setStatus('refresh');
        }
      } finally { refreshing = false; }
    };
    retryRefresh.current = refreshAccount;
    const schedule = poll => {
      if (!isCurrent()) return;
      if (attempts >= 10) {
        setStatus('error');
        return;
      }
      timer = setTimeout(poll, 2000);
    };
    const poll = async () => {
      attempts += 1;
      try {
        const response = await apiClient.get(`/subscriptions/status/${encodeURIComponent(sessionId)}`);
        if (!isCurrent()) return;
        if (response.data.status === 'completed') {
          if (response.data.subscription_type === 'grom_subscription') {
            if (typeof response.data.grom_id !== 'string' || !response.data.grom_id ||
                !knownTier(response.data.current_tier)) {
              throw new Error('Current Grom plan could not be confirmed');
            }
            confirmedGrom = { currentTier: response.data.current_tier };
            setGromReturn(true);
          }
          setPurchasedTier(knownTier(response.data.tier) ? response.data.tier : null);
          await refreshAccount();
        } else if (['expired', 'refunded', 'partially_refunded'].includes(response.data.status)) {
          setStatus('error');
        } else {
          // Provider-paid alone does not prove that local activation completed.
          schedule(poll);
        }
      } catch (error) {
        if (isCurrent()) {
          logger.error('Error checking status:', error);
          schedule(poll);
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      retryRefresh.current = null;
    };
  }, [sessionId, userId, authLoading]);

  const getTierDisplay = () => {
    if (!tier) return 'your subscription';
    const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
    return `${tierName} subscription`;
  };

  if (status === 'checking') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <Loader2 className="w-16 h-16 text-yellow-400 animate-spin mb-6" />
        <h1 className="text-2xl font-bold text-foreground mb-2 font-oswald" >
          Verifying Payment
        </h1>
        <p className="text-muted-foreground text-center">
          Please wait while we confirm your subscription...
        </p>
      </div>
    );
  }

  if (status === 'refresh') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <h1 className="text-2xl font-bold text-foreground mb-2">Payment verification completed</h1>
        <p role="alert" className="text-muted-foreground text-center mb-6 max-w-md">
          We could not refresh your current account plan. Retry the account refresh before checking your benefits.
        </p>
        <Button onClick={() => retryRefresh.current?.()}>Retry account refresh</Button>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mb-6">
          <XCircle className="w-10 h-10 text-red-400" />
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-2 font-oswald" >
          Something Went Wrong
        </h1>
        <p className="text-muted-foreground text-center mb-8 max-w-md">
          We couldn't confirm your subscription status. Check Account & Billing or contact support before starting another checkout.
        </p>
        <div className="flex gap-4">
          <Button
            onClick={() => navigate(-1)}
            variant="outline"
            className="border-border text-foreground hover:bg-muted"
          >
            Go Back
          </Button>
          <Button
            onClick={() => navigate('/feed')}
            className="bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold"
          >
            Continue to Feed
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        {/* Success Animation */}
        <div className="w-24 h-24 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-6 animate-pulse">
          <CheckCircle className="w-12 h-12 text-emerald-400" />
        </div>

        {/* Title */}
        <h1 className="text-4xl font-bold text-foreground mb-3 font-oswald" >
          {gromReturn ? 'Grom Subscription Status Confirmed' : 'Subscription Status Confirmed'}
        </h1>
        
        <p className="text-muted-foreground text-lg mb-8">
          {gromReturn ? "The linked Grom's current plan is " : 'Your current account plan is '}{getTierDisplay()}.
        </p>

        {purchasedTier && purchasedTier !== tier && (
          <p className="text-muted-foreground mb-6">
            This checkout was for {purchasedTier.charAt(0).toUpperCase() + purchasedTier.slice(1)}.
            {' '}{gromReturn ? "The linked Grom's current plan is shown above." : 'Your current account plan is shown above.'}
          </p>
        )}

        {/* Tier Badge */}
        {tier && (
          <div className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-400/20 via-yellow-400/20 to-orange-400/20 border border-yellow-400/30 rounded-full mb-8">
            <span className="text-foreground font-bold text-lg capitalize">{tier}</span>
            <span className="text-muted-foreground">{gromReturn ? 'Current Grom Plan' : 'Current Plan'}</span>
          </div>
        )}

        <div className="bg-card rounded-xl p-6 mb-8 border border-border text-left">
          <p className="text-muted-foreground">
            {gromReturn ? "View Account & Billing for your linked Grom's current plan details." :
              'View Account & Billing for your current plan details and available benefits.'}
          </p>
        </div>

        {/* CTA */}
        <Button
          onClick={() => navigate('/feed')}
          className="w-full h-14 text-lg bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 hover:from-emerald-500 hover:via-yellow-500 hover:to-orange-500 text-black font-bold"
          data-testid="continue-to-feed"
        >
          Start Exploring
        </Button>
      </div>
    </div>
  );
};
