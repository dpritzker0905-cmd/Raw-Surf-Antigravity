import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LAYER_REGISTRY } from './LayerRegistry';
import { WeatherTelemetry } from './WeatherTelemetry';
import { API_BASE } from '../../lib/apiClient';

function getLayerTruth(layerId, rasterVisible, windData, marineData) {
  const layer = LAYER_REGISTRY[layerId];
  if (!layer) return "OFF";
  if (layer.type === "raster") return rasterVisible ? "LOADED" : "LOADING";
  if (layer.type === "particle") return (windData && windData.vectors && windData.vectors.length > 0) ? "LOADED" : "LOADING";
  if (layer.type === "marine") return (marineData && marineData.grid && marineData.grid.vectors && marineData.grid.vectors.length > 0) ? "LOADED" : "LOADING";
  return "OFF";
}

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

  // Live telemetry ticking loop (updates numbers at 2Hz without React overhead on main map)
  useEffect(() => {
    if (minimized) return;
    const interval = setInterval(() => {
      setTicks(t => t + 1);
    }, 500);
    return () => clearInterval(interval);
  }, [minimized]);

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
            rows: issue.rows || null
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
  const showExtendedWarning = activeModel === 'EURO' && timeOffsetHours > 72;

  // GPU metrics from window
  const gpuTexturesCount = typeof window !== 'undefined' ? window.__RAW_GPU__?.textureCount : 0;
  const gpuUploadsCount = typeof window !== 'undefined' ? window.__RAW_GPU__?.textureUploadCount : 0;
  const gpuMemoryBytes = typeof window !== 'undefined' ? window.__RAW_GPU__?.gpuMemoryEstimate : 0;
  const gpuFps = typeof window !== 'undefined' ? window.__WEATHER_TELEMETRY__?.gpuStats?.fps : null;
  const gpuDroppedFrames = typeof window !== 'undefined' ? window.__RAW_GPU__?.droppedFrameCounter : 0;
  const fboStatus = typeof window !== 'undefined' ? window.__RAW_GPU__?.advFboStatus : null;

  return (
    <div style={{
      position: 'absolute',
      bottom: '16px',
      left: '16px',
      zIndex: 100,
      fontFamily: '"Outfit", "Inter", -apple-system, sans-serif',
      color: '#f8fafc',
      background: 'rgba(10, 10, 26, 0.85)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '16px',
      boxShadow: '0 20px 50px 0 rgba(0, 0, 0, 0.55)',
      width: minimized ? '220px' : '360px',
      padding: '16px',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      userSelect: 'none',
      pointerEvents: 'auto'
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
            background: truthIssues?.length > 0 ? '#ef4444' : (isTransitioning ? '#fbbf24' : '#10b981'),
            boxShadow: truthIssues?.length > 0 
              ? '0 0 12px #ef4444, 0 0 4px #ef4444' 
              : (isTransitioning ? '0 0 12px #fbbf24, 0 0 4px #fbbf24' : '0 0 12px #10b981, 0 0 4px #10b981'),
            animation: 'pulse 1.5s infinite ease-in-out'
          }} />
          <span style={{
            fontSize: '12px',
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            background: 'linear-gradient(135deg, #00f0ff, #0072ff)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            Diagnostics HUD
          </span>
        </div>
        <button
          onClick={() => setMinimized(!minimized)}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: 'none',
            borderRadius: '6px',
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: '10px',
            padding: '3px 8px',
            fontWeight: 600,
            transition: 'all 0.2s',
            outline: 'none'
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
                    {gridProvider}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>Class:</span>
                  <span style={{ 
                    fontWeight: 700, 
                    color: isEstimated ? '#fbbf24' : '#10b981' 
                  }}>
                    {isEstimated ? 'ESTIMATED FALLBACK' : 'AUTHORITATIVE NATIVE'}
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
                    ⚠️ Copernicus native ends at +72h (Waves: +240h). Extended GFS/ICON trend-blend estimate is currently active.
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

                {truthIssues?.length === 0 ? (
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
                    <span>No Causal Layer Violations Detected</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {truthIssues.map((v, i) => (
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{
                fontSize: '9px',
                fontWeight: 700,
                textTransform: 'uppercase',
                color: '#64748b',
                letterSpacing: '0.05em'
              }}>
                Interactive Shader Debug Views
              </div>

              {/* Direct Debug Buttons */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '5px'
              }}>
                {[
                  { name: 'Normal View', mode: null },
                  { name: 'Ocean Mask', mode: 'mask' },
                  { name: 'Mesh UVs', mode: 'uv' },
                  { name: 'Grid Index', mode: 'grid' },
                  { name: 'Mercator Grids', mode: 'mercator' },
                  { name: 'Particle UVs', mode: 'part_uv' },
                  { name: 'Particle Pos', mode: 'part_pos' },
                  { name: 'Advection Offsets', mode: 'part_offset' },
                  { name: 'FBO Quantization', mode: 'part_fbo' }
                ].map(item => (
                  <button
                    key={item.name}
                    onClick={() => setDebugMode(item.mode)}
                    style={{
                      background: currentDebugMode === item.mode ? 'rgba(0, 240, 255, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                      border: currentDebugMode === item.mode ? '1px solid #00f0ff' : '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '6px',
                      color: currentDebugMode === item.mode ? '#00f0ff' : '#e2e8f0',
                      fontSize: '9px',
                      fontWeight: 'bold',
                      padding: '5px 0',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease-in-out',
                      outline: 'none'
                    }}
                    onMouseEnter={(e) => {
                      if (currentDebugMode !== item.mode) {
                        e.target.style.background = 'rgba(0, 240, 255, 0.1)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (currentDebugMode !== item.mode) {
                        e.target.style.background = 'rgba(255, 255, 255, 0.04)';
                      }
                    }}
                  >
                    {item.name}
                  </button>
                ))}
              </div>

              {/* Stacking Info block */}
              {activeDiagnostic === '2-0-2' && (
                <div style={{
                  background: 'rgba(0, 240, 255, 0.08)',
                  border: '1px solid rgba(0, 240, 255, 0.25)',
                  borderRadius: '8px',
                  padding: '8px',
                  fontSize: '9px',
                  color: '#cffafe',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px',
                  maxHeight: '100px',
                  overflowY: 'auto'
                }}>
                  <div style={{ fontWeight: 'bold', color: '#00f0ff', marginBottom: '2px' }}>🗺️ LAYERS STACK INSPECTOR</div>
                  {stackInfo.map((l, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace' }}>
                      <span>{l.id}</span>
                      <span style={{ color: '#00f0ff' }}>#{l.idx} ({l.type})</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Interactive Safe Keypad (Legacy fallback support) */}
              <div style={{
                background: 'rgba(0, 0, 0, 0.2)',
                border: '1px solid rgba(255, 255, 255, 0.04)',
                borderRadius: '8px',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '9px',
                  color: '#64748b'
                }}>
                  <span>COMBINATION PAD:</span>
                  <span style={{
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    color: activeDiagnostic === 'invalid' ? '#ef4444' : '#00f0ff',
                    background: 'rgba(0,0,0,0.3)',
                    padding: '1px 5px',
                    borderRadius: '4px',
                    letterSpacing: '2px'
                  }}>
                    {combo.padEnd(3, '_')}
                  </span>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: '4px'
                }}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(num => (
                    <button
                      key={num}
                      onClick={() => handleKeyClick(num.toString())}
                      style={{
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        borderRadius: '4px',
                        color: '#cbd5e1',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        padding: '4px 0',
                        cursor: 'pointer',
                        transition: 'all 0.12s',
                        outline: 'none'
                      }}
                    >
                      {num}
                    </button>
                  ))}
                </div>
                <button
                  onClick={clearCombo}
                  style={{
                    width: '100%',
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    borderRadius: '4px',
                    color: '#fca5a5',
                    fontSize: '8px',
                    fontWeight: 'bold',
                    padding: '3px 0',
                    cursor: 'pointer',
                    outline: 'none'
                  }}
                >
                  CLEAR CODE
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: GPU & FCE TELEMETRY */}
          {activeTab === 'gpu' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8' }}>Frame Rate:</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#10b981' }}>
                  {gpuFps || 60} FPS
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8' }}>GPU Memory:</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#f472b6' }}>
                  {((gpuMemoryBytes || 0) / (1024 * 1024)).toFixed(2)} MB
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8' }}>Resident Textures:</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#60a5fa' }}>
                  {gpuTexturesCount || 0} textures
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8' }}>Texture Uploads:</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#34d399' }}>
                  {gpuUploadsCount || 0} uploads
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8' }}>Dropped Frames:</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600, color: gpuDroppedFrames > 0 ? '#ef4444' : '#94a3b8' }}>
                  {gpuDroppedFrames || 0}
                </span>
              </div>

              <div style={{
                marginTop: '4px',
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                paddingTop: '6px',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px'
              }}>
                <div style={{ fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>
                  WebGL Shader Bindings
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>State A Tex Unit:</span>
                  <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>
                    {typeof window !== 'undefined' && window.__RAW_GPU__?.particleStateATexUnit !== undefined ? window.__RAW_GPU__.particleStateATexUnit : 'N/A'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>State B Tex Unit:</span>
                  <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>
                    {typeof window !== 'undefined' && window.__RAW_GPU__?.particleStateBTexUnit !== undefined ? window.__RAW_GPU__.particleStateBTexUnit : 'N/A'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>FBO Status:</span>
                  <span style={{ 
                    fontFamily: 'monospace', 
                    fontWeight: 600,
                    color: fboStatus === 'FRAMEBUFFER_COMPLETE' ? '#10b981' : '#ef4444'
                  }}>
                    {fboStatus || 'INACTIVE'}
                  </span>
                </div>
              </div>

              <div style={{
                marginTop: '4px',
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                paddingTop: '6px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}>
                <div style={{ fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em', marginBottom: '2px' }}>
                  Field Composition Engine (FCE)
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>FCE Revision:</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#f59e0b' }}>
                    {simulationField?.revision || 'none'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>Simulation Frame:</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#38bdf8' }}>
                    {simFrameIndex}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>Plan Evolution:</span>
                  <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>
                    {renderPlan?.evolution || 'none'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>Wind Data Grid:</span>
                  <span style={{ fontFamily: 'monospace', color: windVectorCount > 0 ? '#10b981' : '#64748b' }}>
                    {windVectorCount > 0 ? `${windVectorCount.toLocaleString()} cells` : 'none'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>Marine Data Grid:</span>
                  <span style={{ fontFamily: 'monospace', color: marineVectorCount > 0 ? '#10b981' : '#64748b' }}>
                    {marineVectorCount > 0 ? `${marineVectorCount.toLocaleString()} cells` : 'none'}
                  </span>
                </div>
              </div>
            </div>
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

export default TruthOverlay;
