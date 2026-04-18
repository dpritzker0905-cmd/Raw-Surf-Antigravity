import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { Users, Clock, DollarSign, User, Save, Volume2, VolumeX, Footprints, Shirt, Waves, StickyNote, Maximize2 } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Textarea } from './ui/textarea';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Audio notification for new surfer joins
const useJoinChime = () => {
  const audioRef = useRef(null);
  
  useEffect(() => {
    // Create audio element with a pleasant chime sound
    audioRef.current = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2Onp6XjYF3cnJ6hI2UlpGJgHh0dHqCi5KVk46Ge3Z1eoCIkJOSkIZ+d3V3fYWNkpKQiIF6dnZ6gYiPkpCNhX13dnl/hoyQj4yFfnd2eH+Gi5COi4R8d3Z4f4aLj42KhHx3dnh/houOjImDfHd2eH+GiY2MiIN8eHd5gIaJjIqHg3x4eHqBhomKiIWCfHh4eoGFiImHhYJ8eHl7goSHh4WDf3t4eXuChIaFhIF+ent6e4KDhIKAfn17e3t+gYGBf356e3t8foB/fn17enx9fX5+fXx7e3x9fX19fHt7e3x9fX18e3t7fH19fHt7e3t8fHx8e3t7e3x8fHx7e3t7fHx8fHt7e3t8fHx8e3t7e3x8fHx7e3t7fHx8fHt7e3t8fHt7');
    audioRef.current.volume = 0.5;
  }, []);
  
  const playChime = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  }, []);
  
  return playChime;
};

// Time ago formatter
const formatTimeAgo = (isoString) => {
  if (!isoString) return '';
  const now = new Date();
  const joined = new Date(isoString);
  const diffMs = now - joined;
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
};

// Surfer Detail Modal - Enlarged photo and full info
const SurferDetailModal = ({ 
  surfer, 
  isOpen, 
  onClose, 
  onSaveNotes,
  isLight,
  textPrimaryClass,
  textSecondaryClass 
}) => {
  const [notes, setNotes] = useState(surfer?.photographer_notes || '');
  const [saving, setSaving] = useState(false);
  
  useEffect(() => {
    setNotes(surfer?.photographer_notes || '');
  }, [surfer]);
  
  const handleSaveNotes = async () => {
    setSaving(true);
    try {
      await onSaveNotes(surfer.id, notes);
      toast.success('Notes saved');
    } catch (error) {
      toast.error('Failed to save notes');
    } finally {
      setSaving(false);
    }
  };
  
  if (!surfer) return null;
  
  const displayImage = surfer.selfie_url || surfer.avatar_url;
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${isLight ? 'border-gray-200' : 'border-zinc-700'} sm:max-w-[400px]`}>
        {/* Scrollable container */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          <DialogHeader className="mb-4">
            <DialogTitle className={textPrimaryClass}>Surfer Details</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Large Selfie/Avatar */}
            <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-zinc-800">
              {displayImage ? (
                <img 
                  src={displayImage} 
                  alt={surfer.name} 
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <User className={`w-24 h-24 ${textSecondaryClass}`} />
                </div>
              )}
              {/* Recently joined badge */}
              {surfer.isRecent && (
                <Badge className="absolute top-3 right-3 bg-green-500 text-white animate-pulse">
                  Just Joined!
                </Badge>
              )}
            </div>
            
            {/* Name & Username */}
            <div className="text-center">
              <h3 className={`text-xl font-bold ${textPrimaryClass}`}>{surfer.name}</h3>
              {surfer.username && (
                <p className="text-cyan-400">@{surfer.username}</p>
              )}
            </div>
            
            {/* Info Grid */}
            <div className={`grid grid-cols-2 gap-3 p-4 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
              {/* Stance */}
              <div className="flex items-center gap-2">
                <Footprints className="w-4 h-4 text-purple-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className={`text-xs ${textSecondaryClass}`}>Stance</p>
                  <p className={`font-medium ${textPrimaryClass} truncate`}>
                    {surfer.stance ? surfer.stance.charAt(0).toUpperCase() + surfer.stance.slice(1) : 'Not set'}
                  </p>
                </div>
              </div>
              
              {/* Wetsuit Color */}
              <div className="flex items-center gap-2">
                <Waves className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className={`text-xs ${textSecondaryClass}`}>Wetsuit</p>
                  <p className={`font-medium ${textPrimaryClass} truncate`}>
                    {surfer.wetsuit_color || 'Not set'}
                  </p>
                </div>
              </div>
              
              {/* Rash Guard */}
              <div className="flex items-center gap-2">
                <Shirt className="w-4 h-4 text-orange-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className={`text-xs ${textSecondaryClass}`}>Rash Guard</p>
                  <p className={`font-medium ${textPrimaryClass} truncate`}>
                    {surfer.rash_guard_color || 'Not set'}
                  </p>
                </div>
              </div>
              
              {/* Skill Level */}
              <div className="flex items-center gap-2">
                <Waves className="w-4 h-4 text-green-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className={`text-xs ${textSecondaryClass}`}>Skill</p>
                  <p className={`font-medium ${textPrimaryClass} truncate`}>
                    {surfer.skill_level || 'Not set'}
                  </p>
                </div>
              </div>
              
              {/* Time in Session */}
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className={`text-xs ${textSecondaryClass}`}>Joined</p>
                  <p className={`font-medium ${textPrimaryClass} truncate`}>
                    {formatTimeAgo(surfer.joined_at)}
                  </p>
                </div>
              </div>
              
              {/* Amount Paid */}
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-green-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className={`text-xs ${textSecondaryClass}`}>Paid</p>
                  <p className="font-medium text-green-400 truncate">
                    ${surfer.amount_paid?.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
            
            {/* Photographer Notes */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <StickyNote className="w-4 h-4 text-amber-400" />
                <span className={`text-sm font-medium ${textPrimaryClass}`}>Your Notes</span>
              </div>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes to help identify this surfer... (e.g., 'Red fins, staying near the pier, goofy footer')"
                className={`${isLight ? 'bg-gray-100' : 'bg-zinc-800'} ${textPrimaryClass} min-h-[80px]`}
              />
              <Button
                onClick={handleSaveNotes}
                disabled={saving}
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 text-white mb-4"
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Saving...' : 'Save Notes'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Individual Surfer Card in the grid
const SurferCard = ({ surfer, onClick, isLight, textPrimaryClass, textSecondaryClass }) => {
  const displayImage = surfer.selfie_url || surfer.avatar_url;
  const isRecent = surfer.isRecent;
  
  return (
    <div 
      onClick={onClick}
      className={`relative cursor-pointer rounded-xl overflow-hidden transition-all duration-200 hover:scale-105 hover:shadow-lg ${
        isLight ? 'bg-gray-100 hover:bg-gray-200' : 'bg-zinc-800 hover:bg-zinc-700'
      } ${isRecent ? 'ring-2 ring-green-500 ring-offset-2 ring-offset-zinc-900' : ''}`}
    >
      {/* Selfie/Avatar */}
      <div className="aspect-square relative">
        {displayImage ? (
          <img 
            src={displayImage} 
            alt={surfer.name} 
            className="w-full h-full object-cover"
          />
        ) : (
          <div className={`w-full h-full flex items-center justify-center ${isLight ? 'bg-gray-200' : 'bg-zinc-700'}`}>
            <User className={`w-8 h-8 ${textSecondaryClass}`} />
          </div>
        )}
        
        {/* Recently joined indicator */}
        {isRecent && (
          <div className="absolute top-1 right-1">
            <span className="flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </span>
          </div>
        )}
        
        {/* Expand icon on hover */}
        <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
          <Maximize2 className="w-6 h-6 text-white" />
        </div>
      </div>
      
      {/* Info */}
      <div className="p-2">
        <p className={`text-sm font-medium truncate ${textPrimaryClass}`}>
          {surfer.username ? `@${surfer.username}` : surfer.name}
        </p>
        <div className="flex items-center justify-between">
          <span className={`text-xs ${textSecondaryClass}`}>
            {formatTimeAgo(surfer.joined_at)}
          </span>
          <span className="text-xs text-green-400 font-medium">
            ${surfer.amount_paid?.toFixed(0)}
          </span>
        </div>
        {/* Quick ID hints */}
        {(surfer.stance || surfer.wetsuit_color) && (
          <div className="flex gap-1 mt-1">
            {surfer.stance && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 border-purple-500/50 text-purple-400">
                {surfer.stance === 'goofy' ? 'G' : 'R'}
              </Badge>
            )}
            {surfer.wetsuit_color && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-500/50 text-blue-400 truncate max-w-[60px]">
                {surfer.wetsuit_color}
              </Badge>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Main Surfer Roster Card Component
export const SurferRosterCard = ({ 
  photographerId, 
  isLive, 
  theme,
  onParticipantsUpdate 
}) => {
  const [participants, setParticipants] = useState([]);
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [_loading, _setLoading] = useState(false);
  const [selectedSurfer, setSelectedSurfer] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const previousCountRef = useRef(0);
  
  const playChime = useJoinChime();
  
  // Theme classes
  const isLight = theme === 'light';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-zinc-900 border-zinc-700';
  
  // Fetch participants
  const fetchParticipants = useCallback(async () => {
    if (!photographerId || !isLive) return;
    
    try {
      const res = await axios.get(`${API}/photographer/${photographerId}/live-participants`);
      const data = res.data;
      
      if (data.is_live && data.participants) {
        // Mark recently joined surfers (within last 5 minutes)
        const now = new Date();
        const participantsWithRecent = data.participants.map(p => ({
          ...p,
          isRecent: (now - new Date(p.joined_at)) < 5 * 60 * 1000
        }));
        
        // Check if new surfer joined
        if (participantsWithRecent.length > previousCountRef.current && soundEnabled) {
          playChime();
          const newSurfer = participantsWithRecent[0]; // Most recent is first
          if (newSurfer && previousCountRef.current > 0) {
            toast.success(`${newSurfer.username ? `@${newSurfer.username}` : newSurfer.name} joined your session!`, {
              duration: 5000
            });
          }
        }
        
        previousCountRef.current = participantsWithRecent.length;
        setParticipants(participantsWithRecent);
        setTotalEarnings(data.total_earnings || 0);
        
        // Notify parent of update
        if (onParticipantsUpdate) {
          onParticipantsUpdate({
            count: participantsWithRecent.length,
            earnings: data.total_earnings || 0
          });
        }
      }
    } catch (error) {
      console.error('Error fetching participants:', error);
    }
  }, [photographerId, isLive, soundEnabled, playChime, onParticipantsUpdate]);
  
  // Initial fetch and polling
  useEffect(() => {
    if (isLive) {
      fetchParticipants();
      
      // Poll every 10 seconds for new surfers
      const interval = setInterval(fetchParticipants, 10000);
      return () => clearInterval(interval);
    }
  }, [isLive, fetchParticipants]);
  
  // Save photographer notes
  const handleSaveNotes = async (participantId, notes) => {
    await axios.patch(`${API}/photographer/${photographerId}/participant/${participantId}/notes`, {
      notes
    });
    
    // Update local state
    setParticipants(prev => prev.map(p => 
      p.id === participantId ? { ...p, photographer_notes: notes } : p
    ));
  };
  
  // Open surfer detail
  const handleSurferClick = (surfer) => {
    setSelectedSurfer(surfer);
    setShowDetailModal(true);
  };
  
  if (!isLive) return null;
  
  return (
    <>
      <Card className={`${cardBgClass} border`}>
        <CardContent className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-cyan-400" />
              <h3 className={`font-bold ${textPrimaryClass}`}>Surfers in Session</h3>
              <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/50">
                {participants.length}
              </Badge>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Sound toggle */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`${textSecondaryClass} hover:text-cyan-400`}
              >
                {soundEnabled ? (
                  <Volume2 className="w-4 h-4" />
                ) : (
                  <VolumeX className="w-4 h-4" />
                )}
              </Button>
              
              {/* Earnings display */}
              <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-green-500/20">
                <DollarSign className="w-4 h-4 text-green-400" />
                <span className="text-green-400 font-bold">
                  ${totalEarnings.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
          
          {/* Surfer Grid */}
          {participants.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {participants.map((surfer) => (
                <SurferCard
                  key={surfer.id}
                  surfer={surfer}
                  onClick={() => handleSurferClick(surfer)}
                  isLight={isLight}
                  textPrimaryClass={textPrimaryClass}
                  textSecondaryClass={textSecondaryClass}
                />
              ))}
            </div>
          ) : (
            <div className={`text-center py-8 ${textSecondaryClass}`}>
              <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No surfers have joined yet</p>
              <p className="text-sm">They'll appear here when they jump in</p>
            </div>
          )}
          
          {/* Tip */}
          {participants.length > 0 && (
            <p className={`text-xs ${textSecondaryClass} mt-3 text-center`}>
              Tap a surfer to see full details and add identification notes
            </p>
          )}
        </CardContent>
      </Card>
      
      {/* Surfer Detail Modal */}
      <SurferDetailModal
        surfer={selectedSurfer}
        isOpen={showDetailModal}
        onClose={() => {
          setShowDetailModal(false);
          setSelectedSurfer(null);
        }}
        onSaveNotes={handleSaveNotes}
        isLight={isLight}
        textPrimaryClass={textPrimaryClass}
        textSecondaryClass={textSecondaryClass}
      />
    </>
  );
};

export default SurferRosterCard;
