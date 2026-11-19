/**
 * ForecastDataHealth - Admin > Surf Forecast > Data and ingest health.
 *
 * Reads GET /api/health/data, the same report the external uptime monitor polls: it is computed from the SERVED
 * manifest on read (no database, no forecast fetch), so it is cheap enough for the panel's 60-second refresh and it
 * catches a dead ingest cron even when the cron never runs. The endpoint answers 503 when the verdict is critical;
 * that body is still the report, so it is shown, not treated as a load failure.
 *
 * Per lane (model / domain, plus the precomputed ratings lane): verdict, how old the newest run is, how far it lags
 * the freshest lane, how far ahead its forecast reaches, the model cycle's age and status, and its source. The
 * thresholds the verdicts were judged against are shown beside them.
 *
 * Themes: semantic tokens; the verdict is always a word (OK / Warning / Critical), never colour alone.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, Loader2 } from 'lucide-react';
import apiClient from '../../lib/apiClient';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

const VERDICT = { ok: 'OK', warn: 'Warning', critical: 'Critical' };

export function verdictText(v) {
  return VERDICT[v] || (v ? String(v) : 'Unknown');
}

function hours(v) {
  return v === null || v === undefined ? '—' : `${Number(v).toFixed(1)} h`;
}

export async function loadDataHealth() {
  try {
    const res = await apiClient.get('/health/data');
    return { report: res.data, error: '' };
  } catch (err) {
    const body = err?.response?.data;
    if (body && typeof body === 'object' && body.status) return { report: body, error: '' };   // 503 = critical report
    return { report: null, error: 'Could not reach the data-health check.' };
  }
}

export default function ForecastDataHealth({ refreshKey = 0 }) {
  const [state, setState] = useState({ loading: true, report: null, error: '' });

  const load = useCallback(async () => {
    const next = await loadDataHealth();
    setState({ loading: false, ...next });
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const { loading, report, error } = state;
  const lanes = Object.entries(report?.lanes || {});
  const th = report?.thresholds;

  return (
    <Card className="bg-card border-border" data-testid="forecast-data-health">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm text-foreground">
          <Activity className="h-4 w-4" aria-hidden="true" /> Data and ingest health
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Freshness of every forecast lane, from the manifest the map is served from. The same check an external
          uptime monitor polls (/api/health/data).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p role="status" className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Checking data health…
          </p>
        ) : error ? (
          <p role="alert" className="text-sm text-foreground">{error}</p>
        ) : (
          <>
            <p role={report.status === 'critical' ? 'alert' : 'status'}
              className="rounded-lg border border-border bg-muted/40 p-2 text-sm text-foreground">
              Overall: <strong>{verdictText(report.status)}</strong>
              {report.freshest_run_age_h != null && ` · freshest run ${hours(report.freshest_run_age_h)} old`}
              {report.generated_at && ` · checked ${new Date(report.generated_at).toLocaleString()}`}
              {report.manifest_written_by && ` · manifest written by ${report.manifest_written_by}`}
            </p>

            {(report.alerts || []).length > 0 && (
              <ul aria-label="Data-health alerts" className="space-y-1">
                {report.alerts.map((a) => (
                  <li key={a} className="flex items-start gap-1.5 text-xs text-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{a}
                  </li>
                ))}
              </ul>
            )}

            {lanes.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <caption className="sr-only">Forecast lanes and their freshness</caption>
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      {['Lane', 'Status', 'Newest run age', 'Lags freshest', 'Reaches ahead', 'Model cycle', 'Source'].map((h) => (
                        <th key={h} scope="col" className="whitespace-nowrap py-1.5 pr-3 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lanes.map(([name, lane]) => (
                      <tr key={name} className="border-b border-border/50 last:border-0" data-testid={`lane-${name}`}>
                        <th scope="row" className="whitespace-nowrap py-1.5 pr-3 text-left font-mono font-normal text-foreground">{name}</th>
                        <td className="py-1.5 pr-3 text-foreground">
                          {verdictText(lane.verdict)}{lane.reason ? ` (${lane.reason})` : ''}
                        </td>
                        <td className="py-1.5 pr-3 text-muted-foreground">{hours(lane.age_h)}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground">{hours(lane.lag_h)}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground">
                          {lane.frames != null ? `${lane.frames} frames` : hours(lane.horizon_h)}
                        </td>
                        <td className="py-1.5 pr-3 text-muted-foreground">
                          {lane.model_cycle_age_h != null ? hours(lane.model_cycle_age_h) : '—'}
                          {lane.model_cycle_status ? ` (${String(lane.model_cycle_status).replace(/_/g, ' ')})` : ''}
                        </td>
                        <td className="py-1.5 pr-3 text-muted-foreground">{lane.source || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {th && (
              <p className="text-xs text-muted-foreground" data-testid="health-thresholds">
                Limits: a lane is a warning when it lags the freshest by more than {hours(th.stale_h)}, critical when
                its newest run is older than {hours(th.critical_h)}. Minimum reach ahead:{' '}
                {Object.entries(th.min_horizon_h || {}).map(([m, h]) => `${m} ${hours(h)}`).join(', ')}
                {th.euro_short_cycle_reach_h != null && ` (EURO 06/18Z cycles: ${hours(th.euro_short_cycle_reach_h)} from the cycle)`}.
                Precomputed ratings: warning after {hours(th.ratings_warn_h)}, critical after {hours(th.ratings_critical_h)}.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
