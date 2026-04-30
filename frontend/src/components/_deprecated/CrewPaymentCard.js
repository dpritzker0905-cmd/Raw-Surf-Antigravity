import React from 'react';
import { AlertTriangle, Users, Clock, CreditCard, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';

/**
 * CrewPaymentCard - Displays crew payment status and alerts
 * 
 * Used in booking cards to show:
 * - PENDING_PAYMENT status with crew payment progress
 * - Host alerts when crew members haven't paid
 * - Payment action buttons for crew members
 */

export const CrewPaymentCard = ({
  booking,
  isHost = false,
  currentUserId,
  onPayShare,
  onRemindCrew,
  theme = 'dark'
}) => {
  const isLight = theme === 'light';
  const isPendingPayment = booking.status === 'PendingPayment' || booking.crew_payment_required;
  
  if (!isPendingPayment) return null;

  const totalCrew = booking.max_participants || 1;
  const paidCount = booking.crew_paid_count || 0;
  const pendingCount = totalCrew - paidCount;
  const paymentProgress = (paidCount / totalCrew) * 100;
  
  // Check if current user has paid (simplified - would need participant data)
  const currentUserPaid = booking.participants?.find(p => p.participant_id === currentUserId)?.payment_status === 'Paid';

  return (
    <div className={`mt-3 p-3 rounded-lg border ${
      isLight 
        ? 'bg-amber-50 border-amber-200' 
        : 'bg-amber-500/10 border-amber-500/30'
    }`}>
      <div className="flex items-start gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className={`text-sm font-medium ${isLight ? 'text-amber-800' : 'text-amber-300'}`}>
            Awaiting Crew Payments
          </p>
          <p className={`text-xs ${isLight ? 'text-amber-600' : 'text-amber-400/80'}`}>
            Session will be confirmed once all crew members pay
          </p>
        </div>
      </div>

      {/* Payment Progress */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className={`text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
            Payment Progress
          </span>
          <span className={`text-xs font-medium ${isLight ? 'text-amber-700' : 'text-amber-400'}`}>
            {paidCount}/{totalCrew} paid
          </span>
        </div>
        <Progress 
          value={paymentProgress} 
          className={`h-2 ${isLight ? 'bg-amber-100' : 'bg-amber-900/50'}`}
        />
      </div>

      {/* Crew Status Badges */}
      <div className="flex flex-wrap gap-2 mb-3">
        {paidCount > 0 && (
          <Badge className="bg-green-500/20 text-green-400 text-xs gap-1">
            <CheckCircle2 className="w-3 h-3" />
            {paidCount} Paid
          </Badge>
        )}
        {pendingCount > 0 && (
          <Badge className="bg-amber-500/20 text-amber-400 text-xs gap-1">
            <Clock className="w-3 h-3" />
            {pendingCount} Pending
          </Badge>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        {isHost && pendingCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={onRemindCrew}
            className={`flex-1 text-xs ${
              isLight 
                ? 'border-amber-300 text-amber-700 hover:bg-amber-100' 
                : 'border-amber-500/50 text-amber-400 hover:bg-amber-500/20'
            }`}
          >
            <Users className="w-3 h-3 mr-1" />
            Remind Crew
          </Button>
        )}
        {!isHost && !currentUserPaid && (
          <Button
            size="sm"
            onClick={onPayShare}
            className="flex-1 text-xs bg-amber-500 hover:bg-amber-400 text-black"
          >
            <CreditCard className="w-3 h-3 mr-1" />
            Pay Your Share
          </Button>
        )}
      </div>

      {/* Host Alert */}
      {isHost && booking.host_notified_of_payment_issue && (
        <div className={`mt-2 p-2 rounded text-xs ${
          isLight ? 'bg-red-50 text-red-700' : 'bg-red-500/10 text-red-400'
        }`}>
          <XCircle className="w-3 h-3 inline mr-1" />
          Some crew members missed the payment deadline
        </div>
      )}
    </div>
  );
};

export default CrewPaymentCard;
