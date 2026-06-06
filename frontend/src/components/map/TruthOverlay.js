import React, { useState, useEffect, useMemo } from 'react';
import { LAYER_REGISTRY } from './LayerRegistry';

function getLayerTruth(layerId, rasterVisible) {
  const layer = LAYER_REGISTRY[layerId];
  if (!layer) return "OFF";
  if (layer.type === "raster" || layer.type === "particle") return rasterVisible ? "LOADED" : "LOADING";
  return "OFF";
}

/**
 * TruthOverlay: Visual debugging HUD for the GIS renderer.
 * Displays active layer state, data pipeline status, and truth violations.
 * UPGRADED: Added the Interactive "Diagnostic Safe" Combinations Pad.
 */
var TruthOverlay = ({ activeLayers, activeRenderType, marineData, windData, truthIssues, rasterVisible }) => {
  const [minimized, setMinimized] = useState(false);
  const [combo, setCombo] = useState('');
  const [activeDiagnostic, setActiveDiagnostic] = useState(null);
  const [stackInfo, setStackInfo] = useState([]);
  const [telemetryTicks, setTelemetryTicks] = useState(0);

  // Stats calculation
  const windVectorCount = windData?.vectors?.length || 0;
  const marineVectorCount = marineData?.grid?.vectors?.length || 0;
  const activeLayer = activeLayers?.[0] || 'none';

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

  // Live telemetry hook
  useEffect(() => {
    let interval;
    if (activeDiagnostic === '3-0-3') {
      interval = setInterval(() => {
        setTelemetryTicks(t => t + 1);
      }, 500);
    }
    return () => clearInterval(interval);
  }, [activeDiagnostic]);

  // Keypad click handler
  const handleKeyClick = (num) => {
    if (combo.length < 3) {
      const nextCombo = combo + num;
      setCombo(nextCombo);
      
      // Auto-submit when 3 digits are entered
      if (nextCombo.length === 3) {
        processCombo(nextCombo);
      }
    }
  };

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
      setActiveDiagnostic('1-0-1');
      if (typeof window !== 'undefined') {
        if (!window.__GPU_DEBUG__) window.__GPU_DEBUG__ = { mode: null };
        window.__GPU_DEBUG__.mode = 'mask';
        if (window.map) window.map.triggerRepaint();
      }
    } else if (code === '1-0-2' || code === '102') {
      setActiveDiagnostic('1-0-2');
      if (typeof window !== 'undefined') {
        if (!window.__GPU_DEBUG__) window.__GPU_DEBUG__ = { mode: null };
        window.__GPU_DEBUG__.mode = 'uv';
        if (window.map) window.map.triggerRepaint();
      }
    } else if (code === '1-0-3' || code === '103') {
      setActiveDiagnostic('1-0-3');
      if (typeof window !== 'undefined') {
        if (!window.__GPU_DEBUG__) window.__GPU_DEBUG__ = { mode: null };
        window.__GPU_DEBUG__.mode = 'grid';
        if (window.map) window.map.triggerRepaint();
      }
    } else if (code === '1-0-4' || code === '104') {
      setActiveDiagnostic('1-0-4');
      if (typeof window !== 'undefined') {
        if (!window.__GPU_DEBUG__) window.__GPU_DEBUG__ = { mode: null };
        window.__GPU_DEBUG__.mode = 'mercator';
        if (window.map) window.map.triggerRepaint();
      }
    } else if (code === '0-0-0' || code === '000') {
      setActiveDiagnostic('0-0-0');
      if (typeof window !== 'undefined') {
        if (!window.__GPU_DEBUG__) window.__GPU_DEBUG__ = { mode: null };
        window.__GPU_DEBUG__.mode = null;
        if (window.map) window.map.triggerRepaint();
      }
    } else if (code === '2-0-2' || code === '202') {
      setActiveDiagnostic('2-0-2');
      if (typeof window !== 'undefined' && window.map) {
        try {
          const layers = window.map.getStyle().layers || [];
          // Get indices of important layers
          const important = layers.map((l, idx) => ({ id: l.id, idx, type: l.type }))
            .filter(l => l.id.startsWith('ocean-mask') || l.id.includes('marine') || l.id === 'water' || l.id === 'landuse' || l.id === 'national-park');
          setStackInfo(important);
        } catch (e) {
          setStackInfo([{ id: 'Error reading stack', idx: 0 }]);
        }
      }
    } else if (code === '3-0-3' || code === '303') {
      setActiveDiagnostic('3-0-3');
    } else if (code === '4-0-1' || code === '401') {
      setActiveDiagnostic('4-0-1');
      if (typeof window !== 'undefined') {
        if (!window.__GPU_DEBUG__) window.__GPU_DEBUG__ = { mode: null };
        window.__GPU_DEBUG__.mode = 'part_uv';
        if (window.map) window.map.triggerRepaint();
      }
    } else if (code === '4-0-2' || code === '402') {
      setActiveDiagnostic('4-0-2');
      if (typeof window !== 'undefined') {
        if (!window.__GPU_DEBUG__) window.__GPU_DEBUG__ = { mode: null };
        window.__GPU_DEBUG__.mode = 'part_pos';
        if (window.map) window.map.triggerRepaint();
      }
    } else if (code === '4-0-3' || code === '403') {
      setActiveDiagnostic('4-0-3');
      if (typeof window !== 'undefined') {
        if (!window.__GPU_DEBUG__) window.__GPU_DEBUG__ = { mode: null };
        window.__GPU_DEBUG__.mode = 'part_offset';
        if (window.map) window.map.triggerRepaint();
      }
    } else if (code === '4-0-4' || code === '404') {
      setActiveDiagnostic('4-0-4');
      if (typeof window !== 'undefined') {
        if (!window.__GPU_DEBUG__) window.__GPU_DEBUG__ = { mode: null };
        window.__GPU_DEBUG__.mode = 'part_fbo';
        if (window.map) window.map.triggerRepaint();
      }
    } else {
      setActiveDiagnostic('invalid');
      setTimeout(() => {
        setCombo('');
        setActiveDiagnostic(null);
      }, 1000);
    }
  };

  return (
    <div style={{
      position: 'absolute',
      bottom: '16px',
      left: '16px',
      zIndex: 100,
      fontFamily: '"Outfit", "Inter", -apple-system, sans-serif',
      color: '#f8fafc',
      background: 'rgba(10, 10, 26, 0.82)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      borderRadius: '16px',
      boxShadow: '0 20px 50px 0 rgba(0, 0, 0, 0.55)',
      width: minimized ? '220px' : '340px',
      padding: '18px',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      userSelect: 'none',
      pointerEvents: 'auto'
    }}>
      {/* HUD Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: minimized ? 'none' : '1px solid rgba(255, 255, 255, 0.15)',
        paddingBottom: minimized ? '0' : '10px',
        marginBottom: minimized ? '0' : '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: truthIssues?.length > 0 ? '#ef4444' : '#10b981',
            boxShadow: truthIssues?.length > 0 
              ? '0 0 12px #ef4444, 0 0 4px #ef4444' 
              : '0 0 12px #10b981, 0 0 4px #10b981',
            animation: 'pulse 1.5s infinite ease-in-out'
          }} />
          <span style={{
            fontSize: '13px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            background: 'linear-gradient(135deg, #00f0ff, #0072ff)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            Truth Inspector
          </span>
        </div>
        <button
          onClick={() => setMinimized(!minimized)}
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: 'none',
            borderRadius: '6px',
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: '11px',
            padding: '4px 10px',
            fontWeight: 600,
            transition: 'all 0.2s',
            outline: 'none'
          }}
          onMouseEnter={(e) => e.target.style.background = 'rgba(255,255,255,0.15)'}
          onMouseLeave={(e) => e.target.style.background = 'rgba(255,255,255,0.08)'}
        >
          {minimized ? 'Expand' : 'Collapse'}
        </button>
      </div>

      {!minimized && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Active State */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: '#94a3b8' }}>Active Layer:</span>
            <span style={{ fontWeight: 600, color: '#00f0ff' }}>{activeLayer}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: '#94a3b8' }}>Render Type:</span>
            <span style={{ fontWeight: 600, textTransform: 'capitalize', color: '#e2e8f0' }}>{activeRenderType}</span>
          </div>

          {/* Telemetry pipeline metrics */}
          <div style={{
            background: 'rgba(255,255,255,0.04)',
            borderRadius: '8px',
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            fontSize: '11px',
            border: '1px solid rgba(255,255,255,0.05)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Wind Data Grid:</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: windVectorCount > 0 ? '#10b981' : '#f43f5e' }}>
                {windVectorCount > 0 ? `${windVectorCount.toLocaleString()} vecs` : 'EMPTY'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Marine Data Grid:</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: marineVectorCount > 0 ? '#10b981' : '#f43f5e' }}>
                {marineVectorCount > 0 ? `${marineVectorCount.toLocaleString()} vecs` : 'EMPTY'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Raster Source:</span>
              <span style={{
                fontWeight: 600,
                color: getLayerTruth(activeLayer, rasterVisible) === 'LOADED' ? '#10b981' : 
                       getLayerTruth(activeLayer, rasterVisible) === 'LOADING' ? '#fbbf24' : '#64748b'
               }}>
                {getLayerTruth(activeLayer, rasterVisible)}
              </span>
            </div>
          </div>

          {/* Stacking / Telemetry Diagnostic Output panel if active */}
          {activeDiagnostic && activeDiagnostic !== 'invalid' && (
            <div style={{
              background: 'rgba(0, 240, 255, 0.08)',
              border: '1px solid rgba(0, 240, 255, 0.25)',
              borderRadius: '8px',
              padding: '10px',
              fontSize: '11px',
              color: '#cffafe',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              animation: 'glow 1.5s infinite alternate'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em', color: '#00f0ff' }}>
                  ⚙️ DIAGNOSTIC: {activeDiagnostic === '1-0-1' ? 'OCEAN MASK DEBUG' :
                                  activeDiagnostic === '1-0-2' ? 'UV VISUALIZATION' :
                                  activeDiagnostic === '1-0-3' ? 'GRID INDEX DEBUG' :
                                  activeDiagnostic === '1-0-4' ? 'MERCATOR COORDS' :
                                  activeDiagnostic === '0-0-0' ? 'NORMAL RENDERING' :
                                  activeDiagnostic === '2-0-2' ? 'STACKING INSPECTOR' :
                                  activeDiagnostic === '3-0-3' ? 'LIVE TELEMETRY' :
                                  activeDiagnostic === '4-0-1' ? 'PARTICLE UVs' :
                                  activeDiagnostic === '4-0-2' ? 'PARTICLE POSITIONS' :
                                  activeDiagnostic === '4-0-3' ? 'PARTICLE OFFSETS' :
                                  activeDiagnostic === '4-0-4' ? 'PARTICLE FBO ATTACH' : 'OPACITY OPTIONS'}
                </span>
                <span style={{ cursor: 'pointer', fontWeight: 'bold' }} onClick={clearCombo}>✕</span>
              </div>
              
              {activeDiagnostic === '1-0-1' && (
                <div>
                  <div style={{ color: '#a5f3fc', marginBottom: '4px' }}>GPU Land Mask: Ocean is purple, land is green.</div>
                  <div style={{ fontSize: '10px', color: '#67e8f9' }}>Verify exact high-resolution coastline alignment.</div>
                </div>
              )}

              {activeDiagnostic === '1-0-2' && (
                <div>
                  <div style={{ color: '#a5f3fc', marginBottom: '4px' }}>Mesh UV: R = uv.x, G = uv.y.</div>
                  <div style={{ fontSize: '10px', color: '#67e8f9' }}>Verify G is 0 at North and 1 at South.</div>
                </div>
              )}

              {activeDiagnostic === '1-0-3' && (
                <div>
                  <div style={{ color: '#a5f3fc', marginBottom: '4px' }}>Grid Index: row iteration index color gradient.</div>
                  <div style={{ fontSize: '10px', color: '#67e8f9' }}>Verify top is blue/magenta and bottom is red.</div>
                </div>
              )}

              {activeDiagnostic === '1-0-4' && (
                <div>
                  <div style={{ color: '#a5f3fc', marginBottom: '4px' }}>Projected Mercator coordinate gradients.</div>
                  <div style={{ fontSize: '10px', color: '#67e8f9' }}>Verify continuous wrap and no distortion.</div>
                </div>
              )}

              {activeDiagnostic === '0-0-0' && (
                <div>
                  <div style={{ color: '#a5f3fc', marginBottom: '4px' }}>Normal rendering mode restored.</div>
                </div>
              )}

              {activeDiagnostic === '2-0-2' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '100px', overflowY: 'auto' }}>
                  {stackInfo.map((l, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace' }}>
                      <span>{l.id}</span>
                      <span style={{ color: '#00f0ff' }}>#{l.idx} ({l.type})</span>
                    </div>
                  ))}
                </div>
              )}

              {activeDiagnostic === '3-0-3' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ fontWeight: 'bold', color: '#34d399', marginBottom: '2px' }}>📊 GPU RESIDENCY TELEMETRY</div>
                  <div>GPU Textures: <span style={{ fontFamily: 'monospace', color: '#60a5fa' }}>{window.__RAW_GPU__?.textureCount || 0} resident</span></div>
                  <div>GPU Uploads: <span style={{ fontFamily: 'monospace', color: '#34d399' }}>{window.__RAW_GPU__?.textureUploadCount || 0}</span></div>
                  <div>Draw Calls/Frame: <span style={{ fontFamily: 'monospace', color: '#fbbf24' }}>{window.__RAW_GPU__?.drawCallsPerFrame || 0}</span></div>
                  <div>Est. VRAM: <span style={{ fontFamily: 'monospace', color: '#f472b6' }}>{((window.__RAW_GPU__?.gpuMemoryEstimate || 0) / (1024 * 1024)).toFixed(2)} MB</span></div>
                  <div>Frame Rate: <span style={{ fontFamily: 'monospace', color: '#10b981' }}>{window.__WEATHER_TELEMETRY__?.gpuStats?.fps || 60} FPS</span></div>
                  <div>Dropped Frames: <span style={{ fontFamily: 'monospace', color: '#f43f5e' }}>{window.__RAW_GPU__?.droppedFrameCounter || 0}</span></div>
                  
                  <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.15)', marginTop: '4px', paddingTop: '4px', color: '#00f0ff', fontWeight: 'bold' }}>🌊 PARTICLE PIPELINE TELEMETRY</div>
                  <div>State A Tex Unit: <span style={{ fontFamily: 'monospace', color: '#cffafe' }}>{window.__RAW_GPU__?.particleStateATexUnit !== undefined ? window.__RAW_GPU__.particleStateATexUnit : 'N/A'}</span></div>
                  <div>State B Tex Unit: <span style={{ fontFamily: 'monospace', color: '#cffafe' }}>{window.__RAW_GPU__?.particleStateBTexUnit || 'N/A'}</span></div>
                  <div>FBO Status: <span style={{ fontFamily: 'monospace', color: window.__RAW_GPU__?.advFboStatus === 'FRAMEBUFFER_COMPLETE' ? '#10b981' : '#f43f5e' }}>{window.__RAW_GPU__?.advFboStatus || 'N/A'}</span></div>
                  <div>Pass Executed: <span style={{ fontFamily: 'monospace', color: window.__RAW_GPU__?.particlePassExecuted ? '#10b981' : '#f43f5e' }}>{window.__RAW_GPU__?.particlePassExecuted ? 'TRUE' : 'FALSE'}</span></div>
                </div>
              )}

               {activeDiagnostic === '4-0-1' && (
                <div>
                  <div style={{ color: '#a5f3fc', marginBottom: '4px' }}>Particle UVs: Rendered directly as 2D color coordinates.</div>
                  <div style={{ fontSize: '10px', color: '#67e8f9' }}>R = grid_x, G = grid_y, B = 0.0. Verify full coverage.</div>
                </div>
              )}
              {activeDiagnostic === '4-0-2' && (
                <div>
                  <div style={{ color: '#a5f3fc', marginBottom: '4px' }}>Decoded Positions: Rendered as RGB color values.</div>
                  <div style={{ fontSize: '10px', color: '#67e8f9' }}>Verify that particle positions are correctly mapped to the Mercator viewport.</div>
                </div>
              )}
              {activeDiagnostic === '4-0-3' && (
                <div>
                  <div style={{ color: '#a5f3fc', marginBottom: '4px' }}>Advection Offsets: Visualizes local wave force vectors.</div>
                  <div style={{ fontSize: '10px', color: '#67e8f9' }}>Color values represent the local movement speed and direction.</div>
                </div>
              )}
              {activeDiagnostic === '4-0-4' && (
                <div>
                  <div style={{ color: '#a5f3fc', marginBottom: '4px' }}>FBO Attach State: Render raw texture color contents.</div>
                  <div style={{ fontSize: '10px', color: '#67e8f9' }}>Visualizes the raw high/low quantized channels stored in VRAM.</div>
                </div>
              )}
            </div>
          )}

          {/* Interactive Safe Keypad */}
          <div style={{
            background: 'rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: '10px',
            padding: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '11px',
              color: '#94a3b8'
            }}>
              <span>DIAGNOSTIC SAFE DIAL:</span>
              <span style={{
                fontFamily: 'monospace',
                fontSize: '14px',
                fontWeight: 'bold',
                color: activeDiagnostic === 'invalid' ? '#ef4444' : '#00f0ff',
                background: 'rgba(0,0,0,0.3)',
                padding: '2px 8px',
                borderRadius: '4px',
                letterSpacing: '3px'
              }}>
                {combo.padEnd(3, '_')}
              </span>
            </div>

            {/* Matrix layout of digits */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: '6px'
            }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(num => (
                <button
                  key={num}
                  onClick={() => handleKeyClick(num.toString())}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '6px',
                    color: '#e2e8f0',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    padding: '6px 0',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease-in-out',
                    outline: 'none'
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.background = 'rgba(0, 240, 255, 0.15)';
                    e.target.style.borderColor = 'rgba(0, 240, 255, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = 'rgba(255, 255, 255, 0.05)';
                    e.target.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                  }}
                >
                  {num}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={clearCombo}
                style={{
                  flex: 1,
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '6px',
                  color: '#fca5a5',
                  fontSize: '10px',
                  fontWeight: 'bold',
                  padding: '5px 0',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                CLEAR
              </button>
            </div>
          </div>

          {/* Hard Truth Violations section */}
          <div>
            <div style={{
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              color: '#94a3b8',
              letterSpacing: '0.03em',
              marginBottom: '6px'
            }}>
              Violations:
            </div>

            {truthIssues?.length === 0 ? (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.15)',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '11px',
                color: '#a7f3d0'
              }}>
                <span style={{ fontSize: '12px' }}>✓</span>
                <span>System State Validated</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {truthIssues.map((v, i) => (
                  <div 
                    key={i}
                    style={{
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      fontSize: '11px',
                      color: '#fca5a5',
                      animation: 'shake 0.3s ease-in-out'
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', marginBottom: '2px' }}>
                      ⚠️ {v.type}
                    </div>
                    <div style={{ lineHeight: 1.3 }}>{v.hint}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Embedded Dynamic Animations via Inline Style Injection */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.75; }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
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
