import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, MapPin, Check, X, Loader2, RefreshCw, ExternalLink, MessageSquare } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { useAuth } from '../../contexts/AuthContext';
import apiClient, { BACKEND_URL } from '../../lib/apiClient';
import { toast } from 'sonner';


/**
 * AdminPrecisionQueue - Queue of spots flagged for review
 * 
 * Features:
 * - List spots with >150m inland flag or unverified accuracy
 * - One-by-one review workflow
 * - Quick "Snap Offshore" action
 * - Photographer relocation suggestions
 */
export const AdminPrecisionQueue = () => {
  const { user } = useAuth();
  const [queue, setQueue] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('queue'); // 'queue' | 'suggestions'
  const [processing, setProcessing] = useState(null);

  // Fetch queue
  const fetchQueue = useCallback(async () => {
    try {
      setLoading(true);
      const [queueRes, suggestionsRes] = await Promise.all([
        apiClient.get(`/admin/spots/queue`),
        apiClient.get(`/admin/spots/suggestions`)
      ]);
      setQueue(queueRes.data.queue);
      setSuggestions(suggestionsRes.data.suggestions);
    } catch (error) {
      toast.error('Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) {
      fetchQueue();
    }
  }, [user?.id, fetchQueue]);

  // Quick move spot offshore (estimate 150m towards water)
  const handleSnapOffshore = async (spot) => {
    setProcessing(spot.id);
    try {
      // Calculate offshore direction (simple: move towards lower longitude for US East Coast)
      // This is a rough estimate - admin should refine manually
      const offsetLat = -0.001; // ~111m south (towards water for most US spots)
      const offsetLng = -0.001; // ~85m west
      
      await apiClient.put(
        `/admin/spots/${spot.id}/move`,
        { 
          latitude: spot.latitude + offsetLat, 
          longitude: spot.longitude + offsetLng,
          override_land_warning: true 
        }
      );
      
      toast.success(`Snapped ${spot.name} offshore`);
      fetchQueue();
    } catch (error) {
      toast.error('Failed to move spot');
    } finally {
      setProcessing(null);
    }
  };

  // Apply photographer suggestion
  const handleApplySuggestion = async (suggestion) => {
    setProcessing(suggestion.id);
    try {
      await apiClient.put(
        `/admin/spots/${suggestion.spot_id}/move`,
        { 
          latitude: suggestion.suggested_coords.latitude, 
          longitude: suggestion.suggested_coords.longitude,
          override_land_warning: true 
        }
      );
      
      toast.success(`Applied suggestion for ${suggestion.spot_name}`);
      fetchQueue();
    } catch (error) {
      toast.error('Failed to apply suggestion');
    } finally {
      setProcessing(null);
    }
  };

  // Dismiss suggestion (keep current location)
  const handleDismissSuggestion = async (suggestion) => {
    setProcessing(suggestion.id);
    // For now, just remove from local state (could add API endpoint to mark as dismissed)
    setSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
    setProcessing(null);
    toast.success('Suggestion dismissed');
  };

  // Open in map editor
  const openInEditor = (spot) => {
    // Navigate to spots tab with spot selected
    window.location.hash = `#spots?selected=${spot.id}`;
    toast.info(`Go to Spots tab to edit ${spot.name}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-400" />
            Precision Queue
          </h3>
          <p className="text-gray-400 text-sm">Spots requiring coordinate verification</p>
        </div>
        <Button variant="outline" onClick={fetchQueue} className="border-zinc-600">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('queue')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'queue'
              ? 'bg-orange-500 text-white'
              : 'bg-zinc-800 text-gray-400 hover:text-white'
          }`}
        >
          Flagged ({queue.length})
        </button>
        <button
          onClick={() => setActiveTab('suggestions')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'suggestions'
              ? 'bg-cyan-500 text-white'
              : 'bg-zinc-800 text-gray-400 hover:text-white'
          }`}
        >
          Suggestions ({suggestions.length})
        </button>
      </div>

      {/* Queue Tab */}
      {activeTab === 'queue' && (
        <div className="space-y-3">
          {queue.length === 0 ? (
            <div className="text-center py-12 bg-zinc-800 rounded-xl">
              <Check className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
              <p className="text-white font-medium">All Clear!</p>
              <p className="text-gray-400 text-sm">No spots require review</p>
            </div>
          ) : (
            queue.map((spot, index) => (
              <div
                key={spot.id}
                className="bg-zinc-800 rounded-xl p-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold">
                    {index + 1}
                  </div>
                  <div>
                    <h4 className="text-white font-medium">{spot.name}</h4>
                    <p className="text-gray-400 text-sm">{spot.region} • {spot.country}</p>
                    <p className="text-gray-500 text-xs">
                      ({spot.latitude.toFixed(4)}, {spot.longitude.toFixed(4)})
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <Badge className={`
                    ${spot.accuracy_flag === 'unverified' ? 'bg-gray-500' : ''}
                    ${spot.accuracy_flag === 'low_accuracy' ? 'bg-orange-500' : ''}
                    ${spot.flagged_for_review ? 'bg-red-500' : ''}
                  `}>
                    {spot.accuracy_flag || 'Flagged'}
                  </Badge>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSnapOffshore(spot)}
                    disabled={processing === spot.id}
                    className="border-cyan-500 text-cyan-400"
                  >
                    {processing === spot.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <MapPin className="w-4 h-4 mr-1" />
                        Snap Offshore
                      </>
                    )}
                  </Button>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openInEditor(spot)}
                    className="border-zinc-600"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Suggestions Tab */}
      {activeTab === 'suggestions' && (
        <div className="space-y-3">
          {suggestions.length === 0 ? (
            <div className="text-center py-12 bg-zinc-800 rounded-xl">
              <MessageSquare className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p className="text-white font-medium">No Suggestions</p>
              <p className="text-gray-400 text-sm">Photographers haven't submitted relocation suggestions yet</p>
            </div>
          ) : (
            suggestions.map((suggestion) => (
              <div
                key={suggestion.id}
                className="bg-zinc-800 rounded-xl p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-white font-medium">{suggestion.spot_name}</h4>
                    <p className="text-gray-400 text-sm">
                      Suggested by: {suggestion.photographer_name}
                    </p>
                    
                    <div className="mt-2 grid grid-cols-2 gap-4 text-xs">
                      <div className="bg-zinc-700/50 p-2 rounded">
                        <p className="text-gray-500">Current</p>
                        <p className="text-gray-300">
                          ({suggestion.current_coords.latitude.toFixed(4)}, {suggestion.current_coords.longitude.toFixed(4)})
                        </p>
                      </div>
                      <div className="bg-cyan-500/10 p-2 rounded border border-cyan-500/30">
                        <p className="text-cyan-400">Suggested</p>
                        <p className="text-white">
                          ({suggestion.suggested_coords.latitude.toFixed(4)}, {suggestion.suggested_coords.longitude.toFixed(4)})
                        </p>
                      </div>
                    </div>
                    
                    {suggestion.suggestion_note && (
                      <p className="text-gray-400 text-sm mt-2 italic">
                        "{suggestion.suggestion_note}"
                      </p>
                    )}
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleApplySuggestion(suggestion)}
                      disabled={processing === suggestion.id}
                      className="bg-emerald-500 hover:bg-emerald-600"
                    >
                      {processing === suggestion.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Check className="w-4 h-4 mr-1" />
                          Apply
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDismissSuggestion(suggestion)}
                      className="border-zinc-600 text-gray-400"
                    >
                      <X className="w-4 h-4 mr-1" />
                      Dismiss
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default AdminPrecisionQueue;
