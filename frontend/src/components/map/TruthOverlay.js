import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LAYER_REGISTRY } from './LayerRegistry';
import { WeatherTelemetry } from './WeatherTelemetry';
import { API_BASE } from '../../lib/apiClient';
import { BUILD_VERSION } from '../../buildVersion';
import { TruthOverlayVisualTab } from './TruthOverlayVisualTab';
import { TruthOverlayGpuTab } from './TruthOverlayGpuTab';
import { resolveTruthVerdict } from './truthVerdict';

// PROD GATE (2026-07-19). This HUD was mounted UNCONDITIONALLY by MapWebGL — a 360px dark
// diagnostics panel fixed bottom-left over the live map for EVERY production user (nearly
// full-width on a 390px phone). Same dev-chrome class as MarineAnimTuner, which has carried a
// prod gate all along; this component simply never got one. Contract mirrors
// MarineAnimTuner.isEnabled exactly: '0' suppresses everywhere (the pixel-probe scripts set it —
// a HUD inside the screenshot crop biases every contrast/density metric), ?diag=1 or
// localStorage '1' enables anywhere, dev hosts stay default-ON, production is OFF, and any
// storage failure fails CLOSED. Only the RENDER is gated — the truth-violation POST effect keeps
// running in production because /api/weather/client-diagnostics is a real, tested backend route.
export function isDiagHudEnabled(win) {
  if (!win) return false;
  try {
    if (win.localStorage.getItem('__RAW_DIAG__') === '0') return false;
    if (new URLSearchParams(win.location.search).get('diag') === '1') return true;
    if (win.localStorage.getItem('__RAW_DIAG__') === '1') return true;
    const h = win.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0';
  } catch (e) { return false; }
}

const getLayerTruth = (id, visible, wind, marine) => {
  const l = LAYER_REGISTRY[id];
  return !l ? "OFF" : l.type === "raster" ? (visible ? "LOADED" : "LOADING")
    : l.type === "particle" ? (wind?.vectors?.length ? "LOADED" : "LOADING")
    : l.type === "marine" ? (marine?.grid?.vectors?.length ? "LOADED" : "LOADING") : "OFF";
};

/**
 * TruthOverlay: Redesigned into the Unified Diagnostics HUD.
 * Integrates the Truth Inspector, Events Trace, Visual Debug Overlay, and GPU/FCE Telemetry HUD.
 */
var TruthOverlay = ({
  activeLayers,
  activeRenderType,
  marineData,
  windData,
  truthIssues,
  rasterVisible,
  activeModel = 'GFS',
  timeOffsetHours = 0,
  simulationField = null,
  renderPlan = null,
  simFrameIndex = 0,
  isTransitioning = false
}) => {
  const [minimized, setMinimized] = useState(false);
  const [activeTab, setActiveTab] = useState('health'); // 'health', 'events', 'visual', 'gpu'
  const [combo, setCombo] = useState('');
  const [activeDiagnostic, setActiveDiagnostic] = useState(null);
  const [stackInfo, setStackInfo] = useState([]);
  const [ticks, setTicks] = useState(0);

  // Stats calculation
  const windVectorCount = windData?.vectors?.length || 0;
  const marineVectorCount = marineData?.grid?.vectors?.length || 0;
  const activeLayer = activeLayers?.[0] || 'none';

  // Live telemetry ticking loop (updates at 0.5Hz — only when GPU tab is active and not minimized)
  useEffect(() => {
    if (minimized || activeTab !== 'gpu') return;
    const interval = setInterval(() => {
      setTicks(t => t + 1);
    }, 2000);
    return () => clearInterval(interval);
  }, [minimized, activeTab]);

  // Subscribe to WeatherTelemetry for live events trace
  const [events, setEvents] = useState(() => {
    return WeatherTelemetry.logs.slice(0, 20);
  });

  useEffect(() => {
    const unsubscribe = WeatherTelemetry.subscribe((evt) => {
      setEvents(prev => {
        const next = [evt, ...prev];
        if (next.length > 20) {
          next.pop();
        }
        return next;
      });
    });
    return () => unsubscribe();
  }, []);

  // Reset/initialize GPU debug mode on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (!window.__GPU_DEBUG__) {
        window.__GPU_DEBUG__ = { mode: null };
      } else {
        window.__GPU_DEBUG__.mode = null;
      }
    }
  }, []);

  // Throttled truth violation reporting to backend diagnostics route
  const lastReportedRef = useRef({});

  useEffect(() => {
    if (!truthIssues || truthIssues.length === 0) return;
    
    const now = Date.now();
    truthIssues.forEach(issue => {
      const key = `${issue.type}:${issue.layerId}`;
      const lastReported = lastReportedRef.current[key] || 0;
      
      // Throttle reporting to once per 60 seconds per violation type
      if (now - lastReported > 60000) {
        lastReportedRef.current[key] = now;
        
        const payload = {
          timestamp: new Date().toISOString(),
          event_type: `TRUTH_VIOLATION_${issue.type}`,
          model: activeModel,
          layer: activeLayers?.[0] || 'none',
          timeOffset: timeOffsetHours,
          fps: typeof window !== 'undefined' ? window.__WEATHER_TELEMETRY__?.gpuStats?.fps || 60 : 60,
          memory: typeof window !== 'undefined' ? Math.round((window.__RAW_GPU__?.gpuMemoryEstimate || 0) / (1024 * 1024)) : 0,
          correlationId: issue.correlationId || 'none',
          details: {
            hint: issue.hint,
            sources: issue.sources || null,
            cols: issue.cols || null,
            rows: issue.rows || null,
            // R11-03: the ONLY telemetry that leaves the device was release-anonymous — a
            // server-side TRUTH_VIOLATION record could not distinguish a HEAD defect from a
            // stale bundle. Rides `details` so the backend schema needs no change.
            build: BUILD_VERSION
          }
        };
        
        fetch(`${API_BASE}/weather/client-diagnostics`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }).catch(err => {
          // Silent catch to prevent UI disruptions
        });
      }
    });
  }, [truthIssues, activeModel, activeLayers, timeOffsetHours]);

  const clearCombo = () => {
    setCombo('');
    setActiveDiagnostic(null);
    if (typeof window !== 'undefined') {
      window.__DIAGNOSTIC_THEME__ = undefined;
      if (window.__GPU_DEBUG__) {
        window.__GPU_DEBUG__.mode = null;
      }
      if (window.map) window.map.triggerRepaint();
    }
  };

  const processCombo = (code) => {
    if (code === '1-0-1' || code === '101') {
      setDebugMode('mask', '1-0-1');
    } else if (code === '1-0-2' || code === '102') {
      setDebugMode('uv', '1-0-2');
    } else if (code === '1-0-3' || code === '103') {
      setDebugMode('grid', '1-0-3');
    } else if (code === '1-0-4' || code === '104') {
      setDebugMode('mercator', '1-0-4');
    } else if (code === '0-0-0' || code === '000') {
      setDebugMode(null, '0-0-0');
    } else if (code === '2-0-2' || code === '202') {
      setActiveDiagnostic('2-0-2');
      if (typeof window !== 'undefined' && window.map) {
        try {
          const layers = window.map.getStyle().layers || [];
          const important = layers.map((l, idx) => ({ id: l.id, idx, type: l.type }))
            .filter(l => l.id.startsWith('ocean-mask') || l.id.includes('marine') || l.id === 'water' || l.id === 'landuse' || l.id === 'national-park');
          setStackInfo(important);
        } catch (e) {
          setStackInfo([{ id: 'Error reading stack', idx: 0 }]);
        }
      }
    } else if (code === '3-0-3' || code === '303') {
      setActiveTab('gpu');
      setActiveDiagnostic('3-0-3');
    } else if (code === '4-0-1' || code === '401') {
      setDebugMode('part_uv', '4-0-1');
    } else if (code === '4-0-2' || code === '402') {
      setDebugMode('part_pos', '4-0-2');
    } else if (code === '4-0-3' || code === '403') {
      setDebugMode('part_offset', '4-0-3');
    } else if (code === '4-0-4' || code === '404') {
      setDebugMode('part_fbo', '4-0-4');
    } else {
      setActiveDiagnostic('invalid');
      setTimeout(() => {
        setCombo('');
        setActiveDiagnostic(null);
      }, 1000);
    }
  };

  const handleKeyClick = (num) => {
    if (combo.length < 3) {
      const nextCombo = combo + num;
      setCombo(nextCombo);
      if (nextCombo.length === 3) {
        processCombo(nextCombo);
      }
    }
  };

  const setDebugMode = (mode, diagnosticId = null) => {
    setActiveDiagnostic(diagnosticId);
    if (typeof window !== 'undefined') {
      if (!window.__GPU_DEBUG__) window.__GPU_DEBUG__ = { mode: null };
      window.__GPU_DEBUG__.mode = mode;
      if (window.map) window.map.triggerRepaint();
    }
  };

  // Determine current active debug mode from window
  const currentDebugMode = typeof window !== 'undefined' ? window.__GPU_DEBUG__?.mode : null;

  // Grid details for provenance display
  const isEstimated = marineData?.grid?.isEstimated || marineData?.grid?.is_estimated;
  const gridProvider = marineData?.grid?.provider || marineData?.grid?.__gridProvider || 'unknown';

  // ⛔ ONE-BIT AUTHORITY (fixed 2026-08-11, certification audit 11.2 / RC-01).
  // The Class row rendered `isEstimated ? 'ESTIMATED FALLBACK' : 'AUTHORITATIVE NATIVE'` — a binary
  // on one flag. `marineData?.grid?.isEstimated` yields `undefined` when there is NO grid at all,
  // and `undefined` is falsy, so the ABSENCE of data took the most confident branch. Measured live
  // on production at e015d90b with every /api/weather/* request rejected: productId null, nothing
  // ever fetched, badge green "AUTHORITATIVE NATIVE", HUD reporting zero truth violations. The same
  // green badge was shown for a 10 deg resample of a 0.25 deg native dataset (ncep_gfswave025) and
  // during a cross-model `gfs_estimated_fallback`.
  // ★ "NATIVE" is a claim about RESOLUTION. It cannot be derived from a boolean, and the absent
  //   case must never be the confident case.
  const __projDiag = typeof window !== 'undefined' ? window.__MARINE_PROJECTION_DIAG__ : null;
  const __windData = typeof window !== 'undefined' ? window.__MARINE_WIND_DATA__ : null;
  const __countOf = (o) => (Array.isArray(o?.vectors) ? o.vectors.length : null);
  // Prefer the grid this overlay was handed; fall back to the live field the engine is drawing.
  const gridVectorCount = __countOf(marineData?.grid) ?? __countOf(__windData);
  const productIdForClass = marineData?.grid?.productId || __projDiag?.productId || null;
  const resolutionDeg = marineData?.grid?.resolution ?? __projDiag?.resolution ?? null;
  const isSubstituted = /fallback|blend|estimated/.test(String(gridProvider).toLowerCase());

  // ⛔ "NO VIOLATIONS DETECTED" WAS NOT A RESULT (fixed 2026-08-11, audit 11.2 / RC-02).
  // The green ✓ below rendered whenever `truthIssues` was empty — but the parity gate that is
  // supposed to POPULATE it returned `match: true` whenever nothing was comparable, so an empty
  // list meant "nothing was checked" just as often as "everything passed". Measured on production
  // during a total data-load failure: parity UNSAMPLED, productId null, HUD still green ✓.
  // ★ "I detected no violations" and "I could not look" must not share a pixel.
  const __parity = typeof window !== 'undefined' ? window.__MARINE_SOURCE_PARITY__ : null;
  // Only a genuine refusal earns the amber badge. NOT_APPLICABLE (no point selected) is the normal
  // resting state — it is qualified on the green row instead, so the row never implies that
  // heatmap-vs-infobox parity was actually verified when it could not have been.
  // ⛔ The branch set below used to be computed inline here, and named only UNSAMPLED and
  // NOT_APPLICABLE — so MISMATCH (a REAL disagreement) and a missing instrument both fell through
  // to green. `resolveTruthVerdict` is now the single decision, exhaustive over the status set.
  const __verdict = resolveTruthVerdict(truthIssues, __parity, typeof window !== 'undefined' ? window : {});
  const parityUnverified = __verdict.kind === 'unverified';
  const parityUnverifiedWhy = (__verdict.parityReasons || []).join(' · ');
  const parityNotApplicable = __verdict.notApplicable;
  // ★ Two DIFFERENT absences, and conflating them would just relabel the same lie:
  //   - nothing rendered at all            => NO DATA
  //   - something rendered, provenance lost => UNVERIFIED SOURCE (never "authoritative")
  const provenanceClass = (!gridVectorCount)
    ? { label: 'NO DATA', color: '#ef4444' }
    : !productIdForClass
      ? { label: 'UNVERIFIED SOURCE', color: '#fbbf24' }
      : isEstimated
        ? { label: 'ESTIMATED FALLBACK', color: '#fbbf24' }
        : isSubstituted
          ? { label: 'SUBSTITUTED SOURCE', color: '#fbbf24' }
          : resolutionDeg == null
            ? { label: 'RESOLUTION UNKNOWN', color: '#fbbf24' }
            : resolutionDeg > 0.5
              ? { label: `COARSE ${resolutionDeg}° GRID`, color: '#fbbf24' }
              : { label: 'AUTHORITATIVE NATIVE', color: '#10b981' };
  // Map the data's source_dataset to its basic origin name so the HUD shows where the data ACTUALLY came
  // from (NOAA / DWD / Copernicus / ECMWF) instead of the 'open-meteo' capabilities-contract channel key.
  const __basicSourceName = (sd) => {
    if (!sd) return null;
    const s = String(sd).toLowerCase();
    if (s.includes('gfs') || s.startsWith('ncep')) return 'NOAA';
    if (s.includes('gwam') || s.includes('dwd')) return 'DWD';
    if (s.includes('copernicus') || s.includes('cmems')) return 'Copernicus';
    if (s.includes('ecmwf')) return 'ECMWF';
    if (s.includes('open') && s.includes('meteo')) return 'Open-Meteo';
    return null;
  };
  const gridSourceDataset = marineData?.grid?.__sourceDataset || marineData?.grid?.sourceDataset || null;
  const displayProvider = __basicSourceName(gridSourceDataset) || gridProvider;
  const showExtendedWarning = activeModel === 'EURO' && timeOffsetHours > 240;

  // GPU metrics from window
  const gpuTexturesCount = typeof window !== 'undefined' ? window.__RAW_GPU__?.textureCount : 0;
  const gpuUploadsCount = typeof window !== 'undefined' ? window.__RAW_GPU__?.textureUploadCount : 0;
  const gpuMemoryBytes = typeof window !== 'undefined' ? window.__RAW_GPU__?.gpuMemoryEstimate : 0;
  const gpuFps = typeof window !== 'undefined' ? window.__WEATHER_TELEMETRY__?.gpuStats?.fps : null;
  const gpuDroppedFrames = typeof window !== 'undefined' ? window.__RAW_GPU__?.droppedFrameCounter : 0;
  const fboStatus = typeof window !== 'undefined' ? window.__RAW_GPU__?.advFboStatus : null;

  // Evolution mode: prefer the live prop, fall back to the sampled window value
  // (in normal forecast-authoritative mode the per-frame renderPlan is not published
  //  to React — the bridge keeps the latest sample on window.__SIM_EVOLUTION__).
  const evolutionMode = renderPlan?.evolution?.mode
    || (typeof window !== 'undefined' ? window.__SIM_EVOLUTION__?.mode : null);
  // Live frame counter with the same window fallback.
  const liveSimFrame = simFrameIndex || (typeof window !== 'undefined' ? (window.__SIM_FRAME__ || 0) : 0);

  // Render gate — AFTER every hook (rules of hooks), so the telemetry/report effects above keep
  // running for production users while the panel itself never mounts for them.
  if (!isDiagHudEnabled(typeof window !== 'undefined' ? window : null)) return null;

  return (
    <div style={{
      position: 'absolute', bottom: '16px', left: '16px', zIndex: 100,
      fontFamily: '"Outfit", "Inter", -apple-system, sans-serif', color: '#f8fafc',
      background: 'rgba(10, 10, 26, 0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '16px',
      boxShadow: '0 20px 50px 0 rgba(0, 0, 0, 0.55)', width: minimized ? '220px' : '360px',
      padding: '16px', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      userSelect: 'none', pointerEvents: 'auto'
    }}>
      {/* HUD Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: minimized ? 'none' : '1px solid rgba(255, 255, 255, 0.12)',
        paddingBottom: minimized ? '0' : '8px',
        marginBottom: minimized ? '0' : '8px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            // Same verdict as the Truth Violations row — the header dot must not read green while
            // the row below it says NOT VERIFIED or reports a parity mismatch.
            background: __verdict.kind === 'violations' ? '#ef4444'
              : (__verdict.kind === 'unverified' || isTransitioning) ? '#fbbf24' : '#10b981',
            boxShadow: __verdict.kind === 'violations'
              ? '0 0 12px #ef4444, 0 0 4px #ef4444'
              : (__verdict.kind === 'unverified' || isTransitioning) ? '0 0 12px #fbbf24, 0 0 4px #fbbf24' : '0 0 12px #10b981, 0 0 4px #10b981',
            animation: 'pulse 1.5s infinite ease-in-out'
          }} />
          <span style={{
            fontSize: '12px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
            background: 'linear-gradient(135deg, #00f0ff, #0072ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
          }}>
            Diagnostics HUD
          </span>
        </div>
        <button
          onClick={() => setMinimized(!minimized)}
          style={{
            background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '6px', color: '#94a3b8',
            cursor: 'pointer', fontSize: '10px', padding: '3px 8px', fontWeight: 600, transition: 'all 0.2s', outline: 'none'
          }}
          onMouseEnter={(e) => e.target.style.background = 'rgba(255,255,255,0.12)'}
          onMouseLeave={(e) => e.target.style.background = 'rgba(255,255,255,0.06)'}
        >
          {minimized ? 'Expand' : 'Collapse'}
        </button>
      </div>

      {!minimized && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Tab Selection Row */}
          <div style={{
            display: 'flex',
            gap: '2px',
            background: 'rgba(0, 0, 0, 0.2)',
            borderRadius: '8px',
            padding: '2px',
            border: '1px solid rgba(255, 255, 255, 0.05)'
          }}>
            {[
              { id: 'health', label: 'Health' },
              { id: 'events', label: 'Events' },
              { id: 'visual', label: 'Visual' },
              { id: 'gpu', label: 'GPU/FCE' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1,
                  background: activeTab === tab.id ? 'rgba(0, 240, 255, 0.15)' : 'transparent',
                  border: 'none',
                  borderRadius: '6px',
                  color: activeTab === tab.id ? '#00f0ff' : '#94a3b8',
                  fontSize: '9px',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  padding: '4px 0',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  outline: 'none'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* TAB 1: HEALTH & TRUTH (Truth Inspector) */}
          {activeTab === 'health' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '11px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8' }}>Model / Layer:</span>
                <span style={{ fontWeight: 700, color: '#00f0ff' }}>
                  {activeModel} / {activeLayer}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8' }}>Render Mode:</span>
                <span style={{ fontWeight: 600, textTransform: 'capitalize', color: '#e2e8f0' }}>{activeRenderType}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8' }}>Raster Source:</span>
                <span style={{
                  fontWeight: 600,
                  color: getLayerTruth(activeLayer, rasterVisible, windData, marineData) === 'LOADED' ? '#10b981' : 
                         getLayerTruth(activeLayer, rasterVisible, windData, marineData) === 'LOADING' ? '#fbbf24' : '#64748b'
                }}>
                  {getLayerTruth(activeLayer, rasterVisible, windData, marineData)}
                </span>
              </div>

              {/* Grid Provenance */}
              <div style={{
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '8px',
                padding: '8px 10px',
                border: '1px solid rgba(255,255,255,0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px'
              }}>
                <div style={{ fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>
                  Grid Provenance
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>Provider:</span>
                  <span style={{ fontWeight: 600, color: '#f8fafc', textTransform: 'uppercase' }}>
                    {displayProvider}
                  </span>
                </div>
                {gridSourceDataset && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8' }}>Source:</span>
                    <span style={{ fontWeight: 500, color: '#cbd5e1' }}>
                      {gridSourceDataset}
                    </span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>Class:</span>
                  <span style={{
                    fontWeight: 700,
                    color: provenanceClass.color
                  }}>
                    {provenanceClass.label}
                  </span>
                </div>
                
                {showExtendedWarning && (
                  <div style={{
                    marginTop: '4px',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.25)',
                    color: '#f59e0b',
                    fontSize: '9px',
                    fontWeight: 600,
                    lineHeight: 1.2
                  }}>
                    ⚠️ Copernicus native ends at +240h. Extended GFS/ICON trend-blend estimate is currently active.
                  </div>
                )}
              </div>

              {/* Hard Truth Violations section */}
              <div style={{ marginTop: '2px' }}>
                <div style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: '#64748b',
                  letterSpacing: '0.05em',
                  marginBottom: '4px'
                }}>
                  Truth Violations
                </div>

                {/* ⛔ This used to branch on `truthIssues.length` alone, so a parity MISMATCH —
                    found by a DIFFERENT validator, and therefore leaving this list empty — rendered
                    the green ✓. The branch is now the verdict itself, which is exhaustive. */}
                {__verdict.kind === 'violations' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {__verdict.issues.map((v, i) => (
                      <div
                        key={i}
                        style={{
                          background: 'rgba(239, 68, 68, 0.06)',
                          border: '1px solid rgba(239, 68, 68, 0.18)',
                          borderRadius: '8px',
                          padding: '6px 10px',
                          color: '#fca5a5'
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', marginBottom: '2px' }}>
                          ⚠️ {v.type}
                        </div>
                        <div style={{ lineHeight: 1.2, fontSize: '10px' }}>{v.hint}</div>
                      </div>
                    ))}
                    {(__verdict.parityReasons || []).map((reason, i) => (
                      <div
                        key={`parity-${i}`}
                        style={{
                          background: 'rgba(239, 68, 68, 0.06)',
                          border: '1px solid rgba(239, 68, 68, 0.18)',
                          borderRadius: '8px',
                          padding: '6px 10px',
                          color: '#fca5a5'
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', marginBottom: '2px' }}>
                          ⚠️ source-parity-mismatch
                        </div>
                        <div style={{ lineHeight: 1.2, fontSize: '10px' }}>{reason}</div>
                      </div>
                    ))}
                  </div>
                ) : parityUnverified ? (
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '6px',
                    background: 'rgba(251, 191, 36, 0.06)',
                    border: '1px solid rgba(251, 191, 36, 0.16)',
                    borderRadius: '8px',
                    padding: '6px 10px',
                    color: '#fde68a'
                  }}>
                    <span style={{ fontSize: '12px', color: '#fbbf24', fontWeight: 'bold' }}>?</span>
                    <span>
                      NOT VERIFIED — source parity not established
                      {parityUnverifiedWhy ? ` (${parityUnverifiedWhy})` : ''}
                    </span>
                  </div>
                ) : (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'rgba(16, 185, 129, 0.06)',
                    border: '1px solid rgba(16, 185, 129, 0.12)',
                    borderRadius: '8px',
                    padding: '6px 10px',
                    color: '#a7f3d0'
                  }}>
                    <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 'bold' }}>✓</span>
                    <span>
                      No Causal Layer Violations Detected
                      {parityNotApplicable && (
                        <span style={{ color: '#94a3b8' }}> · source parity n/a (no point selected)</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: EVENTS TRACE (Live feed from WeatherTelemetry) */}
          {activeTab === 'events' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{
                fontSize: '9px',
                fontWeight: 700,
                textTransform: 'uppercase',
                color: '#64748b',
                letterSpacing: '0.05em',
                marginBottom: '2px'
              }}>
                Live Weather Events Trace
              </div>
              
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                maxHeight: '200px',
                overflowY: 'auto',
                paddingRight: '4px'
              }}>
                {events.length === 0 ? (
                  <div style={{ color: '#64748b', fontSize: '10px', textAlign: 'center', padding: '20px 0' }}>
                    Waiting for weather events...
                  </div>
                ) : (
                  events.map((evt) => {
                    let badgeColor = '#38bdf8'; // Default blue (request/info)
                    if (evt.type.includes('fail') || evt.type.includes('error') || evt.type.includes('lost') || evt.type.includes('drop')) {
                      badgeColor = '#f43f5e'; // red (error)
                    } else if (evt.type.includes('warn') || evt.type.includes('fallback') || evt.type.includes('stale') || evt.type.includes('mismatch')) {
                      badgeColor = '#fbbf24'; // yellow (warning)
                    } else if (evt.type.includes('loaded') || evt.type.includes('success') || evt.type.includes('restored')) {
                      badgeColor = '#34d399'; // green (success)
                    }

                    const timeStr = new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    const isFailure = badgeColor === '#f43f5e';

                    return (
                      <div key={evt.id} style={{
                        background: isFailure ? 'rgba(244, 63, 94, 0.05)' : 'rgba(255, 255, 255, 0.02)',
                        border: isFailure ? '1px solid rgba(244, 63, 94, 0.15)' : '1px solid rgba(255, 255, 255, 0.05)',
                        borderRadius: '6px',
                        padding: '6px 8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '9px' }}>
                          <span style={{ fontWeight: 'bold', color: badgeColor, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                            {evt.type}
                          </span>
                          <span style={{ color: '#64748b', fontFamily: 'monospace' }}>{timeStr}</span>
                        </div>
                        <div style={{ color: '#cbd5e1', fontSize: '10px', lineHeight: 1.25 }}>
                          {evt.payload?.message || evt.payload?.error || `Processed ${evt.model || activeModel} slice at offset +${evt.timeOffset || 0}h`}
                        </div>
                        {evt.correlationId && (
                          <div style={{ color: '#475569', fontSize: '8px', fontFamily: 'monospace', marginTop: '1px' }}>
                            Trace: {evt.correlationId}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 3: VISUAL DEBUG (Shader debug layers and Keypad) */}
          {activeTab === 'visual' && (
            <TruthOverlayVisualTab
              combo={combo}
              activeDiagnostic={activeDiagnostic}
              currentDebugMode={currentDebugMode}
              stackInfo={stackInfo}
              handleKeyClick={handleKeyClick}
              clearCombo={clearCombo}
              setDebugMode={setDebugMode}
            />
          )}

          {/* TAB 4: GPU & FCE TELEMETRY */}
          {activeTab === 'gpu' && (
            <TruthOverlayGpuTab
              gpuFps={gpuFps}
              gpuMemoryBytes={gpuMemoryBytes}
              gpuTexturesCount={gpuTexturesCount}
              gpuUploadsCount={gpuUploadsCount}
              gpuDroppedFrames={gpuDroppedFrames}
              fboStatus={fboStatus}
              simulationField={simulationField}
              liveSimFrame={liveSimFrame}
              evolutionMode={evolutionMode}
              windVectorCount={windVectorCount}
              marineVectorCount={marineVectorCount}
            />
          )}
        </div>
      )}

      {/* Embedded Dynamic Animations via Inline Style Injection */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.75; }
        }
        @keyframes glow {
          0% { box-shadow: 0 0 5px rgba(0, 240, 255, 0.1); }
          100% { box-shadow: 0 0 15px rgba(0, 240, 255, 0.3); }
        }
      `}} />
    </div>
  );
};

export default React.memo(TruthOverlay);
