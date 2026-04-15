import React, { useState, useRef, useEffect } from 'react';
import { X, Camera, CreditCard, Coins, Check, Loader2, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const JumpInSessionModal = ({ photographer, onClose, onSuccess }) => {
  const { user, updateUser } = useAuth();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  
  // State
  const [step, setStep] = useState('options'); // 'options' | 'selfie' | 'payment' | 'success'
  const [selfieUrl, setSelfieUrl] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('credits');

  // Pricing calculations
  const sessionBuyinPrice = photographer?.session_price || photographer?.live_buyin_price || 25;
  const photosIncluded = photographer?.photo_package_size || 3;
  const galleryPhotoPrice = photographer?.photo_price_standard || 10;
  const savingsAmount = Math.max(0, (photosIncluded * galleryPhotoPrice) - sessionBuyinPrice);
  
  // Subscription discount
  let subDiscount = 0;
  if (user?.subscription_tier === 'basic') subDiscount = 0.10;
  else if (user?.subscription_tier === 'premium') subDiscount = 0.20;
  const finalPrice = sessionBuyinPrice * (1 - subDiscount);
  const hasEnoughCredits = (user?.credit_balance || 0) >= finalPrice;

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Start camera when entering selfie step
  useEffect(() => {
    let mounted = true;
    
    if (step === 'selfie' && !selfieUrl) {
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
            toast.error('Could not access camera');
            setStep('payment');
          }
        }
      };
      const timer = setTimeout(startCamera, 300);
      return () => {
        mounted = false;
        clearTimeout(timer);
      };
    }
  }, [step, selfieUrl]);

  // Stop camera
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setCameraReady(false);
    }
  };

  // Capture selfie
  const captureSelfie = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    
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
    setCameraReady(false);
  };

  // Join session
  const handleJoinSession = async () => {
    if (!user?.id) {
      toast.error('Please log in to join a session');
      return;
    }
    
    if (!photographer?.id) {
      toast.error('Invalid photographer');
      return;
    }
    
    setLoading(true);
    try {
      const response = await axios.post(`${API}/sessions/join?surfer_id=${user.id}`, {
        photographer_id: photographer.id,
        selfie_url: selfieUrl || null,
        payment_method: paymentMethod,
        origin_url: window.location.origin
      });
      
      // Handle Stripe redirect for card payments
      if (response.data.requires_payment && response.data.checkout_url) {
        // Store session info for when user returns
        localStorage.setItem('pending_session_join', JSON.stringify({
          photographer_id: photographer.id,
          photographer_name: photographer.full_name,
          checkout_session_id: response.data.session_id
        }));
        // Redirect to Stripe checkout
        window.location.href = response.data.checkout_url;
        return;
      }
      
      // Credit payment succeeded
      if (paymentMethod === 'credits' && response.data?.remaining_credits !== undefined) {
        updateUser({ credit_balance: response.data.remaining_credits });
      }
      
      setStep('success');
      toast.success("You're in the session!");
      setTimeout(() => {
        if (onSuccess) onSuccess(response.data);
      }, 2000);
    } catch (error) {
      console.error('Join session error:', error);
      const message = error.response?.data?.detail || 'Failed to join session';
      toast.error(typeof message === 'string' ? message : 'Failed to join session');
    } finally {
      setLoading(false);
    }
  };

  // Close handler
  const handleClose = () => {
    stopCamera();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[10000]">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/90 backdrop-blur-sm" 
        onClick={handleClose}
      />
      
      {/* Modal - Full height on mobile, centered on desktop */}
      <div className="absolute inset-x-0 bottom-0 top-16 z-[10001] flex flex-col sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-md sm:w-[95%] sm:max-h-[85vh]">
        <div className="flex-1 bg-zinc-900 rounded-t-2xl sm:rounded-2xl border border-zinc-800 overflow-hidden shadow-2xl flex flex-col">
          
          {/* Header - Fixed at top */}
          <div className="flex items-center justify-between p-4 border-b border-zinc-800 shrink-0">
            <h2 className="text-lg font-bold text-white">Jump In Session</h2>
            <button 
              onClick={handleClose} 
              className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 text-gray-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Photographer Info - Fixed */}
          <div className="p-4 bg-zinc-800/30 flex items-center gap-3 shrink-0">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 p-0.5">
              <div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center overflow-hidden">
                {photographer?.avatar_url ? (
                  <img src={photographer.avatar_url} className="w-full h-full object-cover" alt="" />
                ) : (
                  <span className="text-cyan-400 font-bold">{photographer?.full_name?.[0]}</span>
                )}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold truncate">{photographer?.full_name}</p>
              <p className="text-gray-400 text-sm truncate">{photographer?.current_spot_name}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-white">${sessionBuyinPrice}</p>
              {savingsAmount > 0 && (
                <p className="text-emerald-400 text-xs">Save ${savingsAmount}</p>
              )}
            </div>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="p-4 pb-8">
            
            {/* Step: Options */}
            {step === 'options' && (
              <div className="space-y-4">
                {/* Surfboard instruction box */}
                <div className="p-4 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border-2 border-cyan-500/40 rounded-xl">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-cyan-500/30 flex items-center justify-center shrink-0">
                      <span className="text-3xl">🏄</span>
                    </div>
                    <div>
                      <p className="text-cyan-300 font-bold text-lg">Hold your surfboard up!</p>
                      <p className="text-cyan-400/80 text-sm">
                        Take a quick selfie with your board so the photographer can spot you in the lineup
                      </p>
                    </div>
                  </div>
                </div>
                
                <Button
                  onClick={() => setStep('selfie')}
                  className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold py-4"
                >
                  <Camera className="w-5 h-5 mr-2" />
                  Take Selfie & Join
                </Button>
                
                <Button
                  onClick={() => setStep('payment')}
                  variant="outline"
                  className="w-full border-zinc-700 text-gray-300 py-4"
                >
                  Skip Selfie & Join
                </Button>
                
                <button
                  onClick={handleClose}
                  className="w-full text-center text-gray-500 text-sm py-2 hover:text-gray-300"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Step: Selfie */}
            {step === 'selfie' && (
              <div className="space-y-4">
                <div className="relative aspect-[4/3] bg-black rounded-xl overflow-hidden">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full object-cover scale-x-[-1] ${selfieUrl ? 'hidden' : ''}`}
                  />
                  
                  {selfieUrl && (
                    <img src={selfieUrl} alt="Selfie" className="w-full h-full object-cover" />
                  )}
                  
                  {!cameraReady && !selfieUrl && (
                    <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
                      <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
                    </div>
                  )}
                  
                  <canvas ref={canvasRef} className="hidden" />
                </div>

                {/* Surfboard instruction - smaller version */}
                <div className="p-3 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 rounded-xl flex items-center gap-3">
                  <span className="text-2xl">🏄</span>
                  <div>
                    <p className="text-cyan-300 font-bold text-sm">Hold your board up!</p>
                    <p className="text-cyan-400/70 text-xs">So they can spot you in the water</p>
                  </div>
                </div>

                <div className="flex gap-3">
                  {!selfieUrl ? (
                    <>
                      <Button
                        onClick={() => { stopCamera(); setStep('options'); }}
                        variant="outline"
                        className="flex-1 border-zinc-700"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={captureSelfie}
                        disabled={!cameraReady}
                        className="flex-1 bg-gradient-to-r from-yellow-400 to-orange-500 text-black font-bold"
                      >
                        <Camera className="w-5 h-5 mr-2" />
                        Capture
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        onClick={retakeSelfie}
                        variant="outline"
                        className="flex-1 border-zinc-700"
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Retake
                      </Button>
                      <Button
                        onClick={() => { stopCamera(); setStep('payment'); }}
                        className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold"
                      >
                        <Check className="w-5 h-5 mr-2" />
                        Use This
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Step: Payment */}
            {step === 'payment' && (
              <div className="space-y-4">
                <h3 className="text-white font-semibold">Choose Payment Method</h3>
                
                <div className="space-y-3">
                  <button
                    onClick={() => setPaymentMethod('credits')}
                    className={`w-full p-4 rounded-xl border-2 flex items-center gap-3 transition-all ${
                      paymentMethod === 'credits' 
                        ? 'border-cyan-500 bg-cyan-500/10' 
                        : 'border-zinc-700 bg-zinc-800/50'
                    }`}
                  >
                    <Coins className="w-6 h-6 text-yellow-400" />
                    <div className="flex-1 text-left">
                      <p className="text-white font-medium">Surf Credits</p>
                      <p className="text-gray-400 text-sm">${(user?.credit_balance || 0).toFixed(2)} available</p>
                    </div>
                    {paymentMethod === 'credits' && <Check className="w-5 h-5 text-cyan-400" />}
                  </button>

                  <button
                    onClick={() => setPaymentMethod('card')}
                    className={`w-full p-4 rounded-xl border-2 flex items-center gap-3 transition-all ${
                      paymentMethod === 'card' 
                        ? 'border-cyan-500 bg-cyan-500/10' 
                        : 'border-zinc-700 bg-zinc-800/50'
                    }`}
                  >
                    <CreditCard className="w-6 h-6 text-blue-400" />
                    <div className="flex-1 text-left">
                      <p className="text-white font-medium">Credit Card</p>
                    </div>
                    {paymentMethod === 'card' && <Check className="w-5 h-5 text-cyan-400" />}
                  </button>
                </div>

                {paymentMethod === 'credits' && !hasEnoughCredits && (
                  <p className="text-red-400 text-sm text-center">
                    Not enough credits (need ${finalPrice.toFixed(2)})
                  </p>
                )}

                <Button
                  onClick={handleJoinSession}
                  disabled={loading || (paymentMethod === 'credits' && !hasEnoughCredits)}
                  className="w-full bg-gradient-to-r from-yellow-400 to-orange-500 text-black font-bold py-4"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>Pay ${finalPrice.toFixed(2)} & Join</>
                  )}
                </Button>
                
                <button
                  onClick={() => setStep('options')}
                  className="w-full text-center text-gray-500 text-sm py-2 hover:text-gray-300"
                >
                  Back
                </button>
              </div>
            )}

            {/* Step: Success */}
            {step === 'success' && (
              <div className="py-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Check className="w-8 h-8 text-green-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">You're In!</h3>
                <p className="text-gray-400">{photographer?.full_name} will find you in the water</p>
              </div>
            )}
            </div>
          </div>
          
          {/* Safe area padding at bottom for mobile navigation */}
          <div className="h-safe-area-inset-bottom bg-zinc-900 shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 20px)' }} />
        </div>
      </div>
    </div>
  );
};

export default JumpInSessionModal;
