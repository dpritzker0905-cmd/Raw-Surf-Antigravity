import React, { useEffect, useId, useRef, useState } from 'react';
import { Ellipsis } from 'lucide-react';

const STEPS = [['−1d', -24, 'Step back 1 day'], ['−3h', -3, 'Step back 3 hours', -1], ['−1h', -1, 'Step back 1 hour'], ['Now', null, 'Jump to now'], ['+1h', 1, 'Step forward 1 hour'], ['+3h', 3, 'Step forward 3 hours', 1], ['+1d', 24, 'Step forward 1 day']];

/** Ordinary disclosure: the adjacent slider retains its own arrow-key navigation. */
export default function ForecastTimeSteps({ compact = false, onStep, className = '', children, showSteps = true, active = true }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const toggle = useRef(null);
  const id = useId();
  useEffect(() => { if (!active) setOpen(false); }, [active]);
  useEffect(() => {
    if (!compact || !open) return;
    const dismiss = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [compact, open]);
  const escape = event => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault(); event.stopPropagation(); setOpen(false); toggle.current?.focus();
  };
  return <div ref={root} className={compact ? 'weather-time-shortcuts' : ''} onKeyDown={escape}>
    {compact && <button type="button" ref={toggle} className={`weather-shortcuts-toggle rounded-full border ${className}`}
      aria-label={showSteps ? "Time shortcuts" : "Timeline options"} title={showSteps ? "Time shortcuts" : "Timeline options"} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <Ellipsis className="w-4 h-4" aria-hidden="true" />
    </button>}
    {(!compact || open) && <div id={id} className={`${compact ? 'weather-shortcuts-panel rounded-xl border shadow-xl ' : ''}weather-time-steps flex flex-wrap items-center justify-center gap-1 mt-1.5 ${compact ? className : ''}`}>
      {showSteps && STEPS.map(([label, delta, aria, grid]) => <button key={label} type="button" aria-label={aria}
        className={`text-[9px] leading-none font-bold px-2 py-1 rounded-full border ${className} transition-colors`}
        onClick={() => onStep(delta, grid)}>{label}</button>)}
      {compact && children && <div className="weather-shortcuts-extra">{typeof children === 'function' ? children(() => { setOpen(false); toggle.current?.focus(); }) : children}</div>}
    </div>}
  </div>;
}
