import React, { useRef } from 'react';
import { Images } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';

export const PhotoMatchingUnavailableDialog = ({ open, onClose }) => {
  const { theme } = useTheme();
  const openerRef = useRef(null);
  const surface = theme === 'light' ? 'bg-white text-zinc-900 border-zinc-200'
    : theme === 'beach' ? 'bg-black text-white border-white/50'
      : 'bg-zinc-950 text-zinc-100 border-zinc-700';
  const muted = theme === 'light' ? 'text-zinc-600' : theme === 'beach' ? 'text-white' : 'text-zinc-300';

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className={`top-auto max-h-[85vh] sm:max-w-md ${surface}`}
        // These controlled wrappers do not own a Dialog.Trigger; preserve the actual opener.
        onOpenAutoFocus={() => { openerRef.current = document.activeElement; }}
        onCloseAutoFocus={(event) => {
          const opener = openerRef.current;
          if (opener?.isConnected && typeof opener.focus === 'function') {
            event.preventDefault();
            opener.focus();
          }
        }}>
        <DialogHeader>
          <Images className="h-8 w-8 mb-2" aria-hidden="true" />
          <DialogTitle>Find your photos</DialogTitle>
          <DialogDescription className={muted}>
            Automatic photo matching is currently unavailable.
          </DialogDescription>
        </DialogHeader>
        <div className={`modal-body px-4 py-4 text-sm leading-relaxed ${muted}`}>
          Browse the gallery to find your photos, or review photos already in your locker.
          You can ask the photographer to tag you in a photo.
        </div>
        <DialogFooter><Button onClick={onClose}>Back to photos</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
