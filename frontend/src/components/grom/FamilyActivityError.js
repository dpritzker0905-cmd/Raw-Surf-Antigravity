import React from 'react';
import { Button } from '../ui/button';

export default function FamilyActivityError({ onRetry }) {
  return (
    <div role="alert" className="rounded-lg border border-border bg-muted p-4 text-foreground">
      <p className="text-sm">Family activity could not be loaded. Try again to see recent activity.</p>
      <Button type="button" variant="outline" className="mt-3" onClick={onRetry}>Retry family activity</Button>
    </div>
  );
}
