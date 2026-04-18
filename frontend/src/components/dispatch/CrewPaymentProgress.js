/**
 * CrewPaymentProgress - TICKET-003
 * Shows individual payment status per crew member
 * Allows captain to cover remaining shares to unlock media immediately
 */
import React, { useState, useEffect } from 'react';
import { 
  Check, Users, Loader2, 
  Send, AlertCircle, ChevronDown, ChevronUp, Shield
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible';
import { toast } from 'sonner';
import axios from 'axios';

const API = process.env.REACT_APP_BACKEND_URL;

/**
 * Individual crew member chip showing payment status
 */
const CrewMemberChip = ({ member, _isLight }) => {
  const isPaid = member.paid;
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div 
            className={`
              flex items-center gap-2 px-2 py-1 rounded-full transition-all
              ${isPaid 
                ? 'bg-green-500/20 border border-green-500/30' 
                : 'bg-amber-500/20 border border-amber-500/30'
              }
            `}
            data-testid={`crew-member-${member.user_id}`}
          >
            {/* Avatar */}
            <div className="relative">
              <div className="w-6 h-6 rounded-full overflow-hidden bg-zinc-700">
                {member.avatar_url ? (
                  <img src={member.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-zinc-400">
                    {member.name?.charAt(0) || '?'}
                  </div>
                )}
              </div>
              {/* Status indicator */}
              <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-zinc-900 ${
                isPaid ? 'bg-green-500' : 'bg-amber-500'
              }`}>
                {isPaid && <Check className="w-2 h-2 text-white" />}
              </div>
            </div>
            
            {/* Name */}
            <span className={`text-xs font-medium ${isPaid ? 'text-green-400' : 'text-amber-400'}`}>
              {member.name?.split(' ')[0] || member.username || 'Crew'}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent className="bg-zinc-800 border-zinc-700">
          <div className="text-xs">
            <p className="font-medium text-white">{member.name || member.username}</p>
            <p className={isPaid ? 'text-green-400' : 'text-amber-400'}>
              {isPaid ? `Paid $${member.share_amount?.toFixed(2) || '0.00'}` : `Owes $${member.share_amount?.toFixed(2) || '0.00'}`}
            </p>
            {isPaid && member.paid_at && (
              <p className="text-zinc-400 mt-1">
                {new Date(member.paid_at).toLocaleString()}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/**
 * Main CrewPaymentProgress component
 */
export const CrewPaymentProgress = ({ 
  dispatchId,
  bookingId,
  serviceType = 'dispatch', // 'dispatch' or 'booking'
  currentUserId,
  isCaptain = false,
  onAllPaid,
  onRefresh,
  theme = 'dark',
  compact = false
}) => {
  const isLight = theme === 'light';
  const [crewMembers, setCrewMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [covering, setCovering] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(null);
  const [isExpanded, setIsExpanded] = useState(!compact);
  
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-zinc-400';
  const bgCardClass = isLight ? 'bg-gray-100' : 'bg-zinc-800';
  
  // Fetch crew payment status
  const fetchCrewStatus = async () => {
    try {
      const endpoint = serviceType === 'dispatch' 
        ? `${API}/api/dispatch/${dispatchId}/crew-status`
        : `${API}/api/bookings/${bookingId}/crew-status`;
      
      const response = await axios.get(endpoint);
      setCrewMembers(response.data.crew || response.data.participants || []);
      
      // Check if all paid
      const allPaid = response.data.all_participants_paid || 
        (response.data.crew?.every(m => m.paid) ?? false);
      if (allPaid && onAllPaid) {
        onAllPaid();
      }
    } catch (error) {
      console.error('Failed to fetch crew status:', error);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    if (dispatchId || bookingId) {
      fetchCrewStatus();
      // Poll every 10 seconds
      const interval = setInterval(fetchCrewStatus, 10000);
      return () => clearInterval(interval);
    }
  }, [dispatchId, bookingId]);
  
  // Calculate totals
  const paidCount = crewMembers.filter(m => m.paid).length;
  const totalCount = crewMembers.length;
  const paidAmount = crewMembers.filter(m => m.paid).reduce((sum, m) => sum + (m.share_amount || 0), 0);
  const totalAmount = crewMembers.reduce((sum, m) => sum + (m.share_amount || 0), 0);
  const unpaidAmount = totalAmount - paidAmount;
  const unpaidMembers = crewMembers.filter(m => !m.paid);
  const progressPercent = totalCount > 0 ? (paidCount / totalCount) * 100 : 0;
  
  // Cover remaining shares (captain only)
  const handleCoverRemaining = async () => {
    if (!isCaptain || unpaidAmount <= 0) return;
    
    setCovering(true);
    try {
      const endpoint = serviceType === 'dispatch'
        ? `${API}/api/dispatch/${dispatchId}/cover-remaining`
        : `${API}/api/bookings/${bookingId}/cover-remaining`;
      
      await axios.post(endpoint, { captain_id: currentUserId });
      
      toast.success(`Covered $${unpaidAmount.toFixed(2)} for your crew!`);
      await fetchCrewStatus();
      onRefresh?.();
    } catch (error) {
      const msg = error.response?.data?.detail || 'Failed to cover remaining amount';
      toast.error(msg);
    } finally {
      setCovering(false);
    }
  };
  
  // Send reminder to unpaid crew member
  const handleSendReminder = async (memberId) => {
    setSendingReminder(memberId);
    try {
      const endpoint = serviceType === 'dispatch'
        ? `${API}/api/dispatch/${dispatchId}/remind-crew`
        : `${API}/api/bookings/${bookingId}/remind-crew`;
      
      await axios.post(endpoint, { 
        captain_id: currentUserId,
        member_id: memberId 
      });
      
      toast.success('Reminder sent!');
    } catch (error) {
      toast.error('Failed to send reminder');
    } finally {
      setSendingReminder(null);
    }
  };
  
  if (loading) {
    return (
      <div className={`p-4 rounded-lg ${bgCardClass} flex items-center justify-center`}>
        <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
      </div>
    );
  }
  
  if (crewMembers.length === 0) {
    return null;
  }
  
  // All paid state
  if (paidCount === totalCount) {
    return (
      <div 
        className="p-3 rounded-lg bg-green-500/10 border border-green-500/30"
        data-testid="crew-payment-complete"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-green-500/20">
            <Check className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <p className={`font-medium ${textPrimaryClass}`}>All Crew Paid!</p>
            <p className={`text-sm ${textSecondaryClass}`}>
              {totalCount} members • ${totalAmount.toFixed(2)} total
            </p>
          </div>
        </div>
      </div>
    );
  }
  
  // Compact mode for smaller UIs
  if (compact) {
    return (
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <button 
            className={`w-full p-3 rounded-lg ${bgCardClass} hover:bg-opacity-80 transition-all`}
            data-testid="crew-payment-progress-compact"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-cyan-400" />
                <div className="text-left">
                  <p className={`text-sm font-medium ${textPrimaryClass}`}>
                    Crew Payment: {paidCount}/{totalCount}
                  </p>
                  <Progress value={progressPercent} className="w-24 h-1.5 mt-1" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                {unpaidAmount > 0 && (
                  <Badge className="bg-amber-500/20 text-amber-400">
                    ${unpaidAmount.toFixed(2)} pending
                  </Badge>
                )}
                {isExpanded ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
              </div>
            </div>
          </button>
        </CollapsibleTrigger>
        
        <CollapsibleContent className="mt-2">
          <CrewPaymentDetails 
            crewMembers={crewMembers}
            unpaidMembers={unpaidMembers}
            unpaidAmount={unpaidAmount}
            isCaptain={isCaptain}
            covering={covering}
            sendingReminder={sendingReminder}
            onCoverRemaining={handleCoverRemaining}
            onSendReminder={handleSendReminder}
            isLight={isLight}
            textPrimaryClass={textPrimaryClass}
            textSecondaryClass={textSecondaryClass}
            bgCardClass={bgCardClass}
          />
        </CollapsibleContent>
      </Collapsible>
    );
  }
  
  // Full mode
  return (
    <div 
      className={`p-4 rounded-lg ${bgCardClass}`}
      data-testid="crew-payment-progress"
    >
      {/* Header with progress */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-cyan-500/20">
            <Users className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <p className={`font-medium ${textPrimaryClass}`}>Crew Payment Status</p>
            <p className={`text-sm ${textSecondaryClass}`}>
              {paidCount} of {totalCount} paid
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-green-400">${paidAmount.toFixed(2)}</p>
          <p className={`text-xs ${textSecondaryClass}`}>of ${totalAmount.toFixed(2)}</p>
        </div>
      </div>
      
      {/* Progress bar */}
      <Progress value={progressPercent} className="h-2 mb-4" />
      
      <CrewPaymentDetails 
        crewMembers={crewMembers}
        unpaidMembers={unpaidMembers}
        unpaidAmount={unpaidAmount}
        isCaptain={isCaptain}
        covering={covering}
        sendingReminder={sendingReminder}
        onCoverRemaining={handleCoverRemaining}
        onSendReminder={handleSendReminder}
        isLight={isLight}
        textPrimaryClass={textPrimaryClass}
        textSecondaryClass={textSecondaryClass}
        bgCardClass={bgCardClass}
      />
    </div>
  );
};

/**
 * Crew payment details (member list + actions)
 */
const CrewPaymentDetails = ({
  crewMembers,
  unpaidMembers,
  unpaidAmount,
  isCaptain,
  covering,
  sendingReminder,
  onCoverRemaining,
  onSendReminder,
  isLight,
  textPrimaryClass,
  textSecondaryClass,
  _bgCardClass
}) => {
  return (
    <>
      {/* Crew member chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {crewMembers.map(member => (
          <CrewMemberChip key={member.user_id} member={member} isLight={isLight} />
        ))}
      </div>
      
      {/* Captain actions */}
      {isCaptain && unpaidMembers.length > 0 && (
        <div className={`pt-4 border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}>
          {/* Cover remaining button */}
          <Button
            onClick={onCoverRemaining}
            disabled={covering}
            className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-medium mb-3"
            data-testid="cover-remaining-btn"
          >
            {covering ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Shield className="w-4 h-4 mr-2" />
                Cover ${unpaidAmount.toFixed(2)} to Unlock Now
              </>
            )}
          </Button>
          
          {/* Send reminders */}
          <div className="space-y-2">
            <p className={`text-xs ${textSecondaryClass} mb-2`}>
              Or send a payment reminder:
            </p>
            {unpaidMembers.map(member => (
              <div 
                key={member.user_id}
                className={`flex items-center justify-between p-2 rounded-lg ${isLight ? 'bg-white' : 'bg-zinc-900'}`}
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-zinc-700">
                    {member.avatar_url ? (
                      <img src={member.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-sm text-zinc-400">
                        {member.name?.charAt(0) || '?'}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${textPrimaryClass}`}>
                      {member.name || member.username}
                    </p>
                    <p className="text-xs text-amber-400">
                      Owes ${member.share_amount?.toFixed(2) || '0.00'}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onSendReminder(member.user_id)}
                  disabled={sendingReminder === member.user_id}
                  className="border-zinc-600"
                  data-testid={`remind-${member.user_id}`}
                >
                  {sendingReminder === member.user_id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Send className="w-3 h-3 mr-1" />
                      Remind
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Non-captain waiting message */}
      {!isCaptain && unpaidMembers.length > 0 && (
        <div className={`p-3 rounded-lg ${isLight ? 'bg-amber-50' : 'bg-amber-500/10'} border ${isLight ? 'border-amber-200' : 'border-amber-500/30'}`}>
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <p className={`text-sm ${textSecondaryClass}`}>
              Waiting for {unpaidMembers.length} crew member{unpaidMembers.length > 1 ? 's' : ''} to complete payment.
              Media will unlock once everyone has paid.
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default CrewPaymentProgress;
