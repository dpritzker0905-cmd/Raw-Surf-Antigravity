/**
 * The rating band's legend title. Over a PARTITION layer (Swell 1, Swell 2, Wind Waves) the band rates the TOTAL sea, like the
 * spot glyphs (bug hunt 2026-11-22 item D, owner: "Rate the whole sea"; backend band_total_sea.py), so the title says so while
 * the partition's own key stays beneath it. Kill: window.__RAW_DISABLE_BAND_WHOLE_SEA_LABEL__ = true.
 */
const PARTITIONS = new Set(['swell_1', 'swell_2', 'wind_waves']);

export function ratingBandLegendTitle(layer) {
  const killed = typeof window !== 'undefined' && window.__RAW_DISABLE_BAND_WHOLE_SEA_LABEL__ === true;
  return (!killed && PARTITIONS.has(layer)) ? 'Surf Rating · whole sea (coastal band)' : 'Surf Rating (coastal band)';
}
