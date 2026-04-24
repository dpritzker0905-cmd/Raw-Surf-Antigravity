import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import apiClient from '../lib/apiClient';
import { getFullUrl } from '../utils/media';
import {
  ArrowLeft, RefreshCw, Camera, Video, Zap, Calendar,
  Loader2, Check, Percent, Star, MapPin, Shield, CheckCircle,
  CreditCard, Coins, ChevronRight, Sparkles, Bell, Radio
} from 'lucide-react';
import logger from '../utils/logger';
import { ROLE_SETS } from '../constants/roles';

/**
 * PhotographerSubscribePage — Dedicated, polished subscription page
 * Route: /photographer/:photographerId/subscribe
 * 
 * Shows the photographer's available plans with full details,
 * comparison layout, and inline payment. Premium look & feel.
 */
export const PhotographerSubscribePage = () => {
  const { photographerId } = useParams();
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [photographer, setPhotographer] = useState(null);
  const [plans, setPlans] = useState([]);
  const [activeSub, setActiveSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(null);

  // Theme tokens
  const pageBg = isLight ? 'bg-gray-50' : 'bg-black';
  const cardBg = isLight ? 'bg-white' : 'bg-zinc-900';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-zinc-400';
  const borderColor = isLight ? 'border-gray-200' : 'border-zinc-800';

  useEffect(() => {
    if (photographerId) fetchData();
  }, [photographerId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [profRes, plansRes] = await Promise.all([
        apiClient.get(`/profiles/${photographerId}`),
        apiClient.get(`/photo-subscriptions/plans/${photographerId}`),
      ]);
      setPhotographer(profRes.data);
      setPlans((plansRes.data || []).filter(p => p.is_active));

      // Check if user already has an active sub
      if (user?.id) {
        try {
          const subsRes = await apiClient.get(`/photo-subscriptions/my-subscriptions/${user.id}`);
          const existing = (subsRes.data || []).find(
            s => s.photographer_id === photographerId && s.status === 'active'
          );
          setActiveSub(existing || null);
        } catch { /* ignore */ }
      }
    } catch (err) {
      logger.error('Failed to load subscription page:', err);
      toast.error('Failed to load plans');
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async (plan, method) => {
    if (!user?.id) {
      toast.error('Please log in to subscribe');
      navigate('/auth?tab=signup');
      return;
    }
    setSubscribing(plan.id + '-' + method);
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
        setActiveSub(res.data.subscription);
        fetchData();
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to subscribe');
    } finally {
      setSubscribing(null);
    }
  };

  if (loading) {
    return (
      <div className={`min-h-screen ${pageBg} flex items-center justify-center`}>
        <Loader2 className="w-10 h-10 text-violet-400 animate-spin" />
      </div>
    );
  }

  if (!photographer) {
    return (
      <div className={`min-h-screen ${pageBg} flex items-center justify-center`}>
        <div className="text-center">
          <Camera className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
          <p className={textSecondary}>Photographer not found</p>
          <Button onClick={() => navigate(-1)} variant="outline" className="mt-4">Go Back</Button>
        </div>
      </div>
    );
  }

  const isSelf = user?.id === photographerId;
  const isProPhotographer = photographer.role && ROLE_SETS.PHOTOGRAPHERS.includes(photographer.role);

  // If photographer is not a pro role, show a helpful message
  if (!isProPhotographer) {
    return (
      <div className={`min-h-screen ${pageBg} flex items-center justify-center`}>
        <div className="text-center max-w-md px-6">
          <Camera className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
          <p className={`font-semibold ${textPrimary} mb-1`}>Subscriptions Not Available</p>
          <p className={`text-sm ${textSecondary}`}>
            {photographer.full_name} is not currently offering subscription plans.
            Only professional photographers on paid plans can create subscriptions.
          </p>
          <Button onClick={() => navigate(`/profile/${photographerId}`)} variant="outline" className={`mt-4 ${borderColor} ${textPrimary}`}>View Profile</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${pageBg} pb-24 md:pb-8`}>
      {/* ── Hero gradient ── */}
      <div className="relative">
        <div className="h-36 bg-gradient-to-br from-violet-900/80 via-fuchsia-900/50 to-purple-900/60 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-violet-500/15 via-transparent to-fuchsia-500/10" />
          {/* Decorative dots */}
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.3) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
        </div>

        {/* Back button */}
        <Button
          variant="ghost"
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 text-white/70 hover:text-white hover:bg-white/10 backdrop-blur-sm"
        >
          <ArrowLeft className="w-5 h-5 mr-1" /> Back
        </Button>
      </div>

      {/* ── Photographer card ── */}
      <div className="max-w-2xl mx-auto px-4 -mt-14 relative z-10">
        <div className={`${cardBg} rounded-2xl border ${borderColor} p-5 shadow-xl`}>
          <div className="flex items-center gap-4">
            <Avatar className="w-16 h-16 border-3 border-violet-500/30 shadow-lg">
              <AvatarImage src={getFullUrl(photographer.avatar_url)} />
              <AvatarFallback className="bg-violet-500/20 text-violet-300 text-xl">
                {photographer.full_name?.[0] || '?'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h1 className={`text-lg font-bold ${textPrimary} truncate`}>{photographer.full_name}</h1>
                {photographer.is_approved_pro && (
                  <CheckCircle className="w-4 h-4 text-violet-400 fill-violet-400/20 shrink-0" />
                )}
              </div>
              {photographer.location && (
                <p className={`text-xs ${textSecondary} flex items-center gap-1`}>
                  <MapPin className="w-3 h-3" /> {photographer.location}
                </p>
              )}
              <p className={`text-xs ${textSecondary} mt-1`}>
                @{photographer.username || photographerId.slice(0, 8)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Active subscription banner ── */}
      {activeSub && (
        <div className="max-w-2xl mx-auto px-4 mt-4">
          <Card className="border-emerald-500/40 bg-emerald-500/5 border-2">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <Check className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="flex-1">
                <p className={`font-semibold text-sm ${textPrimary}`}>
                  You're subscribed to {activeSub.plan_name}
                </p>
                <p className={`text-xs ${textSecondary}`}>
                  Expires {new Date(activeSub.expires_at).toLocaleDateString()} •
                  {activeSub.photos_remaining} photos, {activeSub.videos_remaining} videos left
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                onClick={() => navigate('/bookings?tab=subscriptions')}
              >
                Manage
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Plans header ── */}
      <div className="max-w-2xl mx-auto px-4 mt-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-full px-4 py-1.5 mb-3">
            <Sparkles className="w-4 h-4 text-violet-400" />
            <span className="text-xs font-medium text-violet-300">Subscription Plans</span>
          </div>
          <h2 className={`text-xl font-bold ${textPrimary}`}>
            Subscribe to {photographer.full_name}
          </h2>
          <p className={`text-sm ${textSecondary} mt-1 max-w-md mx-auto`}>
            Get recurring content, priority booking, and exclusive discounts with a subscription plan.
          </p>
        </div>

        {/* ── Subscriber benefits ── */}
        <div className={`mb-6 p-4 rounded-2xl border ${isLight ? 'bg-violet-50/50 border-violet-200' : 'bg-violet-500/5 border-violet-500/15'}`}>
          <p className={`text-xs font-semibold ${textPrimary} mb-3`}>What you get as a subscriber:</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {[
              { icon: Bell, color: 'text-violet-400', bg: 'bg-violet-500/15', label: 'Instant Notifications', desc: 'Get notified when they go live or are available on-demand' },
              { icon: Camera, color: 'text-cyan-400', bg: 'bg-cyan-500/15', label: 'Recurring Content', desc: 'Photos & videos delivered to your locker automatically' },
              { icon: Percent, color: 'text-emerald-400', bg: 'bg-emerald-500/15', label: 'Exclusive Discounts', desc: 'Save on bookings and on-demand sessions' },
            ].map(({ icon: Icon, color, bg, label, desc }) => (
              <div key={label} className="flex items-start gap-2.5">
                <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center shrink-0 mt-0.5`}>
                  <Icon className={`w-3.5 h-3.5 ${color}`} />
                </div>
                <div>
                  <p className={`text-xs font-semibold ${textPrimary}`}>{label}</p>
                  <p className={`text-[10px] ${textSecondary} leading-snug`}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Plans list ── */}
        {plans.length === 0 ? (
          <Card className={`${cardBg} ${borderColor}`}>
            <CardContent className="p-12 text-center">
              <RefreshCw className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
              <p className={`${textSecondary} mb-1`}>No plans available yet</p>
              <p className={`text-xs ${textSecondary}`}>
                {photographer.full_name} hasn't created any subscription plans yet.
              </p>
              <Button
                onClick={() => navigate(`/profile/${photographerId}`)}
                variant="outline"
                className={`mt-4 ${borderColor} ${textPrimary}`}
              >
                View Profile
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {plans.map((plan, idx) => {
              const isPopular = idx === 0 && plans.length > 1;
              return (
                <Card
                  key={plan.id}
                  className={`${cardBg} overflow-hidden transition-all duration-200 ${
                    isPopular
                      ? 'border-2 border-violet-500/50 ring-1 ring-violet-500/20 shadow-lg shadow-violet-500/5'
                      : `${borderColor} hover:border-violet-500/30`
                  }`}
                >
                  {/* Popular badge */}
                  {isPopular && (
                    <div className="bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-center text-xs font-bold py-1.5 tracking-wide">
                      ⭐ MOST POPULAR
                    </div>
                  )}

                  <CardContent className="p-5">
                    {/* Plan name + price */}
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className={`text-lg font-bold ${textPrimary}`}>{plan.name}</h3>
                        {plan.description && (
                          <p className={`text-xs ${textSecondary} mt-0.5`}>{plan.description}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-black text-violet-400">${plan.price}</p>
                        <p className={`text-[10px] ${textSecondary} font-medium`}>
                          per {plan.interval === 'weekly' ? 'week' : 'month'}
                        </p>
                      </div>
                    </div>

                    {/* Quota breakdown */}
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      {plan.photos_included > 0 && (
                        <div className={`flex items-center gap-2 p-2.5 rounded-xl ${isLight ? 'bg-cyan-50' : 'bg-cyan-500/5'} border ${isLight ? 'border-cyan-100' : 'border-cyan-500/10'}`}>
                          <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center">
                            <Camera className="w-4 h-4 text-cyan-400" />
                          </div>
                          <div>
                            <p className={`text-sm font-bold ${textPrimary}`}>{plan.photos_included}</p>
                            <p className={`text-[10px] ${textSecondary}`}>Photos</p>
                          </div>
                        </div>
                      )}
                      {plan.videos_included > 0 && (
                        <div className={`flex items-center gap-2 p-2.5 rounded-xl ${isLight ? 'bg-purple-50' : 'bg-purple-500/5'} border ${isLight ? 'border-purple-100' : 'border-purple-500/10'}`}>
                          <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                            <Video className="w-4 h-4 text-purple-400" />
                          </div>
                          <div>
                            <p className={`text-sm font-bold ${textPrimary}`}>{plan.videos_included}</p>
                            <p className={`text-[10px] ${textSecondary}`}>Videos</p>
                          </div>
                        </div>
                      )}
                      {plan.live_session_buyins > 0 && (
                        <div className={`flex items-center gap-2 p-2.5 rounded-xl ${isLight ? 'bg-red-50' : 'bg-red-500/5'} border ${isLight ? 'border-red-100' : 'border-red-500/10'}`}>
                          <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
                            <Zap className="w-4 h-4 text-red-400" />
                          </div>
                          <div>
                            <p className={`text-sm font-bold ${textPrimary}`}>{plan.live_session_buyins}</p>
                            <p className={`text-[10px] ${textSecondary}`}>Jump-ins</p>
                          </div>
                        </div>
                      )}
                      {plan.sessions_included > 0 && (
                        <div className={`flex items-center gap-2 p-2.5 rounded-xl ${isLight ? 'bg-blue-50' : 'bg-blue-500/5'} border ${isLight ? 'border-blue-100' : 'border-blue-500/10'}`}>
                          <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                            <Calendar className="w-4 h-4 text-blue-400" />
                          </div>
                          <div>
                            <p className={`text-sm font-bold ${textPrimary}`}>{plan.sessions_included}</p>
                            <p className={`text-[10px] ${textSecondary}`}>Sessions</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Discount perks */}
                    {(plan.booking_discount_pct > 0 || plan.on_demand_discount_pct > 0) && (
                      <div className={`mb-4 p-3 rounded-xl ${isLight ? 'bg-emerald-50 border-emerald-100' : 'bg-emerald-500/5 border-emerald-500/10'} border`}>
                        <p className="text-xs font-semibold text-emerald-400 mb-1.5 flex items-center gap-1">
                          <Percent className="w-3 h-3" /> Subscriber Discounts
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {plan.booking_discount_pct > 0 && (
                            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[11px]">
                              {plan.booking_discount_pct}% off bookings
                            </Badge>
                          )}
                          {plan.on_demand_discount_pct > 0 && (
                            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[11px]">
                              {plan.on_demand_discount_pct}% off on-demand
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Subscribe buttons */}
                    {isSelf ? (
                      <p className={`text-xs text-center ${textSecondary} py-2`}>
                        This is your plan. Manage in Subscription Settings.
                      </p>
                    ) : activeSub ? (
                      <p className={`text-xs text-center text-emerald-400 py-2 font-medium`}>
                        ✓ You already have an active subscription
                      </p>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleSubscribe(plan, 'credits')}
                          disabled={!!subscribing}
                          className="flex-1 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-bold hover:from-violet-600 hover:to-fuchsia-600 h-11"
                        >
                          {subscribing === plan.id + '-credits' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <Coins className="w-4 h-4 mr-2" />
                              Pay ${plan.price} Credits
                            </>
                          )}
                        </Button>
                        <Button
                          onClick={() => handleSubscribe(plan, 'card')}
                          disabled={!!subscribing}
                          variant="outline"
                          className={`flex-1 ${borderColor} ${textPrimary} font-semibold h-11 hover:bg-violet-500/5`}
                        >
                          {subscribing === plan.id + '-card' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <CreditCard className="w-4 h-4 mr-2" />
                              Pay with Card
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Trust badges */}
        <div className="mt-8 flex items-center justify-center gap-6">
          {[
            { icon: Shield, label: 'Secure Payment' },
            { icon: RefreshCw, label: 'Auto-renew' },
            { icon: Check, label: 'Cancel Anytime' },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <Icon className={`w-3.5 h-3.5 ${textSecondary}`} />
              <span className={`text-[11px] ${textSecondary}`}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PhotographerSubscribePage;
