import React from 'react';

export const TruthOverlayGpuTab = ({
  gpuFps,
  gpuMemoryBytes,
  gpuTexturesCount,
  gpuUploadsCount,
  gpuDroppedFrames,
  fboStatus,
  simulationField,
  liveSimFrame,
  evolutionMode,
  windVectorCount,
  marineVectorCount
}) => {
  return (
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
            {liveSimFrame}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#94a3b8' }}>Plan Evolution:</span>
          <span style={{ fontFamily: 'monospace', color: evolutionMode === 'sandbox_active' ? '#10b981' : '#94a3b8' }}>
            {evolutionMode === 'sandbox_active' ? 'Active (sandbox)'
              : evolutionMode === 'disabled_forecast_authoritative' ? 'Disabled (forecast-auth)'
              : 'none'}
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
  );
};
