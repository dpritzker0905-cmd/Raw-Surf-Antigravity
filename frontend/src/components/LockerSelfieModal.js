import React, { useState } from 'react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { toast } from 'sonner';
import { ScanFace, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import SelfieCapture from './SelfieCapture';


export const LockerSelfieModal = ({ isOpen, onClose, user, fetchClaimQueue, spotId = null, spotName = null, photographerId = null, photographerName = null }) => {
  const [scanning, setScanning] = useState(false);

  const handleCapture = async (selfieUrl) => {
    setScanning(true);
    try {
      await apiClient.post(`/surfer-gallery/scan-locker?surfer_id=${user?.id}`, {
        selfie_url: selfieUrl,
        spot_id: spotId,
        photographer_id: photographerId
      });
      
      let msg = "AI scanning initiated! Your locker will update shortly with matches.";
      if (spotName) msg = `Scanning ${spotName} initiated! Matches will appear in your locker.`;
      if (photographerName) msg = `Scanning ${photographerName}'s galleries initiated! Matches will appear in your locker.`;
      
      toast.success(msg);
      
      if (fetchClaimQueue) {
          setTimeout(() => fetchClaimQueue(), 4000);
          setTimeout(() => fetchClaimQueue(), 12000);
      }
    } catch (err) {
      toast.error("Failed to start scan");
    } finally {
      setScanning(false);
      onClose();
    }
  };

  let title = "Scan Recent Galleries";
  if (spotName) title = `Scan ${spotName}`;
  if (photographerName) title = `Scan ${photographerName}'s Photos`;

  let desc = "Hold your surfboard up! We'll search recent public galleries for your face, wetsuit, and board colors.";
  if (spotName) desc = `Hold your surfboard up! We'll search the last 30 days of ${spotName} galleries for your face, wetsuit, and board colors.`;
  if (photographerName) desc = `Hold your surfboard up! We'll search the last 30 days of ${photographerName}'s galleries for your face, wetsuit, and board colors.`;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border border-zinc-700 sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <ScanFace className="w-5 h-5 text-cyan-400" />
            {title}
          </DialogTitle>
          <div className="text-gray-400 text-sm">
            {desc}
          </div>
        </DialogHeader>
        {scanning ? (
          <div className="py-12 flex flex-col items-center">
            <RefreshCw className="w-10 h-10 text-cyan-400 animate-spin mb-4" />
            <p className="text-white">Mapping Neural Networks...</p>
          </div>
        ) : (
          <SelfieCapture onCapture={handleCapture} onSkip={onClose} skipAllowed={false} />
        )}
      </DialogContent>
    </Dialog>
  );
};
