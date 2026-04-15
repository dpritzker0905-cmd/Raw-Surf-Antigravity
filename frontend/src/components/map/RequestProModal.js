/**
 * RequestProModal - Modal for requesting a professional photographer
 * Extracted from MapPage.js for better organization (~200 lines)
 */
import React, { useState } from 'react';
import { Camera, MapPin, Clock, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { toast } from 'sonner';
import axios from 'axios';
import BoostSelector from './BoostSelector';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const RequestProModal = ({
  isOpen,
  onClose,
  userId,
  userLocation,
  nearestSpot,
  onSuccess
}) => {
  const [estimatedDuration, setEstimatedDuration] = useState(1);
  const [inviteFriends, setInviteFriends] = useState(false);
  const [boostHours, setBoostHours] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!userLocation) {
      toast.error('Location required');
      return;
    }
    
    setLoading(true);
    try {
      const response = await axios.post(`${API}/dispatch/request?requester_id=${userId}`, {
        latitude: userLocation.lat,
        longitude: userLocation.lng,
        location_name: nearestSpot?.name || 'Current Location',
        spot_id: nearestSpot?.id || null,
        estimated_duration_hours: estimatedDuration,
        is_immediate: true,
        is_shared: inviteFriends
      });
      
      const dispatchId = response.data.id;
      onClose();
      toast.success('Request created! Proceeding to payment...');
      
      // Simulate payment (in production, this opens Stripe checkout)
      setTimeout(async () => {
        try {
          await axios.post(`${API}/dispatch/${dispatchId}/pay?payer_id=${userId}`);
          toast.success('Payment confirmed! Searching for a Pro...');
          
          // Apply boost if selected
          if (boostHours > 0) {
            try {
              await axios.post(`${API}/dispatch/request/${dispatchId}/boost?user_id=${userId}`, {
                boost_hours: boostHours
              });
              toast.success(`🚀 Request boosted! You'll appear first for ${boostHours} hour(s)`);
            } catch (boostErr) {
              toast.error(boostErr.response?.data?.detail || 'Failed to boost request');
            }
          }
          
          if (onSuccess) {
            onSuccess(dispatchId);
          }
          
        } catch (err) {
          toast.error('Payment failed');
        }
      }, 1000);
      
    } catch (error) {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Failed to create request');
    } finally {
      setLoading(false);
    }
  };

  const depositAmount = ((75 * estimatedDuration) * 0.25).toFixed(0);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Camera className="w-6 h-6 text-cyan-400" />
            Request a Pro
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          {/* Location Display */}
          <div className="p-3 bg-zinc-800/50 rounded-lg">
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-cyan-400" />
              <span className="text-gray-300">
                {nearestSpot?.name || 'Current Location'}
              </span>
            </div>
            {userLocation && (
              <div className="text-xs text-gray-500 mt-1 ml-6">
                {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}
              </div>
            )}
          </div>

          {/* Duration Selection */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">
              <Clock className="w-4 h-4 inline mr-1" />
              How long do you need?
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map((hours) => (
                <button
                  key={hours}
                  onClick={() => setEstimatedDuration(hours)}
                  className={`p-3 rounded-lg text-center transition-all ${
                    estimatedDuration === hours
                      ? 'bg-cyan-500 text-white ring-2 ring-cyan-400'
                      : 'bg-zinc-800 text-gray-300 hover:bg-zinc-700'
                  }`}
                >
                  <div className="text-lg font-bold">{hours}</div>
                  <div className="text-xs">hour{hours > 1 ? 's' : ''}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Invite Friends Toggle */}
          <div className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg">
            <div>
              <div className="text-sm font-medium">Share with friends</div>
              <div className="text-xs text-gray-400">
                Split the cost with your crew
              </div>
            </div>
            <button
              onClick={() => setInviteFriends(!inviteFriends)}
              className={`w-12 h-6 rounded-full transition-colors ${
                inviteFriends ? 'bg-cyan-500' : 'bg-zinc-700'
              }`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                  inviteFriends ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Price Summary */}
          <div className="p-4 bg-gradient-to-r from-cyan-900/20 to-blue-900/20 rounded-lg border border-cyan-500/30">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-400">Session Rate</span>
              <span className="text-white">$75/hour</span>
            </div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-400">Duration</span>
              <span className="text-white">{estimatedDuration} hour{estimatedDuration > 1 ? 's' : ''}</span>
            </div>
            <div className="flex justify-between text-sm font-medium pt-2 border-t border-zinc-700">
              <span className="text-gray-300">Estimated Total</span>
              <span className="text-white">${75 * estimatedDuration}</span>
            </div>
            <div className="border-t border-zinc-700 pt-2 mt-2">
              <div className="flex items-center justify-between">
                <span className="text-cyan-400 font-medium">Deposit Required (25%)</span>
                <span className="text-cyan-400 font-bold">${depositAmount}</span>
              </div>
            </div>
          </div>
          
          {/* Boost Priority Option */}
          <BoostSelector 
            selectedHours={boostHours}
            onSelect={setBoostHours}
          />

          <p className="text-xs text-gray-500 text-center">
            Deposit is non-refundable once a Pro accepts and starts traveling to you.
          </p>
        </div>
        
        <DialogFooter className="mt-4 flex-shrink-0">
          <Button
            variant="outline"
            onClick={onClose}
            className="border-zinc-600 text-white hover:bg-zinc-800"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !userLocation}
            className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-bold"
            data-testid="request-pro-submit"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>Pay ${depositAmount} Deposit</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RequestProModal;
