import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { 
  Users, DollarSign, Clock, CheckCircle2, AlertTriangle, 
  Send, Calculator, Loader2, ChevronDown, ChevronUp,
  Anchor, Shield, Percent, Wallet, ArrowRight, 
  UserCheck, Crown, Timer, Bell, RefreshCw, MessageCircle
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { Slider } from './ui/slider';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { toast } from 'sonner';
import logger from '../utils/logger';

const API = process.env.REACT_APP_BACKEND_URL;

/**
 * CrewHub - Captain's Command Center for Split Bookings
 * 
 * Features:
 * - Granular payment control: custom percentages per crew member
 * - "Paid by Me" toggle for Captain to cover specific members
 * - Real-time balance calculation with remaining balance display
 * - Payment window countdown (60min On-Demand / 24hr Scheduled)
 * - 1-click nudge for reminders via OneSignal
 */

export const CrewHub = ({ 
  booking, 
  crewMembers: initialCrew = [], 
  totalPrice,
  onUpdate,
  onPaymentComplete,
  isCheckoutMode = false  // True when in checkout flow, false when viewing existing booking
}) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const isLight = theme === 'light';
  
  // Crew state with custom split data
  const [crewMembers, setCrewMembers] = useState(initialCrew);
  const [loading, setLoading] = useState(false);
  const [savingSplits, setSavingSplits] = useState(false);
  const [sendingNudge, setSendingNudge] = useState(null);
  
  // Captain's view state
  const isCaptain = booking?.creator_id === user?.id || isCheckoutMode;
  const bookingTotal = totalPrice || booking?.total_price || 0;
  
  // Payment window countdown
  const [timeRemaining, setTimeRemaining] = useState(null);
  const paymentWindowExpires = booking?.payment_window_expires_at;
  
  // Computed values
  const totalCrew = crewMembers.length + 1; // +1 for captain
  const equalShare = bookingTotal / totalCrew;
  
  // Calculate totals from custom splits
  const assignedTotal = useMemo(() => {
    return crewMembers.reduce((sum, m) => sum + (m.share_amount || equalShare), 0);
  }, [crewMembers, equalShare]);
  
  const captainShare = useMemo(() => {
    // Captain pays: their share + any covered members
    const captainBase = bookingTotal - assignedTotal;
    const coveredAmount = crewMembers
      .filter(m => m.covered_by_captain)
      .reduce((sum, m) => sum + (m.share_amount || equalShare), 0);
    return Math.max(0, captainBase + coveredAmount);
  }, [bookingTotal, assignedTotal, crewMembers, equalShare]);
  
  const remainingBalance = useMemo(() => {
    const paid = crewMembers.reduce((sum, m) => 
      sum + (m.payment_status === 'Paid' || m.covered_by_captain ? (m.share_amount || equalShare) : 0), 0
    );
    const captainPaid = booking?.captain_hold_paid ? captainShare : 0;
    return bookingTotal - paid - captainPaid;
  }, [crewMembers, bookingTotal, captainShare, equalShare, booking?.captain_hold_paid]);
  
  const paidCount = crewMembers.filter(m => m.payment_status === 'Paid' || m.covered_by_captain).length;
  const pendingCount = crewMembers.filter(m => m.payment_status === 'Pending' && !m.covered_by_captain).length;
  const paymentProgress = totalCrew > 0 ? ((paidCount + (booking?.captain_hold_paid ? 1 : 0)) / totalCrew) * 100 : 0;

  // Update countdown timer
  useEffect(() => {
    if (!paymentWindowExpires) return;
    
    const updateTimer = () => {
      const now = new Date();
      const expires = new Date(paymentWindowExpires);
      const diff = expires - now;
      
      if (diff <= 0) {
        setTimeRemaining({ expired: true });
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        setTimeRemaining({ hours, minutes, seconds, expired: false });
      }
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [paymentWindowExpires]);

  // Fetch crew status for existing bookings
  useEffect(() => {
    if (booking?.id && !isCheckoutMode) {
      fetchCrewStatus();
    }
  }, [booking?.id, isCheckoutMode]);

  const fetchCrewStatus = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API}/api/bookings/${booking.id}/crew-hub-status?captain_id=${user.id}`);
      setCrewMembers(response.data?.crew || []);
    } catch (error) {
      logger.error('Failed to fetch crew status:', error);
    } finally {
      setLoading(false);
    }
  };

  // Handle percentage slider change
  const handlePercentageChange = (memberId, percentage) => {
    const newAmount = (percentage / 100) * bookingTotal;
    setCrewMembers(prev => prev.map(m => 
      m.id === memberId || m.participant_id === memberId
        ? { ...m, share_percentage: percentage, share_amount: newAmount }
        : m
    ));
  };

  // Handle direct amount input
  const handleAmountChange = (memberId, amount) => {
    const numAmount = parseFloat(amount) || 0;
    const percentage = (numAmount / bookingTotal) * 100;
    setCrewMembers(prev => prev.map(m => 
      m.id === memberId || m.participant_id === memberId
        ? { ...m, share_amount: numAmount, share_percentage: percentage }
        : m
    ));
  };

  // Handle "Paid by Me" toggle
  const handleCoverToggle = (memberId, covered) => {
    setCrewMembers(prev => prev.map(m => 
      m.id === memberId || m.participant_id === memberId
        ? { ...m, covered_by_captain: covered, payment_status: covered ? 'Paid' : 'Pending' }
        : m
    ));
  };

  // Save custom splits to backend
  const handleSaveSplits = async () => {
    // Validate total
    const totalAssigned = crewMembers.reduce((sum, m) => sum + (m.share_amount || 0), 0) + captainShare;
    if (Math.abs(totalAssigned - bookingTotal) > 0.01) {
      toast.error(`Split amounts must equal $${bookingTotal.toFixed(2)}. Current: $${totalAssigned.toFixed(2)}`);
      return;
    }

    setSavingSplits(true);
    try {
      await axios.post(`${API}/api/bookings/${booking.id}/crew-hub/update-splits`, {
        captain_id: user.id,
        splits: crewMembers.map(m => ({
          participant_id: m.participant_id || m.id,
          share_amount: m.share_amount || equalShare,
          share_percentage: m.share_percentage || (100 / totalCrew),
          covered_by_captain: m.covered_by_captain || false
        })),
        captain_share: captainShare
      });
      toast.success('Payment splits updated!');
      onUpdate?.();
    } catch (error) {
      toast.error('Failed to update splits');
    } finally {
      setSavingSplits(false);
    }
  };

  // Send nudge to pending member
  const handleNudge = async (memberId) => {
    setSendingNudge(memberId);
    try {
      await axios.post(`${API}/api/bookings/${booking.id}/nudge`, {
        participant_id: memberId,
        captain_id: user.id
      });
      toast.success('Reminder sent!');
    } catch (error) {
      toast.error('Failed to send reminder');
    } finally {
      setSendingNudge(null);
    }
  };

  // Nudge all pending members
  const handleNudgeAll = async () => {
    const pendingIds = crewMembers
      .filter(m => m.payment_status === 'Pending' && !m.covered_by_captain)
      .map(m => m.participant_id || m.id);
    
    if (pendingIds.length === 0) {
      toast.info('All crew members have paid!');
      return;
    }

    setSendingNudge('all');
    try {
      await axios.post(`${API}/api/bookings/${booking.id}/nudge-all`, {
        captain_id: user.id
      });
      toast.success(`Reminders sent to ${pendingIds.length} crew members!`);
    } catch (error) {
      toast.error('Failed to send reminders');
    } finally {
      setSendingNudge(null);
    }
  };

  // Captain covers remaining balance
  const handleCoverRemaining = async () => {
    if (!window.confirm(`Cover the remaining $${remainingBalance.toFixed(2)} for your crew?`)) return;
    
    setLoading(true);
    try {
      await axios.post(`${API}/api/bookings/${booking.id}/crew-hub/captain-cover-remaining`, {
        captain_id: user.id,
        cover_amount: remainingBalance
      });
      toast.success('You covered the remaining balance! Session confirmed.');
      fetchCrewStatus();
      onUpdate?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to cover balance');
    } finally {
      setLoading(false);
    }
  };

  // Distribute evenly
  const handleDistributeEvenly = () => {
    const evenShare = bookingTotal / totalCrew;
    const evenPercentage = 100 / totalCrew;
    setCrewMembers(prev => prev.map(m => ({
      ...m,
      share_amount: evenShare,
      share_percentage: evenPercentage,
      covered_by_captain: false
    })));
    toast.info(`Set to even split: $${evenShare.toFixed(2)} each`);
  };

  if (!isCaptain && !isCheckoutMode) {
    return null; // Only captain sees the hub
  }

  return (
    <Card className={`${isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/50 border-zinc-800'}`} data-testid="crew-hub">
      <CardHeader className="pb-2">
        <CardTitle className={`text-lg flex items-center justify-between ${isLight ? 'text-gray-900' : 'text-white'}`}>
          <div className="flex items-center gap-2">
            <Crown className="w-5 h-5 text-yellow-400" />
            Crew Hub
            <Badge className="bg-gradient-to-r from-yellow-400 to-orange-400 text-black text-xs">
              Captain
            </Badge>
          </div>
          {booking?.id && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/bookings/${booking.id}/chat`)}
              className={`flex items-center gap-1.5 ${isLight ? 'border-cyan-500 text-cyan-600 hover:bg-cyan-50' : 'border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10'}`}
              data-testid="crew-hub-chat-btn"
            >
              <MessageCircle className="w-4 h-4" />
              Chat
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Payment Window Countdown */}
        {paymentWindowExpires && !booking?.payment_window_expired && (
          <div className={`p-3 rounded-lg flex items-center justify-between ${
            timeRemaining?.expired 
              ? (isLight ? 'bg-red-50 border border-red-200' : 'bg-red-500/10 border border-red-500/30')
              : (isLight ? 'bg-amber-50 border border-amber-200' : 'bg-amber-500/10 border border-amber-500/30')
          }`}>
            <div className="flex items-center gap-2">
              <Timer className={`w-5 h-5 ${timeRemaining?.expired ? 'text-red-500' : 'text-amber-500'}`} />
              <div>
                <p className={`text-sm font-medium ${isLight ? 'text-gray-900' : 'text-white'}`}>
                  {timeRemaining?.expired ? 'Payment Window Expired' : 'Crew Payment Window'}
                </p>
                <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                  {booking?.booking_type === 'on_demand' ? '60-minute window' : '24-hour window'}
                </p>
              </div>
            </div>
            {!timeRemaining?.expired && timeRemaining && (
              <div className="text-right">
                <p className={`text-lg font-bold font-mono ${isLight ? 'text-amber-600' : 'text-amber-400'}`}>
                  {String(timeRemaining.hours).padStart(2, '0')}:
                  {String(timeRemaining.minutes).padStart(2, '0')}:
                  {String(timeRemaining.seconds).padStart(2, '0')}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Real-Time Balance Summary */}
        <div className={`p-4 rounded-xl ${isLight ? 'bg-gradient-to-br from-cyan-50 to-blue-50' : 'bg-gradient-to-br from-cyan-500/10 to-blue-500/10'} border border-cyan-400/30`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-cyan-400" />
              <span className={`font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>Session Total</span>
            </div>
            <span className="text-2xl font-bold text-cyan-400">${bookingTotal.toFixed(2)}</span>
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className={isLight ? 'text-gray-600' : 'text-gray-400'}>Your Share (Captain)</span>
              <span className={`font-medium ${isLight ? 'text-gray-900' : 'text-white'}`}>${captainShare.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className={isLight ? 'text-gray-600' : 'text-gray-400'}>Crew ({crewMembers.length})</span>
              <span className={`font-medium ${isLight ? 'text-gray-900' : 'text-white'}`}>${assignedTotal.toFixed(2)}</span>
            </div>
            <div className={`flex justify-between text-sm pt-2 border-t ${isLight ? 'border-cyan-200' : 'border-cyan-500/30'}`}>
              <span className={`font-medium ${remainingBalance > 0 ? 'text-amber-500' : 'text-green-500'}`}>
                {remainingBalance > 0 ? 'Remaining Balance' : 'Fully Covered'}
              </span>
              <span className={`font-bold ${remainingBalance > 0 ? 'text-amber-500' : 'text-green-500'}`}>
                ${remainingBalance.toFixed(2)}
              </span>
            </div>
          </div>
          
          {/* Progress Bar */}
          <div className="mt-3">
            <Progress value={paymentProgress} className="h-2" />
            <p className={`text-xs mt-1 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
              {paidCount + (booking?.captain_hold_paid ? 1 : 0)}/{totalCrew} paid
            </p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleDistributeEvenly}
            className={`flex-1 ${isLight ? 'border-gray-300' : 'border-zinc-600'}`}
          >
            <Calculator className="w-4 h-4 mr-1" />
            Even Split
          </Button>
          {pendingCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleNudgeAll}
              disabled={sendingNudge === 'all'}
              className={`flex-1 ${isLight ? 'border-cyan-300 text-cyan-700' : 'border-cyan-500/50 text-cyan-400'}`}
            >
              {sendingNudge === 'all' ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Bell className="w-4 h-4 mr-1" />}
              Nudge All
            </Button>
          )}
        </div>

        {/* Crew Members with Granular Controls */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
          </div>
        ) : (
          <div className="space-y-3">
            <h4 className={`text-sm font-medium ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>
              Crew Payment Controls
            </h4>
            
            {crewMembers.map((member, idx) => {
              const memberId = member.participant_id || member.id;
              const memberShare = member.share_amount || equalShare;
              const memberPercentage = member.share_percentage || (100 / totalCrew);
              const isPaid = member.payment_status === 'Paid';
              const isCovered = member.covered_by_captain;
              
              return (
                <div 
                  key={memberId}
                  className={`p-4 rounded-xl ${isLight ? 'bg-gray-50 border border-gray-100' : 'bg-zinc-800/50 border border-zinc-700/50'}`}
                  data-testid={`crew-member-${idx}`}
                >
                  {/* Member Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        isPaid || isCovered
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-amber-500/20 text-amber-400'
                      }`}>
                        {member.name?.charAt(0) || member.value?.charAt(0) || 'C'}
                      </div>
                      <div>
                        <p className={`text-sm font-medium ${isLight ? 'text-gray-900' : 'text-white'}`}>
                          {member.name || member.value || `Crew ${idx + 1}`}
                        </p>
                        <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                          {member.email || member.type === 'email' ? 'Email invite' : 'Username invite'}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {isPaid ? (
                        <Badge className="bg-green-500/20 text-green-400">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Paid
                        </Badge>
                      ) : isCovered ? (
                        <Badge className="bg-purple-500/20 text-purple-400">
                          <Shield className="w-3 h-3 mr-1" />
                          You Covered
                        </Badge>
                      ) : (
                        <>
                          <Badge className="bg-amber-500/20 text-amber-400">
                            <Clock className="w-3 h-3 mr-1" />
                            Pending
                          </Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleNudge(memberId)}
                            disabled={sendingNudge === memberId}
                            className="p-1 h-7"
                          >
                            {sendingNudge === memberId ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4 text-cyan-400" />
                            )}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Payment Controls (only show for unpaid members) */}
                  {!isPaid && (
                    <div className="space-y-3">
                      {/* Percentage Slider */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                            Share: {memberPercentage.toFixed(1)}%
                          </span>
                          <span className={`text-sm font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>
                            ${memberShare.toFixed(2)}
                          </span>
                        </div>
                        <Slider
                          value={[memberPercentage]}
                          onValueChange={([val]) => handlePercentageChange(memberId, val)}
                          max={100}
                          step={1}
                          disabled={isCovered}
                          className="cursor-pointer"
                        />
                      </div>

                      {/* Direct Amount Input */}
                      <div className="flex items-center gap-2">
                        <span className={`text-sm ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>Or set amount:</span>
                        <div className="flex items-center gap-1 flex-1">
                          <DollarSign className="w-4 h-4 text-gray-400" />
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            max={bookingTotal}
                            value={memberShare.toFixed(2)}
                            onChange={(e) => handleAmountChange(memberId, e.target.value)}
                            disabled={isCovered}
                            className={`h-8 w-24 ${isLight ? 'bg-white' : 'bg-zinc-900 border-zinc-600'}`}
                          />
                        </div>
                      </div>

                      {/* "Paid by Me" Toggle */}
                      <div className={`flex items-center justify-between p-2 rounded-lg ${isLight ? 'bg-purple-50' : 'bg-purple-500/10'}`}>
                        <div className="flex items-center gap-2">
                          <Shield className="w-4 h-4 text-purple-400" />
                          <span className={`text-sm ${isLight ? 'text-purple-700' : 'text-purple-300'}`}>
                            I'll cover this member
                          </span>
                        </div>
                        <Switch
                          checked={isCovered}
                          onCheckedChange={(checked) => handleCoverToggle(memberId, checked)}
                          className="data-[state=checked]:bg-purple-500"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col gap-2 pt-2">
          {/* Save Splits */}
          {booking?.id && (
            <Button
              onClick={handleSaveSplits}
              disabled={savingSplits}
              className="w-full bg-cyan-500 hover:bg-cyan-400 text-black"
            >
              {savingSplits ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
              Save Payment Splits
            </Button>
          )}
          
          {/* Cover Remaining (only if there's remaining balance) */}
          {remainingBalance > 0 && booking?.id && (
            <Button
              onClick={handleCoverRemaining}
              disabled={loading}
              variant="outline"
              className={`w-full ${isLight ? 'border-purple-300 text-purple-700' : 'border-purple-500/50 text-purple-400'}`}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Wallet className="w-4 h-4 mr-2" />}
              Cover Remaining ${remainingBalance.toFixed(2)}
            </Button>
          )}
          
          {/* Proceed to Payment (checkout mode) */}
          {isCheckoutMode && onPaymentComplete && (
            <Button
              onClick={() => onPaymentComplete({ crewMembers, captainShare })}
              className="w-full bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold"
            >
              <ArrowRight className="w-4 h-4 mr-2" />
              Confirm & Pay ${captainShare.toFixed(2)}
            </Button>
          )}
        </div>

        {/* Payment Locked Message */}
        {paymentProgress < 100 && booking?.id && !isCheckoutMode && (
          <div className={`p-3 rounded-lg ${isLight ? 'bg-amber-50 border border-amber-200' : 'bg-amber-500/10 border border-amber-500/30'}`}>
            <p className={`text-sm ${isLight ? 'text-amber-700' : 'text-amber-400'} flex items-center gap-2`}>
              <AlertTriangle className="w-4 h-4" />
              Session locked until all crew payments complete. Photographer cannot see this booking yet.
            </p>
          </div>
        )}

        {/* All Paid Confirmation */}
        {paymentProgress === 100 && (
          <div className={`p-3 rounded-lg ${isLight ? 'bg-green-50 border border-green-200' : 'bg-green-500/10 border border-green-500/30'}`}>
            <p className={`text-sm ${isLight ? 'text-green-700' : 'text-green-400'} flex items-center gap-2`}>
              <CheckCircle2 className="w-4 h-4" />
              All payments received! Session is confirmed and visible to photographer.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default CrewHub;
