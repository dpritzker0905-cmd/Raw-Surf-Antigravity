import React from 'react';

export const TruthOverlayVisualTab = ({
  combo,
  activeDiagnostic,
  currentDebugMode,
  stackInfo,
  handleKeyClick,
  clearCombo,
  setDebugMode
}) => {
  return (
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
  );
};
