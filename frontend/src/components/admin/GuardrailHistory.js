/**
 * GuardrailHistory - Admin > Surf Forecast > Guardrail (D-065).
 *
 * Fixes ship on; the guardrail workflow (flag-guardrail.yml, every 6 hours) scores each guarded fix on vs off and can
 * turn one OFF through the runtime manifest. This view shows, read-only (GET /admin/surf-forecast/guardrail):
 *  - what the guardrail has set right now, with its reason, who, when and evidence;
 *  - every decision it applied (disable / clear), newest first;
 *  - how a fix comes back on: a new fix version in the code, or the owner's words through the workflow's manual run.
 *    That run is deliberately NOT a button here: the guardrail workflow is the only writer of the manifest.
 *
 * Themes: semantic tokens, state in words. ARIA: tables with scoped headers, a labelled copy button, links named.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, History, Loader2 } from 'lucide-react';
import apiClient from '../../lib/apiClient';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';

export function reenableCommand(flag) {
  return `gh workflow run flag-guardrail.yml -f reenable=${flag} -f owner_words="<your words, verbatim>"`;
}

function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

function CopyCommand({ flag }) {
  const [copied, setCopied] = useState(false);
  const cmd = reenableCommand(flag);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <code className="break-all rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] text-foreground">{cmd}</code>
      <Button size="sm" variant="outline" onClick={copy} aria-label={`Copy the re-enable command for ${flag}`}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export default function GuardrailHistory({ refreshKey = 0 }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/admin/surf-forecast/guardrail');
      setState({ loading: false, data: res.data, error: '' });
    } catch {
      setState({ loading: false, data: null, error: 'Could not load the guardrail record.' });
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const { loading, data, error } = state;
  const entries = Object.entries(data?.entries || {});
  const actions = data?.actions || [];

  return (
    <Card className="bg-card border-border" data-testid="guardrail-history">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm text-foreground">
          <History className="h-4 w-4" aria-hidden="true" /> Guardrail (D-065)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Fixes ship on. Every 6 hours ({data?.schedule_utc || '02:30, 08:30, 14:30 and 20:30 UTC'}) the guardrail scores
          each guarded fix on against off and can turn one off, with a written reason, through the runtime manifest. It
          only writes when the repository variable FLAG_GUARDRAIL_ENFORCE is 1; otherwise it reports in its GitHub issue.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p role="status" className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Loading the guardrail record…
          </p>
        ) : error ? (
          <p role="alert" className="text-sm text-foreground">{error}</p>
        ) : (
          <>
            {(data.errors || []).map((e) => <p key={e} role="alert" className="text-xs text-foreground">{e}</p>)}

            <section aria-label="Set by the guardrail now" className="space-y-2">
              <h3 className="text-xs font-semibold text-foreground">Set right now</h3>
              {entries.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nothing: every guarded fix runs on its code default or an environment value.
                </p>
              ) : (
                <ul className="space-y-2">
                  {entries.map(([flag, e]) => {
                    const code = data.guarded?.[flag];
                    const newer = e.state === 'off' && code?.fix_version && e.fix_version && code.fix_version !== e.fix_version;
                    return (
                      <li key={flag} className="rounded-lg border border-border p-2 text-xs" data-testid={`guardrail-entry-${flag}`}>
                        <p className="text-foreground">
                          <code className="font-mono">{flag}</code>: <strong>{e.state === 'off' ? 'OFF' : 'ON'}</strong>
                          {e.set_by ? ` by ${e.set_by}` : ''}{e.set_at ? `, ${when(e.set_at)}` : ''}
                        </p>
                        {e.reason && <p className="text-muted-foreground">{e.reason}</p>}
                        {e.evidence && (
                          /^https?:\/\//.test(e.evidence)
                            ? <a href={e.evidence} target="_blank" rel="noopener noreferrer" className="text-foreground underline">Evidence (guardrail run)</a>
                            : <p className="text-muted-foreground">Evidence: {e.evidence}</p>
                        )}
                        {e.state === 'off' && (
                          <div className="mt-1 text-foreground">
                            <p>
                              Comes back on with a new fix version in the code (now {code?.fix_version || '—'})
                              {newer ? ': a newer version is in the code, so the next run clears this' : ''}, or with your
                              words through the workflow&apos;s manual run:
                            </p>
                            <CopyCommand flag={flag} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {data.workflow_url && (
                <a href={data.workflow_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-foreground underline">
                  Open the guardrail workflow on GitHub <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </section>

            <section aria-label="Guardrail decisions" className="space-y-2">
              <h3 className="text-xs font-semibold text-foreground">Decisions it applied</h3>
              {actions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  None recorded. The guardrail records only the decisions it applies (enforce mode); while it runs as a
                  dry run, its findings are in the &quot;Flag guardrail&quot; GitHub issue and the run summaries.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <caption className="sr-only">Guardrail decisions, newest first</caption>
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        {['When', 'Flag', 'Action', 'Reason', 'Run'].map((h) => (
                          <th key={h} scope="col" className="py-1.5 pr-3 text-left font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {actions.map((a, i) => (
                        <tr key={`${a.at}-${a.flag}-${i}`} className="border-b border-border/50 align-top last:border-0">
                          <th scope="row" className="whitespace-nowrap py-1.5 pr-3 text-left font-normal text-foreground">{when(a.at)}</th>
                          <td className="py-1.5 pr-3 font-mono text-foreground">{a.flag}</td>
                          <td className="py-1.5 pr-3 text-foreground">{a.action === 'disable' ? 'Turned off' : a.action === 'clear' ? 'Cleared (back on)' : a.action}</td>
                          <td className="py-1.5 pr-3 text-muted-foreground">{a.reason || '—'}</td>
                          <td className="py-1.5 pr-3">
                            {a.run && /^https?:\/\//.test(a.run)
                              ? <a href={a.run} target="_blank" rel="noopener noreferrer" className="text-foreground underline" aria-label={`Guardrail run for ${a.flag}, ${when(a.at)}`}>Run</a>
                              : <span className="text-muted-foreground">{a.run || '—'}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
