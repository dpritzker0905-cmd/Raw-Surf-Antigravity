import React, { useRef } from 'react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

export function GalleryDeleteDialog({ deleteConfirm, setDeleteConfirm, deletingItemId,
  executeDeleteFromGallery, executeBulkDelete, galleryRegion }) {
  const returnTo = useRef(null);

  function rememberItem() {
    const region = galleryRegion.current;
    returnTo.current = null;
    if (deleteConfirm?.type !== 'single' || !region) return;
    const actions = Array.from(region.querySelectorAll('[data-gallery-action-id]'));
    const index = actions.findIndex(button => button.dataset.galleryActionId === String(deleteConfirm.itemId));
    if (index >= 0) {
      returnTo.current = { region, galleryId: region.dataset.galleryId, index, itemId: String(deleteConfirm.itemId), pending: false };
    }
  }

  function restoreFocus(event) {
    const position = returnTo.current;
    returnTo.current = null;
    const region = galleryRegion.current;
    if (!position || !region || position.region !== region || position.galleryId !== region.dataset.galleryId) return;
    const actions = Array.from(region.querySelectorAll('[data-gallery-action-id]'));
    // If dismissed during the request, the grid can still be replaced. Back survives that refresh.
    const target = position.pending ? region.querySelector('[data-gallery-back]') :
      actions.find(button => button.dataset.galleryActionId === position.itemId) ||
      actions[Math.min(position.index, actions.length - 1)] || region.querySelector('[data-gallery-empty-upload]');
    if (target) {
      event.preventDefault();
      target.focus();
    }
  }

  async function confirmDelete() {
    const request = deleteConfirm;
    if (request?.type === 'bulk') {
      executeBulkDelete();
    } else if (request?.itemId) {
      const position = returnTo.current;
      if (position) position.pending = true;
      await executeDeleteFromGallery(request.itemId);
      if (position) position.pending = false;
    }
    // An older request can finish after dismissal and a different confirmation.
    setDeleteConfirm(current => current === request ? null : current);
  }

  return (
    <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
      <DialogContent onOpenAutoFocus={rememberItem} onCloseAutoFocus={restoreFocus} className="bg-background border-border text-foreground max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-foreground">Confirm Delete</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground py-2">
          {deleteConfirm?.type === 'bulk'
            ? `Delete ${deleteConfirm?.count} selected items? This cannot be undone.`
            : 'Delete this item from the gallery? This cannot be undone.'}
        </p>
        <div className="flex gap-3 justify-end pt-2">
          <Button
            variant="outline"
            className="border-border"
            onClick={() => setDeleteConfirm(null)}
          >
            {deletingItemId ? 'Close' : 'Cancel'}
          </Button>
          <Button
            className="bg-red-500 hover:bg-red-600 text-white"
            disabled={Boolean(deletingItemId)}
            onClick={confirmDelete}
          >
            {deletingItemId ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
