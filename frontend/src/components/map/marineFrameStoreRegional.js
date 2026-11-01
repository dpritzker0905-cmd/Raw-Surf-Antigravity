/**
 * marineFrameStoreRegional.js — the GPU frame store's REGIONAL show (2026-10-24, z7-9 instant scrub).
 *
 * WHY. #459 made the store show a CLIP of the 2-degree global_mid at mid zoom; #491 made the z7-9 boxes a pilot tile covers read
 * the tile's bundle (staticRegional.js). A scrub step there still waited for the normal path (the 150 ms debounce, the series
 * cache, the engine commit: 26-45 ms offline on the bundle arm, and the whole /grid round trip live on the dynamic arm), because the
 * store refused every regional resident: its sets are the world sets (getPinnedIndexSync keeps regional keys out).
 *
 * WHAT. A regional tile is just another lattice. When the committed grid is the stored tile's frame (its product id is in a pinned
 * regional index) and an exact window of that tile's lattice (the Step 3 clip: no pad, the data-extent clamp), it becomes the crop
 * show's resident, and a step shows the SAME window of the stepped-to tile frame, packed exactly (marineFrameStoreCrop.packWindow,
 * pinned byte for byte against the real encoder on real tile frames in marineFrameStoreRegional.test.js). The frames come from the
 * bundle already in memory (one object per run), so the packs for the whole run are built in idle time with no extra request.
 *
 * FAIL CLOSED. The regional resident exists only while the engine holds a clip of a STORED TILE frame (a dynamic viewport product
 * the server may answer first, grid_resolver Steps 1-2, carries another product id and is never taken for one); only GFS waves
 * (the packer's scope); a window of one set shows only that set's frames (cropWindowFor); and the whole path rides the regional
 * bundles' own gate (staticRegional.regionalBundlesOn: DARK until the live parity passes, D-001) because a regional set is pinned
 * only while that gate is open. Kill: window.__RAW_DISABLE_FRAME_STORE_REGIONAL__ = true (read per call).
 */
export const regionalShowOn = () => typeof window === 'undefined' || window.__RAW_DISABLE_FRAME_STORE_REGIONAL__ !== true;

/** The crop show's view of a pinned regional index: the same shape as a store set, but nothing in the store (no world pack, no GPU
 *  layer): `key` carries the model, layer, region and run in the order engineHolds reads them (model / layer first). */
export function regionalInfoOf(staticKey, index) {
  const [model, , layer, regionId] = String(staticKey).split('/');
  const frames = (index && index.frames) || [];
  const runId = (index && (index.model_run_time || index.run || index.path)) || 'unknown';
  const byPid = new Map(frames.filter((f) => f.meta && f.meta.product_id).map((f) => [f.meta.product_id, f.valid_time]));
  return {
    key: `${model}/${layer}/${regionId}/${runId}`, staticKey, index, regional: true, regionId,
    validTimes: frames.map((f) => f.valid_time).filter(Boolean).sort(), byVt: new Map(frames.map((f) => [f.valid_time, f])), byPid,
  };
}

/** Which tile frame is this committed grid? By its product id (the tile product's own file name, as the world path finds a frame),
 *  or null: a dynamic viewport product, a global_mid clip or a rating grid never match. */
export function findRegionalFrame(infos, grid) {
  const pid = grid && (grid.productId || grid.__storedProductId || grid.__servedProductId || grid.product_id);
  if (!pid) return null;
  for (const info of infos) {
    const validTime = info.byPid.get(pid);
    if (validTime) return { info, validTime };
  }
  return null;
}
