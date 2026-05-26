import React, { useState } from 'react';
import { LAYER_REGISTRY } from './LayerRegistry';

function getLayerTruth(layerId, rasterVisible) {
  const layer = LAYER_REGISTRY[layerId];
  if (!layer) return "OFF";
  if (layer.type === "raster" || layer.omVariable) return rasterVisible ? "LOADED" : "LOADING";
  return "ACTIVE";
}

/**
 * TruthOverlay: Visual debugging HUD for the GIS renderer.
 * Displays active layer state, data pipeline status, and truth violations.
 * Designed with premium glassmorphism, vibrant HSL colors, and micro-animations.
 */
var TruthOverlay = ({ activeLayers, activeRenderType, marineData, windData, truthIssues, rasterVisible }) => {
  const [minimized, setMinimized] = useState(false);

  // Stats calculation
  const windVectorCount = windData?.vectors?.length || 0;
  const marineVectorCount = marineData?.grid?.vectors?.length || 0;
  const activeLayer = activeLayers?.[0] || 'none';

  return (
    <div style={{
      position: 'absolute',
      bottom: '16px',
      left: '16px',
      zIndex: 100,
      fontFamily: '"Outfit", "Inter", -apple-system, sans-serif',
      color: '#f8fafc',
      background: 'rgba(10, 10, 26, 0.75)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '12px',
      boxShadow: '0 12px 40px 0 rgba(0, 0, 0, 0.45)',
      width: minimized ? '220px' : '320px',
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
        borderBottom: minimized ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
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
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            background: 'linear-gradient(135deg, #06b6d4, #0891b2)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            Truth Inspector
          </span>
        </div>
        <button
          onClick={() => setMinimized(!minimized)}
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: 'none',
            borderRadius: '4px',
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: '11px',
            padding: '2px 8px',
            fontWeight: 500,
            transition: 'background 0.2s',
            outline: 'none'
          }}
          onMouseEnter={(e) => e.target.style.background = 'rgba(255,255,255,0.1)'}
          onMouseLeave={(e) => e.target.style.background = 'rgba(255,255,255,0.05)'}
        >
          {minimized ? 'Expand' : 'Collapse'}
        </button>
      </div>

      {!minimized && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Active State */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: '#64748b' }}>Active Layer:</span>
            <span style={{ fontWeight: 600, color: '#22d3ee' }}>{activeLayer}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: '#64748b' }}>Render Type:</span>
            <span style={{ fontWeight: 600, textTransform: 'capitalize', color: '#e2e8f0' }}>{activeRenderType}</span>
          </div>

          {/* Telemetry pipeline metrics */}
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '6px',
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            fontSize: '11px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Wind Data Grid:</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: windVectorCount > 0 ? '#34d399' : '#f43f5e' }}>
                {windVectorCount > 0 ? `${windVectorCount.toLocaleString()} vecs` : 'EMPTY'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Marine Data Grid:</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: marineVectorCount > 0 ? '#34d399' : '#f43f5e' }}>
                {marineVectorCount > 0 ? `${marineVectorCount.toLocaleString()} vecs` : 'EMPTY'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Raster Source:</span>
              <span style={{
                fontWeight: 600,
                color: getLayerTruth(activeLayer, rasterVisible) === 'LOADED' ? '#34d399' : 
                       getLayerTruth(activeLayer, rasterVisible) === 'LOADING' ? '#fbbf24' : '#64748b'
              }}>
                {getLayerTruth(activeLayer, rasterVisible)}
              </span>
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
                borderRadius: '6px',
                padding: '6px 10px',
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
                      borderRadius: '6px',
                      padding: '6px 10px',
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
          50% { transform: scale(1.15); opacity: 0.7; }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
      `}} />
    </div>
  );
};

export default TruthOverlay;
