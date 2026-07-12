import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, Activity, Cpu, Server, Network, Terminal, RefreshCw, Play, 
  CheckCircle2, AlertTriangle, Layers, Clock, Database, HelpCircle
} from 'lucide-react';
import { WeatherTelemetry } from '../../components/map/WeatherTelemetry';
import apiClient from '../../lib/apiClient';
import { useTheme } from '../../contexts/ThemeContext';
import { getThemeTokens } from '../../utils/themeTokens';
import { toast } from 'sonner';

export const WeatherDiagnostics: React.FC = () => {
  const [report, setReport] = useState<any>(WeatherTelemetry.getDiagnosticReport());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sandboxTimeOffset, setSandboxTimeOffset] = useState<number>(0);
  const [simulationLogs, setSimulationLogs] = useState<string[]>([
    'Diagnostics interface active.',
    'Telemetry hooks verified across Open-Meteo decoders.'
  ]);
  // Backend data-pipeline freshness (the decoupled cron's per-lane health, from /api/health/data).
  const [pipelineHealth, setPipelineHealth] = useState<any>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const fetchPipelineHealth = React.useCallback(async () => {
    setHealthLoading(true);
    try {
      const res = await apiClient.get('/health/data');
      setPipelineHealth(res.data);
    } catch (err: any) {
      // /health/data returns 503 when status=critical — axios throws, but the body IS the report.
      setPipelineHealth(err?.response?.data && err.response.data.status
        ? err.response.data
        : { status: 'critical', freshest_run_age_h: null, lanes: {}, alerts: ['health endpoint unreachable'] });
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    // Poll telemetry state at 1-second intervals
    const interval = setInterval(() => {
      setReport(WeatherTelemetry.getDiagnosticReport());
    }, 1000);

    // Subscribe to immediate telemetry events for toast alerts
    const unsubscribe = WeatherTelemetry.subscribe((event) => {
      if (event.type === 'tile_failed') {
        toast.error(`[Tile Fail] ${event.payload.url.substring(0, 45)}...`, {
          description: `Correlation: ${event.correlationId}`,
          id: `tile-fail-${event.id}`
        });
      } else if (event.type === 'FPS_drop_detected') {
        toast.warning(`[Performance drop] FPS fell to ${event.payload.currentFps}`, {
          id: 'fps-drop-toast'
        });
      }
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  // Poll backend pipeline health on mount + every 60s (the cron refreshes every 3h; 60s keeps the badge live).
  useEffect(() => {
    fetchPipelineHealth();
    const t = setInterval(fetchPipelineHealth, 60000);
    return () => clearInterval(t);
  }, [fetchPipelineHealth]);

  const triggerManualRefresh = () => {
    setIsRefreshing(true);
    setReport(WeatherTelemetry.getDiagnosticReport());
    fetchPipelineHealth();
    setSimulationLogs(prev => [...prev, `[TELEMETRY] Manual purge and query: ${Date.now()}`]);
    setTimeout(() => {
      setIsRefreshing(false);
      toast.success('Diagnostics telemetry successfully synchronized!');
    }, 400);
  };

  const handleSandboxReplay = (failId: string) => {
    const failure = report.recentFailures.find((f: any) => f.id === failId);
    if (!failure) return;

    setSimulationLogs(prev => [
      ...prev,
      `[REPLAY] Re-constructing failing frame ${failId}...`,
      `[REPLAY] Restoring state parameters: Model=${failure.model}, Layers=${failure.layers.join(',')}`,
      `[REPLAY] Simulated FPS: ${failure.fps}, Memory estimate: ${failure.memory} MB`,
      `[REPLAY] Bypassing beta gate constraints for target correlation...`
    ]);

    toast.success('Failure frame successfully loaded into Sandbox Engine!', {
      description: `Target state: GFS / Fog + Precipitation`
    });
  };

  const cacheHitRate = report.tileStats.total > 0 
    ? Math.round((report.tileStats.cached / report.tileStats.total) * 100)
    : 100;

  const avgDecodeMs = report.tileStats.loaded > 0
    ? Math.round(report.tileStats.sumDecodeMs / report.tileStats.loaded)
    : 0;

  // Theme-aware tokens for this whole panel (light / dark / beach).
  const { theme } = useTheme();
  const t = getThemeTokens(theme);
  const dim = t.isLight || t.isBeach;  // light + beach backgrounds need darker accent shades for contrast
  const accent = dim ? 'text-cyan-600' : 'text-cyan-400';
  const accentBorder = dim ? 'border-cyan-600/30' : 'border-cyan-500/20';
  const accentBg = dim ? 'bg-cyan-600/10' : 'bg-cyan-500/10';
  const successText = dim ? 'text-emerald-600' : 'text-emerald-400';
  const warnText = dim ? 'text-amber-600' : 'text-amber-400';
  const dangerText = dim ? 'text-red-600' : 'text-red-400';
  const purpleText = dim ? 'text-purple-600' : 'text-purple-400';
  const healthText = (v: string) =>
    v === 'ok' ? successText : v === 'warn' ? warnText : dangerText;
  const healthBorder = (v: string) =>
    v === 'ok' ? 'border-emerald-500/30' : v === 'warn' ? 'border-amber-500/30' : 'border-red-500/40';

  return (
    <div className={`${t.glassBg} backdrop-blur-md rounded-xl border p-6 shadow-2xl space-y-6`}>

      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className={`text-xl font-bold ${t.textPrimary} flex items-center gap-2`}>
            <Activity className={`w-5 h-5 ${accent} animate-pulse`} />
            Weather Intelligence Diagnostic Panel
          </h2>
          <p className={`text-xs ${t.textSecondary} mt-1`}>
            Real-time raster decoding logs, WebGL drawing metrics, and Open-Meteo tile telemetry.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={triggerManualRefresh}
            disabled={isRefreshing}
            className={`${t.cardBg} ${t.hoverBg} border ${t.border} ${t.textSecondary} font-extrabold text-xs px-3.5 py-2 rounded-lg flex items-center gap-2 transition-all disabled:opacity-40`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? `animate-spin ${accent}` : ''}`} />
            Refresh Telemetry
          </button>

          <span className={`text-[10px] ${accentBg} border ${accentBorder} ${accent} px-3 py-1 rounded-lg uppercase font-bold tracking-wider flex items-center gap-1.5`}>
            <Server className="w-3.5 h-3.5" />
            Self-Diagnosing 2.0
          </span>
        </div>
      </div>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        
        {/* Metric 1: FPS */}
        <div className={`${t.rowBg} border ${t.borderLight} rounded-lg p-4 flex items-center gap-4`}>
          <div className={`p-2.5 rounded-lg ${accentBg} border ${accentBorder} ${accent}`}>
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <span className={`text-[10px] ${t.textMuted} uppercase font-bold tracking-wider`}>WebGL Performance</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className={`text-lg font-extrabold font-mono ${report.gpuStats.fps > 45 ? successText : report.gpuStats.fps > 24 ? warnText : dangerText}`}>
                {report.gpuStats.fps}
              </span>
              <span className={`text-[10px] ${t.textMuted}`}>FPS</span>
            </div>
          </div>
        </div>

        {/* Metric 2: Tile Success Rate */}
        <div className={`${t.rowBg} border ${t.borderLight} rounded-lg p-4 flex items-center gap-4`}>
          <div className={`p-2.5 rounded-lg ${dim ? 'bg-emerald-600/10 border-emerald-600/20' : 'bg-emerald-500/5 border-emerald-500/10'} border ${successText}`}>
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <span className={`text-[10px] ${t.textMuted} uppercase font-bold tracking-wider`}>Tile Load Success</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className={`text-lg font-extrabold font-mono ${successText}`}>
                {report.tileStats.total > 0 ? Math.round((report.tileStats.loaded / report.tileStats.total) * 100) : 100}%
              </span>
              <span className={`text-[9px] ${t.textMuted} font-mono`}>({report.tileStats.loaded}/{report.tileStats.total})</span>
            </div>
          </div>
        </div>

        {/* Metric 3: Cache Hit Rate */}
        <div className={`${t.rowBg} border ${t.borderLight} rounded-lg p-4 flex items-center gap-4`}>
          <div className={`p-2.5 rounded-lg ${dim ? 'bg-purple-600/10 border-purple-600/20' : 'bg-purple-500/5 border-purple-500/10'} border ${purpleText}`}>
            <Database className="w-5 h-5" />
          </div>
          <div>
            <span className={`text-[10px] ${t.textMuted} uppercase font-bold tracking-wider`}>Edge Cache Hit Rate</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className={`text-lg font-extrabold font-mono ${purpleText}`}>{cacheHitRate}%</span>
              <span className={`text-[10px] ${t.textMuted}`}>of requests</span>
            </div>
          </div>
        </div>

        {/* Metric 4: Avg Decode Time */}
        <div className={`${t.rowBg} border ${t.borderLight} rounded-lg p-4 flex items-center gap-4`}>
          <div className={`p-2.5 rounded-lg ${dim ? 'bg-amber-600/10 border-amber-600/20' : 'bg-amber-500/5 border-amber-500/10'} border ${warnText}`}>
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <span className={`text-[10px] ${t.textMuted} uppercase font-bold tracking-wider`}>Raster Decode Duration</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className={`text-lg font-extrabold font-mono ${warnText}`}>{avgDecodeMs}</span>
              <span className={`text-[10px] ${t.textMuted}`}>ms / tile</span>
            </div>
          </div>
        </div>

      </div>

      {/* Data Pipeline Health — the decoupled cron's per-lane freshness (GET /api/health/data). Theme-aware. */}
      <div className={`${t.cardBgBorder} border rounded-xl p-5 shadow-xl`}>
        <div className={`flex items-center justify-between border-b ${t.borderLight} pb-3 mb-4`}>
          <span className={`text-[10px] font-bold ${t.textSecondary} uppercase tracking-widest flex items-center gap-1.5`}>
            <Layers className={`w-3.5 h-3.5 ${dim ? 'text-cyan-600' : 'text-cyan-400'}`} />
            Data Pipeline Health — cron freshness per model×domain
          </span>
          {pipelineHealth && (
            <span className={`text-[10px] px-2.5 py-1 rounded-lg uppercase font-bold tracking-wider border ${healthBorder(pipelineHealth.status)} ${healthText(pipelineHealth.status)}`}>
              {pipelineHealth.status}{pipelineHealth.freshest_run_age_h != null ? ` · freshest ${pipelineHealth.freshest_run_age_h}h` : ''}
            </span>
          )}
        </div>
        {!pipelineHealth ? (
          <div className={`${t.textMuted} italic text-[11px]`}>{healthLoading ? 'Loading pipeline health…' : 'No health data.'}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {Object.entries(pipelineHealth.lanes || {}).map(([lane, info]: [string, any]) => {
                const v = info.verdict;
                return (
                  <div key={lane} className={`${t.cellBg} border ${healthBorder(v)} rounded-lg px-3 py-2`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-[11px] font-bold ${t.textPrimary} font-mono`}>{lane}</span>
                      <span className={`text-[9px] uppercase font-bold ${healthText(v)}`}>{v}</span>
                    </div>
                    <div className={`text-[9px] ${t.textMuted} font-mono mt-0.5`}>
                      {info.reason === 'missing' ? 'MISSING' : `age ${info.age_h}h${info.horizon_h != null ? ` · +${Math.round(info.horizon_h)}h` : ''}`}
                    </div>
                  </div>
                );
              })}
            </div>
            {pipelineHealth.alerts && pipelineHealth.alerts.length > 0 && (
              <div className="mt-3 space-y-1">
                {pipelineHealth.alerts.map((a: string, i: number) => (
                  <div key={i} className={`text-[10px] ${dim ? 'text-amber-700' : 'text-amber-400/90'} font-mono flex items-start gap-1.5`}>
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />{a}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Column 1 & 2: Active Telemetry Logs and Failure Archiving */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Active Logs Terminal */}
          <div className={`${t.cardBgBorder} border rounded-xl p-5 shadow-xl`}>
            <div className={`flex justify-between items-center border-b ${t.borderLight} pb-3 mb-4`}>
              <span className={`text-[10px] font-bold ${t.textSecondary} uppercase tracking-widest flex items-center gap-1.5`}>
                <Terminal className={`w-3.5 h-3.5 ${accent}`} />
                Live Telemetry Log
              </span>
              <span className={`text-[9px] ${t.textMuted} font-mono`}>Real-time trace listener</span>
            </div>

            <div className="h-64 overflow-y-auto space-y-2 font-mono text-[11px] leading-relaxed pr-2 scrollbar-thin">
              {report.recentEvents.length === 0 ? (
                <div className={`${t.textMuted} italic`}>Waiting for weather simulation map rendering actions... Toggle the weather controls layer to emit events.</div>
              ) : (
                report.recentEvents.map((evt: any) => {
                  let color = t.textSecondary;
                  if (evt.type.includes('fail') || evt.type.includes('drop')) color = `${dangerText} font-bold`;
                  else if (evt.type.includes('loaded')) color = successText;
                  else if (evt.type.includes('picker')) color = `${purpleText} font-bold`;
                  else if (evt.type.includes('decoded')) color = accent;

                  return (
                    <div key={evt.id} className={`border-b ${t.borderLight}/40 pb-1 flex items-start gap-2`}>
                      <span className={`${t.textMuted} select-none text-[10px]`}>{new Date(evt.timestamp).toLocaleTimeString()}</span>
                      <span className={`font-semibold ${color}`}>{evt.type}</span>
                      <span className={`${t.textMuted} flex-1 truncate`}>
                        {evt.type === 'weather_picker_changed' && `Model=${evt.payload.model} Layers=${evt.payload.layers.join(',')}`}
                        {evt.type === 'tile_requested' && `Url=${evt.payload.url.substring(0, 60)}...`}
                        {evt.type === 'tile_loaded' && `Dur=${evt.payload.duration}ms Cache=${evt.payload.cacheStatus}`}
                        {evt.type === 'raster_decoded' && `Decoded in ${evt.payload.decodeMs}ms`}
                        {evt.type === 'tile_failed' && `Fail url=${evt.payload.url.substring(0, 60)}...`}
                        {evt.type === 'FPS_drop_detected' && `FPS dropped to ${evt.payload.currentFps}`}
                      </span>
                      <span className={`text-[9px] ${t.cardBg} border ${t.border} ${t.textSecondary} px-1 py-0.5 rounded font-mono select-all`}>{evt.correlationId}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Historical Failure Archive */}
          <div className={`${t.cardBgBorder} border rounded-xl p-5 shadow-xl`}>
            <div className={`flex justify-between items-center border-b ${t.borderLight} pb-3 mb-4`}>
              <span className={`text-[10px] font-bold ${t.textSecondary} uppercase tracking-widest flex items-center gap-1.5`}>
                <AlertTriangle className={`w-3.5 h-3.5 ${dangerText}`} />
                Historical Failure Knowledgebase
              </span>
              <span className={`text-[9px] ${t.textMuted} font-mono`}>Archived failures</span>
            </div>

            <div className="space-y-3 max-h-60 overflow-y-auto pr-2 scrollbar-thin">
              {report.recentFailures.length === 0 ? (
                <div className={`${t.textMuted} italic font-mono text-[11px] p-2`}>No rendering or decoding failures registered in this session. System stable.</div>
              ) : (
                report.recentFailures.map((fail: any) => (
                  <div key={fail.id} className={`${t.cellBg} border border-red-500/20 rounded-lg p-3 flex flex-col md:flex-row justify-between gap-3 text-xs`}>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-extrabold ${dangerText}`}>{fail.type.toUpperCase()}</span>
                        <span className={`text-[10px] ${t.textMuted}`}>{new Date(fail.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className={`text-[11px] ${t.textSecondary} leading-tight max-w-md truncate`}>
                        Target model: <span className={`${t.textPrimary} font-bold`}>{fail.model}</span>,
                        Active layers: <span className={`${t.textPrimary} font-bold`}>{fail.layers.join(',')}</span>
                        {fail.details?.url && `, URL: ${fail.details.url.substring(0, 50)}...`}
                      </p>
                      <div className={`flex gap-2 text-[9px] ${t.textMuted}`}>
                        <span>FPS: {fail.fps}</span>
                        <span>•</span>
                        <span>Memory: {fail.memory} MB</span>
                        <span>•</span>
                        <span className="font-mono">Correlation: {fail.correlationId}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleSandboxReplay(fail.id)}
                      className={`self-center md:self-auto ${t.cardBg} border ${t.border} ${t.textSecondary} font-bold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all shadow-lg shrink-0`}
                    >
                      <Play className="w-3 h-3 fill-current" />
                      Sandbox Replay
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

        {/* Column 3: Weather Data Topology Map and Sandbox Replay Controls */}
        <div className="space-y-6">
          
          {/* Topology Map */}
          <div className={`${t.cardBgBorder} border rounded-xl p-5 shadow-xl`}>
            <div className={`border-b ${t.borderLight} pb-3 mb-4`}>
              <span className={`text-[10px] font-bold ${t.textSecondary} uppercase tracking-widest flex items-center gap-1.5`}>
                <Network className={`w-3.5 h-3.5 ${accent}`} />
                Weather Data Topology
              </span>
            </div>

            <div className="space-y-4 font-mono text-[10px] leading-tight select-none">

              <div className={`${t.cellBg} border ${t.border} rounded-lg p-3 space-y-2`}>
                <div className={`${t.textMuted} uppercase font-extrabold text-[9px]`}>A. Data Sources</div>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className={t.textSecondary}>GFS Atmospheric:</span>
                    <span className={`${accent} font-semibold truncate max-w-[120px]`} title={report.topology.sources.GFS}>{report.topology.sources.GFS.substring(30)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={t.textSecondary}>GFS Waves (Global):</span>
                    <span className={`${accent} font-semibold truncate max-w-[120px]`}>{report.topology.sources.GFS_Wave.substring(30)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={t.textSecondary}>EURO (Limited Waves):</span>
                    <span className={`${accent} font-semibold truncate max-w-[120px]`}>{report.topology.sources.EURO_Wave.substring(30)}</span>
                  </div>
                </div>
              </div>

              <div className={`text-center ${t.textMuted} my-1 font-bold`}>↓</div>

              <div className={`${t.cellBg} border ${t.border} rounded-lg p-3 space-y-2`}>
                <div className={`${t.textMuted} uppercase font-extrabold text-[9px]`}>B. Layer Sync Registry</div>
                <div className={`space-y-1 ${t.textSecondary}`}>
                  <div className="flex justify-between">
                    <span>Active Model:</span>
                    <span className={`${purpleText} font-extrabold`}>{report.activeModel}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Active Stack:</span>
                    <span className={`${purpleText} font-extrabold`}>{report.activeLayers.join(', ') || 'None'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Scrubbing Offset:</span>
                    <span className={`${purpleText} font-extrabold`}>+{report.timeOffsetHours}h</span>
                  </div>
                </div>
              </div>

              <div className={`text-center ${t.textMuted} my-1 font-bold`}>↓</div>

              <div className={`${t.cellBg} border ${t.border} rounded-lg p-3 space-y-2`}>
                <div className={`${t.textMuted} uppercase font-extrabold text-[9px]`}>C. Render Engine Pipelines</div>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className={t.textSecondary}>Rain/Cloud/Press:</span>
                    <span className={`${successText} font-semibold`}>{report.topology.layers.rain.engine}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={t.textSecondary}>Wind Vector:</span>
                    <span className={`${successText} font-semibold`}>{report.topology.layers.wind.engine}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={t.textSecondary}>Wave Crests:</span>
                    <span className={`${successText} font-semibold`}>{report.topology.layers.waves.engine}</span>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* Sandbox Replay Control Panel */}
          <div className={`${t.cardBgBorder} border rounded-xl p-5 shadow-xl space-y-4`}>
            <div className={`flex justify-between items-center border-b ${t.borderLight} pb-3`}>
              <span className={`text-[10px] font-bold ${t.textSecondary} uppercase tracking-widest flex items-center gap-1.5`}>
                <Layers className={`w-3.5 h-3.5 ${accent}`} />
                Weather Sandbox
              </span>
              <span className={`text-[10px] ${dim ? 'bg-red-600/10 text-red-600' : 'bg-red-500/10 text-red-400'} px-2 py-0.5 rounded font-bold uppercase select-none`}>Mock Engine</span>
            </div>

            <div className="space-y-4 text-xs font-mono">
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px]">
                  <span className={`${t.textSecondary} font-bold`}>REPLAY TIMELINE OFFSET</span>
                  <span className={`${accent} font-extrabold`}>+{sandboxTimeOffset} Hours</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="120"
                  value={sandboxTimeOffset}
                  onChange={(e) => {
                    setSandboxTimeOffset(Number(e.target.value));
                    setSimulationLogs(prev => [...prev, `[SANDBOX] Playback offset set to +${e.target.value}h`]);
                  }}
                  className={`w-full h-1 ${t.cardBg} rounded-lg appearance-none cursor-pointer accent-cyan-400`}
                />
              </div>

              <div className={`${t.cellBg} border ${t.border} rounded-lg p-3.5 space-y-2 h-36 overflow-y-auto text-[10px] ${t.textSecondary} leading-normal scrollbar-thin`}>
                <div className={`text-[8px] font-bold ${t.textMuted} uppercase tracking-wider mb-1`}>Sandbox playback console</div>
                {simulationLogs.map((log, i) => (
                  <div key={i} className={log.includes('[REPLAY]') ? accent : log.includes('[SANDBOX]') ? warnText : t.textSecondary}>
                    <span className={`${t.textMuted} mr-1.5`}>&gt;&gt;</span>
                    {log}
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setSimulationLogs([
                      'Diagnostics interface active.',
                      'Telemetry hooks verified across Open-Meteo decoders.'
                    ]);
                    toast.success('Sandbox terminal cleared.');
                  }}
                  className={`flex-1 ${t.cardBg} border ${t.border} ${t.hoverBg} ${t.textSecondary} font-bold py-2 rounded-lg transition-all`}
                >
                  Reset Playback
                </button>
                <button
                  onClick={() => {
                    setSimulationLogs(prev => [...prev, `[SANDBOX] Dispatching simulated GRIB frame update...`]);
                    toast.success('Dispatched GRIB playback frame!');
                  }}
                  className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-extrabold py-2 rounded-lg transition-all shadow-lg shadow-cyan-500/10"
                >
                  Step Frame
                </button>
              </div>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
};

export default WeatherDiagnostics;
