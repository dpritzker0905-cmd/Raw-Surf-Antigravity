import React, { useEffect, useState } from 'react';
import { useThemeName } from '../../contexts/ThemeContext';
import { installMarineClearRecorder } from './marineClearRecorder';

// Small dismissible "Captured a map clear" button; mounted from TruthOverlay. Renders nothing until a capture exists.
export default function MarineClearCapture() {
  const theme = useThemeName();
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => installMarineClearRecorder(typeof window !== 'undefined' ? window : null, () => { setShown(true); setCopied(false); }), []);
  if (!shown) return null;
  const palette = theme === 'light'
    ? { bg: '#ffffff', fg: '#0f172a', bd: '#94a3b8' }
    : theme === 'beach'
      ? { bg: '#fff7e6', fg: '#3b2a10', bd: '#c08a3a' }
      : { bg: '#0f172a', fg: '#f8fafc', bd: '#64748b' };
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(window.__SOAK_EVENTS__ || [], null, 1)); setCopied(true); } catch (e) { setCopied(false); }
  };
  return (
    <div role="status" style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 2000, display: 'flex', gap: 6 }}>
      <button type="button" aria-label="Captured a map clear. Copy details to clipboard" onClick={copy}
        style={{ background: palette.bg, color: palette.fg, border: `1px solid ${palette.bd}`, borderRadius: 8, padding: '8px 12px', fontSize: 13, minHeight: 36 }}>
        {copied ? 'Copied' : 'Captured a map clear - copy details'}
      </button>
      <button type="button" aria-label="Dismiss map clear capture notice" onClick={() => setShown(false)}
        style={{ background: palette.bg, color: palette.fg, border: `1px solid ${palette.bd}`, borderRadius: 8, padding: '8px 12px', fontSize: 13, minHeight: 36 }}>x</button>
    </div>
  );
}
