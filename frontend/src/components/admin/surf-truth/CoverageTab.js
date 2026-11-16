import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { ViewState, formatWhen, useAdminGet } from './shared';

/** Coverage: where the truth stream has reports, and how independent they are (counts only, no heights). */
export default function CoverageTab() {
  const coverage = useAdminGet('/admin/surf-truth/coverage?days=30');
  const spots = coverage.data?.spots || [];
  const totals = coverage.data?.totals;
  return (
    <Card className="bg-card border-border">
      <CardHeader><CardTitle className="text-base text-foreground">Coverage, last 30 days</CardTitle></CardHeader>
      <CardContent>
        {coverage.data && coverage.data.listed < totals?.spots && (
          <p className="mb-2 text-xs text-muted-foreground">
            Totals cover every spot; the table lists the {coverage.data.listed} busiest.
          </p>
        )}
        {totals && (
          <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[['Spots', totals.spots], ['Reports', totals.observations], ['Passed gate', totals.quality_ok],
              ['Spots with 2+ observers', totals.multi_observer_spots]].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border p-2">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-lg font-semibold text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        <ViewState loading={coverage.loading} error={coverage.error} empty={!spots.length}
          emptyText="No reports in the last 30 days.">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Spot</TableHead>
                  <TableHead scope="col">Region</TableHead>
                  <TableHead scope="col">Reports</TableHead>
                  <TableHead scope="col">Observers</TableHead>
                  <TableHead scope="col">Passed gate</TableHead>
                  <TableHead scope="col">From anchors</TableHead>
                  <TableHead scope="col">Blind</TableHead>
                  <TableHead scope="col">Last</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spots.map((s) => (
                  <TableRow key={s.spot_id || 'none'}>
                    <TableCell className="text-foreground">{s.name || s.spot_id}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {[s.region, s.country].filter(Boolean).join(', ') || '—'}
                    </TableCell>
                    <TableCell className="text-foreground">{s.observations}</TableCell>
                    <TableCell className="text-foreground">{s.observers}</TableCell>
                    <TableCell className="text-foreground">{s.quality_ok}</TableCell>
                    <TableCell className="text-foreground">{s.anchor_observations}</TableCell>
                    <TableCell className="text-foreground">{s.blind}</TableCell>
                    <TableCell className="text-muted-foreground">{formatWhen(s.last_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ViewState>
      </CardContent>
    </Card>
  );
}
