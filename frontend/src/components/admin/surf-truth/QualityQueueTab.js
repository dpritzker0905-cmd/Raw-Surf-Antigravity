import React, { useState } from 'react';
import { toast } from 'sonner';
import apiClient from '../../../lib/apiClient';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { ViewState, formatWhen, useAdminGet } from './shared';

const FLAG_TEXT = {
  gps_far: 'device GPS far from the spot', gps_missing: 'no device GPS', exif_far: 'photo taken far away',
  exif_stale: 'photo is old', duplicate_media: 'photo used before', media_unverified: 'photo not checked',
  scale_override_no_photo: 'changed the usual scale, no photo', range_only: 'gave a range',
  no_parent: 'no parent report', no_device: 'no device id', device_clock_skew: 'device clock off',
};

function km(m) {
  return m == null ? '—' : `${(m / 1000).toFixed(m < 10000 ? 2 : 0)} km`;
}

/**
 * Quality queue: the random audit sample. The auditor judges whether a report is GENUINE (a real, current look at
 * that spot) from the photo, place, time and flags. The reported height is deliberately not shown (the API does not
 * return it), so an audit can never become a vote on whether the number looks right.
 */
export default function QualityQueueTab() {
  const queue = useAdminGet('/admin/surf-observations/audits');
  const [busy, setBusy] = useState(null);
  const decide = async (id, verdict) => {
    let body = { verdict };
    if (verdict === 'fail') {
      // A fail withholds XP, so it needs a reason (the server refuses one without); the report stays in the record.
      const reason = window.prompt('Why is this report not genuine? (required; it earns no XP but stays recorded)');
      if (!reason || !reason.trim()) return;
      body = { verdict, reason: reason.trim().slice(0, 500) };
    }
    setBusy(id);
    try {
      await apiClient.post(`/admin/surf-observations/${encodeURIComponent(id)}/audit`, body);
      toast.success(verdict === 'pass' ? 'Passed.' : 'Failed.');
      queue.reload();
    } catch (err) {
      toast.error(err?.response?.data?.detail?.toString?.() || 'Could not record the verdict.');
    } finally {
      setBusy(null);
    }
  };
  const items = queue.data || [];
  return (
    <Card className="bg-card border-border">
      <CardHeader><CardTitle className="text-base text-foreground">Audit queue</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Is this a real, current look at this spot? Judge the photo, place and time. The reported height is hidden on
          purpose. Failing a report needs a reason. You cannot audit your own report.
        </p>
        <ViewState loading={queue.loading} error={queue.error} empty={!items.length}
          emptyText="Nothing waiting for audit.">
          <ul className="space-y-3" aria-label="Reports waiting for audit">
            {items.map((item) => (
              <li key={item.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
                  {item.media_url ? (
                    <a href={item.media_url} target="_blank" rel="noopener noreferrer"
                      className="text-sm underline text-foreground">Open photo</a>
                  ) : <span className="text-sm text-muted-foreground">No photo</span>}
                  <div className="min-w-0 text-sm sm:flex-1">
                    <p className="text-foreground">Spot {item.spot_id} · {item.surface.replace('_', ' ')}</p>
                    <p className="text-muted-foreground">
                      Received {formatWhen(item.received_at)} · device {km(item.gps_distance_m)} from spot ·
                      photo {km(item.exif_distance_m)} from spot
                    </p>
                    {item.flags.length > 0 && (
                      <p className="text-xs text-foreground">Flags: {item.flags.map((f) => FLAG_TEXT[f] || f).join(', ')}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy === item.id} onClick={() => decide(item.id, 'pass')}
                      aria-label={`Pass report received ${formatWhen(item.received_at)}`}>Pass</Button>
                    <Button size="sm" variant="outline" disabled={busy === item.id}
                      onClick={() => decide(item.id, 'fail')}
                      aria-label={`Fail report received ${formatWhen(item.received_at)}`}>Fail</Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </ViewState>
      </CardContent>
    </Card>
  );
}
