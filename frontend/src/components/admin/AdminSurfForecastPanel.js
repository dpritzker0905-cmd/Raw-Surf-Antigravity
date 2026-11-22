import React, { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '../../lib/apiClient';
import {
  Waves, RefreshCw, Loader2, Trash2, Database, Star, AlertTriangle, Search,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { useThemeName } from '../../contexts/ThemeContext';
import { toast } from 'sonner';
import logger from '../../utils/logger';
import ForecastDataHealth from './ForecastDataHealth';
import SpotInspector from './SpotInspector';
import GuardrailHistory from './GuardrailHistory';

/**
 * Admin · Surf Forecast — the rating system's control room.
 *
 *  1. FLAGS — every registered rating/forecast flag as the SERVE BOX sees it (GET /admin/surf-forecast/status).
 *     Since D-065 a guarded flag's value comes from env > the runtime manifest (control/flags.json, written only by
 *     the guardrail workflow) > its code default, so each row says its SOURCE and, when the guardrail set it, the
 *     guardrail's reason, who and when. Numeric settings show their value, never an on/off badge. A flag read only
 *     by a workflow lane is marked: this server's copy says nothing about the lane's.
 *     Nothing here flips a flag: the place to change each one is written on its row.
 *  2. PRECOMPUTED DATA — spot ratings and the size climatologies; a read failure is shown as a failure, not as "0".
 *  3. USER CONDITION REPORTS — the human observations that confirm Good/Epic and nudge scores (RATING_OBS_GATE).
 *     Deleting one is confirmed in a dialog and written to the admin log.
 *
 * THEMES: semantic tokens only (foreground / muted / card / border / primary), defined for light, dark and beach;
 * meaning is always in words, never colour alone. Inputs in beach mode pair its global amber-900 text with a light
 * amber field (as BlindHeightInput).
 */

const GROUPS = [
  { id: 'all', label: 'All' },
  { id: 'guardrail', label: 'Set by guardrail' },
  { id: 'changed', label: 'Changed from default' },
  { id: 'guarded', label: 'Guarded (D-065)' },
  { id: 'settings', label: 'Numeric settings' },
];

const SOURCE_TEXT = {
  manifest: 'set by the guardrail manifest',
  env: 'set by environment',
  default: 'code default',
};

export function matchesGroup(flag, group) {
  switch (group) {
    case 'guardrail': return flag.source === 'manifest';
    case 'changed': return flag.value !== flag.default;
    case 'guarded': return !!flag.guarded;
    case 'settings': return flag.kind === 'setting';
    default: return true;
  }
}

export function flagValueText(flag) {
  if (flag.kind === 'setting') return flag.value;
  return flag.value === '0' ? 'Off' : 'On';
}

function when(iso) {
  if (!iso) return '—';
  const d = typeof iso === 'number' ? new Date(iso * 1000) : new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

function ManifestHealth({ manifest }) {
  if (!manifest) return null;
  const neverRead = !manifest.good_at;
  const text = manifest.error
    ? `The guardrail manifest could not be read: ${manifest.error}. Guarded flags keep the last good copy for up to 6 hours, then fall back to their code defaults (an "off" is kept).`
    : neverRead
      ? 'The guardrail manifest has not been read by this server yet (or is turned off here).'
      : `Guardrail manifest read ${when(manifest.good_at)}: ${manifest.entries} entr${manifest.entries === 1 ? 'y' : 'ies'}.`;
  return (
    <p role={manifest.error ? 'alert' : 'status'}
      className="rounded-lg border border-border bg-muted/40 p-2 text-xs text-foreground">
      {manifest.error && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />}
      {text}
    </p>
  );
}

function FlagRow({ f }) {
  const entry = f.manifest_entry;
  return (
    <li className="border-b border-border/50 py-2 last:border-0" data-testid={`flag-${f.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-xs font-mono text-foreground">{f.name}</code>
        <Badge variant="outline" className="text-foreground">
          {f.kind === 'setting' ? <>value <code className="ml-1">{f.value}</code></> : flagValueText(f)}
        </Badge>
        {f.value !== f.default && (
          <Badge variant="outline" className="text-foreground">default {f.kind === 'setting' ? f.default : (f.default === '0' ? 'Off' : 'On')}</Badge>
        )}
        <span className="text-xs text-muted-foreground">{SOURCE_TEXT[f.source] || f.source}</span>
        {f.guarded && <span className="text-xs text-muted-foreground">· guarded, fix version {f.fix_version || '—'}</span>}
      </div>
      {entry && (
        <p className="mt-1 rounded border border-border bg-muted/40 p-1.5 text-xs text-foreground">
          Guardrail: {entry.state === 'off' ? 'turned OFF' : 'turned ON'}
          {entry.reason ? ` — ${entry.reason}` : ''}
          {entry.set_by ? ` (by ${entry.set_by}` : ''}{entry.set_at ? `, ${when(entry.set_at)}` : ''}{entry.set_by ? ')' : ''}
          {entry.evidence ? `. Evidence: ${entry.evidence}` : ''}
          {entry.state === 'off' && '. A new fix version or the owner\'s word turns it back on.'}
        </p>
      )}
      {f.serve_box_value === false && (
        <p className="mt-1 text-xs text-foreground">
          Read by a workflow lane, not this server: the value above is this server&apos;s copy and says nothing about the lane&apos;s.
        </p>
      )}
      <p className="mt-0.5 text-xs text-muted-foreground">{f.controls}</p>
      <p className="text-xs text-muted-foreground">Change it in: {f.where}</p>
    </li>
  );
}

function FlagBoard({ flags, manifest }) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const fieldBg = useThemeName() === 'beach' ? 'bg-amber-50' : 'bg-background';
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return flags.filter((f) => matchesGroup(f, group)
      && (!q || f.name.toLowerCase().includes(q) || (f.controls || '').toLowerCase().includes(q)));
  }, [flags, query, group]);
  const counts = useMemo(() => Object.fromEntries(GROUPS.map((g) => [g.id, flags.filter((f) => matchesGroup(f, g.id)).length])), [flags]);

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-foreground">Forecast and rating flags (as this server sees them)</CardTitle>
        <p className="text-xs text-muted-foreground">
          Since D-065, fixes ship on with a kill switch. A guarded flag reads, in order: an explicit environment value,
          then the guardrail manifest (which the guardrail workflow alone writes and can use to turn a fix off), then its
          code default. Each row says which one applies. Nothing on this page changes a flag.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <ManifestHealth manifest={manifest} />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <label htmlFor="flag-search" className="sr-only">Search flags</label>
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input id="flag-search" aria-label="Search flags" type="search" value={query}
              onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or what it controls"
              className={`h-9 w-full rounded-md border border-border ${fieldBg} pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring`} />
          </div>
        </div>
        <fieldset>
          <legend className="sr-only">Show</legend>
          <div className="flex flex-wrap gap-2">
            {GROUPS.map((g) => {
              const id = `flag-group-${g.id}`;
              const checked = group === g.id;
              return (
                <label key={g.id} htmlFor={id}
                  className={`flex min-h-[36px] cursor-pointer items-center rounded-lg border px-3 py-1.5 text-xs focus-within:ring-2 focus-within:ring-ring
                    ${checked ? 'border-primary bg-primary/15 font-semibold text-foreground' : 'border-border bg-card text-foreground hover:bg-muted'}`}>
                  <input id={id} type="radio" name="flag-group" value={g.id} checked={checked} aria-label={`${g.label} (${counts[g.id]})`}
                    onChange={() => setGroup(g.id)} className="sr-only" />
                  {g.label} ({counts[g.id]})
                </label>
              );
            })}
          </div>
        </fieldset>
        <p className="text-xs text-muted-foreground" aria-live="polite">Showing {shown.length} of {flags.length} flags</p>
        <ul aria-label="Flags">
          {shown.map((f) => <FlagRow key={f.name} f={f} />)}
        </ul>
      </CardContent>
    </Card>
  );
}

function BlobCard({ title, blob, children }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{title}</p>
      {blob?.error ? (
        <p role="alert" className="mt-1 text-sm text-foreground">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
          Could not read: {blob.error}
        </p>
      ) : !blob ? (
        <p className="mt-1 text-sm text-muted-foreground">Not reported</p>
      ) : children}
    </div>
  );
}

function Counters({ title, data }) {
  if (!data) return null;
  if (data.error) {
    return <p role="alert" className="text-xs text-foreground">{title}: could not read ({data.error})</p>;
  }
  const entries = Object.entries(data).filter(([, v]) => v === null || ['number', 'string', 'boolean'].includes(typeof v));
  if (!entries.length) return null;
  return (
    <div>
      <p className="text-xs font-medium text-foreground">{title}</p>
      <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
        {entries.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{k.replace(/_/g, ' ')}</dt>
            <dd className="text-foreground">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export const AdminSurfForecastPanel = () => {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [reports, setReports] = useState([]);
  const [deleting, setDeleting] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchAll = useCallback(async (again = false) => {
    if (again) setRefreshKey((k) => k + 1);   // the data-health card reloads on the same cadence (it loads itself first)
    try {
      const res = await apiClient.get('/admin/surf-forecast/status');
      setStatus(res.data);
      setStatusError('');
    } catch (error) {
      logger.error('Failed to load surf-forecast status:', error);
      setStatusError('Could not load the rating system status.');
    }
    try {
      const res = await apiClient.get('/admin/surf-forecast/reports?hours=168&limit=200');
      setReports(res.data.reports || []);
    } catch (error) {
      logger.error('Failed to load surf reports:', error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(() => fetchAll(true), 60000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const deleteReport = async (report) => {
    setConfirming(null);
    setDeleting(report.id);
    try {
      await apiClient.delete(`/admin/surf-forecast/reports/${encodeURIComponent(report.id)}`);
      setReports((prev) => prev.filter((r) => r.id !== report.id));
      toast.success('Report deleted and logged');
    } catch (error) {
      logger.error('Failed to delete report:', error);
      toast.error('Delete failed');
    }
    setDeleting(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground" role="status">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> Loading surf forecast status…
      </div>
    );
  }

  const flags = status?.flags || [];
  const blobs = status?.blobs || {};
  const freshReports = reports.filter((r) => r.influences_rating_now);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Waves className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-foreground">Surf Forecast System</h2>
        </div>
        <Button size="sm" variant="outline" onClick={() => fetchAll(true)}>
          <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" /> Refresh
        </Button>
      </div>
      {statusError && <p role="alert" className="rounded-lg border border-border p-2 text-sm text-foreground">{statusError}</p>}

      <ForecastDataHealth refreshKey={refreshKey} />

      <SpotInspector />

      <FlagBoard flags={flags} manifest={status?.manifest} />

      <GuardrailHistory refreshKey={refreshKey} />

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-foreground">
            <Database className="h-4 w-4" aria-hidden="true" /> Precomputed data
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <BlobCard title="Spot ratings (glyphs)" blob={blobs.spot_ratings}>
              <p className="mt-1 text-sm text-foreground">
                {blobs.spot_ratings?.frames ?? 0} frames · {(blobs.spot_ratings?.models || []).join(', ') || 'no models'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">generated {when(blobs.spot_ratings?.generated_at)}</p>
              <p className="text-xs text-muted-foreground">
                confirmed good/epic spot-frames: {blobs.spot_ratings?.confirmed_spot_frames ?? 0}
              </p>
            </BlobCard>
            <BlobCard title="Spot size climatology (glyph local calibration)" blob={blobs.spot_size_climatology}>
              <p className="mt-1 text-sm text-foreground">
                {blobs.spot_size_climatology?.spots_ready ?? 0} / {blobs.spot_size_climatology?.spots_tracked ?? 0} spots ready
              </p>
              <p className="mt-1 text-xs text-muted-foreground">updated {when(blobs.spot_size_climatology?.updated_at)}</p>
            </BlobCard>
            <BlobCard title="Grid size climatology (band local calibration)" blob={blobs.grid_size_climatology}>
              <p className="mt-1 text-sm text-foreground">
                {blobs.grid_size_climatology?.cells_ready ?? 0} / {blobs.grid_size_climatology?.cells_tracked ?? 0} coastal cells ready
              </p>
              <p className="mt-1 text-xs text-muted-foreground">updated {when(blobs.grid_size_climatology?.updated_at)}</p>
            </BlobCard>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Counters title="Regional tile first (this server, since restart)" data={status?.regional_tile_first} />
            <Counters title="Targeted Gulf fill (this server, since restart)" data={status?.gulf_fill_targeted} />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-foreground">
            <Star className="h-4 w-4" aria-hidden="true" /> User condition reports (last 7 days)
            {freshReports.length > 0 && (
              <Badge variant="outline" className="text-foreground">
                <AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />{freshReports.length} influencing ratings now
              </Badge>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Reports up to 12 hours old with a star rating confirm Good/Epic and nudge scores while RATING_OBS_GATE is on.
            Deleting a report takes effect on the next rating pass and is written to the admin log.
          </p>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No reports in the last 7 days.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <caption className="sr-only">User condition reports from the last 7 days</caption>
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    {['Spot', 'Stars', 'Conditions', 'Height', 'When', 'Live?'].map((h) => (
                      <th key={h} scope="col" className="py-1.5 pr-2 text-left font-medium">{h}</th>
                    ))}
                    <th scope="col" className="py-1.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => {
                    const label = `${r.spot_name || r.spot_id || 'unknown spot'}, ${when(r.created_at)}`;
                    return (
                      <tr key={r.id} className="border-b border-border/50 last:border-0">
                        <td className="py-1.5 pr-2 text-foreground">{r.spot_name || r.spot_id}</td>
                        <td className="py-1.5 pr-2 text-foreground">{r.rating != null ? `${r.rating} stars` : '—'}</td>
                        <td className="py-1.5 pr-2 text-muted-foreground">{r.conditions || '—'}</td>
                        <td className="py-1.5 pr-2 text-muted-foreground">{r.wave_height || '—'}</td>
                        <td className="whitespace-nowrap py-1.5 pr-2 text-muted-foreground">{when(r.created_at)}</td>
                        <td className="py-1.5 pr-2 text-foreground">{r.influences_rating_now ? 'Live' : '—'}</td>
                        <td className="py-1.5 text-right">
                          <Button size="sm" variant="ghost" aria-label={`Delete report: ${label}`}
                            disabled={deleting === r.id} onClick={() => setConfirming(r)}>
                            {deleting === r.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {confirming && (
        <Dialog open onOpenChange={(open) => { if (!open) setConfirming(null); }}>
          <DialogContent className="bg-background text-foreground border-border sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete this condition report?</DialogTitle>
              <DialogDescription>
                {confirming.spot_name || confirming.spot_id}, {when(confirming.created_at)}.
                {confirming.influences_rating_now ? ' It is fresh, so it is influencing live ratings now.' : ''}
                {' '}The deletion is written to the admin log.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setConfirming(null)}>Cancel</Button>
              <Button onClick={() => deleteReport(confirming)}>Delete report</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default AdminSurfForecastPanel;
