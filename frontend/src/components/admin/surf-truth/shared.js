/**
 * Shared bits for the admin "Surf truth" area: a fetch hook and the one anchor-status dialog.
 *
 * The status dialog is the ONLY way this area changes anything about a person: it sets an anchor status with a
 * required reason through POST /admin/surf-truth/anchors/{id}/status, which writes the anchor's event log and the
 * admin action log. Nothing here edits a reported number (brief item E).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import apiClient from '../../../lib/apiClient';
import logger from '../../../utils/logger';
import { Button } from '../../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Textarea } from '../../ui/textarea';

export const ANCHOR_STATUSES = [
  { value: 'active', label: 'Active', help: 'Sets the scale everyone else is calibrated against.' },
  { value: 'probation', label: 'Probation', help: 'Recorded and watched; does not set the scale.' },
  { value: 'suspended', label: 'Suspended', help: 'Treated as an ordinary observer again.' },
];

export function useAdminGet(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(path);
      setData(res.data);
      setError(null);
    } catch (err) {
      logger.error(`[surf-truth] ${path} failed:`, err);
      setError(err?.response?.status === 403 ? 'Admin access required.' : 'Could not load this view.');
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load };
}

export function formatWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function ViewState({ loading, error, empty, emptyText, children }) {
  if (loading) return <p className="text-sm text-muted-foreground" role="status">Loading…</p>;
  if (error) return <p className="text-sm text-destructive" role="alert">{error}</p>;
  if (empty) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return children;
}

export function StatusBadge({ status }) {
  if (!status) return <span className="text-xs text-muted-foreground">not an anchor</span>;
  const tone = {
    active: 'border-emerald-500/50 bg-emerald-500/10',
    probation: 'border-amber-500/50 bg-amber-500/10',
    suspended: 'border-border bg-muted',
  }[status] || 'border-border';
  // Text carries the meaning; the tint is only a second cue (information never by colour alone).
  return <span className={`inline-block rounded-md border px-2 py-0.5 text-xs text-foreground ${tone}`}>{status}</span>;
}

export function AnchorStatusDialog({ target, onClose, onDone }) {
  const [status, setStatus] = useState('probation');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (target) {
      setStatus(target.current === 'probation' ? 'active' : 'probation');
      setReason('');
    }
  }, [target]);
  if (!target) return null;
  const options = ANCHOR_STATUSES.filter((s) => s.value !== target.current);
  const submit = async () => {
    setSaving(true);
    try {
      await apiClient.post(`/admin/surf-truth/anchors/${encodeURIComponent(target.profileId)}/status`,
        { status, reason: reason.trim() });
      toast.success(`${target.name || 'Observer'} is now ${status}.`);
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.detail?.toString?.() || 'Status change failed.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-background text-foreground border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Anchor status: {target.name || target.profileId}</DialogTitle>
          <DialogDescription>
            Currently {target.current || 'not an anchor'}. Every change is logged with your name and reason.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="text-sm text-muted-foreground mb-1">New status</legend>
          {options.map((opt) => (
            <label key={opt.value} htmlFor={`anchor-status-${opt.value}`}
              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 ${status === opt.value ? 'border-primary bg-primary/10' : 'border-border'}`}>
              <input id={`anchor-status-${opt.value}`} type="radio" name="anchor-status" value={opt.value}
                aria-label={opt.label} checked={status === opt.value} onChange={() => setStatus(opt.value)}
                className="mt-1" />
              <span>
                <span className="block text-sm font-medium text-foreground">{opt.label}</span>
                <span className="block text-xs text-muted-foreground">{opt.help}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="space-y-1">
          <label htmlFor="anchor-status-reason" className="text-sm text-muted-foreground">Reason (required)</label>
          <Textarea id="anchor-status-reason" aria-label="Reason" value={reason} maxLength={500}
            onChange={(e) => setReason(e.target.value)} className="bg-card text-foreground border-border" />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !reason.trim()}>Save status</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
