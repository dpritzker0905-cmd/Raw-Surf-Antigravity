import React from 'react';
import { Camera, Check, ChevronRight } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { SelfieCapture } from '../SelfieCapture';
import { toast } from 'sonner';

export const BookingSelfieStep = ({ 
  selfieUrl, 
  setSelfieUrl, 
  setStep, 
  isLight, 
  textPrimary, 
  textSecondary 
}) => {
  return (
    <div className="space-y-4 pb-4">
      <div className={`p-4 rounded-xl ${isLight ? 'bg-cyan-50' : 'bg-cyan-500/10'} border border-cyan-500/30`}>
        <h4 className={`font-bold text-sm ${textPrimary} mb-2 flex items-center gap-2`}>
          <Camera className="w-4 h-4 text-cyan-400" />
          Help the Photographer Find You!
        </h4>
        <p className={`text-xs ${textSecondary}`}>
          Take a quick selfie with your board. This helps the photographer identify you in their photos so you don't miss any shots!
        </p>
      </div>
      
      {selfieUrl ? (
        <div className="space-y-3">
          <div className="relative aspect-[4/3] rounded-xl overflow-hidden">
            <img loading="lazy" decoding="async" src={selfieUrl} alt="Your selfie" className="w-full h-full object-cover" />
            <Badge className="absolute top-2 right-2 bg-green-500 text-white">
              <Check className="w-3 h-3 mr-1" /> Saved
            </Badge>
          </div>
          <div className="flex gap-2">
            <Button aria-label="Camera"
              variant="outline"
              onClick={() => setSelfieUrl(null)}
              className="flex-1"
            >
              <Camera className="w-4 h-4 mr-2" />
              Retake
            </Button>
            <Button aria-label="Next"
              onClick={() => setStep('confirm')}
              className="flex-1 bg-gradient-to-r from-yellow-500 to-orange-500 text-black font-bold"
            >
              Continue
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      ) : (
        <SelfieCapture
          onCapture={(url) => {
            setSelfieUrl(url);
            toast.success('Selfie captured! The photographer will use this to find you.');
          }}
          onSkip={() => {
            setStep('confirm');
          }}
          title="Selfie with Your Board"
          subtitle="Hold your board so the photographer can spot you in the lineup"
          skipAllowed={true}
          theme={isLight ? 'light' : 'dark'}
        />
      )}
    </div>
  );
};
