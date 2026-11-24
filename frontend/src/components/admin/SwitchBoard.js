/**
 * SwitchBoard - Admin > Surf Forecast > Switches (Fable inspection 2026-11-23, P0-3 and P1-4).
 *
 * EVERY switch and lane setting (GET /admin/surf-forecast/switches), found by scanning the code and the workflows, not
 * a hand-kept list. Each row says its TRUE effective state and where each value comes from, separately:
 *  - this server: an explicit env value, the guardrail's runtime manifest (guarded flags), or the code default;
 *  - each workflow lane: a literal in the workflow file, a repository variable (from the ops snapshot), the workflow's
 *    fallback when the variable is unset, or "set in CI" when no snapshot could be read (never a guess).
 * A switch the ingest lanes run ON through a repository variable therefore reads ON, never "Off, code default".
 * Guarded flags also show the guardrail's coverage class (replay / rating / volume / ledger / BLIND).
 *
 * READ-ONLY: nothing here changes a switch. Repository variables are not secrets; credential-like names are never
 * listed by the server. THEMES: semantic tokens only, state always in words. ARIA: a labelled search, a radio group of
 * filters, a live count, real buttons, a captioned table.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Search, ToggleLeft } from 'lucide-react';
import apiClient from '../../lib/apiClient';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { useThemeName } from '../../contexts/ThemeContext';

const PAGE = 60;

export const SWITCH_GROUPS = [
  { id: 'all', label: 'All' },
  { id: 'changed', label: 'Changed from default' },
  { id: 'lanes', label: 'Set in a workflow lane' },
  { id: 'unknown', label: 'Not known here' },
  { id: 'unregistered', label: 'Not in the flag registry' },
  { id: 'guarded', label: 'Guarded (D-065)' },
  { id: 'blind', label: 'Guardrail blind' },
  { id: 'settings', label: 'Settings' },
];

export function matchesSwitchGroup(s, group) {
  switch (group) {
    case 'changed': return !!s.differs_from_default;
    case 'lanes': return (s.lanes || []).length > 0;
    case 'unknown': return s.state === 'unknown' || (s.lanes_unknown || 0) > 0;
    case 'unregistered': return !s.registered;
    case 'guarded': return !!s.guarded;
    case 'blind': return s.coverage?.class === 'blind';
    case 'settings': return s.kind !== 'switch';
    default: return true;
  }
}

const STATE_TEXT = {
  on: 'On', off: 'Off', mixed: 'Mixed: on in some places, off in others', unknown: 'Not known here (set in CI)',
  setting: 'Setting',
};

export function stateText(s) {
  return STATE_TEXT[s.state] || s.state;
}

const SERVER_SOURCE = {
  env: 'set by this server\'s environment', manifest: 'set by the guardrail manifest', default: 'code default',
  unknown: 'no single code default',
};

export function serverText(s) {
  const v = s.server?.value;
  const src = SERVER_SOURCE[s.server?.source] || s.server?.source;
  return `This server reads ${v == null ? '(not shown)' : v} (${src})`;
}

export function laneText(l) {
  const v = l.value == null || l.value === '' ? 'not known here' : l.value;
  return `${l.workflow}: ${v} (${l.source})`;
}

function SwitchRow({ s }) {
  const entry = s.server?.entry;
  return (
    <li className="border-b border-border/50 py-2 last:border-0" data-testid={`switch-${s.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <code className="break-all text-xs font-mono text-foreground">{s.name}</code>
        <Badge variant="outline" className="text-foreground">{stateText(s)}</Badge>
        {s.defaults?.length > 0 && (
          <span className="text-xs text-muted-foreground">code default {s.defaults.join(' / ')}</span>
        )}
        {s.differs_from_default && <span className="text-xs font-medium text-foreground">· changed from default</span>}
        {!s.registered && <span className="text-xs text-muted-foreground">· not in the flag registry</span>}
        {s.guarded && (
          <span className="text-xs text-muted-foreground">
            · guarded, fix version {s.fix_version || '—'}
            {s.coverage ? `, guardrail coverage: ${s.coverage.class === 'blind' ? 'BLIND' : s.coverage.class}` : ''}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-foreground">{serverText(s)}</p>
      {entry && (
        <p className="mt-1 rounded border border-border bg-muted/40 p-1.5 text-xs text-foreground">
          Guardrail: {entry.state === 'off' ? 'turned OFF' : 'turned ON'}{entry.reason ? ` — ${entry.reason}` : ''}
          {entry.set_by ? ` (by ${entry.set_by})` : ''}
        </p>
      )}
      {(s.lanes || []).length > 0 && (
        <ul className="mt-0.5 list-disc pl-5 text-xs text-foreground" aria-label={`Workflow lanes for ${s.name}`}>
          {s.lanes.map((l, i) => <li key={`${l.workflow}-${i}`} className="break-words">{laneText(l)}</li>)}
        </ul>
      )}
      {s.guarded && s.coverage?.class === 'blind' && (
        <p className="mt-0.5 text-xs text-muted-foreground">Why the guardrail cannot score it: {s.coverage.why}</p>
      )}
      {s.controls && <p className="mt-0.5 text-xs text-muted-foreground">{s.controls}</p>}
      {s.where && <p className="text-xs text-muted-foreground">Change it in: {s.where}</p>}
      {!s.controls && s.files?.length > 0 && (
        <p className="text-xs text-muted-foreground break-all">Read in: {s.files.join(', ')}{s.file_count > s.files.length ? ` and ${s.file_count - s.files.length} more` : ''}</p>
      )}
    </li>
  );
}

function SnapshotLine({ snapshot, known }) {
  if (!snapshot) return null;
  const bad = snapshot.status !== 'ok';
  const text = snapshot.status === 'ok'
    ? `Repository variables from the ops snapshot of ${snapshot.generated_at || '—'} (${snapshot.age_h ?? '?'} h old).`
    : snapshot.status === 'stale'
      ? `The ops snapshot is ${snapshot.age_h} h old (${snapshot.workflow} runs every 6 h, so it has missed runs): lanes that read a repository variable show "not known here" until it runs again.`
      : `${snapshot.error || 'The ops snapshot could not be read.'} Lanes that read a repository variable show "not known here".`;
  return (
    <p role={bad ? 'alert' : 'status'} className="rounded-lg border border-border bg-muted/40 p-2 text-xs text-foreground">
      {bad && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />}
      {text}{!known && snapshot.status === 'ok' ? ' (no variables in it)' : ''}
    </p>
  );
}

function RepoVars({ rows }) {
  if (!rows?.length) return null;
  return (
    <details className="rounded-lg border border-border p-2">
      <summary className="cursor-pointer text-xs font-medium text-foreground">
        Repository variables ({rows.filter((r) => r.set).length} set, {rows.length} known)
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">Repository variables, their values and the switches that read them</caption>
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th scope="col" className="py-1 pr-2 text-left font-medium">Variable</th>
              <th scope="col" className="py-1 pr-2 text-left font-medium">Value</th>
              <th scope="col" className="py-1 text-left font-medium">Read by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-b border-border/50 last:border-0">
                <td className="py-1 pr-2"><code className="break-all text-foreground">{r.name}</code></td>
                <td className="py-1 pr-2 text-foreground">{!r.set ? 'unset' : (r.value == null ? '(not shown)' : r.value)}</td>
                <td className="py-1 break-words text-muted-foreground">{r.read_by.length ? r.read_by.join(', ') : 'no workflow reads it'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default function SwitchBoard({ refreshKey = 0, onUnavailable }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('changed');
  const [limit, setLimit] = useState(PAGE);
  const fieldBg = useThemeName() === 'beach' ? 'bg-amber-50' : 'bg-background';

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/admin/surf-forecast/switches');
      if (!Array.isArray(res?.data?.switches)) throw new Error('no switches');
      setState({ loading: false, data: res.data, error: '' });
    } catch {
      setState({ loading: false, data: null, error: 'Could not load the switch board.' });
      if (onUnavailable) onUnavailable();
    }
  }, [onUnavailable]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const switches = useMemo(() => state.data?.switches || [], [state.data]);
  const counts = useMemo(() => Object.fromEntries(
    SWITCH_GROUPS.map((g) => [g.id, switches.filter((s) => matchesSwitchGroup(s, g.id)).length])), [switches]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return switches.filter((s) => matchesSwitchGroup(s, group)
      && (!q || s.name.toLowerCase().includes(q) || (s.controls || '').toLowerCase().includes(q)
        || (s.lanes || []).some((l) => l.workflow.toLowerCase().includes(q))));
  }, [switches, query, group]);

  if (state.loading) return <p role="status" className="text-sm text-muted-foreground">Loading switches…</p>;
  if (state.error) return null;      // the panel falls back to the registered-flag board
  const c = state.data.counts || {};

  return (
    <Card className="bg-card border-border" data-testid="switch-board">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm text-foreground">
          <ToggleLeft className="h-4 w-4" aria-hidden="true" /> Switches and settings: true state, every source
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {c.switches} switches and {c.settings} settings found by scanning the code and the workflows ({c.registered} in the
          flag registry, {c.unregistered} not). Each row gives what this server reads and what each workflow lane runs with.
          Nothing on this page changes a switch.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <SnapshotLine snapshot={state.data.snapshot} known={state.data.repo_vars_known} />
        <div className="relative">
          <label htmlFor="switch-search" className="sr-only">Search switches</label>
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input id="switch-search" type="search" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }}
            placeholder="Search by name, what it controls or a workflow"
            className={`h-9 w-full rounded-md border border-border ${fieldBg} pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring`} />
        </div>
        <fieldset>
          <legend className="sr-only">Show switches</legend>
          <div className="flex flex-wrap gap-2">
            {SWITCH_GROUPS.map((g) => {
              const id = `switch-group-${g.id}`;
              const checked = group === g.id;
              return (
                <label key={g.id} htmlFor={id}
                  className={`flex min-h-[36px] cursor-pointer items-center rounded-lg border px-3 py-1.5 text-xs focus-within:ring-2 focus-within:ring-ring
                    ${checked ? 'border-primary bg-primary/15 font-semibold text-foreground' : 'border-border bg-card text-foreground hover:bg-muted'}`}>
                  <input id={id} type="radio" name="switch-group" value={g.id} checked={checked}
                    aria-label={`${g.label} (${counts[g.id]})`} onChange={() => { setGroup(g.id); setLimit(PAGE); }}
                    className="sr-only" />
                  {g.label} ({counts[g.id]})
                </label>
              );
            })}
          </div>
        </fieldset>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Showing {Math.min(limit, shown.length)} of {shown.length} matching ({switches.length} in all)
        </p>
        <ul aria-label="Switches">
          {shown.slice(0, limit).map((s) => <SwitchRow key={s.name} s={s} />)}
        </ul>
        {shown.length > limit && (
          <Button size="sm" variant="outline" onClick={() => setLimit((n) => n + PAGE)}>
            Show {Math.min(PAGE, shown.length - limit)} more
          </Button>
        )}
        <RepoVars rows={state.data.repo_vars} />
      </CardContent>
    </Card>
  );
}
