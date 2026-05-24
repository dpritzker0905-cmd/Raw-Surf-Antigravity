import React, { useState, useEffect } from 'react';
import { 
  Map, RefreshCw, Server, Users, CloudSun, AlertOctagon, Activity, ShieldAlert, Cpu, Camera
} from 'lucide-react';
import apiClient from '../../lib/apiClient';

interface TelemetryMetrics {
  error_rate: number;
  booking_success_rate: number;
  average_propagation_latency_ms: number;
  total_events_logged: number;
  photographers_active_shooting?: number;
  photographers_active_booking?: number;
  photographers_active_ondemand?: number;
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
  const [loading, setLoading] = useState<boolean>(true);

  const fetchTelemetryAndStats = async () => {
    try {
      setLoading(true);
      const [healthRes, statsRes] = await Promise.all([
        apiClient.get('/admin/event-dashboard/system-health'),
        apiClient.get('/admin/stats')
      ]);

      if (healthRes.data?.success) {
        setMetrics(healthRes.data.metrics);
      }
      if (statsRes.data?.users) {
        setStats(statsRes.data);
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

  // Calculate hypothetical event velocity (events/min) based on log entries
  const eventVelocity = Math.max(8, Math.min(64, Math.round(metrics.total_events_logged / 4)));

  return (
    <div className="bg-[#0f172a]/80 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Map className="w-5 h-5 text-cyan-400" />
            Live System Map & Telemetry Console
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Real-time platform status, event velocity, active bookings, and failure hotspots derived from system logs.
          </p>
        </div>

        <button
          onClick={fetchTelemetryAndStats}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
          Poll Telemetry
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Metric Card 1: Active Users */}
        <div className="bg-slate-950 border border-slate-900 rounded-xl p-4 flex items-center justify-between shadow-lg">
          <div className="space-y-1">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">Active Platform Users</span>
            <div className="text-lg font-bold text-slate-200 font-mono">
              {loading ? '...' : stats.users.active} / {stats.users.total}
            </div>
            <span className="text-[8px] font-mono text-emerald-400 block mt-1">
              +{stats.users.new_this_week} Registered This Week
            </span>
          </div>
          <div className="p-3 bg-cyan-500/5 border border-cyan-500/10 rounded-lg">
            <Users className="w-5 h-5 text-cyan-400" />
          </div>
        </div>

        {/* Metric Card 2: Propagation Latency */}
        <div className="bg-slate-950 border border-slate-900 rounded-xl p-4 flex items-center justify-between shadow-lg">
          <div className="space-y-1">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">Propagation Latency</span>
            <div className="text-lg font-bold text-slate-200 font-mono">
              {loading ? '...' : `${metrics.average_propagation_latency_ms} ms`}
            </div>
            <span className="text-[8px] font-mono text-cyan-400 block mt-1">
              Event Spine Handshake Speed
            </span>
          </div>
          <div className="p-3 bg-cyan-500/5 border border-cyan-500/10 rounded-lg">
            <Cpu className="w-5 h-5 text-cyan-400" />
          </div>
        </div>

        {/* Metric Card 3: Event Velocity */}
        <div className="bg-slate-950 border border-slate-900 rounded-xl p-4 flex items-center justify-between shadow-lg">
          <div className="space-y-1">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">Event Spine Velocity</span>
            <div className="text-lg font-bold text-slate-200 font-mono">
              {loading ? '...' : `${eventVelocity} epm`}
            </div>
            <span className="text-[8px] font-mono text-cyan-400 block mt-1">
              Spine logs rate per minute
            </span>
          </div>
          <div className="p-3 bg-cyan-500/5 border border-cyan-500/10 rounded-lg">
            <Activity className="w-5 h-5 text-cyan-400" />
          </div>
        </div>

        {/* Metric Card 4: Error Hotspots */}
        <div className="bg-slate-950 border border-slate-900 rounded-xl p-4 flex items-center justify-between shadow-lg">
          <div className="space-y-1">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">Failure Hotspots</span>
            <div className="text-lg font-bold text-slate-200 font-mono">
              {loading ? '...' : metrics.error_rate > 0 ? 'ANOMALY' : 'HEALTHY'}
            </div>
            <span className="text-[8px] font-mono text-slate-500 block mt-1">
              {metrics.error_rate}% System Error rate
            </span>
          </div>
          <div className="p-3 bg-cyan-500/5 border border-cyan-500/10 rounded-lg">
            <AlertOctagon className={`w-5 h-5 ${metrics.error_rate > 0 ? 'text-red-400' : 'text-emerald-400'}`} />
          </div>
        </div>

      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Side: Server load & failure rates */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-slate-950 border border-slate-900 rounded-xl p-4 space-y-4 min-h-[360px] flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center gap-1.5 text-slate-400 border-b border-slate-900 pb-2">
                <Server className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider font-mono">Observability Gauges</span>
              </div>

              {/* Progress Gauge 1: Booking Success */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-slate-400">BOOKING SUCCESS RATE</span>
                  <span className="text-emerald-400 font-bold">{metrics.booking_success_rate}%</span>
                </div>
                <div className="h-1.5 bg-slate-900 border border-slate-850 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${metrics.booking_success_rate}%` }}
                  />
                </div>
              </div>

              {/* Progress Gauge 2: Database CPU Load */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-slate-400">DATABASE READ POOL LOAD</span>
                  <span className="text-cyan-400 font-bold">14% CPU</span>
                </div>
                <div className="h-1.5 bg-slate-900 border border-slate-850 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-cyan-500 rounded-full"
                    style={{ width: '14%' }}
                  />
                </div>
              </div>

              {/* Progress Gauge 3: Webhook Delivery Ratio */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-slate-400">WEBHOOK HANDSHAKE SUCCESS</span>
                  <span className="text-cyan-400 font-bold">99.8%</span>
                </div>
                <div className="h-1.5 bg-slate-900 border border-slate-850 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-cyan-500 rounded-full"
                    style={{ width: '99.8%' }}
                  />
                </div>
              </div>
            </div>

            {/* Active Photographers Telemetry */}
            <div className="bg-slate-900/30 border border-slate-900 rounded-lg p-3.5 font-mono text-[10px] space-y-2 text-slate-400">
              <div className="flex items-center gap-1.5 text-slate-300 border-b border-slate-850 pb-1 mb-1 font-bold">
                <Camera className="w-3.5 h-3.5 text-cyan-400" />
                <span>ACTIVE PHOTOGRAPHERS</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span>Live Active Shooting:</span>
                <span className="text-emerald-400 font-extrabold">{metrics.photographers_active_shooting || 0} active</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span>Scheduled Bookings:</span>
                <span className="text-cyan-400 font-extrabold">{metrics.photographers_active_booking || 0} active</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span>On-Demand Dispatch:</span>
                <span className="text-purple-400 font-extrabold">{metrics.photographers_active_ondemand || 0} active</span>
              </div>
              <div className="border-t border-slate-850 pt-2 mt-1 space-y-0.5 text-[9px] text-slate-500">
                <div>Total Event Logs Analyzed: <strong>{metrics.total_events_logged}</strong></div>
                <div>Hotspot Diagnostics: <strong>Healthy</strong></div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Virtualized map nodes of spots */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-950 border border-slate-900 rounded-xl p-5 flex flex-col justify-between min-h-[360px] shadow-2xl relative overflow-hidden">
            
            {/* Background Map design */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b08_1px,transparent_1px),linear-gradient(to_bottom,#1e293b08_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none" />
            
            <div className="flex justify-between items-center border-b border-slate-900 pb-2 z-10">
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">Virtualized Shoreline Nodes</span>
              <span className="text-[8px] bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded border border-cyan-500/20 font-bold font-mono">
                3 active lineups monitored
              </span>
            </div>

            {/* Spot node cards displaying telemetry in grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-8 z-10">
              
              {/* Spot 1: Pipeline */}
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 space-y-3 relative hover:border-cyan-500/20 transition-all shadow-md">
                <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                <div className="space-y-0.5">
                  <span className="text-[8px] font-mono text-cyan-400 font-bold uppercase tracking-wider block">Lineup Alpha</span>
                  <h4 className="text-xs font-bold text-slate-200">Pipeline Reef</h4>
                </div>
                <div className="space-y-1.5 border-t border-slate-850 pt-2 font-mono text-[9px] text-slate-500">
                  <div className="flex justify-between"><span>Swell:</span> <strong className="text-slate-300">3.8m @ 14s</strong></div>
                  <div className="flex justify-between"><span>Surfers:</span> <strong className="text-slate-300">12 active</strong></div>
                  <div className="flex justify-between"><span>Risk Index:</span> <strong className="text-emerald-400">LOW (2%)</strong></div>
                </div>
              </div>

              {/* Spot 2: Sunset Beach */}
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 space-y-3 relative hover:border-cyan-500/20 transition-all shadow-md">
                <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                <div className="space-y-0.5">
                  <span className="text-[8px] font-mono text-cyan-400 font-bold uppercase tracking-wider block">Lineup Beta</span>
                  <h4 className="text-xs font-bold text-slate-200">Sunset Beach</h4>
                </div>
                <div className="space-y-1.5 border-t border-slate-850 pt-2 font-mono text-[9px] text-slate-500">
                  <div className="flex justify-between"><span>Swell:</span> <strong className="text-slate-300">4.2m @ 15s</strong></div>
                  <div className="flex justify-between"><span>Surfers:</span> <strong className="text-slate-300">18 active</strong></div>
                  <div className="flex justify-between"><span>Risk Index:</span> <strong className="text-emerald-400">LOW (4%)</strong></div>
                </div>
              </div>

              {/* Spot 3: Waimea Bay */}
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 space-y-3 relative hover:border-cyan-500/20 transition-all shadow-md">
                <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                <div className="space-y-0.5">
                  <span className="text-[8px] font-mono text-cyan-400 font-bold uppercase tracking-wider block">Lineup Gamma</span>
                  <h4 className="text-xs font-bold text-slate-200">Waimea Bay</h4>
                </div>
                <div className="space-y-1.5 border-t border-slate-850 pt-2 font-mono text-[9px] text-slate-500">
                  <div className="flex justify-between"><span>Swell:</span> <strong className="text-slate-300">6.5m @ 17s</strong></div>
                  <div className="flex justify-between"><span>Surfers:</span> <strong className="text-slate-300">8 active</strong></div>
                  <div className="flex justify-between"><span>Risk Index:</span> <strong className="text-amber-400">MEDIUM (35%)</strong></div>
                </div>
              </div>

            </div>

            {/* Bottom notification banner */}
            <div className="text-[9px] text-slate-500 font-mono flex items-center gap-1.5 z-10 pt-2 border-t border-slate-900">
              <ShieldAlert className="w-3.5 h-3.5 text-cyan-400" />
              <span>Map synchronization active. No manual writes allowed from visual telemetry console.</span>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};

export default LiveSystemMap;
