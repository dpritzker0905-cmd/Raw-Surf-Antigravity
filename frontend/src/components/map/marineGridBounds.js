// The encoder and edge trim interpret bounds as node endpoints. Older cached products can
// carry the requested bbox instead. Repair only metadata on a verified regular row-major
// lattice; never move/resample vectors or infer missing cells. Wrapped grids keep their path.
export function alignMarineNodeBounds(grid) {
  if (!grid?.bounds || !Array.isArray(grid.vectors)) return grid;
  const { cols, rows, vectors, bounds } = grid;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 ||
      vectors.length !== cols * rows) return grid;
  if (!['west', 'south', 'east', 'north'].every(k => Number.isFinite(bounds[k])) ||
      bounds.east < bounds.west) return grid;
  const first = vectors[0], last = vectors[vectors.length - 1];
  if (!first || !last) return grid;
  const nodes = { west: first.lng, south: first.lat, east: last.lng, north: last.lat };
  if (!Object.values(nodes).every(Number.isFinite)) return grid;
  if (Object.keys(nodes).every(k => nodes[k] === bounds[k])) return grid;
  const dx = (nodes.east - nodes.west) / (cols - 1);
  const dy = (nodes.north - nodes.south) / (rows - 1);
  if (!(dx > 0) || !(dy > 0)) return grid;
  // Do not erase the historical full-wrap seam/mirroring contract by reclassifying a world
  // grid whose endpoint column is missing. Such a grid needs its own source repair.
  if (bounds.east - bounds.west >= 359 && nodes.east - nodes.west < 359) return grid;
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    if (!v || !Number.isFinite(v.lng) || !Number.isFinite(v.lat) ||
        Math.abs(v.lng - (nodes.west + (i % cols) * dx)) > 1e-6 ||
        Math.abs(v.lat - (nodes.south + Math.floor(i / cols) * dy)) > 1e-6) return grid;
  }
  return { ...grid, bounds: nodes };
}
