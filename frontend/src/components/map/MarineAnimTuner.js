import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * MarineAnimTuner — a live, dev-only tuning panel for the WebGL marine wave animation.
 *
 * TRUTHFUL: the engine reads window.__RAW_* globals every frame AND echoes exactly what it applied into
 * window.__RAW_GPU__.anim. This panel writes the globals (instant, no reload) and reads that echo back, so
 * every slider shows the GPU's ACTUAL applied value ("GPU: N") — you can see the sliders reaching the shader.
 *
 * ONE GLOBAL VALUE SET (applies at every zoom). The live map zoom is DISPLAYED so you can judge how a value
 * reads across zooms, but the values themselves are global. (An earlier per-zoom BAND design self-zeroed the
 * animation when you crossed into an untuned band on zoom-out — that regression is removed. If deliberate
 * per-zoom curves are wanted later, add them explicitly on top of a stable render pipeline.)
 *
 * FLOATS ABOVE EVERYTHING: portal to document.body, position:fixed, max z-index; draggable header; collapsible.
 * PROD-SAFE: only on localhost (or ?tuner=1 / localStorage.__RAW_TUNER__='1'); opt out with __RAW_TUNER__='0'.
 * Pure UI — writes window globals the engine already reads; never imports the engine (engine-boundaries.md).
 */

// tkey = the field the engine echoes into window.__RAW_GPU__.anim, for the live "GPU applied" readout.
const CONTROLS = [
  { key: '__RAW_TROCHOIDAL__',       tkey: 'trochoidal',     label: 'Trochoidal crest', min: 0,   max: 1,    step: 0.05, def: 0,    hint: 'Sharp leading face, broad trailing back (0 = symmetric)' },
  { key: '__RAW_ORBITAL_PITCH__',    tkey: 'orbitalPitch',   label: 'Orbital pitch',    min: 0,   max: 4,    step: 0.25, def: 0,    hint: 'Crests bob fwd/back with the wave (px). Keep ≤3 to avoid banding.' },
  { key: '__RAW_SHOAL_FOAM__',       tkey: 'shoalFoam',      label: 'Shoaling foam',    min: 0,   max: 3,    step: 0.1,  def: 0,    hint: 'Extra whitecap in shallow water (needs bathymetry — zoom to a coast)' },
  { key: '__RAW_CREST_DIR_JITTER__', tkey: 'crestJitter',    label: 'Crest jitter',     min: 0,   max: 0.5,  step: 0.02, def: 0,    hint: 'Breaks the parallel-crest "grid" over uniform fields (rad)' },
  { key: '__RAW_WAVE_SPEED__',       tkey: 'waveSpeed',      label: 'Wave speed',       min: 0.3, max: 1.5,  step: 0.05, def: 1,    hint: 'Overall drift-speed multiplier' },
  { key: '__RAW_SPEED_HEIGHT_CAP__', tkey: 'speedHeightCap', label: 'Speed height cap', min: 1,   max: 8,    step: 0.5,  def: 3,    hint: 'Caps how fast big swell drifts (m)' },
  { key: '__RAW_PART_TARGET__',      tkey: 'partTarget',     label: 'Crest density',    min: 600, max: 3000, step: 50,   def: 1650, hint: 'On-screen crest count (held constant across zoom)' },
  { key: '__RAW_TILE_ZOOM_MIN__',    tkey: 'tileZoomMin',    label: 'Tile zoom min',    min: 2,   max: 7,    step: 0.5,  def: 4,    hint: 'Zoom where the dense tile mode kicks in' },
];

function defaults() { const o = {}; for (const c of CONTROLS) o[c.key] = c.def; return o; }

const PRESET_NATURAL = { __RAW_TROCHOIDAL__: 0.7, __RAW_ORBITAL_PITCH__: 2.5, __RAW_SHOAL_FOAM__: 1.5, __RAW_CREST_DIR_JITTER__: 0.2 };
const LS_VALS = '__RAW_TUNER_VALUES__';

function isEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.localStorage.getItem('__RAW_TUNER__') === '0') return false;
    if (new URLSearchParams(window.location.search).get('tuner') === '1') return true;
    if (window.localStorage.getItem('__RAW_TUNER__') === '1') return true;
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0';
  } catch (e) { return false; }
}

function loadVals() {
  const base = defaults();
  try {
    const saved = JSON.parse(window.localStorage.getItem(LS_VALS) || 'null');
    if (saved && typeof saved === 'object') {
      for (const c of CONTROLS) if (typeof saved[c.key] === 'number') base[c.key] = saved[c.key];
    }
  } catch (e) { /* ignore */ }
  return base;
}

export default function MarineAnimTuner() {
  const [enabled] = useState(isEnabled);
  const [open, setOpen] = useState(true);
  const [vals, setVals] = useState(loadVals);
  const [zoom, setZoom] = useState(null);
  const [applied, setApplied] = useState(null);   // live window.__RAW_GPU__.anim echo
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState({ x: null, y: null });
  const dragState = useRef(null);
  const valsRef = useRef(vals);
  valsRef.current = vals;

  // Seed the globals from persisted values ONCE on mount, then poll the engine echo for the live readout.
  // Single global value set — never re-applies on zoom (that was the band regression that self-zeroed).
  useEffect(() => {
    if (!enabled) return;
    for (const c of CONTROLS) { if (typeof valsRef.current[c.key] === 'number') window[c.key] = valsRef.current[c.key]; }
    const id = setInterval(() => {
      const anim = (window.__RAW_GPU__ && window.__RAW_GPU__.anim) || null;
      if (anim) {
        setApplied(anim);
        if (typeof anim.zoom === 'number') setZoom(anim.zoom);
      }
    }, 250);
    return () => clearInterval(id);
  }, [enabled]);

  // Edit a value → apply live to the engine + persist. Applies at ALL zooms.
  const apply = useCallback((key, value) => {
    if (typeof window !== 'undefined') window[key] = value;
    setVals(prev => {
      const next = { ...prev, [key]: value };
      try { window.localStorage.setItem(LS_VALS, JSON.stringify(next)); } catch (e) { /* ignore */ }
      return next;
    });
  }, []);

  const applyPreset = useCallback((obj) => { Object.keys(obj).forEach(k => apply(k, obj[k])); }, [apply]);

  const copyForClaude = useCallback(() => {
    const text = CONTROLS.map(c => `${c.key.replace(/^__RAW_|__$/g, '')}=${valsRef.current[c.key]}`).join(' ');
    try { if (navigator.clipboard) navigator.clipboard.writeText(text); } catch (e) { /* ignore */ }
    console.log('[MarineAnimTuner] copy-for-claude:\n' + text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, []);

  const onHeaderMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.parentElement.getBoundingClientRect();
    dragState.current = { sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top };
    const move = (ev) => { const d = dragState.current; if (!d) return; setPos({ x: Math.max(0, d.ox + ev.clientX - d.sx), y: Math.max(0, d.oy + ev.clientY - d.sy) }); };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); dragState.current = null; };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    e.preventDefault();
  }, []);

  if (!enabled || typeof document === 'undefined') return null;

  const anchor = pos.x == null ? { top: 12, right: 12 } : { top: pos.y, left: pos.x };
  const panel = { position: 'fixed', ...anchor, zIndex: 2147483647, width: 286, background: 'rgba(10,16,26,0.94)', color: '#e6f0ff', borderRadius: 10, border: '1px solid rgba(90,150,220,0.4)', boxShadow: '0 8px 30px rgba(0,0,0,0.55)', font: '12px/1.4 -apple-system, Segoe UI, Roboto, sans-serif', backdropFilter: 'blur(6px)', userSelect: 'none' };
  const header = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', cursor: 'move', borderBottom: open ? '1px solid rgba(90,150,220,0.25)' : 'none' };
  const btn = { background: 'rgba(60,110,180,0.35)', color: '#dbeaff', border: '1px solid rgba(120,170,230,0.4)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11 };
  const chevron = { background: 'transparent', border: 'none', color: '#cfe2ff', cursor: 'pointer', fontSize: 14, padding: '0 4px', lineHeight: 1 };
  const live = applied && typeof applied.zoom === 'number';

  return createPortal(
    <div style={panel}>
      <div style={header} onMouseDown={onHeaderMouseDown} title="Drag to move">
        <span style={{ fontWeight: 600 }}>🌊 Marine Anim Tuner</span>
        <button style={chevron} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }} title={open ? 'Collapse' : 'Expand'}>{open ? '▾' : '▸'}</button>
      </div>
      {open && (
        <div style={{ padding: '8px 10px 10px', maxHeight: '74vh', overflowY: 'auto' }}>
          {/* Live zoom (values apply at every zoom — displayed so you can judge how they read across zooms) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, padding: '5px 7px', background: 'rgba(40,80,140,0.35)', borderRadius: 6 }}>
            <span>live zoom <b style={{ color: '#8fd0ff' }}>{live ? applied.zoom.toFixed(2) : '—'}</b></span>
            <span style={{ fontSize: 10, opacity: 0.7 }}>values apply at all zooms</span>
          </div>
          {!live && <div style={{ fontSize: 10, color: '#ffb0b0', marginBottom: 6 }}>No engine echo yet — turn on Waves (GFS → Waves) and keep this tab focused.</div>}

          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button style={btn} onClick={() => applyPreset(PRESET_NATURAL)}>🌊 Natural</button>
            <button style={btn} onClick={() => applyPreset({ __RAW_TROCHOIDAL__: 0, __RAW_ORBITAL_PITCH__: 0, __RAW_SHOAL_FOAM__: 0, __RAW_CREST_DIR_JITTER__: 0 })}>Reset (off)</button>
          </div>

          {CONTROLS.map(c => {
            const gpu = applied ? applied[c.tkey] : undefined;
            const gpuNum = typeof gpu === 'number' ? (Math.round(gpu * 1000) / 1000) : null;
            const match = gpuNum != null && Math.abs(gpuNum - vals[c.key]) < 1e-6;
            const shoalInert = c.key === '__RAW_SHOAL_FOAM__' && applied && applied.shoalActive === false && vals[c.key] > 0;
            return (
              <div key={c.key} style={{ marginBottom: 9 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span>{c.label}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ color: '#8fd0ff' }}>{vals[c.key]}</span>
                    {gpuNum != null && <span style={{ color: match ? '#7fe0a0' : '#ffcf6b', marginLeft: 6, fontSize: 10 }}>GPU:{gpuNum}{match ? ' ✓' : ''}</span>}
                  </span>
                </div>
                <input type="range" min={c.min} max={c.max} step={c.step} value={vals[c.key]} onChange={e => apply(c.key, parseFloat(e.target.value))} style={{ width: '100%', accentColor: '#4aa3ff', cursor: 'pointer' }} />
                <div style={{ fontSize: 10, opacity: 0.55, marginTop: 1 }}>{shoalInert ? '⚠ inert here — no bathymetry at this view (zoom to a coast)' : c.hint}</div>
              </div>
            );
          })}
          <button style={{ ...btn, width: '100%', marginTop: 4 }} onClick={copyForClaude}>
            {copied ? '✓ Copied — paste to Claude' : '📋 Copy for Claude'}
          </button>
        </div>
      )}
    </div>,
    document.body
  );
}
