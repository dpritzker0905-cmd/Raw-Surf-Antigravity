import React, { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { toast } from 'sonner';

var DeleteConfirmModal = ({ open, onClose, onConfirm, isLight }) => {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      toast.error('Failed to delete post');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} max-w-sm`} aria-describedby="delete-post-description">
        <DialogHeader>
          <DialogTitle className="text-red-500 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            Delete Post?
          </DialogTitle>
          <DialogDescription id="delete-post-description" className={isLight ? 'text-gray-600' : 'text-gray-400'}>
            This action cannot be undone. The post will be permanently deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button aria-label="Loader2" 
            variant="destructive"
            onClick={handleConfirm} 
            disabled={loading}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DeleteConfirmModal;
