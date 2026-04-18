/**
 * SessionActionDrawer - Command Center for managing scheduled bookings
 * 
 * Features:
 * - Invite Crew: Launch CrewHub to add friends
 * - Split Payment: Trigger crew-split logic, send payment requests
 * - Modify: Change time slot (subject to availability)
 * - Cancel: Execute cancellation policy logic
 */
import React, { useState } from 'react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { useNavigate } from 'react-router-dom';
import { 
  Users, DollarSign, Clock, ChevronRight, 
  AlertTriangle, Calendar, MapPin, 
  Send, UserPlus, Settings, Ban, Loader2,
  MessageCircle, Share2, Check
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Textarea } from './ui/textarea';
import { toast } from 'sonner';
import logger from '../utils/logger';


export const SessionActionDrawer = ({
  isOpen,
  onClose,
  booking,
  user,
  theme = 'dark',
  onRefresh,
  onOpenCrewHub,
  onOpenModify,
  onOpenCrewView  // New prop for viewing crew lineup
}) => {
  const navigate = useNavigate();
  const isLight = theme === 'light';
  const [activeAction, setActiveAction] = useState(null); // 'cancel' | 'split' | null
  const [cancellationReason, setCancellationReason] = useState('');
  // Separate loading states for each action to prevent UI bleed
  const [cancelLoading, setCancelLoading] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [splitLoading, setSplitLoading] = useState(false);
  const [alreadyShared, setAlreadyShared] = useState(false);
  
  const _isHost = booking?.creator_id === user?.id;
  const hoursUntilSession = booking ? 
    (new Date(booking.session_date) - new Date()) / (1000 * 60 * 60) : 0;
  
  // Cancellation policy calculation
  const getRefundInfo = () => {
    if (hoursUntilSession > 24) {
      return { percentage: 100, label: 'Full Refund', color: 'text-green-400' };
    } else if (hoursUntilSession > 0) {
      return { percentage: 50, label: '50% Refund', color: 'text-yellow-400' };
    } else {
      return { percentage: 0, label: 'Credit Only', color: 'text-red-400' };
    }
  };
  
  const refundInfo = getRefundInfo();
  const refundAmount = (booking?.paid_amount || 0) * (refundInfo.percentage / 100);

  // Cancel booking handler
  const handleCancel = async () => {
    if (!booking || !user?.id) return;
    
    setCancelLoading(true);
    try {
      await apiClient.post(`/bookings/${booking.id}/cancel?user_id=${user.id}`, {
        reason: cancellationReason || 'Cancelled by user'
      });
      
      toast.success(
        refundInfo.percentage > 0 
          ? `Booking cancelled. $${refundAmount.toFixed(2)} will be refunded.`
          : 'Booking cancelled. Credit added to your account.'
      );
      
      setActiveAction(null);
      onClose();
      onRefresh?.();
    } catch (error) {
      logger.error('Cancel error:', error);
      const errorMessage = error.response?.data?.detail || 'Failed to cancel booking';
      // Handle validation errors that come as array
      const displayMessage = typeof errorMessage === 'object' 
        ? (Array.isArray(errorMessage) ? errorMessage[0]?.msg : errorMessage.msg || 'Failed to cancel booking')
        : errorMessage;
      toast.error(displayMessage);
    } finally {
      setCancelLoading(false);
    }
  };

  // Split payment - send requests to crew via messages
  const handleSplitPayment = async () => {
    if (!booking) return;
    
    setSplitLoading(true);
    try {
      // Create payment split requests for all pending crew members
      await apiClient.post(`/bookings/${booking.id}/send-split-requests`);
      
      toast.success('Payment requests sent to crew members!');
      setActiveAction(null);
      onClose();
      
      // Navigate to messages to see the sent requests
      navigate('/messages');
    } catch (error) {
      logger.error('Split payment error:', error);
      toast.error(error.response?.data?.detail || 'Failed to send payment requests');
    } finally {
      setSplitLoading(false);
    }
  };

  // Share session to feed
  const handleShareToFeed = async () => {
    if (!booking || !user?.id) return;
    
    // Don't allow re-sharing if already shared
    if (alreadyShared) {
      toast.info('This session is already on your feed!');
      return;
    }
    
    setShareLoading(true);
    try {
      const response = await apiClient.post(`/bookings/${booking.id}/share-to-feed?user_id=${user.id}`);
      toast.success('Session posted to feed! Friends can join from there.', {
        description: response.data?.spots_left > 0 
          ? `${response.data.spots_left} spot${response.data.spots_left > 1 ? 's' : ''} available for crew` 
          : 'Crew is full!'
      });
      setAlreadyShared(true);
      onClose();
      onRefresh?.(); // Refresh to update any feed-related UI
    } catch (error) {
      logger.error('Share error:', error);
      const errorDetail = error.response?.data?.detail;
      
      // Handle "already shared" case gracefully
      if (errorDetail?.toLowerCase().includes('already posted') || 
          errorDetail?.toLowerCase().includes('already shared')) {
        setAlreadyShared(true);
        toast.info('This session is already on your feed!', {
          description: 'Your friends can see it and join from there.'
        });
      } else if (error.response?.status === 403) {
        toast.error('Only the booking creator can share to feed');
      } else if (error.response?.status === 404) {
        toast.error('Booking not found. It may have been cancelled.');
      } else {
        toast.error(errorDetail || 'Failed to share session. Please try again.');
      }
    } finally {
      setShareLoading(false);
    }
  };

  if (!booking) return null;

  const cardBgClass = isLight ? 'bg-white' : 'bg-zinc-900';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';
  const actionCardClass = isLight 
    ? 'bg-gray-50 hover:bg-gray-100 border-gray-200' 
    : 'bg-zinc-800/50 hover:bg-zinc-800 border-zinc-700';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${cardBgClass} border-zinc-700 sm:max-w-[450px]`}>
        <DialogHeader className="shrink-0 border-b border-zinc-700 px-4 sm:px-6 pt-4 pb-3">
          <DialogTitle className={`text-lg font-bold ${textPrimaryClass} flex items-center gap-2`}>
            <Settings className="w-5 h-5 text-yellow-400" />
            Manage Session
          </DialogTitle>
          <DialogDescription className={textSecondaryClass}>
            {booking.location} · {new Date(booking.session_date).toLocaleDateString()}
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {/* Session Summary */}
        <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'} mb-4`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-cyan-400" />
              <span className={`text-sm ${textPrimaryClass}`}>{booking.location}</span>
            </div>
            <Badge variant={booking.status === 'Confirmed' ? 'default' : 'warning'}>
              {booking.status}
            </Badge>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3 text-gray-400" />
              <span className={textSecondaryClass}>
                {new Date(booking.session_date).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Users className="w-3 h-3 text-gray-400" />
              <span className={textSecondaryClass}>
                {booking.current_participants}/{booking.max_participants}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2 flex-1 overflow-y-auto">
          {/* Invite Crew */}
          <button
            onClick={() => {
              onClose();
              onOpenCrewHub?.(booking);
            }}
            className={`w-full p-4 rounded-lg border ${actionCardClass} flex items-center justify-between transition-colors`}
            data-testid="action-invite-crew"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center">
                <UserPlus className="w-5 h-5 text-cyan-400" />
              </div>
              <div className="text-left">
                <p className={`font-medium ${textPrimaryClass}`}>Invite Crew</p>
                <p className={`text-xs ${textSecondaryClass}`}>Add friends to this session</p>
              </div>
            </div>
            <ChevronRight className={`w-5 h-5 ${textSecondaryClass}`} />
          </button>

          {/* The Crew - View/Manage Crew Lineup with surfboard visualization */}
          <button
            onClick={() => {
              onClose();
              onOpenCrewView?.(booking);
            }}
            className={`w-full p-4 rounded-lg border ${actionCardClass} flex items-center justify-between transition-colors`}
            data-testid="action-view-crew"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-cyan-400" />
              </div>
              <div className="text-left">
                <p className={`font-medium ${textPrimaryClass}`}>The Crew</p>
                <p className={`text-xs ${textSecondaryClass}`}>View lineup & payment status</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-[10px]">
                {booking.current_participants}/{booking.max_participants}
              </Badge>
              <ChevronRight className={`w-5 h-5 ${textSecondaryClass}`} />
            </div>
          </button>

          {/* Split Payment - Only show if there are crew members */}
          {booking.current_participants > 1 && (
            <button
              onClick={() => setActiveAction('split')}
              className={`w-full p-4 rounded-lg border ${actionCardClass} flex items-center justify-between transition-colors`}
              data-testid="action-split-payment"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-green-400" />
                </div>
                <div className="text-left">
                  <p className={`font-medium ${textPrimaryClass}`}>Split Payment</p>
                  <p className={`text-xs ${textSecondaryClass}`}>Send payment requests to crew</p>
                </div>
              </div>
              <ChevronRight className={`w-5 h-5 ${textSecondaryClass}`} />
            </button>
          )}

          {/* Share to Feed */}
          <button
            onClick={handleShareToFeed}
            disabled={shareLoading || alreadyShared}
            className={`w-full p-4 rounded-lg border flex items-center justify-between transition-colors ${
              alreadyShared 
                ? 'border-green-500/50 bg-green-500/10 cursor-default' 
                : actionCardClass
            }`}
            data-testid="action-share-feed"
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                alreadyShared ? 'bg-green-500/20' : 'bg-purple-500/20'
              }`}>
                {alreadyShared ? (
                  <Check className="w-5 h-5 text-green-400" />
                ) : (
                  <Share2 className="w-5 h-5 text-purple-400" />
                )}
              </div>
              <div className="text-left">
                <p className={`font-medium ${alreadyShared ? 'text-green-400' : textPrimaryClass}`}>
                  {alreadyShared ? 'Posted to Feed' : 'Post to Feed'}
                </p>
                <p className={`text-xs ${textSecondaryClass}`}>
                  {alreadyShared ? 'Friends can see and join' : 'Friends can join from feed'}
                </p>
              </div>
            </div>
            {shareLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            ) : alreadyShared ? (
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px]">Shared</Badge>
            ) : (
              <ChevronRight className={`w-5 h-5 ${textSecondaryClass}`} />
            )}
          </button>

          {/* Modify Session */}
          <button
            onClick={() => {
              onClose();
              onOpenModify?.(booking);
            }}
            className={`w-full p-4 rounded-lg border ${actionCardClass} flex items-center justify-between transition-colors`}
            data-testid="action-modify"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                <Clock className="w-5 h-5 text-yellow-400" />
              </div>
              <div className="text-left">
                <p className={`font-medium ${textPrimaryClass}`}>Modify Time</p>
                <p className={`text-xs ${textSecondaryClass}`}>Change session time slot</p>
              </div>
            </div>
            <ChevronRight className={`w-5 h-5 ${textSecondaryClass}`} />
          </button>

          {/* Cancel Session */}
          <button
            onClick={() => setActiveAction('cancel')}
            className={`w-full p-4 rounded-lg border border-red-500/30 bg-red-500/5 hover:bg-red-500/10 flex items-center justify-between transition-colors`}
            data-testid="action-cancel"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <Ban className="w-5 h-5 text-red-400" />
              </div>
              <div className="text-left">
                <p className="font-medium text-red-400">Cancel Session</p>
                <p className={`text-xs ${refundInfo.color}`}>
                  {refundInfo.label} ({refundInfo.percentage}%)
                </p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-red-400" />
          </button>
        </div>

        {/* Cancel Confirmation Dialog */}
        {activeAction === 'cancel' && (
          <div className={`p-4 rounded-lg border border-red-500/30 ${isLight ? 'bg-red-50' : 'bg-red-500/10'}`}>
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5" />
              <div>
                <h4 className="font-medium text-red-400">Cancel this session?</h4>
                <p className={`text-sm ${textSecondaryClass} mt-1`}>
                  Based on our cancellation policy:
                </p>
                <div className={`mt-2 p-2 rounded ${isLight ? 'bg-white' : 'bg-zinc-900'}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-sm ${textSecondaryClass}`}>Refund Amount</span>
                    <span className={`font-bold ${refundInfo.color}`}>
                      ${refundAmount.toFixed(2)} ({refundInfo.percentage}%)
                    </span>
                  </div>
                  {refundInfo.percentage < 100 && (
                    <p className="text-xs text-gray-500 mt-1">
                      {hoursUntilSession <= 0 
                        ? 'Session has passed - credit will be added to your account'
                        : `Less than 24 hours until session`}
                    </p>
                  )}
                </div>
              </div>
            </div>
            
            <Textarea
              value={cancellationReason}
              onChange={(e) => setCancellationReason(e.target.value)}
              placeholder="Reason for cancellation (optional)"
              className={`mb-4 ${isLight ? 'bg-white border-gray-300' : 'bg-zinc-900 border-zinc-700'}`}
              rows={2}
            />
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setActiveAction(null)}
                className="flex-1"
              >
                Keep Session
              </Button>
              <Button
                onClick={handleCancel}
                disabled={cancelLoading}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white"
              >
                {cancelLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Confirm Cancel'
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Split Payment Confirmation */}
        {activeAction === 'split' && (
          <div className={`mt-4 p-4 rounded-lg border border-green-500/30 ${isLight ? 'bg-green-50' : 'bg-green-500/10'}`}>
            <div className="flex items-start gap-3 mb-4">
              <MessageCircle className="w-5 h-5 text-green-400 mt-0.5" />
              <div>
                <h4 className="font-medium text-green-400">Send Payment Requests?</h4>
                <p className={`text-sm ${textSecondaryClass} mt-1`}>
                  This will send payment requests to {booking.current_participants - 1} crew member(s) 
                  via Messages. They'll be able to pay their share directly.
                </p>
                <div className={`mt-2 p-2 rounded ${isLight ? 'bg-white' : 'bg-zinc-900'}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-sm ${textSecondaryClass}`}>Per Person</span>
                    <span className="font-bold text-green-400">
                      ${(booking.total_price / booking.current_participants).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setActiveAction(null)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSplitPayment}
                disabled={splitLoading}
                className="flex-1 bg-green-500 hover:bg-green-600 text-white"
              >
                {splitLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Send Requests
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SessionActionDrawer;
