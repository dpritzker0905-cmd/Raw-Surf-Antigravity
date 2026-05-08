/**
 * CancelSessionDialog — Extracted from OnDemandSessionManager.js (v82)
 * Confirmation dialog for cancelling an active on-demand session.
 */
import React from 'react';
import { X, User, Loader2 } from 'lucide-react';
import { Badge } from '../ui/badge';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '../ui/alert-dialog';
import { getFullUrl } from '../../utils/media';

const CancelSessionDialog = ({
  showCancelConfirm,
  setShowCancelConfirm,
  activeSession,
  isCancelling,
  handleConfirmCancel,
  getImageUrl,
}) => (
  <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
    <AlertDialogContent className="bg-zinc-900 border-zinc-700 max-w-md">
      <AlertDialogHeader>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
            <X className="w-5 h-5 text-red-400" />
          </div>
          <AlertDialogTitle className="text-white text-lg">
            Cancel This Session?
          </AlertDialogTitle>
        </div>
        <AlertDialogDescription className="text-gray-400 text-sm leading-relaxed">
          This will end the on-demand session and notify the surfer.
          Any held payment will be refunded to the surfer's account credits.
          This action cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>

      {/* Session context summary */}
      {activeSession && (
        <div className="p-3 rounded-xl bg-zinc-800/70 border border-zinc-700 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-700 flex-shrink-0">
            {activeSession.requester_selfie ? (
              <img loading="lazy" decoding="async" src={getImageUrl(activeSession.requester_selfie)} alt="" className="w-full h-full object-cover" />
            ) : activeSession.requester_avatar ? (
              <img loading="lazy" decoding="async" src={getFullUrl(getImageUrl(activeSession.requester_avatar))} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <User className="w-5 h-5 text-zinc-500" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium truncate">{activeSession.requester_name || 'Surfer'}</p>
            <p className="text-xs text-gray-500 truncate">{activeSession.location_name || 'On-Demand Session'}</p>
          </div>
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs flex-shrink-0">
            Cancelling
          </Badge>
        </div>
      )}

      <AlertDialogFooter className="gap-3 sm:gap-2">
        <AlertDialogCancel
          className="flex-1 border-zinc-600 bg-transparent text-white hover:bg-zinc-800 hover:text-white"
          disabled={isCancelling}
        >
          Keep Session
        </AlertDialogCancel>
        <AlertDialogAction
          onClick={(e) => {
            e.preventDefault(); // Prevent auto-close so loading state is visible
            handleConfirmCancel();
          }}
          disabled={isCancelling}
          className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold border-0"
        >
          {isCancelling ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <X className="w-4 h-4 mr-2" />
          )}
          {isCancelling ? 'Cancelling...' : 'Yes, Cancel Session'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default CancelSessionDialog;
