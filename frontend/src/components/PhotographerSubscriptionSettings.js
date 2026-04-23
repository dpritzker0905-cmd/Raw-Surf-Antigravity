import React, { useState, useEffect, useCallback } from 'react';
import { 
  RefreshCw, Plus, Trash2, Save, Users, Camera, Video, Zap, 
  Calendar, ChevronDown, ChevronUp, Loader2, ToggleLeft, ToggleRight,
  DollarSign, Percent, ArrowLeft, Eye, EyeOff
} from 'lucide-react';
import { Button } from './ui/button';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { getFullUrl } from '../utils/media';

const PhotographerSubscriptionSettings = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [plans, setPlans] = useState([]);
  const [subscribers, setSubscribers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showNewPlan, setShowNewPlan] = useState(false);
  const [subscribersExpanded, setSubscribersExpanded] = useState(false);

  // New plan form
  const [newPlan, setNewPlan] = useState({
    name: '', interval: 'weekly', price: 15,
    photos_included: 5, videos_included: 1,
    live_session_buyins: 1, sessions_included: 0,
    booking_discount_pct: 10, on_demand_discount_pct: 10,
    description: ''
  });

  const fetchPlans = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await apiClient.get(`/photo-subscriptions/plans/${user.id}`);
      setPlans(res.data || []);
    } catch (err) { console.error(err); }
  }, [user?.id]);

  const fetchSubscribers = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await apiClient.get(`/photo-subscriptions/my-subscribers/${user.id}`);
      setSubscribers(res.data?.subscribers || []);
    } catch (err) { console.error(err); }
  }, [user?.id]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchPlans(), fetchSubscribers()]);
      setLoading(false);
    };
    load();
  }, [fetchPlans, fetchSubscribers]);

  const handleCreatePlan = async () => {
    if (!newPlan.name.trim()) { toast.error('Plan name is required'); return; }
    const minPrice = newPlan.interval === 'weekly' ? 5 : 15;
    if (newPlan.price < minPrice) { toast.error(`Minimum price is $${minPrice}`); return; }

    setSaving(true);
    try {
      await apiClient.post(`/photo-subscriptions/plans?photographer_id=${user.id}`, newPlan);
      toast.success('Plan created!');
      setShowNewPlan(false);
      setNewPlan({ name: '', interval: 'weekly', price: 15, photos_included: 5, videos_included: 1, live_session_buyins: 1, sessions_included: 0, booking_discount_pct: 10, on_demand_discount_pct: 10, description: '' });
      fetchPlans();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to create plan');
    } finally { setSaving(false); }
  };

  const togglePlanActive = async (plan) => {
    try {
      await apiClient.patch(`/photo-subscriptions/plans/${plan.id}?photographer_id=${user.id}`, { is_active: !plan.is_active });
      toast.success(plan.is_active ? 'Plan deactivated' : 'Plan activated');
      fetchPlans();
    } catch (err) { toast.error('Failed to update plan'); }
  };

  const deletePlan = async (planId) => {
    try {
      await apiClient.delete(`/photo-subscriptions/plans/${planId}?photographer_id=${user.id}`);
      toast.success('Plan deactivated');
      fetchPlans();
    } catch (err) { toast.error('Failed to deactivate plan'); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
      </div>
    );
  }

  const weeklyPlans = plans.filter(p => p.interval === 'weekly');
  const monthlyPlans = plans.filter(p => p.interval === 'monthly');
  const totalSubscribers = subscribers.length;
  const totalRevenue = subscribers.reduce((sum, s) => sum + (s.plan_price || 0), 0);

  return (
    <div className="p-4 max-w-3xl mx-auto pb-32">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-gray-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <RefreshCw className="w-6 h-6 text-violet-400" />
            Subscription Settings
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Create recurring plans for surfers to subscribe to your photography
          </p>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="p-3 rounded-xl text-center" style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)' }}>
          <p className="text-2xl font-bold text-violet-400">{plans.filter(p => p.is_active).length}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Active Plans</p>
        </div>
        <div className="p-3 rounded-xl text-center" style={{ background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.2)' }}>
          <p className="text-2xl font-bold text-cyan-400">{totalSubscribers}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Subscribers</p>
        </div>
        <div className="p-3 rounded-xl text-center" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
          <p className="text-2xl font-bold text-emerald-400">${totalRevenue.toFixed(0)}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Active Revenue</p>
        </div>
      </div>

      {/* Existing Plans */}
      {plans.length > 0 && (
        <div className="space-y-3 mb-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Your Plans</h2>
          {[...weeklyPlans, ...monthlyPlans].map(plan => (
            <div key={plan.id} className="rounded-xl overflow-hidden" style={{ background: 'rgba(39,39,42,0.5)', border: `1px solid ${plan.is_active ? 'rgba(139,92,246,0.3)' : 'rgba(63,63,70,0.5)'}` }}>
              <div className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-foreground truncate">{plan.name}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${plan.interval === 'weekly' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-violet-500/20 text-violet-400'}`}>
                        {plan.interval}
                      </span>
                      {!plan.is_active && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-zinc-700 text-gray-400">Inactive</span>
                      )}
                    </div>
                    <p className="text-2xl font-bold text-foreground mt-1">
                      ${plan.price}<span className="text-sm text-muted-foreground font-normal">/{plan.interval === 'weekly' ? 'wk' : 'mo'}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => togglePlanActive(plan)} className="p-2 rounded-lg hover:bg-zinc-700 text-gray-400 hover:text-white transition-colors" title={plan.is_active ? 'Deactivate' : 'Activate'}>
                      {plan.is_active ? <Eye className="w-4 h-4 text-emerald-400" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                    <button onClick={() => deletePlan(plan.id)} className="p-2 rounded-lg hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors" title="Deactivate">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Quotas */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  {plan.photos_included > 0 && (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs" style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.15)' }}>
                      <Camera className="w-3.5 h-3.5 text-cyan-400" />
                      <span className="text-muted-foreground">{plan.photos_included} photos</span>
                    </div>
                  )}
                  {plan.videos_included > 0 && (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs" style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.15)' }}>
                      <Video className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-muted-foreground">{plan.videos_included} videos</span>
                    </div>
                  )}
                  {plan.live_session_buyins > 0 && (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
                      <Zap className="w-3.5 h-3.5 text-red-400" />
                      <span className="text-muted-foreground">{plan.live_session_buyins} jump-ins</span>
                    </div>
                  )}
                  {plan.sessions_included > 0 && (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
                      <Calendar className="w-3.5 h-3.5 text-blue-400" />
                      <span className="text-muted-foreground">{plan.sessions_included} sessions</span>
                    </div>
                  )}
                </div>

                {/* Discounts */}
                {(plan.booking_discount_pct > 0 || plan.on_demand_discount_pct > 0) && (
                  <div className="flex flex-wrap gap-2">
                    {plan.booking_discount_pct > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        <Percent className="w-3 h-3" /> {plan.booking_discount_pct}% off bookings
                      </span>
                    )}
                    {plan.on_demand_discount_pct > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <Percent className="w-3 h-3" /> {plan.on_demand_discount_pct}% off on-demand
                      </span>
                    )}
                  </div>
                )}

                {/* Subscriber count */}
                <div className="mt-3 pt-3 border-t border-zinc-700/50 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" /> {plan.subscriber_count || 0} active subscribers
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Plan Builder */}
      {showNewPlan ? (
        <div className="rounded-xl p-5 mb-6" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(6,182,212,0.08))', border: '1px solid rgba(139,92,246,0.3)' }}>
          <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5 text-violet-400" /> Create New Plan
          </h3>

          <div className="space-y-4">
            {/* Name + Interval */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Plan Name</label>
                <input value={newPlan.name} onChange={e => setNewPlan(p => ({ ...p, name: e.target.value }))} placeholder="e.g., Weekly Basic" className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-foreground text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Interval</label>
                <div className="flex rounded-lg overflow-hidden border border-zinc-700">
                  {['weekly', 'monthly'].map(int => (
                    <button key={int} onClick={() => setNewPlan(p => ({ ...p, interval: int }))} className={`flex-1 py-2.5 text-sm font-semibold transition-all ${newPlan.interval === int ? 'bg-violet-500/20 text-violet-400' : 'bg-zinc-800 text-muted-foreground hover:bg-zinc-700'}`}>
                      {int === 'weekly' ? '📅 Weekly' : '📆 Monthly'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Price */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                Price (min ${newPlan.interval === 'weekly' ? '5' : '15'}/{newPlan.interval === 'weekly' ? 'week' : 'month'})
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input type="number" min={newPlan.interval === 'weekly' ? 5 : 15} step="1" value={newPlan.price} onChange={e => setNewPlan(p => ({ ...p, price: parseFloat(e.target.value) || 0 }))} className="w-full pl-8 pr-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-foreground text-sm focus:ring-2 focus:ring-violet-500" />
              </div>
            </div>

            {/* Quotas */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">What's Included</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'photos_included', icon: Camera, label: 'Photos', color: 'cyan' },
                  { key: 'videos_included', icon: Video, label: 'Videos', color: 'purple' },
                  { key: 'live_session_buyins', icon: Zap, label: 'Live Jump-Ins', color: 'red' },
                  { key: 'sessions_included', icon: Calendar, label: 'Booked Sessions', color: 'blue' },
                ].map(({ key, icon: Icon, label, color }) => (
                  <div key={key} className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: `rgba(${color === 'cyan' ? '6,182,212' : color === 'purple' ? '168,85,247' : color === 'red' ? '239,68,68' : '59,130,246'},0.08)`, border: `1px solid rgba(${color === 'cyan' ? '6,182,212' : color === 'purple' ? '168,85,247' : color === 'red' ? '239,68,68' : '59,130,246'},0.2)` }}>
                    <Icon className={`w-4 h-4 text-${color}-400`} style={{ color: color === 'cyan' ? '#06b6d4' : color === 'purple' ? '#a855f7' : color === 'red' ? '#ef4444' : '#3b82f6' }} />
                    <input type="number" min={0} value={newPlan[key]} onChange={e => setNewPlan(p => ({ ...p, [key]: parseInt(e.target.value) || 0 }))} className="w-14 text-center bg-zinc-900 border border-zinc-700 rounded text-sm text-foreground py-1" />
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Discounts */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Subscriber Discounts</label>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-2.5 rounded-lg" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
                  <p className="text-[10px] text-muted-foreground mb-1">Booking Discount</p>
                  <div className="flex items-center gap-1">
                    <input type="number" min={0} max={100} value={newPlan.booking_discount_pct} onChange={e => setNewPlan(p => ({ ...p, booking_discount_pct: parseFloat(e.target.value) || 0 }))} className="w-14 text-center bg-zinc-900 border border-zinc-700 rounded text-sm text-foreground py-1" />
                    <span className="text-xs text-blue-400">% off</span>
                  </div>
                </div>
                <div className="p-2.5 rounded-lg" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  <p className="text-[10px] text-muted-foreground mb-1">On-Demand Discount</p>
                  <div className="flex items-center gap-1">
                    <input type="number" min={0} max={100} value={newPlan.on_demand_discount_pct} onChange={e => setNewPlan(p => ({ ...p, on_demand_discount_pct: parseFloat(e.target.value) || 0 }))} className="w-14 text-center bg-zinc-900 border border-zinc-700 rounded text-sm text-foreground py-1" />
                    <span className="text-xs text-emerald-400">% off</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Description (optional)</label>
              <textarea value={newPlan.description} onChange={e => setNewPlan(p => ({ ...p, description: e.target.value }))} placeholder="Describe what subscribers get..." rows={2} className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-foreground text-sm focus:ring-2 focus:ring-violet-500 resize-none" />
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <Button onClick={() => setShowNewPlan(false)} variant="outline" className="flex-1 border-zinc-700">Cancel</Button>
              <Button onClick={handleCreatePlan} disabled={saving} className="flex-1 bg-gradient-to-r from-violet-500 to-cyan-500 text-white font-bold">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4 mr-2" /> Create Plan</>}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Button onClick={() => setShowNewPlan(true)} className="w-full mb-6 bg-gradient-to-r from-violet-500/20 to-cyan-500/20 text-violet-400 border border-violet-500/30 hover:bg-violet-500/30 font-semibold py-3">
          <Plus className="w-5 h-5 mr-2" /> Create New Subscription Plan
        </Button>
      )}

      {/* Subscribers Section */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(39,39,42,0.5)', border: '1px solid rgba(63,63,70,0.5)' }}>
        <button onClick={() => setSubscribersExpanded(!subscribersExpanded)} className="w-full p-4 flex items-center justify-between">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-400" />
            Active Subscribers ({totalSubscribers})
          </h3>
          {subscribersExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        
        {subscribersExpanded && (
          <div className="px-4 pb-4 space-y-2">
            {subscribers.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-4">No subscribers yet. Share your plans to attract surfers!</p>
            ) : (
              subscribers.map(sub => (
                <div key={sub.id} className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-violet-500 p-0.5">
                    <div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center overflow-hidden">
                      {sub.surfer_avatar ? (
                        <img src={getFullUrl(sub.surfer_avatar)} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <span className="text-cyan-400 font-bold text-sm">{sub.surfer_name?.[0] || '?'}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{sub.surfer_name || 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground">{sub.plan_name} • expires {new Date(sub.expires_at).toLocaleDateString()}</p>
                  </div>
                  <span className="text-sm font-bold text-emerald-400">${sub.plan_price}/{sub.plan_interval === 'weekly' ? 'wk' : 'mo'}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PhotographerSubscriptionSettings;
