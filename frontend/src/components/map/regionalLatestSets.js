/**
 * regionalLatestSets.js: what the regional tile pick reads from the latest.json the client already holds (2026-10-24, #514).
 *
 * latest.json lists every published set under `sets[key]`. A set is one of:
 *   - listed:  {index, bundle, run, ...}: a published regional set (an `index` is what makes it listed);
 *   - empty:   {"empty": true, "reason", "written_at", "writer"}: the box has NO stored product for this layer (GFS swell_2
 *              us_west_coast_socal today), so there is no tile to wait for. Keyed on `empty === true`, never on the reason text;
 *   - absent:  not listed yet (before the first read, or never published).
 * An `index` always wins over `empty` (a set that gained products is rewritten as a normal record), so empty -> normal reads normally.
 * Pure functions of (latest, key); `registerLatestProbes` hands them to staticRegional (no import cycle: staticFrames passes its
 * latest.json accessor). Kill/bypass: none needed (an empty only removes a manifest wait and renames a pick reason).
 */
import { setRegionalLatestProbes } from './staticRegional';

const entry = (latest, key) => (latest && latest.sets && latest.sets[key]) || null;

/** The set has a published index in this latest.json. */
export const setIsListed = (latest, key) => { const s = entry(latest, key); return !!(s && s.index); };

/** The set is an explicit empty in this latest.json (no index; `empty === true`). */
export const setIsEmpty = (latest, key) => { const s = entry(latest, key); return !!(s && s.empty === true && !s.index); };

/** Register the probes the pre-manifest tile pick uses; `getLatest()` returns the latest.json read so far (or null). */
export function registerLatestProbes(getLatest) {
  setRegionalLatestProbes({ listed: (k) => setIsListed(getLatest(), k), read: () => !!getLatest(), empty: (k) => setIsEmpty(getLatest(), k) });
}
