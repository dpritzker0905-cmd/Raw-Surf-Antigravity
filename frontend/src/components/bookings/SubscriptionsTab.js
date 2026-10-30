import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  RefreshCw, Camera, Video, Zap, Calendar, Loader2, Percent
} from 'lucide-react';
import { Button } from '../ui/button';
import { useAuth } from '../../contexts/AuthContext';
import apiClient from '../../lib/apiClient';
import { toast } from 'sonner';
import { getFullUrl } from '../../utils/media';
import logger from '../../utils/logger';
import { useSearchParams } from 'react-router-dom';

// Share only the pending request, so StrictMode's effect replay cannot submit
// the same checkout twice. A settled failure can still be retried explicitly.
const completionRequests = new Map();
const completeCardPayment = (userId, checkoutId) => {
  const key = JSON.stringify([userId, checkoutId]);
  if (!completionRequests.has(key)) {
    const request = Promise.resolve().then(() => apiClient.post(
      `/photo-subscriptions/complete-card-payment?checkout_session_id=${encodeURIComponent(checkoutId)}`
    ));
    completionRequests.set(key, request);
    request.finally(() => {
      if (completionRequests.get(key) === request) completionRequests.delete(key);
    }).catch(() => {});
  }
  return completionRequests.get(key);
};

export const SubscriptionsTab = () => {
  const { user, updateUser, loading: authLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(null);
  const [accessClock, setAccessClock] = useState(Date.now());
  const [returnNotice, setReturnNotice] = useState(null);
  const [returnAttempt, setReturnAttempt] = useState(0);
  const requestGeneration = useRef(0);
  const mounted = useRef(false);
  const subPayment = searchParams.get('sub_payment');
  const checkoutId = searchParams.get('checkout_session_id');
  const userId = user?.id;
  const identity = useRef(null);
  const previousUserId = useRef(userId);
  identity.current = { userId, subPayment, checkoutId, authLoading };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestGeneration.current += 1; };
  }, []);

  useEffect(() => {
    if (previousUserId.current !== userId) {
      previousUserId.current = userId;
      setReturnNotice(null);
    }
  }, [userId]);

  useEffect(() => {
    const now = Date.now();
    const upcoming = subscriptions.filter(sub => sub.access_active === true)
      .map(sub => new Date(sub.expires_at).getTime()).filter(expiry => expiry > now);
    if (!upcoming.length) return;
    const delay = Math.min(Math.min(...upcoming) - now + 1, 2147483647);
    const timer = window.setTimeout(() => setAccessClock(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [subscriptions, accessClock]);


  const fetchSubscriptions = useCallback(async (expectedReturn = null) => {
    if (!userId) return false;
    const generation = ++requestGeneration.current;
    const isCurrentUserRequest = () => mounted.current && !identity.current.authLoading && identity.current.userId === userId && generation === requestGeneration.current;
    const isCurrent = () => isCurrentUserRequest() && (!expectedReturn ||
      (identity.current.subPayment === expectedReturn.subPayment && identity.current.checkoutId === expectedReturn.checkoutId));
    setLoading(true);
    try {
      const res = await apiClient.get(`/photo-subscriptions/my-subscriptions/${encodeURIComponent(userId)}`);
      if (!isCurrent()) return false;
      setSubscriptions(res.data || []);
      return true;
    } catch (err) {
      if (isCurrent()) logger.error('Failed to fetch subscriptions:', err);
      return false;
    } finally { if (isCurrentUserRequest()) setLoading(false); }
  }, [userId]);

  useEffect(() => {
    setSubscriptions([]);
    if (userId && !authLoading) fetchSubscriptions();
    else setLoading(true);
  }, [userId, authLoading, fetchSubscriptions]);

  // A checkout return is confirmed only by the server's linked-subscription
  // result. Pending/error states remain on the URL for an explicit retry.
  useEffect(() => {
    let cancelled = false;
    const clearReturnParams = () => {
      if (typeof setSearchParams !== 'function') return;
      setSearchParams(previous => {
        const next = new URLSearchParams(previous);
        next.delete('sub_payment');
        next.delete('checkout_session_id');
        return next;
      }, { replace: true });
    };
    if (subPayment === 'cancelled') {
      setReturnNotice({ kind: 'cancelled', text: 'Checkout was cancelled.' });
      clearReturnParams();
      return () => { cancelled = true; };
    }
    if (subPayment !== 'success') return () => { cancelled = true; };
    if (!checkoutId) {
      setReturnNotice({ kind: 'error', text: 'The payment return is missing its checkout ID. Please contact support.' });
      return () => { cancelled = true; };
    }
    if (authLoading || !userId) {
      setReturnNotice({ kind: 'waiting', text: 'Waiting for your account before checking the payment.' });
      return () => { cancelled = true; };
    }
    const isCurrent = () => !cancelled && mounted.current && !identity.current.authLoading && identity.current.userId === userId &&
      identity.current.subPayment === 'success' && identity.current.checkoutId === checkoutId;
    setReturnNotice({ kind: 'working', text: 'Confirming your photo subscription…' });
    (async () => {
      try {
        const response = await completeCardPayment(userId, checkoutId);
        if (!isCurrent()) return;
        const result = response?.data;
        if (result?.success === false && result?.activation_status === 'not_activated' && result?.code === 'payment_refunded') {
          setReturnNotice({ kind: 'refunded', text: 'A refund was recorded for this payment, so this subscription cannot be activated.' });
          clearReturnParams();
          return;
        }
        if (result?.success === false && result?.activation_status === 'review_required' && result?.paid === true) {
          setReturnNotice({ kind: 'review', text: 'Your payment was received, but the subscription needs review. Please contact support.' });
          return;
        }
        if (result?.success !== true || !result?.subscription || !result.subscription.id) {
          setReturnNotice({ kind: 'retry', text: 'Your subscription could not yet be confirmed. Please try again.' });
          return;
        }
        // A completed checkout may be replayed long after its subscription has
        // expired or been cancelled. The linked record proves processing, not
        // that the entitlement is still active.
        const confirmedText = result.already_completed === true
          ? 'Your payment was already processed. Check your subscription list for current access.'
          : result.subscription.access_active === true
            ? 'Your photo subscription is active.'
            : 'Your payment was processed. Check your subscription list for current access.';
        const refreshed = await fetchSubscriptions({ subPayment, checkoutId });
        if (!isCurrent()) return;
        if (refreshed) {
          setReturnNotice({ kind: 'confirmed', text: confirmedText });
          toast.success(result.already_completed === true ? 'Payment was already processed.' :
            result.subscription.access_active === true ? 'Subscription activated!' : 'Payment processed.');
        } else {
          setReturnNotice({ kind: 'refresh', confirmedText, text: `${confirmedText} The subscription list could not be refreshed.` });
        }
        clearReturnParams();
      } catch (err) {
        if (isCurrent()) setReturnNotice({ kind: 'retry', text: 'We could not confirm your subscription. Please try again.' });
      }
    })();
    return () => { cancelled = true; };
  }, [subPayment, checkoutId, userId, authLoading, returnAttempt, fetchSubscriptions, setSearchParams]);

  const retryListRefresh = async () => {
    const expected = { ...identity.current };
    const confirmedText = returnNotice?.confirmedText || 'Your payment was processed. Check your subscription list for current access.';
    const refreshed = await fetchSubscriptions(expected);
    if (mounted.current && !identity.current.authLoading && identity.current.userId === expected.userId &&
        identity.current.subPayment === expected.subPayment && identity.current.checkoutId === expected.checkoutId) {
      setReturnNotice(refreshed
        ? { kind: 'confirmed', text: confirmedText }
        : { kind: 'refresh', confirmedText, text: `${confirmedText} The subscription list could not be refreshed.` });
    }
  };

  const notice = returnNotice && (
    <div role={['retry', 'review', 'refunded', 'error', 'refresh'].includes(returnNotice.kind) ? 'alert' : 'status'} className="rounded-lg border border-violet-500/30 p-3 text-sm text-foreground">
      <p>{returnNotice.text}</p>
      {returnNotice.kind === 'retry' && <Button onClick={() => setReturnAttempt(attempt => attempt + 1)} size="sm">Retry confirmation</Button>}
      {returnNotice.kind === 'refresh' && <Button onClick={retryListRefresh} size="sm">Retry list refresh</Button>}
    </div>
  );

  const handleCancel = async (subId) => {
    setCancelling(subId);
    try {
      await apiClient.post(`/photo-subscriptions/cancel/${subId}?surfer_id=${user.id}`);
      toast.success('Subscription cancelled. Access continues until expiry.');
      fetchSubscriptions();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to cancel');
    } finally { setCancelling(null); }
  };

  const handleRenew = async (sub) => {
    // Navigate to photographer's plans to re-subscribe
    // For now, call subscribe endpoint directly with credits if available
    if (!sub.plan_id) { toast.error('Plan no longer available'); return; }
    
    try {
      const res = await apiClient.post(
        `/photo-subscriptions/subscribe?surfer_id=${user.id}`,
        { plan_id: sub.plan_id, payment_method: 'credits', origin_url: window.location.origin }
      );
      if (res.data?.success) {
        if (res.data.remaining_credits !== undefined) {
          updateUser({ credit_balance: res.data.remaining_credits });
        }
        toast.success('Subscription renewed!');
        fetchSubscriptions();
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to renew');
    }
  };

  if (loading) {
    return (
      <div>
        {notice}
        <div className="flex items-center justify-center h-48"><Loader2 className="w-6 h-6 animate-spin text-violet-400" /></div>
      </div>
    );
  }

  const hasAccess = sub => sub.access_active === true && new Date(sub.expires_at).getTime() > Math.max(accessClock, Date.now());
  const activeSubs = subscriptions.filter(hasAccess);
  const expiredSubs = subscriptions.filter(sub => !hasAccess(sub)).slice(0, 5);

  const QuotaBar = ({ icon: Icon, label, remaining, total, color }) => {
    const pct = total > 0 ? Math.max(0, (remaining / total) * 100) : 0;
    return (
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-center mb-0.5">
            <span className="text-[10px] text-muted-foreground">{label}</span>
            <span className="text-[10px] font-semibold" style={{ color }}>{remaining}/{total}</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {notice}
      {/* Active Subscriptions */}
      {activeSubs.length > 0 ? (
        <div className="space-y-3">
          {activeSubs.map(sub => {
            const expiresAt = new Date(sub.expires_at);
            const now = new Date();
            const daysLeft = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));
            const isExpiringSoon = daysLeft <= 2;

            return (
              <div key={sub.id} className="rounded-xl overflow-hidden" style={{ background: 'rgba(39,39,42,0.6)', border: '1px solid rgba(139,92,246,0.3)' }}>
                {/* Photographer Header */}
                <div className="p-4 flex items-center gap-3" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.1), rgba(6,182,212,0.05))' }}>
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-violet-400 to-cyan-500 p-0.5">
                    <div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center overflow-hidden">
                      {sub.photographer_avatar ? (
                        <img loading="lazy" decoding="async" src={getFullUrl(sub.photographer_avatar)} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <span className="text-violet-400 font-bold">{sub.photographer_name?.[0]}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground truncate">{sub.photographer_name}</p>
                    <p className="text-xs text-muted-foreground">{sub.plan_name} - ${sub.plan_price}/{sub.plan_interval === 'weekly' ? 'wk' : 'mo'}</p>
                    {sub.status === 'cancelled' && (
                      <p className="text-xs text-muted-foreground">Cancelled; access until {expiresAt.toLocaleDateString()}</p>
                    )}
                  </div>
                  <div className={`px-2 py-1 rounded-full text-[10px] font-bold ${isExpiringSoon ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                    {daysLeft}d left
                  </div>
                </div>

                {/* Quota Bars */}
                <div className="p-4 space-y-2.5">
                  {sub.photos_remaining > 0 ? (
                    <QuotaBar icon={Camera} label="Photos" remaining={sub.photos_remaining} total={sub.plan_price ? Math.max(sub.photos_remaining, 1) : 0} color="#06b6d4" />
                  ) : null}
                  {sub.videos_remaining > 0 && (
                    <QuotaBar icon={Video} label="Videos" remaining={sub.videos_remaining} total={Math.max(sub.videos_remaining, 1)} color="#a855f7" />
                  )}
                  {sub.live_session_buyins_remaining > 0 && (
                    <QuotaBar icon={Zap} label="Live Jump-Ins" remaining={sub.live_session_buyins_remaining} total={Math.max(sub.live_session_buyins_remaining, 1)} color="#ef4444" />
                  )}
                  {sub.sessions_remaining > 0 && (
                    <QuotaBar icon={Calendar} label="Sessions" remaining={sub.sessions_remaining} total={Math.max(sub.sessions_remaining, 1)} color="#3b82f6" />
                  )}

                  {/* Discounts */}
                  {(sub.booking_discount_pct > 0 || sub.on_demand_discount_pct > 0) && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {sub.booking_discount_pct > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          <Percent className="w-2.5 h-2.5" /> {sub.booking_discount_pct}% off bookings
                        </span>
                      )}
                      {sub.on_demand_discount_pct > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <Percent className="w-2.5 h-2.5" /> {sub.on_demand_discount_pct}% off on-demand
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="px-4 pb-4 flex gap-2">
                  {sub.status === 'active' && (
                    <button aria-label="Cancel subscription" onClick={() => handleCancel(sub.id)} disabled={cancelling === sub.id} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
                      {cancelling === sub.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Cancel'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 px-4">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-violet-500/10 flex items-center justify-center">
            <RefreshCw className="w-8 h-8 text-violet-400" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">No Active Subscriptions</h3>
          <p className="text-muted-foreground text-sm mb-4 max-w-xs mx-auto">
            Subscribe to your favorite photographers for weekly or monthly bundles of photos, videos, and sessions at discounted rates.
          </p>
          <p className="text-xs text-muted-foreground">
            Visit a photographer's profile to see their available plans
          </p>
        </div>
      )}

      {/* Expired Subscriptions */}
      {expiredSubs.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Past Subscriptions</h3>
          <div className="space-y-2">
            {expiredSubs.map(sub => (
              <div key={sub.id} className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/30 border border-zinc-800 opacity-60">
                <div className="w-9 h-9 rounded-full bg-zinc-700 flex items-center justify-center">
                  {sub.photographer_avatar ? (
                    <img loading="lazy" decoding="async" src={getFullUrl(sub.photographer_avatar)} className="w-full h-full rounded-full object-cover" alt="" />
                  ) : (
                    <span className="text-xs text-muted-foreground font-bold">{sub.photographer_name?.[0]}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{sub.photographer_name}</p>
                  <p className="text-[10px] text-muted-foreground">{sub.plan_name} - {sub.status}</p>
                </div>
                <Button onClick={() => handleRenew(sub)} size="sm" variant="outline" className="text-xs border-zinc-700 text-muted-foreground hover:text-violet-400">
                  Resubscribe
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SubscriptionsTab;
