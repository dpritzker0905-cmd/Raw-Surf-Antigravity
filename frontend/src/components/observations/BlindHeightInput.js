/**
 * BlindHeightInput - "How big is it?" asked BEFORE any forecast is shown on the screen (T1 crowd truth, P1).
 *
 * The surfer gives what THEY see: a number (or, if they will not commit, one of the old ranges), its unit, the SCALE
 * they mean (face vs Hawaiian: an unlabelled "4 ft" is ambiguous by about x2), and typical vs sets. The server, not
 * this component, converts it to face metres and decides `source` and `forecast_shown_before`.
 *
 * This component must never show a forecast number, nor ANY example number (an anchor): it renders no forecast,
 * takes none as a prop, and its placeholder is a word, not a value.
 *
 * Accessibility: native radio groups inside fieldset/legend (arrow keys move within a group, one Tab stop each),
 * a labelled number input, and the scale named in words, never by colour. Themes: semantic tokens only
 * (foreground/muted/card/border/primary), which light, dark and beach mode all define.
 */
import React from 'react';
import { useThemeName } from '../../contexts/ThemeContext';

export const HEIGHT_BUCKETS = ['Flat', '1-2ft', '2-3ft', '3-4ft', '4-6ft', '6-8ft', '8ft+'];

// Client-side guess at the region's default scale, for the INITIAL selection only. The server recomputes the default
// from the spot and records whether the user overrode it; this copy never decides anything stored.
const HAWAII_BOX = { latMin: 18.5, latMax: 22.6, lonMin: -160.8, lonMax: -154.4 };
export function defaultScaleFor(spot) {
  if (!spot) return 'face';
  const state = String(spot.state_province || '').trim().toLowerCase();
  if (['hawaii', "hawai'i", 'hawaiʻi', 'hi'].includes(state)) return 'hawaiian';
  const lat = Number(spot.latitude);
  const lon = Number(spot.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= HAWAII_BOX.latMin && lat <= HAWAII_BOX.latMax
    && lon >= HAWAII_BOX.lonMin && lon <= HAWAII_BOX.lonMax) return 'hawaiian';
  return 'face';
}

export const emptyObservation = (scale = 'face') => ({
  mode: 'value', height_value: '', height_unit: 'ft', height_bucket: '', height_scale: scale, set_or_avg: '',
});

/** Is the observation complete enough to send? */
export function observationReady(obs) {
  if (!obs || !obs.set_or_avg || !obs.height_scale) return false;
  if (obs.mode === 'bucket') return HEIGHT_BUCKETS.includes(obs.height_bucket);
  const v = Number(obs.height_value);
  return obs.height_value !== '' && Number.isFinite(v) && v >= 0 && v <= (obs.height_unit === 'm' ? 30 : 100);
}

/** The request body fields for POST /surf-observations (no server-owned fields: the server refuses them). */
export function observationPayload(obs) {
  const base = { height_scale: obs.height_scale, set_or_avg: obs.set_or_avg };
  if (obs.mode === 'bucket') return { ...base, height_bucket: obs.height_bucket };
  return { ...base, height_value: Number(obs.height_value), height_unit: obs.height_unit };
}

/** Short label for the legacy free-text `wave_height` column; always names the scale. */
export function observationLabel(obs) {
  if (!observationReady(obs)) return null;
  const size = obs.mode === 'bucket' ? obs.height_bucket : `${Number(obs.height_value)}${obs.height_unit}`;
  return `${size} ${obs.height_scale}, ${obs.set_or_avg}`;
}

const SCALE_HELP = {
  face: 'Face: the full height of the wave face, bottom to top.',
  hawaiian: 'Hawaiian: about half the full face height.',
};

function Segmented({ name, legend, options, value, onChange, help }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm text-muted-foreground mb-1.5">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const id = `${name}-${opt.value}`;
          const checked = value === opt.value;
          return (
            <label key={opt.value} htmlFor={id}
              className={`relative cursor-pointer select-none rounded-lg border px-3 py-2 text-sm min-h-[40px] flex items-center
                focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background
                ${checked ? 'border-primary bg-primary/15 text-foreground font-semibold' : 'border-border bg-card text-foreground hover:bg-muted'}`}>
              <input id={id} type="radio" aria-label={String(opt.label)} name={name} value={opt.value} checked={checked}
                onChange={() => onChange(opt.value)} className="sr-only" />
              {checked && <span aria-hidden="true" className="mr-1">✓</span>}
              {opt.label}
            </label>
          );
        })}
      </div>
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </fieldset>
  );
}

const BlindHeightInput = ({ value, onChange, idPrefix = 'obs', defaultScale = 'face' }) => {
  const obs = value || emptyObservation(defaultScale);
  const set = (patch) => onChange({ ...obs, ...patch });
  const inputId = `${idPrefix}-height-value`;
  // Beach mode's global input rule forces amber-900 text (index.css); pair it with the light amber field it expects.
  const fieldBg = useThemeName() === 'beach' ? 'bg-amber-50' : 'bg-background';

  return (
    <section aria-labelledby={`${idPrefix}-heading`} className="space-y-3 rounded-xl border border-border bg-card p-3"
      data-testid="blind-height-input">
      <div>
        <h3 id={`${idPrefix}-heading`} className="text-sm font-semibold text-foreground">How big is it right now?</h3>
        <p className="text-xs text-muted-foreground">Your own eyes, before any forecast. This helps us check our surf forecast.</p>
      </div>

      {obs.mode === 'value' ? (
        <div className="space-y-1.5">
          <label htmlFor={inputId} className="text-sm text-muted-foreground block">Wave height</label>
          <div className="flex gap-2">
            <input id={inputId} type="number" inputMode="decimal" min="0" step="0.5"
              max={obs.height_unit === 'm' ? 30 : 100}
              value={obs.height_value}
              onChange={(e) => set({ height_value: e.target.value })}
              className={`flex-1 min-w-0 h-10 rounded-md border border-border ${fieldBg} px-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring`}
              placeholder="height" data-testid="obs-height-value" />
            <Segmented name={`${idPrefix}-unit`} legend={<span className="sr-only">Unit</span>}
              value={obs.height_unit} onChange={(u) => set({ height_unit: u })}
              options={[{ value: 'ft', label: 'ft' }, { value: 'm', label: 'm' }]} />
          </div>
          <button type="button" onClick={() => set({ mode: 'bucket', height_value: '' })}
            className="text-xs underline text-muted-foreground hover:text-foreground">
            Not sure of a number? Pick a range
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Segmented name={`${idPrefix}-bucket`} legend="Wave height range"
            value={obs.height_bucket} onChange={(b) => set({ height_bucket: b })}
            options={HEIGHT_BUCKETS.map((b) => ({ value: b, label: b }))} />
          <button type="button" onClick={() => set({ mode: 'value', height_bucket: '' })}
            className="text-xs underline text-muted-foreground hover:text-foreground">
            Enter a number instead
          </button>
        </div>
      )}

      <Segmented name={`${idPrefix}-scale`} legend="Scale you mean"
        value={obs.height_scale} onChange={(s) => set({ height_scale: s })}
        help={`${SCALE_HELP[obs.height_scale] || ''}${obs.height_scale === defaultScale ? ' (usual here)' : ''}`}
        options={[{ value: 'face', label: 'Face' }, { value: 'hawaiian', label: 'Hawaiian' }]} />

      <Segmented name={`${idPrefix}-sets`} legend="Is that the typical wave or the sets?"
        value={obs.set_or_avg} onChange={(v) => set({ set_or_avg: v })}
        options={[{ value: 'typical', label: 'Typical wave' }, { value: 'sets', label: 'The sets' }]} />
    </section>
  );
};

export default BlindHeightInput;
