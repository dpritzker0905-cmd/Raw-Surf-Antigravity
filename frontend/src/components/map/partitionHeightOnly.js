/**
 * Over a PARTITION layer (Swell 1, Swell 2, Wind Waves) the map shows that partition's own height, never a surf rating.
 *
 * Bug hunt 2026-11-22 item D: the rating band graded one partition as if it were the whole sea, disagreeing with the glyph
 * beside it (which rates the total sea). The overnight research consensus the owner delegated (option B) keeps the 0-100 rating
 * where it means something: the Waves (total sea) layer, the spot glyphs, the spot pages and the infobox. A partition layer is
 * asked for in the PLAIN flavour even while Rating is on, so it draws its own honest height field; the legend says "height
 * only, no surf rating". The server half is backend band_partition.py (BAND_PARTITION_HEIGHT_ONLY).
 *
 * No imports, so the engine can read it without an import cycle.
 * Kill: window.__RAW_DISABLE_PARTITION_HEIGHT_ONLY__ = true (the partition layers are rated again, as before).
 */
export const PARTITION_LAYERS = ['swell_1', 'swell_2', 'wind_waves'];

export function partitionHeightOnlyOn() {
  return !(typeof window !== 'undefined' && window.__RAW_DISABLE_PARTITION_HEIGHT_ONLY__ === true);
}

/** True when `layer` is a partition that shows its own height, not a rating. */
export function isPartitionHeightOnly(layer) {
  return partitionHeightOnlyOn() && PARTITION_LAYERS.includes(String(layer || '').toLowerCase());
}

/** The flavour the marine data lane asks for: rated only when Rating is on AND the layer can carry a rating. */
export function bandRatedFor(surf, layer) {
  return !!surf && !isPartitionHeightOnly(layer);
}
