/**
 * SpotInspector - Admin > Surf Forecast > Spot inspector.
 *
 * Pick a spot; see what the ONE forecast chain did there: the catalogue row, the chain's own geometry
 * (resolve_surf_geometry: shore normal and its source, break depth, shelf, exposure), the local size reference, and
 * every PRECOMPUTED rate_one_spot frame (score, level, breaking height, period, swell direction, the limiting factor,
 * why, confidence, geometry readiness). Read-only and cheap: GET /admin/surf-forecast/spots[/{id}] reads cached
 * objects and the offline geometry asset, never a live forecast.
 *
 * Themes: semantic tokens; inputs in beach mode use a light amber field. ARIA: labelled search with a results list of
 * real buttons, tables with scoped headers, the model filter as a radio group.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, MapPin, Search } from 'lucide-react';
import apiClient from '../../lib/apiClient';
import { useThemeName } from '../../contexts/ThemeContext';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

const M_TO_FT = 3.28084;

export function heightText(m) {
  if (m === null || m === undefined || Number.isNaN(Number(m))) return '—';
  return `${Number(m).toFixed(2)} m (${(Number(m) * M_TO_FT).toFixed(1)} ft)`;
}

function num(v, unit = '', digits = 1) {
  return v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : `${Number(v).toFixed(digits)}${unit}`;
}

function text(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.map(text).join('; ');
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k.replace(/_/g, ' ')}: ${text(x)}`).join(', ');
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

const GEOMETRY_LABELS = [
  ['shore_normal_deg', 'Shore normal (seaward)', (v) => num(v, '°', 0)],
  ['shore_normal_src', 'Shore normal source', text],
  ['shore_normal_match_km', 'Bearing source distance', (v) => num(v, ' km', 1)],
  ['swell_normal_deg', 'Swell-exposure normal (MOP)', (v) => num(v, '°', 0)],
  ['break_depth_m', 'Break depth (caps breaking height)', (v) => num(v, ' m', 1)],
  ['depth_m', 'Shelf depth (friction)', (v) => num(v, ' m', 0)],
  ['shelf_width_km', 'Shelf width', (v) => num(v, ' km', 0)],
  ['coastal', 'Coastal', text],
  ['nearshore', 'Land within a cell', text],
  ['magnet_name', 'Swell magnet', text],
  ['magnet_factor', 'Magnet factor', (v) => num(v, '', 2)],
];

function Facts({ items, label }) {
  return (
    <dl aria-label={label} className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2 border-b border-border/40 py-0.5">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function SpotInspector() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [model, setModel] = useState('all');
  const field = useThemeName() === 'beach' ? 'bg-amber-50' : 'bg-background';

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setResults([]); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiClient.get(`/admin/surf-forecast/spots?q=${encodeURIComponent(term)}`);
        if (live) setResults(res.data.spots || []);
      } catch {
        if (live) setResults([]);
      } finally {
        if (live) setSearching(false);
      }
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [query]);

  const open = async (spot) => {
    setLoading(true);
    setError('');
    setModel('all');
    try {
      const res = await apiClient.get(`/admin/surf-forecast/spots/${encodeURIComponent(spot.id)}`);
      setDetail(res.data);
    } catch (err) {
      setDetail(null);
      setError(err?.response?.data?.detail?.toString?.() || 'Could not load the spot.');
    } finally {
      setLoading(false);
    }
  };

  const frames = useMemo(() => detail?.ratings?.frames || [], [detail]);
  const models = useMemo(() => ['all', ...Array.from(new Set(frames.map((f) => f.model).filter(Boolean)))], [frames]);
  const shown = model === 'all' ? frames : frames.filter((f) => f.model === model);

  return (
    <Card className="bg-card border-border" data-testid="spot-inspector">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm text-foreground">
          <MapPin className="h-4 w-4" aria-hidden="true" /> Spot inspector
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          What the forecast chain did at one spot: its geometry and every precomputed rating, with the factor that limited
          it. Read-only; nothing is recomputed.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <label htmlFor="spot-search" className="sr-only">Search spots by name</label>
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input id="spot-search" type="search" aria-label="Search spots by name" value={query}
            onChange={(e) => setQuery(e.target.value)} placeholder="Search spots by name (2+ letters)"
            className={`h-9 w-full rounded-md border border-border ${field} pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring`} />
        </div>
        {searching && <p role="status" className="text-xs text-muted-foreground">Searching…</p>}
        {results.length > 0 && (
          <ul aria-label="Matching spots" className="flex flex-wrap gap-2">
            {results.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => open(s)}
                  className={`min-h-[36px] rounded-lg border px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring
                    ${detail?.spot?.id === s.id ? 'border-primary bg-primary/15 font-semibold text-foreground' : 'border-border bg-card text-foreground hover:bg-muted'}`}
                  aria-pressed={detail?.spot?.id === s.id}>
                  {s.name}{s.region ? `, ${s.region}` : ''}
                </button>
              </li>
            ))}
          </ul>
        )}

        {loading && (
          <p role="status" className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Loading spot…
          </p>
        )}
        {error && <p role="alert" className="text-sm text-foreground">{error}</p>}

        {detail && !loading && (
          <section aria-label={`Inspection of ${detail.spot.name}`} className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{detail.spot.name}</h3>
              <p className="text-xs text-muted-foreground">
                {[detail.spot.region, detail.spot.country].filter(Boolean).join(', ')}
                {' · '}{num(detail.spot.latitude, '', 4)}, {num(detail.spot.longitude, '', 4)}
                {' · pin: '}{text(detail.spot.accuracy_flag)}{detail.spot.is_verified_peak ? ', verified peak' : ''}
              </p>
            </div>

            <div>
              <h4 className="mb-1 text-xs font-semibold text-foreground">Geometry the chain uses</h4>
              {detail.geometry?.error
                ? <p role="alert" className="text-xs text-foreground">Could not resolve: {detail.geometry.error}</p>
                : <Facts label="Geometry" items={GEOMETRY_LABELS.map(([k, label, fmt]) => [label, fmt(detail.geometry?.[k])])} />}
            </div>

            <div>
              <h4 className="mb-1 text-xs font-semibold text-foreground">Local size reference</h4>
              {detail.size_climatology?.error
                ? <p role="alert" className="text-xs text-foreground">Could not read: {detail.size_climatology.error}</p>
                : detail.size_climatology
                  ? <Facts label="Local size reference" items={Object.entries(detail.size_climatology).map(([k, v]) => [k.replace(/_/g, ' '), text(v)])} />
                  : <p className="text-xs text-muted-foreground">No local reference for this spot (the global size curve applies).</p>}
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-foreground">
                Precomputed ratings
                {detail.ratings?.generated_at && <span className="font-normal text-muted-foreground"> · generated {new Date(detail.ratings.generated_at).toLocaleString()}</span>}
              </h4>
              {detail.ratings?.error ? (
                <p role="alert" className="text-xs text-foreground">Could not read the ratings: {detail.ratings.error}</p>
              ) : frames.length === 0 ? (
                <p className="text-xs text-muted-foreground">This spot is in no precomputed frame.</p>
              ) : (
                <>
                  <fieldset>
                    <legend className="sr-only">Model</legend>
                    <div className="flex flex-wrap gap-2">
                      {models.map((m) => (
                        <label key={m} htmlFor={`spot-model-${m}`}
                          className={`flex min-h-[32px] cursor-pointer items-center rounded-lg border px-3 py-1 text-xs focus-within:ring-2 focus-within:ring-ring
                            ${model === m ? 'border-primary bg-primary/15 font-semibold text-foreground' : 'border-border bg-card text-foreground hover:bg-muted'}`}>
                          <input id={`spot-model-${m}`} type="radio" name="spot-model" value={m} checked={model === m}
                            aria-label={m === 'all' ? 'All models' : m} onChange={() => setModel(m)} className="sr-only" />
                          {m === 'all' ? 'All models' : m}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <caption className="sr-only">Precomputed ratings for {detail.spot.name}</caption>
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          {['Valid time', 'Model', 'Score', 'Level', 'Breaking height', 'Period', 'Swell from', 'Limited by', 'Why', 'Confidence', 'Geometry readiness'].map((h) => (
                            <th key={h} scope="col" className="whitespace-nowrap py-1.5 pr-3 text-left font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((f) => (
                          <tr key={`${f.model}-${f.valid_time}`} className="border-b border-border/50 align-top last:border-0">
                            <th scope="row" className="whitespace-nowrap py-1.5 pr-3 text-left font-normal text-foreground">
                              {f.valid_time ? new Date(f.valid_time).toLocaleString() : '—'}
                            </th>
                            <td className="py-1.5 pr-3 text-foreground">{f.model || '—'}</td>
                            <td className="py-1.5 pr-3 text-foreground">{num(f.score, '', 1)}</td>
                            <td className="py-1.5 pr-3 text-foreground">{text(f.level)}</td>
                            <td className="whitespace-nowrap py-1.5 pr-3 text-foreground">{heightText(f.surf_height_m)}</td>
                            <td className="py-1.5 pr-3 text-muted-foreground">{num(f.period_s, ' s', 1)}</td>
                            <td className="py-1.5 pr-3 text-muted-foreground">{num(f.swell_from_deg, '°', 0)}</td>
                            <td className="py-1.5 pr-3 text-foreground">
                              {text(f.limiter)}{f.limiter_f != null ? ` (×${Number(f.limiter_f).toFixed(2)})` : ''}
                              {f.directional_conflict ? ` · ${text(f.directional_conflict)}` : ''}
                            </td>
                            <td className="min-w-[12rem] py-1.5 pr-3 text-muted-foreground">{text(f.why)}</td>
                            <td className="py-1.5 pr-3 text-muted-foreground">{text(f.confidence)}</td>
                            <td className="py-1.5 pr-3 text-muted-foreground">{text(f.geometry_readiness)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
