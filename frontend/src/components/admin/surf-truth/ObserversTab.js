import React, { useState } from 'react';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { AnchorStatusDialog, StatusBadge, ViewState, formatWhen, useAdminGet } from './shared';

/** Observers: who reports, how often, and how their reports fare on the quality gate. Counts only, no heights. */
export default function ObserversTab() {
  const observers = useAdminGet('/admin/surf-truth/observers?days=30');
  const [target, setTarget] = useState(null);
  const rows = observers.data || [];
  return (
    <Card className="bg-card border-border">
      <CardHeader><CardTitle className="text-base text-foreground">Observers, last 30 days</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Counts only: this view never shows what anyone reported, so nobody is judged by their numbers.
          &quot;Blind&quot; means entered on a screen that showed no forecast.
        </p>
        <ViewState loading={observers.loading} error={observers.error} empty={!rows.length}
          emptyText="No observations in the last 30 days.">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Observer</TableHead>
                  <TableHead scope="col">Anchor</TableHead>
                  <TableHead scope="col">Reports</TableHead>
                  <TableHead scope="col">Passed gate</TableHead>
                  <TableHead scope="col">Flagged</TableHead>
                  <TableHead scope="col">Corroborated</TableHead>
                  <TableHead scope="col">Blind</TableHead>
                  <TableHead scope="col">Spots</TableHead>
                  <TableHead scope="col">Last</TableHead>
                  <TableHead scope="col"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((o) => (
                  <TableRow key={o.profile_id}>
                    <TableCell className="text-foreground">{o.name || o.profile_id}</TableCell>
                    <TableCell><StatusBadge status={o.anchor_status} /></TableCell>
                    <TableCell className="text-foreground">{o.observations}</TableCell>
                    <TableCell className="text-foreground">{o.quality_ok}</TableCell>
                    <TableCell className="text-foreground">{o.flagged}</TableCell>
                    <TableCell className="text-foreground">{o.corroborated}</TableCell>
                    <TableCell className="text-foreground">{o.blind}</TableCell>
                    <TableCell className="text-foreground">{o.spots}</TableCell>
                    <TableCell className="text-muted-foreground">{formatWhen(o.last_at)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline"
                        aria-label={`Set anchor status for ${o.name || o.profile_id}`}
                        onClick={() => setTarget({ profileId: o.profile_id, name: o.name, current: o.anchor_status })}>
                        {o.anchor_status ? 'Anchor status' : 'Make anchor'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ViewState>
      </CardContent>
      <AnchorStatusDialog target={target} onClose={() => setTarget(null)}
        onDone={() => { setTarget(null); observers.reload(); }} />
    </Card>
  );
}
