import React, { useState } from 'react';
import { MapPin, Bell, DollarSign, Send, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import apiClient from '../../lib/apiClient';
import { getFullUrl } from '../../utils/media';
import { toast } from 'sonner';
import logger from '../../utils/logger';

/**
 * PhotographerRequestModal -- Extracted from SpotHub.js
 * Request photographer coverage at a spot with no active photographers.
 */
const PhotographerRequestModal = ({ isOpen, onClose, spot, spotId, onSuccess }) => {
  const { theme } = useTheme();
  const { user } = useAuth();
  const isLight = theme === 'light';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const cardBg = isLight ? 'bg-gray-50' : 'bg-zinc-800';
  const inputBg = isLight ? 'bg-white border-gray-300' : 'bg-zinc-900 border-zinc-700';
  
  const [urgency, setUrgency] = useState('today');
  const [preferredTime, setPreferredTime] = useState('');
  const [duration, setDuration] = useState(2);
  const [notes, setNotes] = useState('');
  const [maxBudget, setMaxBudget] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const urgencyOptions = [
    { id: 'now', label: 'Right Now', emoji: '\u26A1', description: 'ASAP (expires in 2 hours)' },
    { id: 'today', label: 'Today', emoji: '\u2600\uFE0F', description: 'Within the day (expires in 12 hours)' },
    { id: 'flexible', label: 'Flexible', emoji: String.fromCodePoint(0x1F919), description: 'Anytime works (expires in 3 days)' }
  ];
  
  const timeOptions = ['Dawn Patrol', 'Morning', 'Midday', 'Afternoon', 'Sunset', 'Flexible'];
  
  const handleSubmit = async () => {
    if (!user?.id) {
      toast.error('Please sign in to request a photographer');
      return;
    }
    
    setIsSubmitting(true);
    try {
      const response = await apiClient.post(`/photographer-request`, {
        spot_id: spotId,
        urgency,
        preferred_time: preferredTime || null,
        duration_hours: duration,
        notes: notes || null,
        max_budget: maxBudget ? parseFloat(maxBudget) : null
      });
      
      toast.success(`Request sent! ${response.data.notified_photographers} photographers notified`);
      onSuccess?.(response.data);
      onClose();
    } catch (error) {
      logger.error('Error creating photographer request:', error);
      toast.error(error.response?.data?.detail || 'Failed to send request');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border-zinc-800 max-w-md max-h-[85vh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle className={`text-lg font-bold ${textPrimary} flex items-center gap-2`}>
            <Bell className="w-5 h-5 text-amber-400" />
            Request Photographer Coverage
          </DialogTitle>
          <DialogDescription className={textSecondary}>
            Alert nearby photographers that you want coverage at {spot?.name || 'this spot'}
          </DialogDescription>
        </DialogHeader>
        
        {/* Spot Info */}
        <div className={`p-3 rounded-xl ${cardBg} mb-4 flex items-center gap-3`}>
          {spot?.image_url && (
            <img loading="lazy" decoding="async" src={getFullUrl(spot.image_url)} alt={spot.name} className="w-14 h-14 rounded-lg object-cover" />
          )}
          <div>
            <span className={`font-medium ${textPrimary}`}>{spot?.name}</span>
            <p className={`text-xs ${textSecondary} flex items-center gap-1`}>
              <MapPin className="w-3 h-3" />
              {spot?.region || 'Surf Spot'}
            </p>
          </div>
        </div>
        
        {/* Urgency Selection */}
        <div className="space-y-2">
          <label className={`text-sm font-medium ${textPrimary}`}>When do you need coverage?</label>
          <div className="grid grid-cols-3 gap-2">
            {urgencyOptions.map((option) => (
              <button
                key={option.id}
                onClick={() => setUrgency(option.id)}
                className={`p-3 rounded-xl border-2 transition-all text-center ${
                  urgency === option.id
                    ? 'border-amber-500 bg-amber-500/10'
                    : `border-zinc-700 ${isLight ? 'hover:bg-gray-50' : 'hover:bg-zinc-800'}`
                }`}
                data-testid={`urgency-${option.id}`}
              >
                <span className="text-xl">{option.emoji}</span>
                <p className={`text-xs font-medium ${textPrimary} mt-1`}>{option.label}</p>
              </button>
            ))}
          </div>
          <p className={`text-xs ${textSecondary}`}>
            {urgencyOptions.find(o => o.id === urgency)?.description}
          </p>
        </div>
        
        {/* Preferred Time */}
        <div className="space-y-2 mt-4">
          <label className={`text-sm font-medium ${textPrimary}`}>Preferred Time (optional)</label>
          <div className="flex flex-wrap gap-2">
            {timeOptions.map((time) => (
              <button
                key={time}
                onClick={() => setPreferredTime(preferredTime === time ? '' : time)}
                className={`px-3 py-1.5 rounded-full text-xs transition-all ${
                  preferredTime === time
                    ? 'bg-cyan-500 text-white'
                    : `${isLight ? 'bg-gray-100 text-gray-700' : 'bg-zinc-800 text-gray-300'} hover:bg-cyan-500/20`
                }`}
              >
                {time}
              </button>
            ))}
          </div>
        </div>
        
        {/* Duration */}
        <div className="space-y-2 mt-4">
          <label className={`text-sm font-medium ${textPrimary}`}>Session Duration</label>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map((hours) => (
              <button
                key={hours}
                onClick={() => setDuration(hours)}
                className={`flex-1 py-2 rounded-lg text-sm transition-all ${
                  duration === hours
                    ? 'bg-cyan-500 text-white'
                    : `${isLight ? 'bg-gray-100 text-gray-700' : 'bg-zinc-800 text-gray-300'}`
                }`}
              >
                {hours}h
              </button>
            ))}
          </div>
        </div>
        
        {/* Budget (Optional) */}
        <div className="space-y-2 mt-4">
          <label className={`text-sm font-medium ${textPrimary} flex items-center gap-1`}>
            <DollarSign className="w-4 h-4" />
            Max Budget (optional)
          </label>
          <div className="relative">
            <span className={`absolute left-3 top-1/2 -translate-y-1/2 ${textSecondary}`}>$</span>
            <input aria-label="e.g. 100"
              type="number"
              value={maxBudget}
              onChange={(e) => setMaxBudget(e.target.value)}
              placeholder="e.g. 100"
              className={`w-full pl-7 pr-3 py-2 rounded-lg border ${inputBg} ${textPrimary} text-sm`}
            />
          </div>
        </div>
        
        {/* Notes */}
        <div className="space-y-2 mt-4">
          <label className={`text-sm font-medium ${textPrimary}`}>Notes for Photographer (optional)</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. I'll be in a red wetsuit, looking for action shots..."
            className={`${inputBg} ${textPrimary} text-sm min-h-[80px]`}
            maxLength={500}
          />
        </div>
        
        {/* Submit Button */}
        <Button aria-label="Loader2"
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full mt-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold py-3"
          data-testid="submit-photographer-request"
        >
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Send className="w-4 h-4 mr-2" />
          )}
          Send Alert to Photographers
        </Button>
        
        <p className={`text-xs ${textSecondary} text-center mt-2`}>
          Nearby photographers will be notified instantly
        </p>
      </DialogContent>
    </Dialog>
  );
};

export default PhotographerRequestModal;
