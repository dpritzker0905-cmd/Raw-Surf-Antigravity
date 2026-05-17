import React, { useState } from 'react';
import { MessageSquare, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { toast } from 'sonner';

const RequestEditModal = ({ item, isOpen, onClose, onSubmit }) => {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  
  if (!item) return null;
  
  const handleSubmit = async () => {
    if (!message.trim()) {
      toast.error('Please describe your edit request');
      return;
    }
    setLoading(true);
    try {
      await onSubmit(item.id, message);
      toast.success('Edit request sent to photographer');
      setMessage('');
      onClose();
    } catch (error) {
      toast.error('Failed to send request');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-cyan-400" />
            Request Edit
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Send a message to <span className="text-foreground">{item.photographer_name}</span> requesting edits to this photo.
          </p>
          <textarea aria-label="E.g., Could you crop tighter on the wave? Or add a slight color boost?"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="E.g., Could you crop tighter on the wave? Or add a slight color boost?"
            className="w-full h-24 p-3 bg-muted border border-zinc-700 rounded-lg text-foreground placeholder:text-muted-foreground resize-none"
          />
          <p className="text-xs text-muted-foreground">
            Common requests: cropping, color correction, remove watermark (for purchased photos)
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button aria-label="Loader2" onClick={handleSubmit} disabled={loading} className="bg-cyan-500 hover:bg-cyan-600">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RequestEditModal;
