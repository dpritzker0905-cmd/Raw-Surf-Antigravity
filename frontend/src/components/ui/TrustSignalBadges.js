/**
 * TrustSignalBadges -- Social proof indicators for photographer profiles.
 *
 * Fetches data from /profiles/{id}/trust-signals and displays:
 * - Verification badge (G Verified / G Approved Pro)
 *  - Session tier (Legend / Veteran / Experienced etc.)
 *  - Average response time
 *  - Review breakdown with category stars
 */
import React, { useState, useEffect } from 'react';
import { Shield, Clock, Star, Camera, Zap, Award } from 'lucide-react';
import apiClient from '../../lib/apiClient';

const TIER_CONFIG = {
 legend: { label: 'Legend', icon: '=', color: '#FFD700', bg: 'rgba(255,215,0,0.12)' },
 veteran: { label: 'Veteran', icon: 'G', color: '#C084FC', bg: 'rgba(192,132,252,0.12)' },
 experienced: { label: 'Experienced', icon: '=', color: '#38BDF8', bg: 'rgba(56,189,248,0.12)' },
 established: { label: 'Established', icon: '=+', color: '#34D399', bg: 'rgba(52,211,153,0.12)' },
 new: { label: 'New', icon: '=', color: '#94A3B8', bg: 'rgba(148,163,184,0.12)' },
};

const CategoryBar = ({ label, value, maxValue = 5 }) => {
  const pct = Math.min((value / maxValue) * 100, 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-gray-400 truncate">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #38BDF8, #818CF8)' }}
        />
      </div>
      <span className="w-6 text-right text-gray-300 font-medium">{value}</span>
    </div>
  );
};

const TrustSignalBadges = ({ profileId, compact = false }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;

    const fetchTrust = async () => {
      try {
        const res = await apiClient.get(`/profiles/${profileId}/trust-signals`);
        if (!cancelled) setData(res.data);
      } catch {
 // Non-critical -- silently fail
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchTrust();
    return () => { cancelled = true; };
  }, [profileId]);

  if (loading || !data) return null;

  const tier = TIER_CONFIG[data.session_tier] || TIER_CONFIG.new;
  const breakdown = data.review_breakdown || {};

 // --- COMPACT MODE (inline badges for cards / search results) ---
  if (compact) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* Verified badge */}
        {data.is_verified && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-400">
            <Shield className="w-2.5 h-2.5" /> Verified
          </span>
        )}
        {data.is_approved_pro && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400">
            <Award className="w-2.5 h-2.5" /> Approved Pro
          </span>
        )}

        {/* Session tier */}
        <span
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
          style={{ background: tier.bg, color: tier.color }}
        >
          {tier.icon} {tier.label}
        </span>

        {/* Quick response time */}
        {data.avg_response_minutes != null && data.avg_response_minutes <= 15 && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-400">
            <Zap className="w-2.5 h-2.5" /> Fast
          </span>
        )}

        {/* Review stars */}
        {breakdown.overall > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-yellow-400 font-semibold">
            <Star className="w-2.5 h-2.5 fill-current" />
            {breakdown.overall}
          </span>
        )}
      </div>
    );
  }

 // --- FULL MODE (profile page) ---
  return (
    <div
      className="rounded-xl border border-white/10 overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.03)' }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
          <Shield className="w-4 h-4 text-blue-400" />
          Trust Signals
        </h3>

        {/* Verification badges */}
        <div className="flex items-center gap-1.5">
          {data.is_approved_pro && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
 G Approved Pro
            </span>
          )}
          {data.is_verified && !data.is_approved_pro && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
 G Verified
            </span>
          )}
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-3 gap-0 divide-x divide-white/5 px-1 py-3">
        {/* Sessions */}
        <div className="flex flex-col items-center gap-0.5">
          <Camera className="w-4 h-4 text-blue-400" />
          <span className="text-lg font-bold text-white">{data.total_sessions}</span>
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Sessions</span>
          <span
            className="mt-0.5 px-1.5 py-px rounded-full text-[9px] font-bold"
            style={{ background: tier.bg, color: tier.color }}
          >
            {tier.icon} {tier.label}
          </span>
        </div>

        {/* Response time */}
        <div className="flex flex-col items-center gap-0.5">
          <Clock className="w-4 h-4 text-amber-400" />
          <span className="text-lg font-bold text-white">
 {data.avg_response_minutes != null ? `${data.avg_response_minutes}m` : 'G'}
          </span>
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Avg Response</span>
          {data.avg_response_minutes != null && data.avg_response_minutes <= 10 && (
            <span className="mt-0.5 px-1.5 py-px rounded-full text-[9px] font-bold bg-green-500/15 text-green-400">
 G Lightning
            </span>
          )}
        </div>

        {/* Overall rating */}
        <div className="flex flex-col items-center gap-0.5">
          <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
          <span className="text-lg font-bold text-white">
 {breakdown.overall > 0 ? breakdown.overall : 'G'}
          </span>
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Rating</span>
          {breakdown.count > 0 && (
            <span className="mt-0.5 text-[9px] text-gray-500">{breakdown.count} reviews</span>
          )}
        </div>
      </div>

      {/* Category breakdowns */}
      {(breakdown.photo_quality || breakdown.communication || breakdown.punctuality) && (
        <div className="px-4 pb-3 pt-1 space-y-1.5 border-t border-white/5">
          {breakdown.photo_quality != null && (
            <CategoryBar label="Photo Quality" value={breakdown.photo_quality} />
          )}
          {breakdown.communication != null && (
            <CategoryBar label="Communication" value={breakdown.communication} />
          )}
          {breakdown.punctuality != null && (
            <CategoryBar label="Punctuality" value={breakdown.punctuality} />
          )}
        </div>
      )}
    </div>
  );
};

export default TrustSignalBadges;
