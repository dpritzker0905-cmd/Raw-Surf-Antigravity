import React from 'react';
import { MapPin, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';

/**
 * AdminSpotsStats — the Global Spot Database stats header.
 *
 * Extracted verbatim from AdminSpotsPanel.js on 2026-07-28: that file had reached 840 LOC against
 * the 800-LOC ratchet, which had been FAILING CI on every code commit since `46280a1b` (755 -> 807
 * on 2026-07-27). Purely presentational, so this is a move and not a rewrite — the theme tokens
 * (bg-card / bg-muted / text-muted-foreground / bg-input) and the real <button> + aria-pressed +
 * aria-label on the country filters are carried across unchanged, per the project's three-theme
 * and accessibility mandates.
 */
/**
 * ⚠️ A FAILED READ MUST NOT RENDER AS ZERO. `stats?.total_spots || 0` turns "the request 401'd"
 * into a confident "0 spots", which is indistinguishable from an empty database — the same
 * blind-panel failure that hid 165 flagged spots. When `loadError` is set the tiles show "—" and
 * the header says what went wrong, instead of certifying numbers that never arrived.
 */
const AdminSpotsStats = ({ stats, lastRefreshed, filterCountry, onFilterCountry, loadError }) => {
  const n = (value) => (loadError ? '—' : (value ?? 0));
  return (
  <Card className="bg-card border-border">
    <CardHeader>
      <CardTitle className="text-foreground flex items-center gap-2 flex-wrap">
        <MapPin className="w-5 h-5 text-cyan-400" />
        Global Spot Database
        {/* Every number below is read live from production. Saying WHEN makes a stale panel
            distinguishable from a correct one — the failure mode that hid 165 flagged spots. */}
        {loadError ? (
          <span className="text-xs font-normal text-amber-500 ml-auto flex items-center gap-1"
                role="alert">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            {loadError}
          </span>
        ) : (
          <span className="text-xs font-normal text-muted-foreground ml-auto" aria-live="polite">
            {lastRefreshed
              ? `Live · updated ${lastRefreshed.toLocaleTimeString()}`
              : 'Loading live data…'}
          </span>
        )}
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-muted rounded-lg p-3 text-center">
          <p className="text-3xl font-bold text-foreground">{n(stats?.total_spots)}</p>
          <p className="text-xs text-muted-foreground">Total Spots</p>
        </div>
        <div className="bg-muted rounded-lg p-3 text-center">
          <p className="text-3xl font-bold text-cyan-400">{n(stats?.by_country?.length)}</p>
          <p className="text-xs text-muted-foreground">Countries</p>
        </div>
        <div className="bg-muted rounded-lg p-3 text-center">
          <p className="text-3xl font-bold text-green-400">{n(stats?.by_tier?.tier_1)}</p>
          <p className="text-xs text-muted-foreground">Tier 1 (East Coast)</p>
        </div>
        <div className="bg-muted rounded-lg p-3 text-center">
          <p className="text-3xl font-bold text-purple-400">{n(stats?.by_tier?.tier_3)}</p>
          <p className="text-xs text-muted-foreground">Tier 3 (Global)</p>
        </div>
      </div>

      {/* ── Accuracy / review state ────────────────────────────────────────────────
          These four numbers were absent, so nothing on this dashboard could change when
          a spot's verification or placement state did: a 2026-07-27 correction moved 1256
          spots out of is_verified_peak and flagged 158 as low_accuracy, and the panel
          rendered identically before and after. "Verified" deliberately shows the count
          with a REAL verified_by, not is_verified_peak — the bulk import scripts hardcoded
          that flag True on every row they wrote, so it carried no accuracy information. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-muted rounded-lg p-3 text-center">
          <p className="text-3xl font-bold text-foreground">{n(stats?.active_spots)}</p>
          <p className="text-xs text-muted-foreground">Active (shown on map)</p>
        </div>
        <div className="bg-muted rounded-lg p-3 text-center">
          <p className="text-3xl font-bold text-amber-500">{n(stats?.flagged_for_review)}</p>
          <p className="text-xs text-muted-foreground">Flagged for review</p>
        </div>
        <div className="bg-muted rounded-lg p-3 text-center">
          <p className="text-3xl font-bold text-red-500">{n(stats?.low_accuracy)}</p>
          <p className="text-xs text-muted-foreground">Low accuracy (misplaced)</p>
        </div>
        <div className="bg-muted rounded-lg p-3 text-center">
          <p className="text-3xl font-bold text-emerald-500">{n(stats?.has_verifier)}</p>
          <p className="text-xs text-muted-foreground">Verified by a human</p>
        </div>
      </div>

      {/* Countries breakdown — real <button>s. These were Badges with onClick, i.e.
          keyboard-unreachable and invisible to assistive tech (accessibility mandate). */}
      <div className="flex flex-wrap gap-2">
        {stats?.by_country?.slice(0, 10).map((item) => {
          const isActive = filterCountry === item.country;
          return (
            <button
              key={item.country}
              type="button"
              onClick={() => onFilterCountry(isActive ? '' : item.country)}
              aria-pressed={isActive}
              aria-label={`Filter spots by ${item.country} (${item.count} spots)`}
              className="focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded-full"
            >
              <Badge
                className={`cursor-pointer ${isActive
                  ? 'bg-cyan-500 text-white hover:bg-cyan-400'
                  : 'bg-input text-muted-foreground hover:bg-muted'}`}
              >
                {item.country}: {item.count}
              </Badge>
            </button>
          );
        })}
      </div>
    </CardContent>
  </Card>
  );
};

export { AdminSpotsStats };
export default AdminSpotsStats;
