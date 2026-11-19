/**
 * TrainingConsent - the person's opt-in to let their wave reports improve Raw Surf's forecasts (T1 P3).
 *
 * Off unless they turn it on. The wording comes from the SERVER (GET /surf-observations/consent), so it can change
 * without an app release; the server records each choice with the wording's version. This component only shows the
 * current choice and sends a new one. It renders nothing until the server answers (or if it cannot), so a report is
 * never blocked by it and nobody sees a toggle whose state is unknown.
 *
 * Accessibility: a native checkbox with a visible label and description (aria-describedby); the state is said in
 * words ("On" / "Off"), not by colour. Themes: semantic tokens only (foreground/muted/border/primary).
 */
import React, { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient';
import logger from '../../utils/logger';

const URL = '/surf-observations/consent';

const TrainingConsent = ({ idPrefix = 'obs' }) => {
  const [state, setState] = useState(null);   // { granted, title, text } once the server answers
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await apiClient.get(URL);
        if (live && res?.data && typeof res.data.granted === 'boolean') setState(res.data);
      } catch (err) {
        logger.warn('[consent] not loaded:', err?.response?.status || err?.message);
      }
    })();
    return () => { live = false; };
  }, []);

  if (!state) return null;

  const id = `${idPrefix}-training-consent`;
  const toggle = async (granted) => {
    const before = state;
    setState({ ...state, granted });
    setSaving(true);
    setError('');
    try {
      const res = await apiClient.put(URL, { granted, source: 'blind_height_input' });
      if (res?.data && typeof res.data.granted === 'boolean') setState(res.data);
    } catch (err) {
      setState(before);
      setError('Could not save your choice. It is unchanged.');
      logger.warn('[consent] not saved:', err?.response?.status || err?.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border p-2.5" data-testid="training-consent">
      <div className="flex items-start gap-2.5">
        <input id={id} type="checkbox" checked={state.granted} disabled={saving}
          aria-describedby={`${id}-text`} onChange={(e) => toggle(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-primary focus:outline-none focus:ring-2 focus:ring-ring" />
        <div className="min-w-0">
          <label htmlFor={id} className="block text-sm font-medium text-foreground cursor-pointer">
            {state.title} <span className="text-muted-foreground font-normal">({state.granted ? 'On' : 'Off'})</span>
          </label>
          <p id={`${id}-text`} className="text-xs text-muted-foreground">{state.text}</p>
          {error && <p role="alert" className="mt-1 text-xs text-foreground">{error}</p>}
        </div>
      </div>
    </div>
  );
};

export default TrainingConsent;
