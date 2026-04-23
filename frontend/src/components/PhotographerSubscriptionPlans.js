import React, { useState, useEffect } from 'react';
import { RefreshCw, Camera, Video, Zap, Calendar, Loader2, Check, Percent, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from './ui/button';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';

/**
 * Embeddable component showing a photographer's subscription plans.
 * Surfers can subscribe directly from a photographer's profile.
 */
export const PhotographerSubscriptionPlans = ({ photographerId, photographerName }) => {
  const { user, updateUser } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (photographerId) fetchPlans();
  }, [photographerId]);

  const fetchPlans = async () => {
    try {
      const res = await apiClient.get(`/photo-subscriptions/plans/${photographerId}`);
      setPlans((res.data || []).filter(p => p.is_active));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleSubscribe = async (plan, method) => {
    if (!user?.id) { toast.error('Please log in to subscribe'); return; }
    setSubscribing(plan.id);
    try {
      const res = await apiClient.post(
        `/photo-subscriptions/subscribe?surfer_id=${user.id}`,
        { plan_id: plan.id, payment_method: method, origin_url: window.location.origin }
      );
      if (method === 'card' && res.data?.checkout_url) {
        window.location.href = res.data.checkout_url;
        return;
      }
      if (res.data?.success) {
        if (res.data.remaining_credits !== undefined) {
          updateUser({ credit_balance: res.data.remaining_credits });
        }
        toast.success(`Subscribed to ${plan.name}!`);
        fetchPlans();
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to subscribe');
    } finally { setSubscribing(null); }
  };

  if (loading) return null;
  if (plans.length === 0) return null;

  return (
    <div className="mb-4">
      {/* Collapsed toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 rounded-xl bg-violet-500/10 border border-violet-500/30 hover:border-violet-400/50 transition-all"
      >
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-violet-300">
            Subscription Plans
          </span>
          <span className="text-xs text-violet-400/70 bg-violet-500/20 px-1.5 py-0.5 rounded-full">
            {plans.length}
          </span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-violet-400" /> : <ChevronDown className="w-4 h-4 text-violet-400" />}
      </button>

      {/* Expanded plans list */}
      {expanded && (
        <div className="mt-2 space-y-2">
          {plans.map(plan => (
            <div key={plan.id} className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 overflow-hidden">
              {/* Plan header */}
              <div className="p-3 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{plan.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{plan.description || `${plan.interval} plan`}</p>
                </div>
                <div className="text-right ml-3">
                  <p className="text-lg font-bold text-violet-400">${plan.price}</p>
                  <p className="text-[10px] text-muted-foreground">/{plan.interval === 'weekly' ? 'wk' : 'mo'}</p>
                </div>
              </div>

              {/* Quota badges */}
              <div className="px-3 pb-2 flex flex-wrap gap-1.5">
                {plan.photos_included > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                    <Camera className="w-2.5 h-2.5" /> {plan.photos_included} photos
                  </span>
                )}
                {plan.videos_included > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    <Video className="w-2.5 h-2.5" /> {plan.videos_included} videos
                  </span>
                )}
                {plan.live_session_buyins > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-red-500/10 text-red-400 border border-red-500/20">
                    <Zap className="w-2.5 h-2.5" /> {plan.live_session_buyins} jump-ins
                  </span>
                )}
                {plan.sessions_included > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    <Calendar className="w-2.5 h-2.5" /> {plan.sessions_included} sessions
                  </span>
                )}
                {plan.booking_discount_pct > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <Percent className="w-2.5 h-2.5" /> {plan.booking_discount_pct}% off bookings
                  </span>
                )}
                {plan.on_demand_discount_pct > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <Percent className="w-2.5 h-2.5" /> {plan.on_demand_discount_pct}% off on-demand
                  </span>
                )}
              </div>

              {/* Subscribe buttons */}
              <div className="px-3 pb-3 flex gap-2">
                <Button
                  onClick={() => handleSubscribe(plan, 'credits')}
                  disabled={subscribing === plan.id}
                  size="sm"
                  className="flex-1 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-xs font-bold hover:from-violet-600 hover:to-fuchsia-600"
                >
                  {subscribing === plan.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>Pay with Credits</>
                  )}
                </Button>
                <Button
                  onClick={() => handleSubscribe(plan, 'card')}
                  disabled={subscribing === plan.id}
                  size="sm"
                  variant="outline"
                  className="flex-1 border-zinc-600 text-foreground text-xs hover:bg-zinc-800"
                >
                  Pay with Card
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PhotographerSubscriptionPlans;
