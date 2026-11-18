import React from 'react';
import { Anchor } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import AnchorsTab from './AnchorsTab';
import CoverageTab from './CoverageTab';
import ObserversTab from './ObserversTab';
import QualityQueueTab from './QualityQueueTab';
import { ConsentTab, ModelTab } from './StatusTabs';

export const SURF_TRUTH_TABS = [
  { id: 'anchors', label: 'Anchors', Component: AnchorsTab },
  { id: 'observers', label: 'Observers', Component: ObserversTab },
  { id: 'coverage', label: 'Coverage', Component: CoverageTab },
  { id: 'quality', label: 'Quality queue', Component: QualityQueueTab },
  { id: 'model', label: 'Model', Component: ModelTab },
  { id: 'consent', label: 'Consent / privacy', Component: ConsentTab },
];

/**
 * Admin · Surf truth: control and monitor the crowd truth stream (David, 2026-11-16: "if its a tool we're to use
 * permanently, we need any area in the admin to control and monitor this").
 *
 * Every route behind it requires an admin (strict JWT + admin role). Admins change statuses and audit verdicts,
 * always with a logged record; nothing here can edit a reported number, and no view shows one.
 * THEMING: shared ui primitives + semantic tokens only, so light, dark and beach mode all work. Tabs are Radix
 * (role=tablist, arrow keys); the list scrolls sideways on a phone instead of wrapping into an unreadable block.
 */
export default function AdminSurfTruthPanel() {
  return (
    <section aria-labelledby="surf-truth-heading" className="space-y-4" data-testid="admin-surf-truth">
      <div className="flex items-center gap-2">
        <Anchor className="h-5 w-5 text-foreground" aria-hidden="true" />
        <h2 id="surf-truth-heading" className="text-lg font-semibold text-foreground">Surf truth</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Blind surf reports from surfers and photographers: who reports, where, how they pass the quality checks,
        and who the anchors are.
      </p>
      <Tabs defaultValue="anchors">
        <div className="overflow-x-auto">
          <TabsList aria-label="Surf truth sections" className="w-max">
            {SURF_TRUTH_TABS.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
          </TabsList>
        </div>
        {SURF_TRUTH_TABS.map(({ id, Component }) => (
          <TabsContent key={id} value={id} className="mt-4"><Component /></TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
