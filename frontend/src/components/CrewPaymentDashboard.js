import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { 
  Users, DollarSign, Clock, CheckCircle2, AlertTriangle, 
  Send, Calculator, Loader2, ChevronDown, ChevronUp
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Input } from './ui/input';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { toast } from 'sonner';
import logger from '../utils/logger';

const API = process.env.REACT_APP_BACKEND_URL;

/**
 * CrewPaymentDashboard - Host Surfer's real-time crew payment management
 * 
 * Features:
 * - Real-time crew payment status
 * - Custom split tool for adjusting amounts per crew member
 * - 1-click nudge for reminders
 * - Payment lock until 100% verified
 */

export const CrewPaymentDashboard = ({ booking, onUpdate }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  
  const [crewMembers, setCrewMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCustomSplit, setShowCustomSplit] = useState(false);
  const [customAmounts, setCustomAmounts] = useState({});
  const [sendingNudge, setSendingNudge] = useState(null);
  const [expanded, setExpanded] = useState(true);

  const isHost = booking.creator_id === user?.id || booking.host_id === user?.id;
  const totalCrew = booking.max_participants || 1;
  const totalAmount = booking.total_price || 0;
  const equalShare = totalAmount / totalCrew;
  
  // Calculate payment progress
  const paidCount = crewMembers.filter(m => m.payment_status === 'Paid').length;
  const pendingCount = crewMembers.filter(m => m.payment_status === 'Pending').length;
  const paymentProgress = totalCrew > 0 ? (paidCount / totalCrew) * 100 : 0;
  const totalPaid = crewMembers.reduce((sum, m) => sum + (m.amount_paid || 0), 0);

  useEffect(() => {
    if (booking.id) {
      fetchCrewStatus();
    }
  }, [booking.id]);

  const fetchCrewStatus = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API}/bookings/${booking.id}/crew-status`);
      setCrewMembers(response.data?.crew || []);
      
      // Initialize custom amounts
      const amounts = {};
      (response.data?.crew || []).forEach(m => {
        amounts[m.participant_id] = m.share_amount || equalShare;
      });
      setCustomAmounts(amounts);
    } catch (error) {
      logger.error('Failed to fetch crew status:', error);
      // Fallback: use booking participants if available
      if (booking.participants) {
        setCrewMembers(booking.participants.map(p => ({
          participant_id: p.participant_id || p.id,
          name: p.name || 'Crew Member',
          email: p.email,
          payment_status: p.payment_status || 'Pending',
          amount_paid: p.amount_paid || 0,
          share_amount: p.share_amount || equalShare
        })));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleNudge = async (memberId) => {
    setSendingNudge(memberId);
    try {
      await axios.post(`${API}/bookings/${booking.id}/nudge`, {
        participant_id: memberId
      });
      toast.success('Reminder sent!');
    } catch (error) {
      toast.error('Failed to send reminder');
    } finally {
      setSendingNudge(null);
    }
  };

  const handleNudgeAll = async () => {
    const pendingIds = crewMembers
      .filter(m => m.payment_status === 'Pending')
      .map(m => m.participant_id);
    
    if (pendingIds.length === 0) {
      toast.info('All crew members have paid!');
      return;
    }

    setSendingNudge('all');
    try {
      await axios.post(`${API}/bookings/${booking.id}/nudge-all`);
      toast.success(`Reminders sent to ${pendingIds.length} crew members!`);
    } catch (error) {
      toast.error('Failed to send reminders');
    } finally {
      setSendingNudge(null);
    }
  };

  const handleUpdateSplits = async () => {
    // Validate total equals booking amount
    const customTotal = Object.values(customAmounts).reduce((sum, amt) => sum + parseFloat(amt || 0), 0);
    if (Math.abs(customTotal - totalAmount) > 0.01) {
      toast.error(`Custom splits must equal $${totalAmount.toFixed(2)}. Current total: $${customTotal.toFixed(2)}`);
      return;
    }

    try {
      await axios.post(`${API}/bookings/${booking.id}/update-splits`, {
        splits: Object.entries(customAmounts).map(([id, amount]) => ({
          participant_id: id,
          share_amount: parseFloat(amount)
        }))
      });
      toast.success('Payment splits updated!');
      setShowCustomSplit(false);
      fetchCrewStatus();
      onUpdate?.();
    } catch (error) {
      toast.error('Failed to update splits');
    }
  };

  if (!isHost) return null;

  return (
    <Card className={`${isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/50 border-zinc-800'}`}>
      <CardHeader className="pb-2">
        <button 
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-between w-full"
        >
          <CardTitle className={`text-base flex items-center gap-2 ${isLight ? 'text-gray-900' : 'text-white'}`}>
            <Users className="w-5 h-5 text-cyan-400" />
            Crew Payment Dashboard
            <Badge 
              className={paymentProgress === 100 
                ? 'bg-green-500/20 text-green-400' 
                : 'bg-amber-500/20 text-amber-400'
              }
            >
              {paidCount}/{totalCrew} Paid
            </Badge>
          </CardTitle>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </button>
      </CardHeader>
      
      {expanded && (
        <CardContent className="space-y-4">
          {/* Payment Progress Summary */}
          <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-zinc-800/50'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-sm font-medium ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>
                Payment Progress
              </span>
              <span className={`text-sm font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>
                ${totalPaid.toFixed(2)} / ${totalAmount.toFixed(2)}
              </span>
            </div>
            <Progress value={paymentProgress} className="h-2" />
            
            {paymentProgress < 100 && (
              <p className={`mt-2 text-xs ${isLight ? 'text-amber-600' : 'text-amber-400'}`}>
                <AlertTriangle className="w-3 h-3 inline mr-1" />
                Session locked until all crew members pay. Photographer cannot see this booking yet.
              </p>
            )}
            
            {paymentProgress === 100 && (
              <p className={`mt-2 text-xs ${isLight ? 'text-green-600' : 'text-green-400'}`}>
                <CheckCircle2 className="w-3 h-3 inline mr-1" />
                All payments received! Session is confirmed.
              </p>
            )}
          </div>

          {/* Crew Members List */}
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
            </div>
          ) : (
            <div className="space-y-2">
              {crewMembers.map((member) => (
                <div 
                  key={member.participant_id}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    isLight ? 'bg-gray-50 border border-gray-100' : 'bg-zinc-800/30 border border-zinc-700/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      member.payment_status === 'Paid' 
                        ? 'bg-green-500/20 text-green-400' 
                        : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {member.name?.charAt(0) || 'C'}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${isLight ? 'text-gray-900' : 'text-white'}`}>
                        {member.name || 'Crew Member'}
                        {member.participant_id === user?.id && (
                          <Badge className="ml-2 text-xs bg-cyan-500/20 text-cyan-400">You (Host)</Badge>
                        )}
                      </p>
                      <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                        Share: ${(member.share_amount || equalShare).toFixed(2)}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {member.payment_status === 'Paid' ? (
                      <Badge className="bg-green-500/20 text-green-400">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Paid
                      </Badge>
                    ) : (
                      <>
                        <Badge className="bg-amber-500/20 text-amber-400">
                          <Clock className="w-3 h-3 mr-1" />
                          Pending
                        </Badge>
                        {member.participant_id !== user?.id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleNudge(member.participant_id)}
                            disabled={sendingNudge === member.participant_id}
                            className="p-1 h-7"
                          >
                            {sendingNudge === member.participant_id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4 text-cyan-400" />
                            )}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            {pendingCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleNudgeAll}
                disabled={sendingNudge === 'all'}
                className={`flex-1 ${
                  isLight 
                    ? 'border-cyan-300 text-cyan-700 hover:bg-cyan-50' 
                    : 'border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/20'
                }`}
              >
                {sendingNudge === 'all' ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                Nudge All Pending
              </Button>
            )}
            
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowCustomSplit(true)}
              className={`${
                isLight 
                  ? 'border-gray-300 text-gray-700 hover:bg-gray-50' 
                  : 'border-zinc-600 text-gray-300 hover:bg-zinc-700'
              }`}
            >
              <Calculator className="w-4 h-4 mr-2" />
              Custom Split
            </Button>
          </div>
        </CardContent>
      )}

      {/* Custom Split Dialog */}
      <Dialog open={showCustomSplit} onOpenChange={setShowCustomSplit}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900 border-zinc-700'}`}>
          <DialogHeader>
            <DialogTitle className={`flex items-center gap-2 ${isLight ? 'text-gray-900' : 'text-white'}`}>
              <Calculator className="w-5 h-5 text-cyan-400" />
              Custom Payment Split
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <p className={`text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
              Adjust individual share amounts. Total must equal ${totalAmount.toFixed(2)}.
            </p>
            
            {crewMembers.map((member) => (
              <div key={member.participant_id} className="flex items-center gap-3">
                <div className="flex-1">
                  <p className={`text-sm font-medium ${isLight ? 'text-gray-900' : 'text-white'}`}>
                    {member.name || 'Crew Member'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-gray-400" />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={customAmounts[member.participant_id] || ''}
                    onChange={(e) => setCustomAmounts({
                      ...customAmounts,
                      [member.participant_id]: e.target.value
                    })}
                    className={`w-24 ${isLight ? 'bg-white' : 'bg-zinc-800 border-zinc-600'}`}
                  />
                </div>
              </div>
            ))}
            
            <div className={`flex items-center justify-between pt-2 border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}>
              <span className={`text-sm font-medium ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>
                Total:
              </span>
              <span className={`font-bold ${
                Math.abs(Object.values(customAmounts).reduce((sum, amt) => sum + parseFloat(amt || 0), 0) - totalAmount) < 0.01
                  ? (isLight ? 'text-green-600' : 'text-green-400')
                  : (isLight ? 'text-red-600' : 'text-red-400')
              }`}>
                ${Object.values(customAmounts).reduce((sum, amt) => sum + parseFloat(amt || 0), 0).toFixed(2)}
                <span className={`text-sm font-normal ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                  {' '}/ ${totalAmount.toFixed(2)}
                </span>
              </span>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCustomSplit(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateSplits} className="bg-cyan-500 hover:bg-cyan-400 text-black">
              Update Splits
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default CrewPaymentDashboard;
