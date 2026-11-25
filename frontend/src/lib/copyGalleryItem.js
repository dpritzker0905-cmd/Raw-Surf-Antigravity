import apiClient from './apiClient';

// Keep an unresolved operation across picker dismissal, reload and same-origin tabs.
// Clearing it only after acknowledgement makes the next selection a new copy.
export async function copyGalleryItem(ownerId, itemId, targetId) {
  const slot = 'gallery-copy:' + JSON.stringify([ownerId, itemId, targetId]);
  if (!navigator.locks?.request) {
    throw new Error('A secure browser connection is required to copy gallery items.');
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
    if (response.data?.gallery_id !== targetId || !response.data?.new_item_id) {
      throw new Error('Copy confirmation was interrupted. Retry to confirm this copy.');
    }
    localStorage.removeItem(slot);
    return response;
  });
}
