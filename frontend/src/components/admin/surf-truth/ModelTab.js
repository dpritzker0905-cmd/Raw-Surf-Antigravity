import React, { useState } from 'react';
import { toast } from 'sonner';
import apiClient from '../../../lib/apiClient';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { ViewState, formatWhen, useAdminGet } from './shared';

const FACTS = [
  'No model has been fitted, and nothing in this area changes a surf height anyone sees.',
  'The fit is written and its test was written down before any fit (pre-registered). The research lead reviews the exact code before any run, and each version of the code may be scored once.',
  'The model holds the average anchor bias at zero, estimates each observer\'s own bias and noise, and learns how much people under-read the face only from physical checks (photos with a scale, satellite, shallow buoys).',
  'The fit reads only private, pseudonymized exports: no names, no profile ids, no device or photo positions, no photo links; times to the minute.',
];

/** The export run dialog: an export is personal data in private storage, so running one is a deliberate act. */
function ExportDialog({ open, onClose, onDone }) {
  const [approved, setApproved] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  if (!open) return null;
  const run = async () => {
    setRunning(true);
    setError('');
    try {
      const res = await apiClient.post('/admin/surf-truth/export');
      setResult(res.data);
      toast.success('Export written to private storage.');
      onDone();
    } catch (err) {
      setError(err?.response?.data?.detail?.toString?.() || 'The export did not run.');
    } finally {
      setRunning(false);
    }
  };
  const close = () => { setApproved(false); setResult(null); setError(''); onClose(); };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="bg-background text-foreground border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Run a surf-truth export</DialogTitle>
          <DialogDescription>
            Writes the blind observations, pseudonymized, to private storage for the forecast model. It is personal data:
            run it only after the owner has approved the retention rule and the consent rule. The server refuses while
            the export key is not set.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <p role="status" className="text-sm text-foreground">
            Written: {result.rows} rows, run {result.run_id}.
          </p>
        ) : (
          <label htmlFor="export-approved" className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
            <input id="export-approved" type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)}
              aria-label="The owner has approved exports (retention and consent)" className="mt-0.5 h-4 w-4" />
            The owner has approved exports (retention and consent).
          </label>
        )}
        {error && <p role="alert" className="text-sm text-foreground">{error}</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={close}>{result ? 'Close' : 'Cancel'}</Button>
          {!result && <Button onClick={run} disabled={!approved || running}>{running ? 'Running…' : 'Run export'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ModelTab() {
  const actions = useAdminGet('/admin/surf-truth/actions?limit=200');
  const [open, setOpen] = useState(false);
  const exports = (actions.data || []).filter((a) => a.action === 'export');
  return (
    <div className="space-y-4">
      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-base text-foreground">Truth model</CardTitle></CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            {FACTS.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-base text-foreground">Exports for the model</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Each export is logged with who ran it. Exports go to private storage only and are never shown here.
          </p>
          <Button onClick={() => setOpen(true)}>Run an export…</Button>
          <ViewState loading={actions.loading} error={actions.error} empty={!exports.length} emptyText="No exports yet.">
            <ul className="space-y-2" aria-label="Exports, newest first">
              {exports.map((a) => (
                <li key={a.id} className="rounded-lg border border-border p-2 text-sm">
                  <span className="font-medium text-foreground">Run {a.target_id}</span>
                  <span className="text-muted-foreground"> · {formatWhen(a.at)} · by {a.admin_name || a.admin_id}</span>
                  {a.detail && (
                    <span className="block text-xs text-muted-foreground">
                      {a.detail.rows != null ? `${a.detail.rows} rows` : ''}{a.detail.object ? ` · ${a.detail.object}` : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </ViewState>
        </CardContent>
      </Card>
      <ExportDialog open={open} onClose={() => setOpen(false)} onDone={() => actions.reload()} />
    </div>
  );
}
