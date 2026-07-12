import React, { useState, useEffect } from 'react';
import {
  Map, RefreshCw, Server, Users, CloudSun, AlertOctagon, Activity, ShieldAlert, Cpu, Camera
} from 'lucide-react';
import apiClient from '../../lib/apiClient';
import { useTheme } from '../../contexts/ThemeContext';
import { getThemeTokens } from '../../utils/themeTokens';

interface TelemetryMetrics {
  error_rate: number;
  booking_success_rate: number;
  average_propagation_latency_ms: number;
  total_events_logged: number;
  photographers_active_shooting?: number;
  photographers_active_booking?: number;
  photographers_active_ondemand?: number;
  event_velocity_per_min?: number;
}

interface PlatformStats {
  users: {
    total: number;
    active: number;
    new_this_week: number;
  };
  content: {
    total_posts: number;
    total_gallery_items: number;
  };
}

interface ActiveSpot {
  spot_id: string;
  name: string;
  region: string | null;
  country: string | null;
  live_sessions: number;
  active_bookings: number;
  total_activity: number;
}

export const LiveSystemMap: React.FC = () => {
  const [metrics, setMetrics] = useState<TelemetryMetrics>({
    error_rate: 0.0,
    booking_success_rate: 100.0,
    average_propagation_latency_ms: 2.5,
    total_events_logged: 0,
    photographers_active_shooting: 0,
    photographers_active_booking: 0,
    photographers_active_ondemand: 0
  });
  const [stats, setStats] = useState<PlatformStats>({
    users: { total: 0, active: 0, new_this_week: 0 },
    content: { total_posts: 0, total_gallery_items: 0 }
  });
  const [activeSpots, setActiveSpots] = useState<ActiveSpot[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchTelemetryAndStats = async () => {
    try {
      setLoading(true);
      const [healthRes, statsRes, spotsRes] = await Promise.all([
        apiClient.get('/admin/event-dashboard/system-health'),
        apiClient.get('/admin/stats'),
        apiClient.get('/admin/event-dashboard/active-spots')
      ]);

      if (healthRes.data?.success) {
        setMetrics(healthRes.data.metrics);
      }
      if (statsRes.data?.users) {
        setStats(statsRes.data);
      }
      if (spotsRes.data?.success) {
        setActiveSpots(spotsRes.data.spots || []);
      }
    } catch (err) {
      console.error('Failed to load telemetry maps:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTelemetryAndStats();
    // Poll every 10 seconds for real-time telemetry feel
    const interval = setInterval(fetchTelemetryAndStats, 10000);
    return () => clearInterval(interval);
  }, []);

  // Real events/min, computed server-side from actual event timestamps (see telemetry.py)
  const eventVelocity = metrics.event_velocity_per_min ?? 0;

  const { theme } = useTheme();
  const t = getThemeTokens(theme);
  const dim = t.isLight || t.isBeach;
  const accent = dim ? 'text-cyan-600' : 'text-cyan-400';
  const accentBg = dim ? 'bg-cyan-600/5' : 'bg-cyan-500/5';
  const accentBorder = dim ? 'border-cyan-600/10' : 'border-cyan-500/10';
  const successText = dim ? 'text-emerald-600' : 'text-emerald-400';
  const dangerText = dim ? 'text-red-600' : 'text-red-400';
  const purpleText = dim ? 'text-purple-600' : 'text-purple-400';

  return (
    <div className={`${t.glassBg} backdrop-blur-md rounded-xl border p-6 shadow-2xl space-y-6`}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className={`text-xl font-bold ${t.textPrimary} flex items-center gap-2`}>
            <Map className={`w-5 h-5 ${accent}`} />
            Live System Map & Telemetry Console
          </h2>
          <p className={`text-xs ${t.textSecondary} mt-1`}>
            Real-time platform status, event velocity, active bookings, and failure hotspots derived from system logs.
          </p>
        </div>

        <button
          onClick={fetchTelemetryAndStats}
          className={`flex items-center gap-1.5 ${t.cardBg} hover:${t.hoverBg} border ${t.border} hover:${t.borderLight} ${t.textSecondary} text-xs font-semibold px-3 py-1.5 rounded-lg transition-all`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${accent}`} />
          Poll Telemetry
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

        {/* Metric Card 1: Active Users */}
        <div className={`${t.cardBgBorder} border rounded-xl p-4 flex items-center justify-between shadow-lg`}>
          <div className="space-y-1">
            <span className={`text-[9px] font-bold ${t.textMuted} uppercase tracking-widest block`}>Active Platform Users</span>
            <div className={`text-lg font-bold ${t.textPrimary} font-mono`}>
              {loading ? '...' : stats.users.active} / {stats.users.total}
            </div>
            <span className={`text-[8px] font-mono ${successText} block mt-1`}>
              +{stats.users.new_this_week} Registered This Week
            </span>
          </div>
          <div className={`p-3 ${accentBg} border ${accentBorder} rounded-lg`}>
            <Users className={`w-5 h-5 ${accent}`} />
          </div>
        </div>

        {/* Metric Card 2: Propagation Latency */}
        <div className={`${t.cardBgBorder} border rounded-xl p-4 flex items-center justify-between shadow-lg`}>
          <div className="space-y-1">
            <span className={`text-[9px] font-bold ${t.textMuted} uppercase tracking-widest block`}>Propagation Latency</span>
            <div className={`text-lg font-bold ${t.textPrimary} font-mono`}>
              {loading ? '...' : `${metrics.average_propagation_latency_ms} ms`}
            </div>
            <span className={`text-[8px] font-mono ${accent} block mt-1`}>
              Event Spine Handshake Speed
            </span>
          </div>
          <div className={`p-3 ${accentBg} border ${accentBorder} rounded-lg`}>
            <Cpu className={`w-5 h-5 ${accent}`} />
          </div>
        </div>

        {/* Metric Card 3: Event Velocity */}
        <div className={`${t.cardBgBorder} border rounded-xl p-4 flex items-center justify-between shadow-lg`}>
          <div className="space-y-1">
            <span className={`text-[9px] font-bold ${t.textMuted} uppercase tracking-widest block`}>Event Spine Velocity</span>
            <div className={`text-lg font-bold ${t.textPrimary} font-mono`}>
              {loading ? '...' : `${eventVelocity} epm`}
            </div>
            <span className={`text-[8px] font-mono ${accent} block mt-1`}>
              Spine logs rate per minute
            </span>
          </div>
          <div className={`p-3 ${accentBg} border ${accentBorder} rounded-lg`}>
            <Activity className={`w-5 h-5 ${accent}`} />
          </div>
        </div>

        {/* Metric Card 4: Error Hotspots */}
        <div className={`${t.cardBgBorder} border rounded-xl p-4 flex items-center justify-between shadow-lg`}>
          <div className="space-y-1">
            <span className={`text-[9px] font-bold ${t.textMuted} uppercase tracking-widest block`}>Failure Hotspots</span>
            <div className={`text-lg font-bold ${t.textPrimary} font-mono`}>
              {loading ? '...' : metrics.error_rate > 0 ? 'ANOMALY' : 'HEALTHY'}
            </div>
            <span className={`text-[8px] font-mono ${t.textMuted} block mt-1`}>
              {metrics.error_rate}% System Error rate
            </span>
          </div>
          <div className={`p-3 ${accentBg} border ${accentBorder} rounded-lg`}>
            <AlertOctagon className={`w-5 h-5 ${metrics.error_rate > 0 ? dangerText : successText}`} />
          </div>
        </div>

      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left Side: Server load & failure rates */}
        <div className="lg:col-span-1 space-y-4">
          <div className={`${t.cardBgBorder} border rounded-xl p-4 space-y-4 min-h-[360px] flex flex-col justify-between`}>
            <div className="space-y-4">
              <div className={`flex items-center gap-1.5 ${t.textSecondary} border-b ${t.borderLight} pb-2`}>
                <Server className={`w-3.5 h-3.5 ${accent}`} />
                <span className="text-[10px] font-bold uppercase tracking-wider font-mono">Observability Gauges</span>
              </div>

              {/* Progress Gauge 1: Booking Success */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] font-mono">
                  <span className={t.textSecondary}>BOOKING SUCCESS RATE</span>
                  <span className={`${successText} font-bold`}>{metrics.booking_success_rate}%</span>
                </div>
                <div className={`h-1.5 ${t.cardBg} border ${t.border} rounded-full overflow-hidden`}>
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${metrics.booking_success_rate}%` }}
                  />
                </div>
              </div>

            </div>

            {/* Active Photographers Telemetry */}
            <div className={`${t.rowBg} border ${t.border} rounded-lg p-3.5 font-mono text-[10px] space-y-2 ${t.textSecondary}`}>
              <div className={`flex items-center gap-1.5 ${t.textSecondary} border-b ${t.borderLight} pb-1 mb-1 font-bold`}>
                <Camera className={`w-3.5 h-3.5 ${accent}`} />
                <span>ACTIVE PHOTOGRAPHERS</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span>Live Active Shooting:</span>
                <span className={`${successText} font-extrabold`}>{metrics.photographers_active_shooting || 0} active</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span>Scheduled Bookings:</span>
                <span className={`${accent} font-extrabold`}>{metrics.photographers_active_booking || 0} active</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span>On-Demand Dispatch:</span>
                <span className={`${purpleText} font-extrabold`}>{metrics.photographers_active_ondemand || 0} active</span>
              </div>
              <div className={`border-t ${t.borderLight} pt-2 mt-1 space-y-0.5 text-[9px] ${t.textMuted}`}>
                <div>Total Event Logs Analyzed: <strong>{metrics.total_events_logged}</strong></div>
                <div>Hotspot Diagnostics: <strong className={metrics.error_rate > 0 ? dangerText : successText}>{metrics.error_rate > 0 ? 'Anomaly Detected' : 'Healthy'}</strong></div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Virtualized map nodes of spots */}
        <div className="lg:col-span-2 space-y-4">
          <div className={`${t.cardBgBorder} border rounded-xl p-5 flex flex-col justify-between min-h-[360px] shadow-2xl relative overflow-hidden`}>

            {/* Background Map design */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b08_1px,transparent_1px),linear-gradient(to_bottom,#1e293b08_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none" />

            <div className={`flex justify-between items-center border-b ${t.borderLight} pb-2 z-10`}>
              <span className={`text-[9px] font-bold ${t.textMuted} uppercase tracking-widest block`}>Most Active Surf Spots</span>
              <span className={`text-[8px] ${accentBg} ${accent} px-2 py-0.5 rounded border ${accentBorder} font-bold font-mono`}>
                Live sessions + active bookings
              </span>
            </div>

            {/* Real spot activity cards - ranked by live sessions + active bookings */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-8 z-10">
              {activeSpots.length === 0 ? (
                <div className={`sm:col-span-3 text-center py-10 ${t.textMuted} text-xs font-mono`}>
                  {loading ? 'Loading spot activity...' : 'No active sessions or bookings right now.'}
                </div>
              ) : (
                activeSpots.map((spot, idx) => (
                  <div key={spot.spot_id} className={`${t.rowBg} border ${t.borderLight} rounded-xl p-4 space-y-3 relative hover:border-cyan-500/20 transition-all shadow-md`}>
                    <div className={`absolute top-3 right-3 w-2 h-2 rounded-full animate-ping ${spot.live_sessions > 0 ? 'bg-emerald-500' : t.avatarBg}`} />
                    <div className="space-y-0.5">
                      <span className={`text-[8px] font-mono ${accent} font-bold uppercase tracking-wider block`}>Rank #{idx + 1}</span>
                      <h4 className={`text-xs font-bold ${t.textPrimary}`}>{spot.name}</h4>
                      {(spot.region || spot.country) && (
                        <span className={`text-[9px] ${t.textMuted}`}>{[spot.region, spot.country].filter(Boolean).join(', ')}</span>
                      )}
                    </div>
                    <div className={`space-y-1.5 border-t ${t.borderLight} pt-2 font-mono text-[9px] ${t.textMuted}`}>
                      <div className="flex justify-between"><span>Live Sessions:</span> <strong className={successText}>{spot.live_sessions}</strong></div>
                      <div className="flex justify-between"><span>Active Bookings:</span> <strong className={accent}>{spot.active_bookings}</strong></div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Bottom notification banner */}
            <div className={`text-[9px] ${t.textMuted} font-mono flex items-center gap-1.5 z-10 pt-2 border-t ${t.borderLight}`}>
              <ShieldAlert className={`w-3.5 h-3.5 ${accent}`} />
              <span>Map synchronization active. No manual writes allowed from visual telemetry console.</span>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};

export default LiveSystemMap;
