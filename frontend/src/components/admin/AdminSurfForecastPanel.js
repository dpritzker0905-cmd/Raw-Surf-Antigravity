import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../../lib/apiClient';
import {
  Waves, RefreshCw, Loader2, Trash2, ShieldCheck, ShieldOff,
  Database, Star, AlertTriangle,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { toast } from 'sonner';
import logger from '../../utils/logger';

/**
 * Admin · Surf Forecast — the rating system's control room.
 *
 * Three sections, matching how the pipeline actually works:
 *  1. FEATURE FLAGS — live server values of every rating kill switch (read-only truth; each row says
 *     what it controls and WHERE to flip it — flags are env vars, not runtime toggles by design: a
 *     rating behavior change must be an auditable deploy, not a silent click).
 *  2. DATA BLOBS — freshness of the precomputed spot ratings + the size climatologies (the local-
 *     calibration references) so an operator can see at a glance whether the crons are feeding the map.
 *  3. USER CONDITION REPORTS — the human observations that confirm Good/Epic and nudge scores when
 *     RATING_OBS_GATE is on. Junk reports directly influence live ratings -> moderation (delete) here.
 *
 * THEMING: uses ONLY the shared ui primitives + semantic classes (text-foreground/muted-foreground,
 * bg-card, border) so it renders correctly in all three app themes — light, dark, and beach mode.
 */
export const AdminSurfForecastPanel = () => {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [reports, setReports] = useState([]);
  const [deleting, setDeleting] = useState(null);

  const fetchAll = useCallback(async () => {
    try {
      const res = await apiClient.get('/admin/surf-forecast/status');
      setStatus(res.data);
    } catch (error) {
      logger.error('Failed to load surf-forecast status:', error);
      toast.error('Failed to load rating system status');
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
    const interval = setInterval(fetchAll, 60000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const handleDeleteReport = async (id) => {
    if (!window.confirm('Delete this condition report? If it is fresh it is currently influencing live ratings.')) return;
    setDeleting(id);
    try {
      await apiClient.delete(`/admin/surf-forecast/reports/${id}`);
      setReports((prev) => prev.filter((r) => r.id !== id));
      toast.success('Report deleted');
    } catch (error) {
      logger.error('Failed to delete report:', error);
      toast.error('Delete failed');
    }
    setDeleting(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading surf forecast status…
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
          <Waves className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">Surf Forecast System</h2>
        </div>
        <Button size="sm" variant="outline" onClick={fetchAll} aria-label="Refresh">
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* 1 · Feature flags (live server truth) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Rating feature flags (live server values)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Flags are environment variables — flipping one is an auditable env change + restart in the
            location shown, never a silent toggle. This table reports what the serve box actually sees.
          </p>
        </CardHeader>
        <CardContent className="space-y-1">
          {flags.map((f) => (
            <div key={f.name} className="flex items-start justify-between gap-3 py-1.5 border-b border-border/50 last:border-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-foreground">{f.name}</code>
                  {f.active
                    ? <Badge variant="outline" className="text-emerald-500 border-emerald-500/40"><ShieldCheck className="w-3 h-3 mr-1" />on</Badge>
                    : <Badge variant="outline" className="text-muted-foreground"><ShieldOff className="w-3 h-3 mr-1" />off</Badge>}
                  {f.value !== f.default && (
                    <Badge variant="outline" className="text-amber-500 border-amber-500/40">overridden</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{f.controls}</p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">{f.where}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 2 · Data blobs (cron output freshness) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Database className="w-4 h-4" /> Precomputed data</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg border border-border bg-card">
              <p className="text-xs text-muted-foreground">Spot ratings (glyphs)</p>
              <p className="text-sm text-foreground mt-1">
                {blobs.spot_ratings?.frames ?? '—'} frames · {(blobs.spot_ratings?.models || []).join(', ') || '—'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                generated {blobs.spot_ratings?.generated_at ? new Date(blobs.spot_ratings.generated_at).toLocaleString() : '—'}
              </p>
              <p className="text-xs text-muted-foreground">
                confirmed good/epic spot-frames: {blobs.spot_ratings?.confirmed_spot_frames ?? 0}
              </p>
            </div>
            <div className="p-3 rounded-lg border border-border bg-card">
              <p className="text-xs text-muted-foreground">Spot size climatology (glyph local calibration)</p>
              <p className="text-sm text-foreground mt-1">
                {blobs.spot_size_climatology?.spots_ready ?? 0} / {blobs.spot_size_climatology?.spots_tracked ?? 0} spots ready
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                updated {blobs.spot_size_climatology?.updated_at ? new Date(blobs.spot_size_climatology.updated_at).toLocaleString() : '—'}
              </p>
            </div>
            <div className="p-3 rounded-lg border border-border bg-card">
              <p className="text-xs text-muted-foreground">Grid size climatology (band local calibration)</p>
              <p className="text-sm text-foreground mt-1">
                {blobs.grid_size_climatology?.cells_ready ?? 0} / {blobs.grid_size_climatology?.cells_tracked ?? 0} coastal cells ready
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                updated {blobs.grid_size_climatology?.updated_at ? new Date(blobs.grid_size_climatology.updated_at).toLocaleString() : '—'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3 · User condition reports (the rating's human inputs) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Star className="w-4 h-4" /> User condition reports (last 7 days)
            {freshReports.length > 0 && (
              <Badge variant="outline" className="text-amber-500 border-amber-500/40">
                <AlertTriangle className="w-3 h-3 mr-1" />{freshReports.length} influencing ratings now
              </Badge>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Reports ≤12h old with a star rating confirm Good/Epic and nudge scores when the observation
            gate is on. Delete junk/abusive reports here — removal takes effect on the next rating pass.
          </p>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No reports in the last 7 days.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="text-left py-1.5 pr-2 font-medium">Spot</th>
                    <th className="text-left py-1.5 pr-2 font-medium">Stars</th>
                    <th className="text-left py-1.5 pr-2 font-medium">Conditions</th>
                    <th className="text-left py-1.5 pr-2 font-medium">Height</th>
                    <th className="text-left py-1.5 pr-2 font-medium">When</th>
                    <th className="text-left py-1.5 pr-2 font-medium">Live?</th>
                    <th className="py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 pr-2 text-foreground">{r.spot_name || r.spot_id}</td>
                      <td className="py-1.5 pr-2 text-foreground">{r.rating != null ? `${r.rating}★` : '—'}</td>
                      <td className="py-1.5 pr-2 text-muted-foreground">{r.conditions || '—'}</td>
                      <td className="py-1.5 pr-2 text-muted-foreground">{r.wave_height || '—'}</td>
                      <td className="py-1.5 pr-2 text-muted-foreground whitespace-nowrap">
                        {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                      </td>
                      <td className="py-1.5 pr-2">
                        {r.influences_rating_now
                          ? <Badge variant="outline" className="text-amber-500 border-amber-500/40">live</Badge>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-1.5 text-right">
                        <Button
                          size="sm" variant="ghost" aria-label="Delete report"
                          disabled={deleting === r.id}
                          onClick={() => handleDeleteReport(r.id)}
                        >
                          {deleting === r.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5 text-red-500" />}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminSurfForecastPanel;
