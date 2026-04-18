/**
 * LiveSessionsTab - User's active live sessions they've joined
 * Extracted from Bookings.js for better maintainability
 */

import React, { useState } from 'react';
import { Calendar, Radio, LogOut, Loader2 } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { useAuth } from '../../contexts/AuthContext';
import apiClient, { BACKEND_URL } from '../../lib/apiClient';
import { toast } from 'sonner';


export const LiveSessionsTab = ({
  liveSessions,
  onGoToLiveNow,
  onSessionLeft,
  userId,
  theme
}) => {
  const [leavingSession, setLeavingSession] = useState(null);
  const { updateUser } = useAuth();
  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-zinc-800/50 border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';

  const handleLeaveSession = async (sessionId) => {
    setLeavingSession(sessionId);
    try {
      const response = await apiClient.post(`/sessions/leave/${sessionId}?user_id=${userId}`);
      
      // Check if refund was applied
      if (response.data.refunded) {
        toast.success(`Left early - $${response.data.refund_amount.toFixed(2)} refunded to credits!`, {
          duration: 5000
        });
        // Update user's credit balance in context
        if (response.data.new_balance !== undefined) {
          updateUser({ credit_balance: response.data.new_balance });
        }
      } else {
        toast.success('Left the session');
      }
      
      if (onSessionLeft) onSessionLeft(sessionId);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to leave session');
    } finally {
      setLeavingSession(null);
    }
  };

  if (liveSessions.length === 0) {
    return (
      <Card className={`${cardBgClass} transition-colors duration-300`}>
        <CardContent className="py-12 text-center">
          <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} flex items-center justify-center`}>
            <Calendar className={`w-8 h-8 ${textSecondaryClass}`} />
          </div>
          <h3 className={`text-lg font-medium ${textPrimaryClass} mb-2`}>No Live Sessions</h3>
          <p className={`${textSecondaryClass} mb-6`}>
            Jump into a live session from the Live Now tab.
          </p>
          <Button
            onClick={onGoToLiveNow}
            className="bg-gradient-to-r from-emerald-400 to-green-500 hover:from-emerald-500 hover:to-green-600 text-black font-medium"
            data-testid="see-live-photographers-btn"
          >
            See Live Photographers
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Refund policy note */}
      <p className={`text-xs ${textSecondaryClass} text-center`}>
        Leave within 10 min for automatic refund
      </p>
      
      {liveSessions.map((session) => (
        <Card key={session.id} className={`${cardBgClass} transition-colors duration-300`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <Radio className="w-6 h-6 text-green-400 animate-pulse" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className={`font-medium ${textPrimaryClass} truncate`}>
                  @{session.photographer_username || session.photographer_name || 'photographer'}
                </h3>
                <p className={`text-sm ${textSecondaryClass} truncate`}>{session.location}</p>
              </div>
              
              {/* Leave Session Button */}
              <Button
                onClick={() => handleLeaveSession(session.id)}
                disabled={leavingSession === session.id}
                variant="outline"
                size="sm"
                className="border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300 shrink-0"
              >
                {leavingSession === session.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <LogOut className="w-4 h-4 mr-1" />
                    Leave
                  </>
                )}
              </Button>
              
              <div className="text-right shrink-0">
                <p className="text-green-400 font-bold">${session.amount_paid}</p>
                <p className={`text-xs ${textSecondaryClass}`}>paid</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default LiveSessionsTab;
