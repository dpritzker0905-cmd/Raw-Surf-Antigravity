import apiClient from './apiClient';

// Keep an unresolved operation across picker dismissal, reload and same-origin tabs.
// Clearing it only after acknowledgement makes the next selection a new copy.
export async function copyGalleryItem(ownerId, itemId, targetId) {
  const slot = 'gallery-copy:' + JSON.stringify([ownerId, itemId, targetId]);
  if (!navigator.locks?.request || !globalThis.crypto?.randomUUID) {
    throw new Error('This browser cannot safely track a gallery copy. Use an up-to-date browser on HTTPS.');
  }
  return navigator.locks.request(slot, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('This photo is already being copied to that folder.');
    let operationId = localStorage.getItem(slot);
    if (!operationId) {
      operationId = crypto.randomUUID();
      localStorage.setItem(slot, operationId);
    }
    const response = await apiClient.put(
      `/gallery/item/${encodeURIComponent(itemId)}/copies/${encodeURIComponent(operationId)}`,
      { target_gallery_id: targetId },
    );
    const result = response.data;
    if (result?.gallery_id !== targetId || !result.new_item_id ||
        typeof result.replayed !== 'boolean' || typeof result.copy_present !== 'boolean') {
      throw new Error('Copy confirmation was interrupted. Retry to confirm this copy.');
    }
    localStorage.removeItem(slot);
    if (!result.copy_present) {
      const error = new Error('The previous copy is no longer in this folder. Select again to make a new copy.');
      error.code = 'PREVIOUS_COPY_REMOVED';
      throw error;
    }
    return result;
  });
}
