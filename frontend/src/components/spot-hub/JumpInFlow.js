/**
 * JumpInFlow ? Live session join flow for surfers.
 * Handles crew formation, selfie capture, payment, and session entry.
 * 
 * Extracted from UnifiedSpotDrawer.js for maintainability.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Camera, Check, Loader2, CreditCard, ArrowLeft, RefreshCw, Coins
} from 'lucide-react';
import { Button } from '../ui/button';
import apiClient from '../../lib/apiClient';
import { getFullUrl } from '../../utils/media';
import { toast } from 'sonner';
import logger from '../../utils/logger';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';

var CAMERA_AUTHORIZED_KEY = 'raw_surf_camera_authorized';

var JumpInFlow = ({ photographer, onBack, onSuccess }) => {
  const { user, updateUser } = useAuth();
  const { getEffectiveRole, isGodMode, activePersona } = usePersona();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  
  // Check if camera was previously authorized
  const isCameraAuthorized = localStorage.getItem(CAMERA_AUTHORIZED_KEY) === 'true';
  
  const [step, setStep] = useState(isCameraAuthorized ? 'selfie' : 'preflight'); // preflight, selfie, payment, success
  const [selfieUrl, setSelfieUrl] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('credits');
  const [permissionDenied, setPermissionDenied] = useState(false);
  
  // Calculate session pricing
  const sessionBuyinPrice = photographer?.session_price || photographer?.live_buyin_price || 25;
  const _sessionPhotoPrice = photographer?.live_photo_price || 5;
  const photosIncluded = photographer?.photo_package_size || 3;
  const galleryPhotoPrice = photographer?.gallery_photo_price || photographer?.photo_price_standard || 10;
  
  // Savings calculation
  const estimatedPhotos = photosIncluded > 0 ? photosIncluded : 3;
  const galleryTotalCost = estimatedPhotos * galleryPhotoPrice;
  const sessionTotalCost = sessionBuyinPrice;
  const savingsAmount = galleryTotalCost - sessionTotalCost;
  const savingsPercent = galleryTotalCost > 0 ? Math.round((savingsAmount / galleryTotalCost) * 100) : 0;
  
  // Subscription discounts
  let subDiscount = 0;
  if (user?.subscription_tier === 'basic') subDiscount = 0.10;
  else if (user?.subscription_tier === 'premium') subDiscount = 0.20;
  const finalPrice = sessionBuyinPrice * (1 - subDiscount);
  const hasEnoughCredits = (user?.credit_balance || 0) >= finalPrice;
  
  // Request camera permission (pre-flight)
  const requestCameraPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: 640, height: 480 } 
      });
      localStorage.setItem(CAMERA_AUTHORIZED_KEY, 'true');
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setCameraActive(true);
      } else {
        stream.getTracks().forEach(track => track.stop());
      }
      
      setStep('selfie');
      setPermissionDenied(false);
    } catch (err) {
      logger.error('Camera permission error:', err);
      setPermissionDenied(true);
      toast.error('Camera permission denied. Please enable in browser settings.');
    }
  }, []);
  
  // Camera functions
  const startCamera = useCallback(async () => {
    if (streamRef.current) {
      setCameraActive(true);
      return;
    }
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: 640, height: 480 } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setCameraActive(true);
        localStorage.setItem(CAMERA_AUTHORIZED_KEY, 'true');
      }
    } catch (err) {
      logger.error('Camera error:', err);
      toast.error('Could not access camera. Please allow camera permissions.');
    }
  }, []);
  
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setCameraActive(false);
    }
  }, []);
  
  const captureSelfie = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    setSelfieUrl(dataUrl);
    stopCamera();
  }, [stopCamera]);
  
  const retakeSelfie = useCallback(() => {
    setSelfieUrl(null);
    startCamera();
  }, [startCamera]);
  
  // Helper to convert data URL to File and upload
  const uploadSelfie = async (dataUrl) => {
    if (!dataUrl || !dataUrl.startsWith('data:image')) return null;
    
    try {
      // Convert data URL to blob
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      
      // Create a File from blob
      const file = new File([blob], `selfie_${Date.now()}.jpg`, { type: 'image/jpeg' });
      
      // Upload using FormData
      const formData = new FormData();
      formData.append('file', file);
      
      const uploadRes = await apiClient.post(`/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      return uploadRes.data.url;
    } catch (error) {
      logger.error('Selfie upload error:', error);
      return dataUrl; // Fall back to data URL if upload fails
    }
  };
  
  // Handle join session
  const handleJoinSession = async () => {
    setLoading(true);
    try {
      // Upload selfie to server first (if captured)
      let uploadedSelfieUrl = null;
      if (selfieUrl) {
        uploadedSelfieUrl = await uploadSelfie(selfieUrl);
      }
      
      // Get effective role for God Mode support - pass user's actual role
      const effectiveRole = getEffectiveRole(user?.role);
      
      const response = await apiClient.post(`/sessions/join?surfer_id=${user.id}`, {
        photographer_id: photographer.id,
        selfie_url: uploadedSelfieUrl,
        payment_method: paymentMethod,
        // Pass effective role for God Mode persona validation
        effective_role: isGodMode && activePersona ? effectiveRole : null
      });
      
      if (paymentMethod === 'credits') {
        updateUser({ credit_balance: response.data.remaining_credits });
      }
      
      setStep('success');
      toast.success('You\'re in the session!');
      
      setTimeout(() => {
        onSuccess?.(response.data);
      }, 2000);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to join session');
    } finally {
      setLoading(false);
    }
  };
  
  // Cleanup on unmount
  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);
  
  // Keyboard shortcut for closing map/drawer
  useEffect(() => {
    if (step === 'selfie' && !selfieUrl) {
      startCamera();
    }
  }, [step, selfieUrl, startCamera]);
  
  return (
    <div 
      className="relative bg-zinc-900" 
      style={{ 
        height: '90vh',
        maxHeight: '90vh'
      }}
    >
      {/* Header - Fixed at top with z-index */}
      <div 
        className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 p-4 border-b border-zinc-800 bg-zinc-900"
      >
        <button onClick={onBack} className="text-gray-400 hover:text-white p-2 -ml-2" aria-label="Go back">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h3 className="text-white font-bold flex-1">
          {step === 'preflight' ? 'Camera Access Required' : 'Jump In Session'}
        </h3>
      </div>
      
      {/* Scrollable Content Area - Absolute positioned below header */}
      <div 
        className="absolute left-0 right-0 overflow-y-scroll overflow-x-hidden"
        style={{ 
          top: '60px', // Header height
          bottom: step === 'payment' || step === 'selfie' ? '80px' : '0', // Space for fixed button
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          touchAction: 'pan-y'
        }}
      >
      
      {/* Pre-flight Camera Permission Step */}
      {step === 'preflight' && (
        <div className="p-6 flex flex-col items-center justify-center text-center min-h-full">
          <div className="w-20 h-20 rounded-full bg-cyan-500/20 flex items-center justify-center mb-4">
            <Camera className="w-10 h-10 text-cyan-400" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Enable Camera</h3>
          <p className="text-gray-400 mb-6 max-w-xs">
            We need camera access so you can take a quick selfie. This helps the photographer identify you in the water.
          </p>
          
          {permissionDenied && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 max-w-xs">
              <span className="text-red-300 text-sm">
                Camera access was denied. Please enable it in your browser settings.
              </span>
            </div>
          )}
          
          <Button aria-label="Camera"
            onClick={requestCameraPermission}
            className="w-full max-w-xs bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold py-3"
            data-testid="enable-camera-btn"
          >
            <Camera className="w-5 h-5 mr-2" />
            Enable Camera & Continue
          </Button>
          
          <button
            onClick={() => setStep('payment')}
            className="mt-3 text-gray-500 text-sm hover:text-gray-300"
          >
            Skip selfie (not recommended)
          </button>
        </div>
      )}
      
      {/* Photographer Info Bar - Hidden in preflight */}
      {step !== 'preflight' && (
        <div className="p-4 bg-zinc-800/50 flex items-center gap-3">
          <div className="w-12 h-12 rounded-full p-[2px] bg-gradient-to-r from-cyan-400 to-blue-500">
            <div className="w-full h-full rounded-full bg-zinc-800 overflow-hidden">
              {photographer?.avatar_url ? (
                <img loading="lazy" decoding="async" src={getFullUrl(photographer.avatar_url)} className="w-full h-full object-cover" alt="" />
              ) : (
                <span className="flex items-center justify-center h-full text-lg text-cyan-400">
                  {photographer?.full_name?.charAt(0)}
                </span>
              )}
            </div>
          </div>
          <div className="flex-1">
            <div className="text-white font-medium">{photographer?.full_name}</div>
            <div className="text-gray-400 text-sm">at {photographer?.current_spot_name}</div>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold text-white">${sessionBuyinPrice}</div>
            {subDiscount > 0 && (
              <div className="text-emerald-400 text-xs">-{subDiscount * 100}% subscriber</div>
            )}
          </div>
        </div>
      )}
      
      {/* Session Value Breakdown - Hidden in preflight */}
      {step !== 'preflight' && savingsAmount > 0 && (
        <div className="px-4 py-3 bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border-y border-emerald-500/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-emerald-400 text-sm font-medium">Live Session Deal</p>
              <p className="text-gray-400 text-xs">{photosIncluded} photos included vs ${galleryPhotoPrice}/photo in gallery</p>
            </div>
            <div className="text-right">
              <p className="text-emerald-400 font-bold">Save ${savingsAmount.toFixed(0)}</p>
              <p className="text-emerald-300 text-xs">{savingsPercent}% off gallery price</p>
            </div>
          </div>
        </div>
      )}
      
      {/* Step Content */}
      <div className="p-4">
        {/* Step 1: Selfie Capture */}
        {step === 'selfie' && (
          <div className="space-y-4">
            {/* Camera / Preview - Constrained on desktop, full on mobile */}
            <div className="flex flex-col items-center">
              <div className="relative w-full md:max-w-[400px] md:max-h-[400px] aspect-[4/3] bg-black rounded-xl overflow-hidden">
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
                      <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
                        <Loader2 className="w-8 h-8 text-yellow-400 animate-spin" />
                      </div>
                    )}
                  </>
                ) : (
                  <img loading="lazy" decoding="async" src={selfieUrl} alt="Your selfie" className="w-full h-full object-cover" />
                )}
                <canvas ref={canvasRef} className="hidden" />
              </div>
              
              {/* PROMINENT Identification Instruction */}
              <div className="mt-4 p-4 bg-cyan-500/20 border-2 border-cyan-500/40 rounded-xl w-full md:max-w-[400px]">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-cyan-500/30 flex items-center justify-center shrink-0">
                    <span className="text-2xl">??</span>
                  </div>
                  <div>
                    <p className="text-cyan-300 font-bold">Hold your surfboard up!</p>
                    <p className="text-cyan-400/80 text-sm">
                      This helps the photographer find you in the lineup.
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Desktop Camera Controls - Hidden on mobile (uses sticky footer) */}
              <div className="hidden md:flex gap-3 justify-center md:max-w-[400px] mx-auto w-full mt-4">
                {!selfieUrl ? (
                  <Button aria-label="Camera"
                    onClick={captureSelfie}
                    disabled={!cameraActive}
                    className="flex-1 bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold"
                    data-testid="capture-selfie-btn"
                  >
                    <Camera className="w-4 h-4 mr-2" />
                    Capture Selfie
                  </Button>
                ) : (
                  <>
                    <Button aria-label="Refresh"
                      onClick={retakeSelfie}
                      variant="outline"
                      className="flex-1 border-zinc-600 text-white hover:bg-zinc-800"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Retake
                    </Button>
                    <Button
                      onClick={() => setStep('payment')}
                      className="flex-1 bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold"
                    >
                      Continue
                    </Button>
                  </>
                )}
              </div>
            </div>
            
            {/* Skip selfie option - Desktop only (mobile has sticky footer) */}
            <button
              onClick={() => setStep('payment')}
              className="hidden md:block w-full text-center text-gray-500 text-sm hover:text-gray-300 md:max-w-[400px] mx-auto"
            >
              Skip selfie (not recommended)
            </button>
          </div>
        )}
        
        {/* Step 2: Payment Selection */}
        {step === 'payment' && (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <div className="text-gray-300 text-sm">
                Choose how you'd like to pay
              </div>
            </div>
            
            {/* Price Summary */}
            <div className="bg-zinc-800 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-400">Session Price</span>
                <span className="text-white">${sessionBuyinPrice.toFixed(2)}</span>
              </div>
              {subDiscount > 0 && (
                <div className="flex justify-between items-center mb-2 text-emerald-400">
                  <span>Subscriber Discount ({subDiscount * 100}%)</span>
                  <span>-${(sessionBuyinPrice * subDiscount).toFixed(2)}</span>
                </div>
              )}
              <div className="border-t border-zinc-700 pt-2 mt-2 flex justify-between items-center">
                <span className="text-white font-bold">Total</span>
                <span className="text-xl font-bold text-yellow-400">${finalPrice.toFixed(2)}</span>
              </div>
            </div>
            
            {/* Payment Options */}
            <div className="space-y-3">
              {/* Credits Option */}
              <button
                onClick={() => setPaymentMethod('credits')}
                disabled={!hasEnoughCredits}
                className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-all ${
                  paymentMethod === 'credits'
                    ? 'border-yellow-400 bg-yellow-400/10'
                    : hasEnoughCredits
                      ? 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                      : 'border-zinc-800 bg-zinc-800/50 opacity-50 cursor-not-allowed'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  paymentMethod === 'credits' ? 'border-yellow-400' : 'border-zinc-600'
                }`}>
                  {paymentMethod === 'credits' && <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />}
                </div>
                <Coins className={`w-6 h-6 ${paymentMethod === 'credits' ? 'text-yellow-400' : 'text-gray-400'}`} />
                <div className="text-left flex-1">
                  <div className="text-white font-medium">Pay with Credits</div>
                  <div className="text-gray-400 text-sm">
                    Balance: ${(user?.credit_balance || 0).toFixed(2)}
                    {!hasEnoughCredits && <span className="text-red-400 ml-2">(insufficient)</span>}
                  </div>
                </div>
              </button>
              
              {/* Card Option */}
              <button
                onClick={() => setPaymentMethod('card')}
                className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-all ${
                  paymentMethod === 'card'
                    ? 'border-yellow-400 bg-yellow-400/10'
                    : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  paymentMethod === 'card' ? 'border-yellow-400' : 'border-zinc-600'
                }`}>
                  {paymentMethod === 'card' && <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />}
                </div>
                <CreditCard className={`w-6 h-6 ${paymentMethod === 'card' ? 'text-yellow-400' : 'text-gray-400'}`} />
                <div className="text-left flex-1">
                  <div className="text-white font-medium">Pay with Card</div>
                  <div className="text-gray-400 text-sm">Visa, Mastercard, etc.</div>
                </div>
              </button>
            </div>
            
            {/* Back button */}
            <button
              onClick={() => setStep('selfie')}
              className="w-full text-center text-gray-500 text-sm hover:text-gray-300"
            >
              ? Back to selfie
            </button>
          </div>
        )}
        
        {/* Step 3: Success */}
        {step === 'success' && (
          <div className="py-8 text-center space-y-4">
            <div className="w-20 h-20 mx-auto rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Check className="w-10 h-10 text-emerald-400" />
            </div>
            <h3 className="text-2xl font-bold text-white font-oswald" >
              You're In!
            </h3>
            <p className="text-gray-400">
              {photographer?.full_name} can now see you in their session. 
              Head to the water and catch some waves!
            </p>
            <div className="bg-zinc-800 rounded-lg p-4 text-left">
              <div className="text-sm text-gray-400 mb-1">Shooting at</div>
              <div className="text-white font-medium">{photographer?.current_spot_name}</div>
            </div>
          </div>
        )}
      </div>
      </div>
      {/* End of Scrollable Container */}
      
      {/* Fixed Bottom Button - Pay Now - Absolute positioned */}
      {step === 'payment' && (
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-zinc-800 bg-zinc-900" style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
          <Button aria-label="Loader2"
            onClick={handleJoinSession}
            disabled={loading || (paymentMethod === 'credits' && !hasEnoughCredits)}
            className="w-full h-12 bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold text-lg"
            data-testid="pay-now-btn"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>Pay Now - ${finalPrice.toFixed(2)}</>
            )}
          </Button>
        </div>
      )}
      
      {/* Fixed Bottom - Selfie Controls (Mobile sticky footer) - Absolute positioned */}
      {step === 'selfie' && (
        <div className="absolute bottom-0 left-0 right-0 md:hidden p-4 border-t border-zinc-800 bg-zinc-900" style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
          <div className="flex gap-3">
            {!selfieUrl ? (
              <Button aria-label="Camera"
                onClick={captureSelfie}
                disabled={!cameraActive}
                className="flex-1 h-12 bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold text-lg"
                data-testid="capture-selfie-btn-mobile"
              >
                <Camera className="w-5 h-5 mr-2" />
                Take Selfie
              </Button>
            ) : (
              <>
                <Button aria-label="Refresh"
                  onClick={retakeSelfie}
                  variant="outline"
                  className="flex-1 h-12 border-zinc-600 text-white hover:bg-zinc-800"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Retake
                </Button>
                <Button
                  onClick={() => setStep('payment')}
                  className="flex-1 h-12 bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold"
                >
                  Continue
                </Button>
              </>
            )}
          </div>
          <button
            onClick={() => setStep('payment')}
            className="w-full text-center text-gray-500 text-sm hover:text-gray-300 mt-2"
          >
            Skip selfie
          </button>
        </div>
      )}
    </div>
  );
};


export default JumpInFlow;

