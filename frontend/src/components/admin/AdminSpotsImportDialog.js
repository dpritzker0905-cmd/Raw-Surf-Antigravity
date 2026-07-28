import React from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';

/**
 * AdminSpotsImportDialog — tier picker for the curated-spot import.
 *
 * Extracted from AdminSpotsPanel.js on 2026-07-28 for LOC headroom (the file was 6 lines under the
 * 800 ratchet, i.e. the next edit would have failed CI).
 *
 * ★ NOT a verbatim move: the tier rows were `<div onClick={...}>` — keyboard-unreachable and
 * invisible to assistive tech, exactly what the project's accessibility mandate forbids, and the
 * same defect `ad6cd082` fixed on the country filters. They are now a real radiogroup: `<button
 * role="radio">` with `aria-checked`, reachable by Tab and operable by Enter/Space for free.
 * Touching code means not carrying its debt forward.
 */
const TIERS = [
  { value: 0, label: 'All Curated Spots', desc: 'Import entire curated database (~70 spots)' },
  { value: 1, label: 'Tier 1: East Coast USA', desc: 'Florida to Maine (~25 spots)' },
  { value: 2, label: 'Tier 2: West Coast & Islands', desc: 'California, Hawaii, Puerto Rico (~15 spots)' },
  { value: 3, label: 'Tier 3: Global', desc: 'Australia, Indonesia, Europe, etc. (~30 spots)' },
];

const AdminSpotsImportDialog = ({
  open, onOpenChange, importTier, setImportTier,
  includeOSM, setIncludeOSM, onImport, importLoading,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="bg-card border border-border sm:max-w-md w-[95vw] sm:w-full rounded-xl">
      <DialogHeader>
        <DialogTitle className="text-foreground flex items-center gap-2">
          <Upload className="w-5 h-5 text-green-400" aria-hidden="true" />
          Import Global Surf Spots
        </DialogTitle>
      </DialogHeader>

      <div className="modal-body px-4 sm:px-6 py-4 space-y-4">
        <p className="text-muted-foreground text-sm">
          Select which region tier to import surf spots from:
        </p>

        <div className="space-y-2" role="radiogroup" aria-label="Import region tier">
          {TIERS.map((tier) => {
            const selected = importTier === tier.value;
            return (
              <button
                key={tier.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setImportTier(tier.value)}
                className={`w-full text-left p-3 rounded-lg border transition-all
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${
                  selected
                    ? 'border-green-500 bg-green-500/10'
                    : 'border-border bg-muted hover:border-input'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    selected ? 'border-green-500' : 'border-zinc-500'
                  }`} aria-hidden="true">
                    {selected && <div className="w-2 h-2 rounded-full bg-green-500" />}
                  </div>
                  <div>
                    <p className="text-foreground font-medium text-sm sm:text-base">{tier.label}</p>
                    <p className="text-xs text-muted-foreground">{tier.desc}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-start gap-2 p-3 bg-muted rounded-lg border border-border">
          <input
            type="checkbox"
            id="include-osm"
            checked={includeOSM}
            onChange={(e) => setIncludeOSM(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-input flex-shrink-0"
          />
          {/* ⚠️ OSM is ODbL share-alike and production carries ZERO osm_id rows deliberately —
              see import_global_spots. Leaving this OFF is what keeps that true. */}
          <label htmlFor="include-osm" className="text-sm text-muted-foreground leading-tight">
            Also fetch from OSM Overpass API (slower, more spots)
          </label>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}
                className="border-input text-muted-foreground hover:text-foreground">
          Cancel
        </Button>
        <Button onClick={onImport} disabled={importLoading}
                className="bg-green-600 hover:bg-green-700 text-white">
          {importLoading
            ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
            : <Upload className="w-4 h-4 mr-2" aria-hidden="true" />}
          Start Import
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export { AdminSpotsImportDialog };
export default AdminSpotsImportDialog;
