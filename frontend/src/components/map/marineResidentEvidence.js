// Bounded samples of the resident renderer grid, not a claim about every texel or upstream skill.
const finite = value => Number.isFinite(value) ? value : null;
export function describeResidentMarineGrid(grid) {
  if (!grid) return null;
  const vectors = Array.isArray(grid.vectors) ? grid.vectors : [];
  const indices = [...new Set(Array.from({ length: Math.min(9, vectors.length) }, (_, i) =>
    Math.floor(i * (vectors.length - 1) / Math.max(1, Math.min(9, vectors.length) - 1))))];
  return {
    requestedValidTime: grid.valid_time ?? grid.validTime ?? null,
    servedValidTime: grid.served_valid_time ?? null,
    modelRunTime: grid.model_run_time ?? null,
    sourceDataset: grid.__sourceDataset ?? null,
    componentLayer: grid.__componentLayer ?? null,
    vectorCount: vectors.length,
    // Keep physical samples separate from time labels so metadata-only changes cannot mimic data changes.
    samples: indices.map(index => {
      const v = vectors[index] || {};
      return { index, lat: finite(v.lat), lng: finite(v.lng), speed: finite(v.speed),
        u: finite(v.u), v: finite(v.v), period: finite(v.period), valid: v.is_valid ?? null };
    }),
  };
}

