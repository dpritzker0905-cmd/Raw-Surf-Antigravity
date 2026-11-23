/**
 * VerificationPanel - Admin > Surf Forecast > Verification and skill (Fable inspection 2026-11-23, P1-6 and P1-4).
 *
 * READ-ONLY. Shows what exists today (GET /admin/surf-forecast/verification, from the CI ops snapshot that
 * admin-ops-snapshot.yml writes every 6 h; the serve box reads one small object):
 *  - the skill ledger's pending queue against its cap (headroom BEFORE eviction: at the cap the +72 h rows go first);
 *  - served-wave verify: the LOCKED-holdout state in words (NOT_READ until #1199's list is frozen), sampler and score
 *    counts. Never a station id: LOCKED buoys must not appear anywhere;
 *  - the gust-verify record's object counts;
 *  - the last runs of the tide gates, scorers, collectors and the guardrail (conclusion, time, link);
 *  - the guardrail's coverage: which guarded flags its replay is BLIND to, and which of those are ON now;
 *  - memory_audit's overdue read-backs; the newest SCOREBOARD rows;
 *  - drift alerts: a reserved list the research lead's loop will fill (empty today, said so in words).
 * THEMES: semantic tokens only, state in words. ARIA: headed sections, captioned tables, a labelled progressbar,
 * named links, real buttons and <details>.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, Gauge } from 'lucide-react';
import apiClient from '../../lib/apiClient';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';

function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

const HOLDOUT_TEXT = {
  NOT_READ: 'Collect-only: the scorer reads nothing and publishes no score until the LOCKED holdout list (#1199) is frozen and committed.',
  READY: 'The LOCKED holdout list is frozen; the scorer excludes those buoys from every table.',
};

export function queueText(p) {
  if (!p || p.error) return p?.error ? `Could not read the queue: ${p.error}` : 'Not reported';
  if (p.cap == null) return `${p.entries ?? '?'} rows pending (cap unknown)`;
  return `${p.entries} of ${p.cap} rows (${p.fill_pct}% full, ${p.headroom} rows of headroom before eviction)`;
}

function Section({ title, children }) {
  return (
    <section className="space-y-1.5" aria-label={title}>
      <h3 className="text-xs font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Count({ label, c }) {
  if (!c) return <p className="text-xs text-muted-foreground">{label}: not reported</p>;
  if (c.error) return <p role="alert" className="text-xs text-foreground">{label}: could not read ({c.error})</p>;
  return (
    <p className="text-xs text-foreground">
      {label}: {c.objects}{c.truncated ? '+' : ''} objects{c.newest ? `, newest ${when(c.newest)}` : ''}
    </p>
  );
}

function QueueBar({ p }) {
  const pct = typeof p?.fill_pct === 'number' ? Math.min(100, Math.max(0, p.fill_pct)) : null;
  return (
    <div className="space-y-1">
      <p className="text-xs text-foreground">{queueText(p)}</p>
      {pct != null && (
        <div role="progressbar" aria-label="Skill ledger pending queue fill" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={pct} aria-valuetext={`${pct}% full`} className="h-2 w-full rounded bg-muted">
          <div className="h-2 rounded bg-primary" style={{ width: `${pct}%` }} />
        </div>
      )}
      {p?.beyond_48h != null && (
        <p className="text-xs text-muted-foreground">
          {p.beyond_48h} pending rows target more than 48 h ahead: at the cap these are evicted first, so the +72 h lead loses its scores.
        </p>
      )}
    </div>
  );
}

function Runs({ rows }) {
  if (!rows?.length) return <p className="text-xs text-muted-foreground">No run history in the snapshot.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">Last runs of the verification workflows</caption>
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th scope="col" className="py-1 pr-2 text-left font-medium">Workflow</th>
            <th scope="col" className="py-1 pr-2 text-left font-medium">Last run</th>
            <th scope="col" className="py-1 text-left font-medium">Before that</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => {
            const [last, ...rest] = w.runs || [];
            return (
              <tr key={w.workflow} className="border-b border-border/50 last:border-0">
                <th scope="row" className="py-1 pr-2 text-left font-normal text-foreground">{w.label}</th>
                <td className="py-1 pr-2 text-foreground">
                  {w.error ? `could not read (${w.error})` : !last ? 'never run' : (
                    <a href={last.url} target="_blank" rel="noreferrer" className="underline underline-offset-2"
                      aria-label={`${w.label}: ${last.conclusion || last.status}, ${when(last.createdAt)} (opens GitHub)`}>
                      {last.conclusion || last.status}, {when(last.createdAt)}
                      <ExternalLink className="ml-1 inline h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                </td>
                <td className="py-1 text-muted-foreground">{rest.map((r) => r.conclusion || r.status).join(', ') || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Scoreboard({ sb }) {
  const [all, setAll] = useState(false);
  if (!sb) return <p className="text-xs text-muted-foreground">Not reported</p>;
  if (sb.error) return <p role="alert" className="text-xs text-foreground">Could not read SCOREBOARD.md ({sb.error})</p>;
  const rows = [...(sb.rows || [])].reverse();
  const shown = all ? rows : rows.slice(0, 12);
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{sb.total} rows in all; newest first.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">Newest SCOREBOARD rows</caption>
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              {['When (UTC)', 'Id', 'Metric', 'Value'].map((h) => (
                <th key={h} scope="col" className="py-1 pr-2 text-left font-medium">{h}</th>))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={`${r.date}-${i}`} className="border-b border-border/50 align-top last:border-0">
                <td className="whitespace-nowrap py-1 pr-2 text-muted-foreground">{r.date}</td>
                <td className="py-1 pr-2 text-foreground">{r.id}</td>
                <td className="py-1 pr-2 break-words text-foreground">{r.metric}</td>
                <td className="py-1 break-words text-foreground">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 12 && (
        <Button size="sm" variant="outline" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Show the newest 12' : `Show all ${rows.length} rows in the snapshot`}
        </Button>
      )}
    </div>
  );
}

function Overdue({ ma }) {
  if (!ma) return <p className="text-xs text-muted-foreground">Not reported</p>;
  if (ma.error) return <p role="alert" className="text-xs text-foreground">memory_audit could not run ({ma.error})</p>;
  return (
    <div className="space-y-1">
      <p className="text-xs text-foreground">
        {ma.overdue_total} overdue read-backs, {ma.open_total} open (memory_audit --docs-only: {ma.fail} FAIL, {ma.warn} WARN).
      </p>
      {ma.overdue?.length > 0 && (
        <details className="rounded-lg border border-border p-2">
          <summary className="cursor-pointer text-xs font-medium text-foreground">The overdue read-backs ({ma.overdue.length} listed)</summary>
          <ul className="mt-1 space-y-1 text-xs">
            {ma.overdue.map((o, i) => (
              <li key={`${o.where}-${i}`} className="break-words text-foreground">
                <span className="text-muted-foreground">due {o.due}</span> · {o.target}
                {o.check ? <span className="text-muted-foreground"> — {o.check}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Coverage({ cov }) {
  if (!cov) return null;
  if (cov.error) return <p className="text-xs text-muted-foreground">{cov.error}</p>;
  const by = cov.by_class || {};
  return (
    <div className="space-y-1 text-xs">
      <p className="text-foreground">
        {cov.guarded} guarded flags: {Object.entries(by).map(([k, v]) => `${v.length} ${k === 'blind' ? 'BLIND' : k}`).join(', ')}.
      </p>
      {cov.blind_effectively_on?.length > 0 && (
        <p className="break-words text-foreground">
          ON now and BLIND to the guardrail&apos;s replay (only the sanity sweep and the owner can turn these off):{' '}
          {cov.blind_effectively_on.join(', ')}.
        </p>
      )}
    </div>
  );
}

export default function VerificationPanel({ refreshKey = 0 }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/admin/surf-forecast/verification');
      if (!res?.data || typeof res.data.verification !== 'object') throw new Error('bad shape');
      setState({ loading: false, data: res.data, error: '' });
    } catch {
      setState({ loading: false, data: null, error: 'Could not load the verification view.' });
    }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const { loading, data, error } = state;
  const v = data?.verification || {};
  const sw = v.served_wave || {};
  const snap = data?.snapshot || {};

  return (
    <Card className="bg-card border-border" data-testid="verification-panel">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm text-foreground">
          <Gauge className="h-4 w-4" aria-hidden="true" /> Verification and skill (read-only)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          What the program measures today, from the ops snapshot ({data?.workflow || 'admin-ops-snapshot.yml'}, every 6 hours).
          Nothing here runs a job or changes a flag.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <p role="status" className="text-sm text-muted-foreground">Loading verification…</p>}
        {error && <p role="alert" className="text-sm text-foreground">{error}</p>}
        {data && (
          <>
            <p role={snap.status === 'ok' ? 'status' : 'alert'}
              className="rounded-lg border border-border bg-muted/40 p-2 text-xs text-foreground">
              {snap.status !== 'ok' && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />}
              {snap.status === 'ok' || snap.status === 'stale'
                ? `Snapshot built ${when(data.generated_at)} (${snap.age_h} h ago${snap.status === 'stale' ? ', STALE: the job has missed runs' : ''}) at commit ${data.commit || '—'}.`
                : snap.error || 'No snapshot could be read.'}
              {data.run_url && (
                <> <a href={data.run_url} target="_blank" rel="noreferrer" className="underline underline-offset-2">Open the run that built it</a></>
              )}
            </p>
            <Section title="Skill ledger pending queue">
              <QueueBar p={v.skill_pending} />
            </Section>
            <Section title="Served-wave verify">
              <p className="text-xs text-foreground">
                {sw.error ? `Could not read the holdout state (${sw.error}).` : (HOLDOUT_TEXT[sw.holdout] || sw.reason || 'Not reported')}
                {sw.holdout_error ? ` ${sw.reason}` : ''}
              </p>
              <Count label="Sampler archive (served frames at the buoys)" c={sw.sampler} />
              <Count label="Buoy truth snapshots" c={sw.truth_snapshots} />
              <Count label="Published score tables" c={sw.scores} />
            </Section>
            <Section title="Gust-verify record">
              <Count label="Model cycles" c={v.gust_verify?.cycles} />
              <Count label="Buoy observations" c={v.gust_verify?.obs} />
            </Section>
            <Section title="Tide gates, scorers and collectors (last runs)">
              <Runs rows={v.workflows} />
            </Section>
            <Section title="Guardrail coverage of the guarded flags">
              <Coverage cov={data.coverage} />
            </Section>
            <Section title="Overdue read-backs">
              <Overdue ma={v.memory_audit} />
            </Section>
            <Section title="SCOREBOARD">
              <Scoreboard sb={v.scoreboard} />
            </Section>
            <Section title="Drift alerts">
              {data.alerts?.length ? (
                <ul className="space-y-1 text-xs">
                  {data.alerts.map((a, i) => (
                    <li key={a.id || i} className="break-words text-foreground">{a.rule || a.id}: {a.scope || ''} {a.severity ? `(${a.severity})` : ''}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No drift alerts are produced yet; the research lead&apos;s per-buoy and per-region rules will list here.</p>
              )}
            </Section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
