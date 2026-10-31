import React from 'react';
import { Button } from '../ui/button';

export default function LinkedGromsLoadError({ onRetry, onBack }) {
  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-2xl font-bold">Grom HQ</h1>
        <div role="alert" className="rounded-lg border border-border bg-muted p-4">
          <h2 className="font-semibold">Linked Groms could not be loaded</h2>
          <p className="mt-2 text-sm">Try again to see your linked Groms, pending requests and family totals.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={onRetry}>Retry linked Groms</Button>
          <Button type="button" variant="outline" onClick={onBack}>Back to Settings</Button>
        </div>
      </div>
    </main>
  );
}
