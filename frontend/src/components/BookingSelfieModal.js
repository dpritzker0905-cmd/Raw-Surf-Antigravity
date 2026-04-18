import React, { useState } from 'react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { Camera, Check, AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { SelfieCapture } from './SelfieCapture';


/**
 * BookingSelfieModal - Prompts surfers to take a selfie for scheduled bookings
 * Helps photographers identify surfers in their session photos
 */
export const BookingSelfieModal = ({ 
  isOpen, 
  onClose, 
  booking,
  userId,
  theme = 'dark',
  onSuccess
}) => {
  const [step, setStep] = useState('prompt'); // 'prompt' | 'capture' | 'success'
  const [_uploading, setUploading] = useState(false);
  
  const isLight = theme === 'light';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';
  const cardBgClass = isLight ? 'bg-white' : 'bg-zinc-900';
  
  const handleCapture = async (selfieUrl) => {
    if (!booking?.id || !userId) {
      toast.error('Missing booking information');
      return;
    }
    
    setUploading(true);
    try {
      const response = await apiClient.patch(`/bookings/${booking.id}/participant-selfie`, {
        participant_id: userId,
        selfie_url: selfieUrl
      });
      
      setStep('success');
      toast.success('Selfie saved! The photographer will use this to identify you.', { duration: 5000 });
      
      if (onSuccess) {
        onSuccess(selfieUrl);
      }
      
      // Auto-close after showing success for 2.5 seconds
      setTimeout(() => {
        onClose();
      }, 2500);
      
    } catch (error) {
      console.error('Error uploading selfie:', error);
      toast.error('Failed to upload selfie. Please try again.');
    } finally {
      setUploading(false);
    }
  };
  
  const handleSkip = () => {
    onClose();
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${cardBgClass} border ${isLight ? 'border-gray-200' : 'border-zinc-700'} sm:max-w-[420px]`}>
        <DialogTitle className="sr-only">Dialog</DialogTitle>
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          
          {/* Prompt Step */}
          {step === 'prompt' && (
            <div className="space-y-4 text-center">
              <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center ${isLight ? 'bg-cyan-100' : 'bg-cyan-500/20'}`}>
                <Camera className="w-8 h-8 text-cyan-500" />
              </div>
              
              <div>
                <h3 className={`text-xl font-bold ${textPrimaryClass}`}>
                  Help the Photographer Find You!
                </h3>
                <p className={`mt-2 ${textSecondaryClass}`}>
                  Take a quick selfie with your board. This helps the photographer identify you in their photos so you don't miss any shots!
                </p>
              </div>
              
              <div className={`p-3 rounded-lg ${isLight ? 'bg-amber-50' : 'bg-amber-500/10'} flex items-start gap-2`}>
                <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-600 dark:text-amber-400 text-left">
                  Sessions with selfies have <strong>3x higher</strong> photo match accuracy!
                </p>
              </div>
              
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleSkip}
                  variant="outline"
                  className={`flex-1 ${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
                >
                  Skip for Now
                </Button>
                <Button
                  onClick={() => setStep('capture')}
                  className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 text-white"
                >
                  <Camera className="w-4 h-4 mr-2" />
                  Take Selfie
                </Button>
              </div>
            </div>
          )}
          
          {/* Capture Step */}
          {step === 'capture' && (
            <SelfieCapture
              onCapture={handleCapture}
              onSkip={handleSkip}
              title="Selfie with Your Board"
              subtitle="Hold your board so the photographer can spot you in the lineup"
              skipAllowed={true}
              theme={theme}
            />
          )}
          
          {/* Success Step */}
          {step === 'success' && (
            <div className="space-y-4 text-center py-8">
              <div className="w-20 h-20 mx-auto rounded-full bg-green-500/20 flex items-center justify-center animate-pulse">
                <Check className="w-10 h-10 text-green-500" />
              </div>
              
              <div>
                <h3 className={`text-xl font-bold text-green-500`}>
                  Selfie Saved!
                </h3>
                <p className={`mt-2 ${textSecondaryClass}`}>
                  The photographer will use your selfie to find you in their photos.
                </p>
              </div>
              
              <p className="text-sm text-green-400">Closing automatically...</p>
            </div>
          )}
          
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BookingSelfieModal;
