/**
 * marineGridHash.js
 * 
 * Shared 32-bit polynomial rolling hash function for marine grids.
 * Used by WebGLMarineLayer, useMarineOrchestrator, and useSimulationField.
 */

export function computeGridContentHash(grid, layer = 'waves') {
  if (!grid?.vectors?.length) return 0;
  if (!grid.__contentHashes) {
    grid.__contentHashes = {};
  }
  if (grid.__contentHashes[layer] !== undefined) {
    return grid.__contentHashes[layer];
  }
  const len = grid.vectors.length;
  let hashSum = 0;
  for (let i = 0; i < len; i++) {
    const v = grid.vectors[i];
    const comp = v?.[layer] || v;
    if (comp) {
      const s = Math.round((comp.speed || 0) * 100);
      const u = Math.round((comp.u || 0) * 100);
      const vComp = Math.round((comp.v || 0) * 100);
      const p = Math.round((comp.period || 0) * 100);
      
      const valSum = (s + (u * 17) + (vComp * 31) + (p * 97)) | 0;
      hashSum = ((hashSum * 33) + valSum + i) | 0;
    }
  }
  const result = hashSum >>> 0;
  grid.__contentHashes[layer] = result;
  return result;
}
