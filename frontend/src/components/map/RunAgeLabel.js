import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { readRunAge } from './runAgeReadout';

/**
 * The always-on run line under the forecast timeline (runAgeReadout.js says why). Rendered by TimelineStatus, so the desktop panel
 * and both phone layouts carry it. Three themes: light text on dark / beach panels, dark text on the light panel. A stale run adds
 * WORDS ("older than 18 h") and an amber tone, never colour alone. Not a live region: it changes once a model cycle, and a
 * per-scrub announcement would be noise; the line is plain text in the reading order. Kill: window.__RAW_DISABLE_RUN_AGE_LABEL__.
 */
export default function RunAgeLabel({ model, layer, theme }) {
  const read = () => readRunAge({ model, layer });
  const [state, setState] = useState(read);
  useEffect(() => {
    setState(read());
    const timer = setInterval(() => setState(read()), 60000);   // the age moves by the hour; capabilities may land after mount
    const t0 = setTimeout(() => setState(read()), 3000);
    return () => { clearInterval(timer); clearTimeout(t0); };
  }, [model, layer]);
  if (!state) return null;
  const isLight = theme === 'light';
  const tone = state.stale ? (isLight ? 'text-amber-800' : 'text-amber-200') : (isLight ? 'text-slate-600' : 'text-slate-300');
  return (
    <p data-run-age={state.stale ? 'stale' : 'ok'} data-run-age-by={state.by} className={`mt-1 text-xs ${tone}`}>
      <Clock className="inline-block w-3 h-3 mr-1 align-[-2px]" aria-hidden="true" focusable="false" />
      {state.text}
    </p>
  );
}
