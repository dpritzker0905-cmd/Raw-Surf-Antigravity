import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, Activity, Cpu, Server, Network, Terminal, RefreshCw, Play, 
  CheckCircle2, AlertTriangle, Layers, Clock, Database, HelpCircle
} from 'lucide-react';
import { WeatherTelemetry } from '../../components/map/WeatherTelemetry';
import apiClient from '../../lib/apiClient';
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

  return (
    <div className="bg-[#0f172a]/80 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl space-y-6">
      
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Activity className="w-5 h-5 text-cyan-400 animate-pulse" />
            Weather Intelligence Diagnostic Panel
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Real-time raster decoding logs, WebGL drawing metrics, and Open-Meteo tile telemetry.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={triggerManualRefresh}
            disabled={isRefreshing}
            className="bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 text-slate-300 font-extrabold text-xs px-3.5 py-2 rounded-lg flex items-center gap-2 transition-all disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
            Refresh Telemetry
          </button>
          
          <span className="text-[10px] bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 px-3 py-1 rounded-lg uppercase font-bold tracking-wider flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5" />
            Self-Diagnosing 2.0
          </span>
        </div>
      </div>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        
        {/* Metric 1: FPS */}
        <div className="bg-slate-950/40 border border-slate-850 rounded-lg p-4 flex items-center gap-4">
          <div className="p-2.5 rounded-lg bg-cyan-500/5 border border-cyan-500/10 text-cyan-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">WebGL Performance</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className={`text-lg font-extrabold font-mono ${report.gpuStats.fps > 45 ? 'text-emerald-400' : report.gpuStats.fps > 24 ? 'text-amber-400' : 'text-red-400'}`}>
                {report.gpuStats.fps}
              </span>
              <span className="text-[10px] text-slate-500">FPS</span>
            </div>
          </div>
        </div>

        {/* Metric 2: Tile Success Rate */}
        <div className="bg-slate-950/40 border border-slate-850 rounded-lg p-4 flex items-center gap-4">
          <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10 text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Tile Load Success</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-lg font-extrabold font-mono text-emerald-400">
                {report.tileStats.total > 0 ? Math.round((report.tileStats.loaded / report.tileStats.total) * 100) : 100}%
              </span>
              <span className="text-[9px] text-slate-500 font-mono">({report.tileStats.loaded}/{report.tileStats.total})</span>
            </div>
          </div>
        </div>

        {/* Metric 3: Cache Hit Rate */}
        <div className="bg-slate-950/40 border border-slate-850 rounded-lg p-4 flex items-center gap-4">
          <div className="p-2.5 rounded-lg bg-purple-500/5 border border-purple-500/10 text-purple-400">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Edge Cache Hit Rate</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-lg font-extrabold font-mono text-purple-400">{cacheHitRate}%</span>
              <span className="text-[10px] text-slate-500">of requests</span>
            </div>
          </div>
        </div>

        {/* Metric 4: Avg Decode Time */}
        <div className="bg-slate-950/40 border border-slate-850 rounded-lg p-4 flex items-center gap-4">
          <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/10 text-amber-400">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Raster Decode Duration</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-lg font-extrabold font-mono text-amber-400">{avgDecodeMs}</span>
              <span className="text-[10px] text-slate-500">ms / tile</span>
            </div>
          </div>
        </div>

      </div>

      {/* Data Pipeline Health — the decoupled cron's per-lane freshness (GET /api/health/data). */}
      <div className="bg-slate-950/40 border border-slate-850 rounded-xl p-5 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            Data Pipeline Health — cron freshness per model×domain
          </span>
          {pipelineHealth && (
            <span className={`text-[10px] px-2.5 py-1 rounded-lg uppercase font-bold tracking-wider border ${
              pipelineHealth.status === 'ok' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : pipelineHealth.status === 'warn' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
              {pipelineHealth.status}{pipelineHealth.freshest_run_age_h != null ? ` · freshest ${pipelineHealth.freshest_run_age_h}h` : ''}
            </span>
          )}
        </div>
        {!pipelineHealth ? (
          <div className="text-slate-600 italic text-[11px]">{healthLoading ? 'Loading pipeline health…' : 'No health data.'}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {Object.entries(pipelineHealth.lanes || {}).map(([lane, info]: [string, any]) => {
                const v = info.verdict;
                const border = v === 'ok' ? 'border-emerald-500/20' : v === 'warn' ? 'border-amber-500/20' : 'border-red-500/20';
                const text = v === 'ok' ? 'text-emerald-400' : v === 'warn' ? 'text-amber-400' : 'text-red-400';
                return (
                  <div key={lane} className={`bg-slate-950/60 border rounded-lg px-3 py-2 ${border}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-200 font-mono">{lane}</span>
                      <span className={`text-[9px] uppercase font-bold ${text}`}>{v}</span>
                    </div>
                    <div className="text-[9px] text-slate-500 font-mono mt-0.5">
                      {info.reason === 'missing' ? 'MISSING' : `age ${info.age_h}h${info.horizon_h != null ? ` · +${Math.round(info.horizon_h)}h` : ''}`}
                    </div>
                  </div>
                );
              })}
            </div>
            {pipelineHealth.alerts && pipelineHealth.alerts.length > 0 && (
              <div className="mt-3 space-y-1">
                {pipelineHealth.alerts.map((a: string, i: number) => (
                  <div key={i} className="text-[10px] text-amber-400/90 font-mono flex items-start gap-1.5">
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
          <div className="bg-slate-950 border border-slate-900 rounded-xl p-5 shadow-xl">
            <div className="flex justify-between items-center border-b border-slate-900 pb-3 mb-4">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                Live Telemetry Log
              </span>
              <span className="text-[9px] text-slate-500 font-mono">Real-time trace listener</span>
            </div>

            <div className="h-64 overflow-y-auto space-y-2 font-mono text-[11px] leading-relaxed pr-2 scrollbar-thin scrollbar-track-slate-950 scrollbar-thumb-slate-850">
              {report.recentEvents.length === 0 ? (
                <div className="text-slate-600 italic">Waiting for weather simulation map rendering actions... Toggle the weather controls layer to emit events.</div>
              ) : (
                report.recentEvents.map((evt: any) => {
                  let color = 'text-slate-400';
                  if (evt.type.includes('fail') || evt.type.includes('drop')) color = 'text-red-400 font-bold';
                  else if (evt.type.includes('loaded')) color = 'text-emerald-400';
                  else if (evt.type.includes('picker')) color = 'text-purple-400 font-bold';
                  else if (evt.type.includes('decoded')) color = 'text-cyan-400';

                  return (
                    <div key={evt.id} className="border-b border-slate-900/40 pb-1 flex items-start gap-2">
                      <span className="text-slate-600 select-none text-[10px]">{new Date(evt.timestamp).toLocaleTimeString()}</span>
                      <span className={`font-semibold ${color}`}>{evt.type}</span>
                      <span className="text-slate-500 flex-1 truncate">
                        {evt.type === 'weather_picker_changed' && `Model=${evt.payload.model} Layers=${evt.payload.layers.join(',')}`}
                        {evt.type === 'tile_requested' && `Url=${evt.payload.url.substring(0, 60)}...`}
                        {evt.type === 'tile_loaded' && `Dur=${evt.payload.duration}ms Cache=${evt.payload.cacheStatus}`}
                        {evt.type === 'raster_decoded' && `Decoded in ${evt.payload.decodeMs}ms`}
                        {evt.type === 'tile_failed' && `Fail url=${evt.payload.url.substring(0, 60)}...`}
                        {evt.type === 'FPS_drop_detected' && `FPS dropped to ${evt.payload.currentFps}`}
                      </span>
                      <span className="text-[9px] bg-slate-900 border border-slate-800 text-slate-400 px-1 py-0.5 rounded font-mono select-all">{evt.correlationId}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Historical Failure Archive */}
          <div className="bg-slate-950 border border-slate-900 rounded-xl p-5 shadow-xl">
            <div className="flex justify-between items-center border-b border-slate-900 pb-3 mb-4">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                Historical Failure Knowledgebase
              </span>
              <span className="text-[9px] text-slate-500 font-mono">Archived failures</span>
            </div>

            <div className="space-y-3 max-h-60 overflow-y-auto pr-2 scrollbar-thin">
              {report.recentFailures.length === 0 ? (
                <div className="text-slate-600 italic font-mono text-[11px] p-2">No rendering or decoding failures registered in this session. System stable.</div>
              ) : (
                report.recentFailures.map((fail: any) => (
                  <div key={fail.id} className="bg-[#020617] border border-red-500/20 rounded-lg p-3 flex flex-col md:flex-row justify-between gap-3 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-red-400">{fail.type.toUpperCase()}</span>
                        <span className="text-[10px] text-slate-500">{new Date(fail.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-tight max-w-md truncate">
                        Target model: <span className="text-slate-200 font-bold">{fail.model}</span>, 
                        Active layers: <span className="text-slate-200 font-bold">{fail.layers.join(',')}</span>
                        {fail.details?.url && `, URL: ${fail.details.url.substring(0, 50)}...`}
                      </p>
                      <div className="flex gap-2 text-[9px] text-slate-500">
                        <span>FPS: {fail.fps}</span>
                        <span>•</span>
                        <span>Memory: {fail.memory} MB</span>
                        <span>•</span>
                        <span className="font-mono">Correlation: {fail.correlationId}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleSandboxReplay(fail.id)}
                      className="self-center md:self-auto bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 font-bold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all shadow-lg hover:shadow-cyan-500/5 shrink-0"
                    >
                      <Play className="w-3 h-3 fill-slate-300" />
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
          <div className="bg-slate-950 border border-slate-900 rounded-xl p-5 shadow-xl">
            <div className="border-b border-slate-900 pb-3 mb-4">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <Network className="w-3.5 h-3.5 text-cyan-400" />
                Weather Data Topology
              </span>
            </div>

            <div className="space-y-4 font-mono text-[10px] leading-tight select-none">
              
              <div className="bg-[#020617] border border-slate-900 rounded-lg p-3 space-y-2">
                <div className="text-slate-500 uppercase font-extrabold text-[9px]">A. Data Sources</div>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400">GFS Atmospheric:</span>
                    <span className="text-cyan-400 font-semibold truncate max-w-[120px]" title={report.topology.sources.GFS}>{report.topology.sources.GFS.substring(30)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">GFS Waves (Global):</span>
                    <span className="text-cyan-400 font-semibold truncate max-w-[120px]">{report.topology.sources.GFS_Wave.substring(30)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">EURO (Limited Waves):</span>
                    <span className="text-cyan-400 font-semibold truncate max-w-[120px]">{report.topology.sources.EURO_Wave.substring(30)}</span>
                  </div>
                </div>
              </div>

              <div className="text-center text-slate-650 my-1 font-bold">↓</div>

              <div className="bg-[#020617] border border-slate-900 rounded-lg p-3 space-y-2">
                <div className="text-slate-500 uppercase font-extrabold text-[9px]">B. Layer Sync Registry</div>
                <div className="space-y-1 text-slate-400">
                  <div className="flex justify-between">
                    <span>Active Model:</span>
                    <span className="text-purple-400 font-extrabold">{report.activeModel}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Active Stack:</span>
                    <span className="text-purple-400 font-extrabold">{report.activeLayers.join(', ') || 'None'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Scrubbing Offset:</span>
                    <span className="text-purple-400 font-extrabold">+{report.timeOffsetHours}h</span>
                  </div>
                </div>
              </div>

              <div className="text-center text-slate-650 my-1 font-bold">↓</div>

              <div className="bg-[#020617] border border-slate-900 rounded-lg p-3 space-y-2">
                <div className="text-slate-500 uppercase font-extrabold text-[9px]">C. Render Engine Pipelines</div>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Rain/Cloud/Press:</span>
                    <span className="text-emerald-400 font-semibold">{report.topology.layers.rain.engine}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Wind Vector:</span>
                    <span className="text-emerald-400 font-semibold">{report.topology.layers.wind.engine}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Wave Crests:</span>
                    <span className="text-emerald-400 font-semibold">{report.topology.layers.waves.engine}</span>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* Sandbox Replay Control Panel */}
          <div className="bg-slate-950 border border-slate-900 rounded-xl p-5 shadow-xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-900 pb-3">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                Weather Sandbox Sandbox
              </span>
              <span className="text-[10px] bg-red-500/10 text-red-400 px-2 py-0.5 rounded font-bold uppercase select-none">Mock Engine</span>
            </div>

            <div className="space-y-4 text-xs font-mono">
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-400 font-bold">REPLAY TIMELINE OFFSET</span>
                  <span className="text-cyan-400 font-extrabold">+{sandboxTimeOffset} Hours</span>
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
                  className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
              </div>

              <div className="bg-[#020617] border border-slate-900 rounded-lg p-3.5 space-y-2 h-36 overflow-y-auto text-[10px] text-slate-450 leading-normal scrollbar-thin">
                <div className="text-[8px] font-bold text-slate-500 uppercase tracking-wider mb-1">Sandbox playback console</div>
                {simulationLogs.map((log, i) => (
                  <div key={i} className={log.includes('[REPLAY]') ? 'text-cyan-400' : log.includes('[SANDBOX]') ? 'text-amber-400' : 'text-slate-400'}>
                    <span className="text-slate-600 mr-1.5">&gt;&gt;</span>
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
                  className="flex-1 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 font-bold py-2 rounded-lg transition-all"
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
