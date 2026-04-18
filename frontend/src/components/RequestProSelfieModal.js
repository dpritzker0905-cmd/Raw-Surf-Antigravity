import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, RefreshCw, Loader2, Check } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { useAuth } from '../contexts/AuthContext';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';


/**
 * RequestProSelfieModal - Surfer uploads identification selfie with surfboard
 * This appears after a Pro accepts their request, so the Pro knows who to find
 */
export const RequestProSelfieModal = ({ dispatchId, isOpen, onClose, onSuccess }) => {
  const { user } = useAuth();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  
  const [selfieUrl, setSelfieUrl] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Start camera when modal opens
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setCameraActive(true);
      }
    } catch (error) {
      logger.error('Camera error:', error);
      toast.error('Could not access camera. Please check permissions.');
    }
  }, []);

  // Stop camera when modal closes
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setCameraActive(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && !selfieUrl) {
      startCamera();
    }
    return () => stopCamera();
  }, [isOpen, selfieUrl, startCamera, stopCamera]);

  // Capture selfie
  const captureSelfie = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    setSelfieUrl(dataUrl);
    stopCamera();
  };

  // Retake selfie
  const retakeSelfie = () => {
    setSelfieUrl(null);
    startCamera();
  };

  // Upload selfie to dispatch request
  const uploadSelfie = async () => {
    if (!selfieUrl || !dispatchId) return;
    
    setUploading(true);
    try {
      // First upload the image to get a URL
      const formData = new FormData();
      const blob = await fetch(selfieUrl).then(r => r.blob());
      formData.append('file', blob, 'dispatch-selfie.jpg');
      
      const uploadResponse = await apiClient.post(`/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      const imageUrl = uploadResponse.data.url;
      
      // Then update the dispatch request with the selfie URL
      await apiClient.post(
        `/dispatch/${dispatchId}/update-selfie?requester_id=${user?.id}`,
        { selfie_url: imageUrl }
      );
      
      toast.success('Selfie uploaded! Your Pro can now identify you.');
      onSuccess?.(imageUrl);
      onClose();
    } catch (error) {
      logger.error('Upload error:', error);
      toast.error(error.response?.data?.detail || 'Failed to upload selfie');
    } finally {
      setUploading(false);
    }
  };

  // Skip selfie
  const skipSelfie = () => {
    toast.info('You can add a selfie later from the tracking screen');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Camera className="w-5 h-5 text-cyan-400" />
            Help Your Pro Find You
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 pt-2">
          <p className="text-gray-400 text-sm text-center">
            Take a quick selfie so your photographer knows who to look for at the beach!
          </p>
          
          {/* Camera Preview */}
          <div className="relative aspect-[4/3] bg-black rounded-xl overflow-hidden">
            {!selfieUrl ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover scale-x-[-1]"
                />
                {!cameraActive && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
                  </div>
                )}
              </>
            ) : (
              <img src={selfieUrl} alt="Your selfie" className="w-full h-full object-cover" />
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>
          
          {/* Pro Tip - Surfboard Identification */}
          <div className="px-4 py-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-center">
            <p className="text-cyan-400 text-sm font-medium">
              🏄 Hold your surfboard in the frame so your Pro can find you in the lineup!
            </p>
          </div>
          
          {/* Camera Controls */}
          <div className="flex gap-3">
            {!selfieUrl ? (
              <Button
                onClick={captureSelfie}
                disabled={!cameraActive}
                className="flex-1 bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-bold"
              >
                <Camera className="w-4 h-4 mr-2" />
                Take Selfie
              </Button>
            ) : (
              <>
                <Button
                  onClick={retakeSelfie}
                  variant="outline"
                  className="flex-1 border-zinc-600 text-white hover:bg-zinc-800"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Retake
                </Button>
                <Button
                  onClick={uploadSelfie}
                  disabled={uploading}
                  className="flex-1 bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-bold"
                >
                  {uploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Confirm
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
          
          {/* Skip option */}
          <button
            onClick={skipSelfie}
            className="w-full text-center text-gray-500 text-sm hover:text-gray-300"
          >
            Skip for now
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RequestProSelfieModal;
