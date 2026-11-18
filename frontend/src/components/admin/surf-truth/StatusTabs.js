import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';

/**
 * The Model and Consent/privacy tabs state what is TRUE today rather than show placeholder numbers. Each says what
 * is not built yet, and which part builds it, so nobody reads an empty screen as "no problem".
 */
function Facts({ title, items }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader><CardTitle className="text-base text-foreground">{title}</CardTitle></CardHeader>
      <CardContent>
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {items.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </CardContent>
    </Card>
  );
}

export function ModelTab() {
  return (
    <Facts title="Truth model (not built yet)" items={[
      'No model has been fitted. Nothing in this area changes a surf height anyone sees.',
      'Part D adds versioned model runs with rollback. Its test is written down (pre-registered) before any fit.',
      'The model will hold the average anchor bias at zero, estimate each observer\'s own bias and noise, and learn how much people under-read the face from physical checks only (photos with a scale, satellite, shallow buoys).',
      'Until then, reports are stored, checked and counted, but not combined into a "true" height.',
    ]} />
  );
}

export function ConsentTab() {
  return (
    <Facts title="Consent and privacy (part P3)" items={[
      'Reports are stored in private tables that only the backend can read.',
      'Each report keeps the device position the app sent and, for photos uploaded through go-live, the photo\'s position read from its file. A random install id links one phone across accounts. All private.',
      'Go-live photos are still stored in the PUBLIC conditions bucket with their original file data. P3 strips or blurs them before storage.',
      'There is no training consent yet. P3 adds a versioned consent, private training copies and deletion. Legal review comes before any training, and that is David\'s decision.',
    ]} />
  );
}
