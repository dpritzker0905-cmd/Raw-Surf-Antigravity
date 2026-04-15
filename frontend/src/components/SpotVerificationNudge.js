import React, { useState, useEffect } from 'react';
import { CheckCircle, AlertCircle, MapPin, Loader2, X } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * SpotVerificationNudge - Photographer verification prompt
 * 
 * Displayed when a photographer:
 * 1. Is within 200m of a spot
 * 2. Goes live OR checks in
 * 3. Has not already voted on this spot
 * 
 * Allows photographers to verify pin accuracy or suggest relocation.
 */
export const SpotVerificationNudge = ({ spot, userLocation, onClose }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null); // null | 'loading' | 'voted' | 'hidden'
  const [showSuggestMove, setShowSuggestMove] = useState(false);
  const [suggestedCoords, setSuggestedCoords] = useState(null);
  const [suggestionNote, setSuggestionNote] = useState('');

  // Check if user already voted
  useEffect(() => {
    const checkVoteStatus = async () => {
      if (!user?.id || !spot?.id) return;
      
      try {
        const response = await axios.get(`${API}/spots/verification/${spot.id}/status`, {
          params: { user_id: user.id }
        });
        
        if (response.data.user_has_voted) {
          setStatus('voted');
        }
      } catch (error) {
        logger.debug('Verification status check failed');
      }
    };
    
    checkVoteStatus();
  }, [user?.id, spot?.id]);

  // Check if user is photographer
  const photographerRoles = ['Hobbyist', 'Photographer', 'Approved Pro'];
  const isPhotographer = photographerRoles.includes(user?.role);

  // Don't show if not photographer, already voted, or spot not provided
  if (!isPhotographer || status === 'voted' || !spot) {
    return null;
  }

  // Submit verification vote
  const handleVote = async (isAccurate) => {
    setLoading(true);
    
    try {
      const payload = {
        is_accurate: isAccurate,
        suggested_latitude: suggestedCoords?.lat || null,
        suggested_longitude: suggestedCoords?.lng || null,
        suggestion_note: suggestionNote || null
      };
      
      const response = await axios.post(
        `${API}/spots/verification/${spot.id}`,
        payload,
        { params: { user_id: user.id } }
      );
      
      if (response.data.is_now_community_verified) {
        toast.success(`${spot.name} is now Community Verified! 🏅`);
      } else {
        toast.success('Thanks for verifying this spot!');
      }
      
      setStatus('voted');
      
    } catch (error) {
      if (error.response?.data?.detail === 'You have already verified this spot') {
        setStatus('voted');
      } else {
        toast.error(error.response?.data?.detail || 'Failed to submit verification');
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle "Suggest Move" - user taps map to suggest new location
  const handleSuggestMove = () => {
    setShowSuggestMove(true);
    // Use current user location as starting suggestion
    if (userLocation) {
      setSuggestedCoords({ lat: userLocation.lat, lng: userLocation.lng });
    }
  };

  // Submit move suggestion
  const handleSubmitSuggestion = () => {
    if (!suggestedCoords) {
      toast.error('Please tap the map to suggest a new location');
      return;
    }
    handleVote(false);
  };

  if (status === 'voted') {
    return (
      <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-2">
        <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        <span className="text-emerald-400 text-sm">You've verified this spot</span>
      </div>
    );
  }

  return (
    <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg space-y-3">
      {!showSuggestMove ? (
        <>
          {/* Verification Prompt */}
          <div className="flex items-start gap-2">
            <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
              💡
            </div>
            <div>
              <p className="text-yellow-400 font-medium text-sm">Verify this pin's location</p>
              <p className="text-gray-400 text-xs mt-0.5">
                Is this pin exactly on the peak?
              </p>
            </div>
          </div>
          
          {/* Vote Buttons */}
          <div className="flex items-center gap-2">
            <Button
              onClick={() => handleVote(true)}
              disabled={loading}
              className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white h-9"
              data-testid="verify-spot-yes"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-1" />
                  Yes, It's Accurate
                </>
              )}
            </Button>
            <Button
              onClick={handleSuggestMove}
              disabled={loading}
              variant="outline"
              className="flex-1 border-orange-500 text-orange-400 h-9"
              data-testid="verify-spot-no"
            >
              <AlertCircle className="w-4 h-4 mr-1" />
              No - Suggest Move
            </Button>
          </div>
          
          {/* Community Verified Badge Info */}
          {spot.community_verified ? (
            <Badge className="bg-emerald-500 text-white text-xs">
              <CheckCircle className="w-3 h-3 mr-1" />
              Community Verified
            </Badge>
          ) : (
            <p className="text-gray-500 text-xs">
              {5 - (spot.verification_votes_yes || 0)} more votes needed for Community Verified badge
            </p>
          )}
        </>
      ) : (
        <>
          {/* Suggest Move Form */}
          <div className="flex items-center justify-between">
            <p className="text-orange-400 font-medium text-sm">Suggest New Location</p>
            <button onClick={() => setShowSuggestMove(false)} className="text-gray-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          
          {/* Suggested Coordinates */}
          <div className="bg-zinc-800 rounded-lg p-3">
            <p className="text-gray-400 text-xs mb-2">
              Use your current GPS location or enter coordinates:
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-gray-500 text-xs">Latitude</label>
                <input
                  type="number"
                  step="0.0001"
                  value={suggestedCoords?.lat || ''}
                  onChange={(e) => setSuggestedCoords(prev => ({ ...prev, lat: parseFloat(e.target.value) }))}
                  className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs">Longitude</label>
                <input
                  type="number"
                  step="0.0001"
                  value={suggestedCoords?.lng || ''}
                  onChange={(e) => setSuggestedCoords(prev => ({ ...prev, lng: parseFloat(e.target.value) }))}
                  className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-sm text-white"
                />
              </div>
            </div>
            
            {userLocation && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSuggestedCoords({ lat: userLocation.lat, lng: userLocation.lng })}
                className="mt-2 w-full border-cyan-500 text-cyan-400"
              >
                <MapPin className="w-3 h-3 mr-1" />
                Use My Location
              </Button>
            )}
          </div>
          
          {/* Note */}
          <textarea
            placeholder="Why should the pin move? (optional)"
            value={suggestionNote}
            onChange={(e) => setSuggestionNote(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white resize-none h-16"
          />
          
          {/* Submit */}
          <Button
            onClick={handleSubmitSuggestion}
            disabled={loading || !suggestedCoords?.lat || !suggestedCoords?.lng}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'Submit Suggestion'
            )}
          </Button>
        </>
      )}
    </div>
  );
};

export default SpotVerificationNudge;
