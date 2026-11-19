import React, { useEffect, useState } from 'react';
import apiClient from '../../../lib/apiClient';
import { Button } from '../../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { formatWhen } from './shared';

/**
 * One anchor's status history, from the append-only event log (GET /admin/surf-truth/anchors/{id}/events): every
 * appointment and change, who made it and the reason they wrote. Read-only.
 */
export default function AnchorHistoryDialog({ target, onClose }) {
  const [state, setState] = useState({ loading: true, events: [], error: '' });

  useEffect(() => {
    if (!target) return undefined;
    let live = true;
    setState({ loading: true, events: [], error: '' });
    apiClient.get(`/admin/surf-truth/anchors/${encodeURIComponent(target.profileId)}/events`)
      .then((res) => { if (live) setState({ loading: false, events: res.data || [], error: '' }); })
      .catch(() => { if (live) setState({ loading: false, events: [], error: 'Could not load the history.' }); });
    return () => { live = false; };
  }, [target]);

  if (!target) return null;
  const { loading, events, error } = state;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-background text-foreground border-border sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Status history: {target.name || target.profileId}</DialogTitle>
          <DialogDescription>Every appointment and change, oldest first. This log cannot be edited.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p role="alert" className="text-sm text-foreground">{error}</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recorded changes.</p>
        ) : (
          <ol className="max-h-[50vh] space-y-2 overflow-y-auto" aria-label="Status changes, oldest first">
            {events.map((e, i) => (
              <li key={`${e.at}-${i}`} className="rounded-lg border border-border p-2 text-sm">
                <span className="font-medium text-foreground">
                  {e.from_status ? `${e.from_status} → ${e.to_status}` : `appointed as ${e.to_status}`}
                </span>
                <span className="text-muted-foreground"> · {formatWhen(e.at)} · by {e.actor_name || e.actor_id}</span>
                {e.reason && <span className="block text-xs text-foreground">“{e.reason}”</span>}
              </li>
            ))}
          </ol>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
