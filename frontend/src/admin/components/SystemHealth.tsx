import React, { useState, useEffect } from 'react';
import { 
  Activity, ShieldAlert, Cpu, Heart, CheckCircle2, RefreshCw, Server
} from 'lucide-react';
import apiClient from '../../lib/apiClient';

interface HealthMetrics {
  error_rate: number;
  booking_success_rate: number;
  average_propagation_latency_ms: number;
  total_events_logged: number;
}

export const SystemHealth: React.FC = () => {
  const [metrics, setMetrics] = useState<HealthMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/admin/event-dashboard/system-health');
      if (res.data?.success) {
        setMetrics(res.data.metrics);
      }
    } catch (err) {
      console.error('Failed to fetch health metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    // Poll every 15 seconds to keep health panel fresh
    const timer = setInterval(fetchMetrics, 15000);
    return () => clearInterval(timer);
  }, []);

  const getStatusColor = (val: number, type: 'error' | 'success' | 'latency') => {
    if (type === 'error') {
      if (val < 1.0) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      if (val < 5.0) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      return 'text-red-400 bg-red-500/10 border-red-500/20';
    }
    
    if (type === 'success') {
      if (val >= 90.0) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      if (val >= 75.0) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      return 'text-red-400 bg-red-500/10 border-red-500/20';
    }

    if (type === 'latency') {
      if (val < 10.0) return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20';
      if (val < 100.0) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      return 'text-red-400 bg-red-500/10 border-red-500/20';
    }
  };

  return (
    <div className="bg-[#0f172a]/80 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Server className="w-5 h-5 text-cyan-400" />
            System Health & Event Diagnostics
          </h2>
          <p className="text-sm text-slate-400 mt-1">Live service quality telemetry and propagation statistics</p>
        </div>
        <button 
          onClick={fetchMetrics}
          disabled={loading}
          className="text-slate-500 hover:text-slate-300 p-2 hover:bg-slate-800 rounded-lg transition-all disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && !metrics ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
        </div>
      ) : !metrics ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          Failed to load diagnostics telemetry.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Diagnostic grids */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* System status */}
            <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-4 flex flex-col justify-between h-[120px]">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-400 uppercase">Core Status</span>
                <Heart className="w-4 h-4 text-rose-500 animate-pulse" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-slate-100">Healthy</span>
              </div>
              <span className="text-[10px] text-slate-500">Service online and active</span>
            </div>

            {/* Error Rate */}
            <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-4 flex flex-col justify-between h-[120px]">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-400 uppercase">Error Rate</span>
                <ShieldAlert className="w-4 h-4 text-amber-500" />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-extrabold text-slate-100">{metrics.error_rate}%</span>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border w-fit ${getStatusColor(metrics.error_rate, 'error')}`}>
                {metrics.error_rate < 1.0 ? 'PRISTINE QUALITY' : metrics.error_rate < 5.0 ? 'WARN STATE' : 'CRITICAL LOAD'}
              </span>
            </div>

            {/* Success rate */}
            <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-4 flex flex-col justify-between h-[120px]">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-400 uppercase">Booking Success</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-extrabold text-slate-100">{metrics.booking_success_rate}%</span>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border w-fit ${getStatusColor(metrics.booking_success_rate, 'success')}`}>
                {metrics.booking_success_rate >= 90.0 ? 'CONVERSION NOMINAL' : 'CONVERSION DEGRADED'}
              </span>
            </div>

            {/* Latency */}
            <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-4 flex flex-col justify-between h-[120px]">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-400 uppercase">Avg Propagation</span>
                <Cpu className="w-4 h-4 text-cyan-400 animate-pulse" />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-extrabold text-slate-100">{metrics.average_propagation_latency_ms}ms</span>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border w-fit ${getStatusColor(metrics.average_propagation_latency_ms, 'latency')}`}>
                {metrics.average_propagation_latency_ms < 10.0 ? 'LOW LATENCY REALTIME' : 'POLLING BACKOFF'}
              </span>
            </div>
          </div>

          {/* Details */}
          <div className="bg-slate-950/20 border border-slate-900 rounded-xl p-4 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              <span className="text-slate-400">Total Event Spikes Monitored: <span className="font-bold text-slate-200">{metrics.total_events_logged}</span></span>
            </div>
            <span className="text-slate-500 font-mono">Real-time Heartbeat Active</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default SystemHealth;
