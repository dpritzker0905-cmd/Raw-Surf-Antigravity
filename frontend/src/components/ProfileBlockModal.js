import React from 'react';
import { Ban, AlertTriangle, Flag, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';

export const ProfileBlockModal = ({
  isOpen, onClose, profileName,
  blockReason, setBlockReason, blockNotes, setBlockNotes,
  blockLoading, onBlock,
}) => (
  <Dialog open={isOpen} onOpenChange={onClose}>
    <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-lg text-red-400">
          <Ban className="w-5 h-5" />
          Block {profileName || 'User'}?
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 mt-2">
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-zinc-300">
              <p className="font-medium text-red-400 mb-1">When you block someone:</p>
              <ul className="space-y-1 text-zinc-400">
                <li>• They won't be able to message you</li>
                <li>• They won't see your posts or profile</li>
                <li>• They won't be able to follow you</li>
                <li>• Any existing follow will be removed</li>
              </ul>
            </div>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-zinc-300 mb-2 block">Reason (optional)</label>
          <select value={blockReason} onChange={(e) => setBlockReason(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
            data-testid="block-reason-select">
            <option value="">Select a reason...</option>
            <option value="harassment">Harassment</option>
            <option value="spam">Spam</option>
            <option value="inappropriate">Inappropriate content</option>
            <option value="scam">Scam/Fraud</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-zinc-300 mb-2 block">Additional notes (private, optional)</label>
          <textarea value={blockNotes} onChange={(e) => setBlockNotes(e.target.value)}
            placeholder="Add any notes about why you're blocking this user..."
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white resize-none h-20"
            data-testid="block-notes-input" />
        </div>
        {(blockReason === 'harassment' || blockReason === 'scam') && (
          <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <p className="text-xs text-amber-400 flex items-center gap-2">
              <Flag className="w-4 h-4" /> This will also report the user to our safety team
            </p>
          </div>
        )}
        <div className="flex gap-3 pt-2">
          <Button onClick={() => { onClose(false); setBlockReason(''); setBlockNotes(''); }}
            variant="outline" className="flex-1 border-zinc-700">Cancel</Button>
          <Button aria-label="Loader2" onClick={onBlock} disabled={blockLoading}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white" data-testid="confirm-block-btn">
            {blockLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Ban className="w-4 h-4 mr-2" />}
            Block User
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
);
