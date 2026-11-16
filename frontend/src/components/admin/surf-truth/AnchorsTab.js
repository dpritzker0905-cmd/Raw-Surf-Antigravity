import React, { useState } from 'react';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { AnchorStatusDialog, StatusBadge, ViewState, formatWhen, useAdminGet } from './shared';

/** Anchors: who sets the scale, their status history, and the admin action log for the whole area. */
export default function AnchorsTab() {
  const anchors = useAdminGet('/admin/surf-truth/anchors');
  const actions = useAdminGet('/admin/surf-truth/actions?limit=50');
  const [target, setTarget] = useState(null);
  const done = () => { setTarget(null); anchors.reload(); actions.reload(); };
  const rows = anchors.data || [];
  return (
    <div className="space-y-4">
      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-base text-foreground">Anchor observers</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Only an active anchor sets the scale. Appoint someone from the Observers tab. Admins change statuses,
            never anyone&apos;s reported numbers.
          </p>
          <ViewState loading={anchors.loading} error={anchors.error} empty={!rows.length}
            emptyText="No anchors yet. Appoint the first from the Observers tab.">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Observer</TableHead>
                    <TableHead scope="col">Status</TableHead>
                    <TableHead scope="col">Since</TableHead>
                    <TableHead scope="col">Reports, 30 days</TableHead>
                    <TableHead scope="col"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((a) => (
                    <TableRow key={a.profile_id}>
                      <TableCell className="text-foreground">{a.name || a.profile_id}</TableCell>
                      <TableCell><StatusBadge status={a.status} /></TableCell>
                      <TableCell className="text-muted-foreground">{formatWhen(a.status_since)}</TableCell>
                      <TableCell className="text-foreground">{a.observations_30d}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline"
                          aria-label={`Change anchor status for ${a.name || a.profile_id}`}
                          onClick={() => setTarget({ profileId: a.profile_id, name: a.name, current: a.status })}>
                          Change status
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </ViewState>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-base text-foreground">Admin action log</CardTitle></CardHeader>
        <CardContent>
          <ViewState loading={actions.loading} error={actions.error} empty={!(actions.data || []).length}
            emptyText="No admin actions yet.">
            <ul className="space-y-2" aria-label="Admin actions, newest first">
              {(actions.data || []).map((a) => (
                <li key={a.id} className="rounded-lg border border-border p-2 text-sm">
                  <span className="font-medium text-foreground">{a.action.replace('_', ' ')}</span>
                  <span className="text-muted-foreground"> · {a.target_type} {a.target_id} · by {a.admin_id}
                    · {formatWhen(a.at)}</span>
                  {a.detail && (
                    <span className="block text-xs text-muted-foreground">
                      {Object.entries(a.detail).map(([k, v]) => `${k}: ${v ?? '—'}`).join(' · ')}
                    </span>
                  )}
                  {a.reason && <span className="block text-xs text-foreground">“{a.reason}”</span>}
                </li>
              ))}
            </ul>
          </ViewState>
        </CardContent>
      </Card>
      <AnchorStatusDialog target={target} onClose={() => setTarget(null)} onDone={done} />
    </div>
  );
}
