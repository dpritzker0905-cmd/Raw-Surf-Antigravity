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

export function ConsentTab() {
  return (
    <Facts title="Consent and privacy (part P3)" items={[
      'Reports are stored in private tables that only the backend can read.',
      'Each report keeps the device position the app sent and, for photos uploaded through go-live, the photo\'s position read from its file. A random install id links one phone across accounts. All private.',
      'Go-live photos are still stored in the PUBLIC conditions bucket with their original file data. P3 strips or blurs them before storage.',
      'Consent is opt-in: a report is exported for the forecast model only if its observer had turned the consent on when they sent it AND still has it on. People change it under the report form or in Settings > Legal.',
      'The consent wording is a legal document: edit it in Compliance > Legal documents > Forecast data consent. Keeping the version is a wording fix; a new version asks everyone again. The current wording is an unreviewed draft until David\'s counsel reviews it.',
      'A data-deletion request erases the person\'s reports, photo records and observer status; the consent history is kept as proof of consent.',
    ]} />
  );
}
