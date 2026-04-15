import React, { useState, useEffect, useRef } from 'react';
import { Camera, RefreshCw, Check, X, User } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';

/**
 * SelfieCapture - Reusable camera capture component for surfer identification
 * Used in: JumpInSessionModal, OnDemandRequestDrawer, BookingSelfieModal
 */
export const SelfieCapture = ({ 
  onCapture, 
  onSkip,
  title = "Take a Selfie",
  subtitle = "Hold your board so the photographer can identify you in the water",
  skipAllowed = true,
  theme = 'dark'
}) => {
  const [selfieUrl, setSelfieUrl] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  
  const isLight = theme === 'light';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';
  const bgClass = isLight ? 'bg-gray-100' : 'bg-zinc-800';
  
  // Start camera on mount
  useEffect(() => {
    let mounted = true;
    
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'user', width: 640, height: 480 } 
        });
        
        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraReady(true);
        }
      } catch (err) {
        if (mounted) {
          console.error('Camera error:', err);
          setCameraError('Could not access camera. Please check permissions.');
        }
      }
    };
    
    const timer = setTimeout(startCamera, 300);
    
    return () => {
      mounted = false;
      clearTimeout(timer);
      // Stop camera on unmount
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);
  
  // Capture selfie
  const captureSelfie = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    
    const ctx = canvas.getContext('2d');
    // Mirror the image for natural selfie appearance
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    setSelfieUrl(dataUrl);
    
    // Stop camera
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setCameraReady(false);
    }
  };
  
  // Retake selfie
  const retakeSelfie = async () => {
    setSelfieUrl(null);
    setCameraReady(false);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: 640, height: 480 } 
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraReady(true);
      }
    } catch (err) {
      toast.error('Could not restart camera');
    }
  };
  
  // Confirm selfie
  const confirmSelfie = () => {
    if (selfieUrl) {
      onCapture(selfieUrl);
    }
  };
  
  // Handle skip
  const handleSkip = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (onSkip) {
      onSkip();
    }
  };
  
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center">
        <h3 className={`text-lg font-bold ${textPrimaryClass}`}>{title}</h3>
        <p className={`text-sm ${textSecondaryClass}`}>{subtitle}</p>
      </div>
      
      {/* Camera/Preview Area */}
      <div className={`relative aspect-[4/3] rounded-xl overflow-hidden ${bgClass}`}>
        {/* Hidden canvas for capture */}
        <canvas ref={canvasRef} className="hidden" />
        
        {/* Camera preview */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover scale-x-[-1] ${selfieUrl ? 'hidden' : ''}`}
        />
        
        {/* Captured selfie preview */}
        {selfieUrl && (
          <img 
            src={selfieUrl} 
            alt="Your selfie" 
            className="w-full h-full object-cover"
          />
        )}
        
        {/* Loading state */}
        {!cameraReady && !selfieUrl && !cameraError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <Camera className={`w-12 h-12 mx-auto mb-2 ${textSecondaryClass} animate-pulse`} />
              <p className={textSecondaryClass}>Starting camera...</p>
            </div>
          </div>
        )}
        
        {/* Error state */}
        {cameraError && !selfieUrl && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center p-4">
              <User className={`w-12 h-12 mx-auto mb-2 ${textSecondaryClass}`} />
              <p className="text-red-400 text-sm">{cameraError}</p>
              {skipAllowed && (
                <Button 
                  onClick={handleSkip}
                  variant="outline" 
                  className="mt-3"
                >
                  Continue Without Selfie
                </Button>
              )}
            </div>
          </div>
        )}
        
        {/* Guide overlay */}
        {cameraReady && !selfieUrl && (
          <div className="absolute inset-0 pointer-events-none">
            {/* Face guide circle */}
            <div className="absolute top-[15%] left-1/2 -translate-x-1/2 w-32 h-32 border-2 border-dashed border-white/30 rounded-full" />
            {/* Board guide area */}
            <div className="absolute bottom-[10%] left-1/2 -translate-x-1/2 w-48 h-16 border-2 border-dashed border-cyan-400/30 rounded-lg flex items-center justify-center">
              <span className="text-cyan-400/50 text-xs">Board here</span>
            </div>
          </div>
        )}
      </div>
      
      {/* Action Buttons */}
      <div className="flex gap-2">
        {!selfieUrl ? (
          <>
            <Button
              onClick={captureSelfie}
              disabled={!cameraReady}
              className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 text-white"
            >
              <Camera className="w-4 h-4 mr-2" />
              {cameraReady ? 'Capture' : 'Loading...'}
            </Button>
            {skipAllowed && (
              <Button
                onClick={handleSkip}
                variant="outline"
                className={isLight ? 'border-gray-300' : 'border-zinc-700'}
              >
                Skip
              </Button>
            )}
          </>
        ) : (
          <>
            <Button
              onClick={retakeSelfie}
              variant="outline"
              className={`flex-1 ${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Retake
            </Button>
            <Button
              onClick={confirmSelfie}
              className="flex-1 bg-gradient-to-r from-green-500 to-emerald-500 text-white"
            >
              <Check className="w-4 h-4 mr-2" />
              Use This
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default SelfieCapture;
