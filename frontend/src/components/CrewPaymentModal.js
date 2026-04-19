import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import apiClient from '../lib/apiClient';
import { getFullUrl } from '../utils/media';
import { Users, MapPin, Clock, Camera, CreditCard, Wallet, 
  Plus, Check, Loader2, ChevronRight, Zap, AlertCircle, ExternalLink
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { toast } from 'sonner';


export const CrewPaymentModal = ({ 
  invite, 
  isOpen, 
  onClose, 
  onSuccess 
}) => {
  const { user, updateUser } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('details'); // 'details' | 'selfie' | 'payment' | 'success'
  const [selfieUrl, setSelfieUrl] = useState(null);
  const [uploadingSelfie, setUploadingSelfie] = useState(false);
  const fileInputRef = useRef(null);
  
  const isLight = theme === 'light';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  const bgCard = isLight ? 'bg-white' : 'bg-zinc-900';
  const sectionBg = isLight ? 'bg-gray-50' : 'bg-zinc-800/50';
  
  const shareAmount = invite?.your_share || 0;
  const userCredits = user?.credit_balance || 0;
  const hasEnoughCredits = userCredits >= shareAmount;
  const shortfall = Math.max(0, shareAmount - userCredits);
  
  const handleSelfieUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    
    setUploadingSelfie(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await apiClient.post(`/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      setSelfieUrl(response.data.url);
      toast.success('Selfie uploaded!');
    } catch (error) {
      const message = error.response?.data?.detail || 'Failed to upload selfie';
      toast.error(message);
    } finally {
      setUploadingSelfie(false);
    }
  };
  
  const handlePayWithCredits = async () => {
    if (!hasEnoughCredits) {
      toast.error(`You need $${shortfall.toFixed(2)} more credits`);
      return;
    }
    
    setLoading(true);
    try {
      const response = await apiClient.post(
        `/dispatch/crew-invite/${invite.id}/pay?payer_id=${user.id}`,
        { selfie_url: selfieUrl }
      );
      
      // Check if backend requires selfie before completing payment
      if (response.data.needs_selfie) {
        setLoading(false);
        toast.info(response.data.message || 'Please add a selfie so the photographer can find you!');
        setStep('selfie');
        return;
      }
      
      // Update user credits
      if (response.data.remaining_credits !== undefined) {
        updateUser({ credit_balance: response.data.remaining_credits });
      }
      
      setStep('success');
      toast.success("You're in! Session confirmed.");
      
      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 2000);
      
    } catch (error) {
      const message = error.response?.data?.detail || 'Payment failed';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };
  
  const handleAddCredits = () => {
    onClose();
    navigate('/credits', { 
      state: { 
        returnTo: '/bookings?tab=scheduled',
        openCrewInvite: true,
        dispatchId: invite.dispatch_id,
        requiredAmount: shareAmount,
        reason: 'crew_session_payment'
      }
    });
  };

  const handlePayWithCard = async () => {
    setLoading(true);
    try {
      const response = await apiClient.post(
        `/dispatch/crew-invite/${invite.id}/checkout?payer_id=${user.id}`,
        {
          selfie_url: selfieUrl,
          origin_url: window.location.origin
        }
      );
      if (response.data.checkout_url) {
        toast.info('Redirecting to secure payment...');
        window.location.href = response.data.checkout_url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (error) {
      const message = error.response?.data?.detail || 'Failed to create payment session';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };
  
  if (!invite) return null;
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className={`${bgCard} border-border sm:max-w-md`}
      >
        <DialogTitle className="sr-only">Dialog</DialogTitle>
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {/* ============ STEP 1: SESSION DETAILS ============ */}
        {step === 'details' && (
          <div className="p-4 space-y-3">
            {/* Header */}
            <div className="text-center">
              <div className="w-12 h-12 mx-auto rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center mb-2">
                <Users className="w-6 h-6 text-white" />
              </div>
              <h2 className={`text-lg font-bold ${textPrimary}`}>You're Invited!</h2>
              <p className={`text-xs ${textSecondary} mt-1`}>
                {invite.captain?.name || 'A friend'} wants you to join their surf session
              </p>
            </div>
            
            {/* Captain Card */}
            <div className={`flex items-center gap-3 p-3 rounded-xl ${sectionBg}`}>
              {invite.captain?.avatar_url ? (
                <img 
                  src={getFullUrl(invite.captain.avatar_url)} 
                  alt="" 
                  className="w-10 h-10 rounded-full object-cover ring-2 ring-cyan-400"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center ring-2 ring-cyan-400/50">
                  <span className="text-cyan-400 font-bold">
                    {invite.captain?.name?.[0]?.toUpperCase() || '?'}
                  </span>
                </div>
              )}
              <div className="flex-1">
                <p className={`font-semibold text-sm ${textPrimary}`}>{invite.captain?.name}</p>
                <p className={`text-xs ${textSecondary}`}>Session Captain</p>
              </div>
              <Badge className="bg-cyan-500/20 text-cyan-400 text-xs">
                <Zap className="w-3 h-3 mr-1" />
                On-Demand
              </Badge>
            </div>
            
            {/* Session Details */}
            <div className="grid grid-cols-2 gap-2">
              <div className={`p-2 rounded-xl ${sectionBg}`}>
                <div className="flex items-center gap-1 text-cyan-400 mb-1">
                  <MapPin className="w-3 h-3" />
                  <span className="text-xs">Location</span>
                </div>
                <p className={`text-xs font-medium ${textPrimary} truncate`}>
                  {invite.location_name || 'TBD'}
                </p>
              </div>
              <div className={`p-2 rounded-xl ${sectionBg}`}>
                <div className="flex items-center gap-1 text-purple-400 mb-1">
                  <Clock className="w-3 h-3" />
                  <span className="text-xs">Duration</span>
                </div>
                <p className={`text-xs font-medium ${textPrimary}`}>
                  {invite.estimated_duration_hours ? `${invite.estimated_duration_hours}h` : 'TBD'}
                </p>
              </div>
            </div>
            
            {/* Photographer */}
            {invite.photographer && (
              <div className={`flex items-center gap-2 p-2 rounded-xl ${sectionBg}`}>
                <Camera className="w-4 h-4 text-amber-400" />
                <div className="flex-1">
                  <p className={`text-xs ${textSecondary}`}>Photographer</p>
                  <p className={`text-sm font-medium ${textPrimary}`}>{invite.photographer.name}</p>
                </div>
              </div>
            )}
            
            {/* Your Share Card */}
            <div className={`p-3 rounded-xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-400/30`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-xs ${textSecondary}`}>Your Share</p>
                  <p className="text-xl font-bold text-amber-400">${shareAmount.toFixed(2)}</p>
                </div>
                <div className="text-right">
                  <p className={`text-xs ${textSecondary}`}>Your Credits</p>
                  <p className={`font-bold ${hasEnoughCredits ? 'text-green-400' : 'text-red-400'}`}>
                    ${userCredits.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
            
            {/* Action Button */}
            <Button
              onClick={() => setStep('selfie')}
              className="w-full py-4 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-bold rounded-xl"
            >
              Continue
              <ChevronRight className="w-5 h-5 ml-2" />
            </Button>
            
            <button 
              onClick={onClose}
              className={`w-full text-center text-xs ${textSecondary} hover:text-red-400 transition-colors py-1`}
            >
              Decline Invite
            </button>
          </div>
        )}
        
        {/* ============ STEP 2: SELFIE ============ */}
        {step === 'selfie' && (
          <div className="p-4 space-y-4">
            {/* Header */}
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setStep('details')} 
                className={`p-2 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-800'}`}
              >
                <ChevronRight className={`w-5 h-5 ${textSecondary} rotate-180`} />
              </button>
              <h2 className={`text-lg font-bold ${textPrimary}`}>Upload Your Selfie</h2>
            </div>
            
            <p className={`text-sm ${textSecondary} text-center`}>
              Help your photographer identify you at the beach!
            </p>
            
            {/* Selfie Upload Area */}
            <div 
              className={`relative rounded-2xl border-2 border-dashed ${
                selfieUrl 
                  ? 'border-green-400/50 bg-green-500/10' 
                  : isLight ? 'border-gray-300 bg-gray-50' : 'border-zinc-600 bg-zinc-800/50'
              } p-4 text-center cursor-pointer transition-all hover:border-cyan-400/50`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="user"
                onChange={handleSelfieUpload}
                className="hidden"
              />
              
              {uploadingSelfie ? (
                <div className="py-8">
                  <Loader2 className="w-10 h-10 text-cyan-400 animate-spin mx-auto mb-3" />
                  <p className={`text-sm ${textSecondary}`}>Uploading...</p>
                </div>
              ) : selfieUrl ? (
                <div className="relative">
                  <img 
                    src={selfieUrl} 
                    alt="Your selfie" 
                    className="w-32 h-32 rounded-full mx-auto object-cover ring-4 ring-green-400/50"
                  />
                  <div className="absolute bottom-0 right-1/2 translate-x-1/2 translate-y-2">
                    <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center">
                      <Check className="w-5 h-5 text-white" />
                    </div>
                  </div>
                  <p className={`text-sm ${textSecondary} mt-4`}>Tap to change</p>
                </div>
              ) : (
                <div className="py-8">
                  <div className="w-16 h-16 rounded-full bg-cyan-500/20 flex items-center justify-center mx-auto mb-3">
                    <Camera className="w-8 h-8 text-cyan-400" />
                  </div>
                  <p className={`font-medium ${textPrimary} mb-1`}>Take a Selfie</p>
                  <p className={`text-xs ${textSecondary}`}>
                    Show yourself with your surfboard so the photographer can find you
                  </p>
                </div>
              )}
            </div>
            
            {/* Continue Button */}
            <Button
              onClick={() => setStep('payment')}
              disabled={!selfieUrl}
              className={`w-full py-4 font-bold rounded-xl ${
                selfieUrl 
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white'
                  : 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
              }`}
            >
              Continue to Payment
              <ChevronRight className="w-5 h-5 ml-2" />
            </Button>
            
            <button 
              onClick={() => setStep('payment')}
              className={`w-full text-center text-xs ${textSecondary} hover:text-cyan-400 transition-colors py-1`}
            >
              Skip for now
            </button>
          </div>
        )}
        
        {/* ============ STEP 3: PAYMENT ============ */}
        {step === 'payment' && (
          <div className="p-5 space-y-5">
            {/* Header */}
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setStep('selfie')} 
                className={`p-2 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-800'}`}
              >
                <ChevronRight className={`w-5 h-5 ${textSecondary} rotate-180`} />
              </button>
              <h2 className={`text-xl font-bold ${textPrimary}`}>Payment</h2>
            </div>
            
            {/* Amount Due */}
            <div className={`text-center p-6 rounded-2xl ${sectionBg}`}>
              <p className={`text-sm ${textSecondary} mb-1`}>Amount Due</p>
              <p className="text-4xl font-bold text-amber-400">${shareAmount.toFixed(2)}</p>
            </div>
            
            {/* Payment Option: Credits */}
            <div className={`p-4 rounded-xl border-2 ${
              hasEnoughCredits 
                ? 'border-green-400/50 bg-green-500/10' 
                : 'border-zinc-700 bg-zinc-800/30'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    hasEnoughCredits ? 'bg-green-500/20' : 'bg-zinc-700'
                  }`}>
                    <Wallet className={`w-5 h-5 ${hasEnoughCredits ? 'text-green-400' : 'text-gray-400'}`} />
                  </div>
                  <div>
                    <p className={`font-medium ${textPrimary}`}>Surf Credits</p>
                    <p className={`text-sm ${textSecondary}`}>Balance: ${userCredits.toFixed(2)}</p>
                  </div>
                </div>
                {hasEnoughCredits && (
                  <Badge className="bg-green-500/20 text-green-400">
                    <Check className="w-3 h-3 mr-1" />
                    Ready
                  </Badge>
                )}
              </div>
              
              {hasEnoughCredits ? (
                <Button
                  onClick={handlePayWithCredits}
                  disabled={loading}
                  className="w-full py-5 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-bold rounded-xl"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Check className="w-5 h-5 mr-2" />
                      Pay ${shareAmount.toFixed(2)} with Credits
                    </>
                  )}
                </Button>
              ) : (
                <div className={`p-3 rounded-lg ${isLight ? 'bg-red-50' : 'bg-red-500/10'} border border-red-500/30`}>
                  <div className="flex items-center gap-2 text-red-400 mb-2">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">Insufficient Credits</span>
                  </div>
                  <p className={`text-xs ${textSecondary}`}>
                    You need ${shortfall.toFixed(2)} more to pay with credits
                  </p>
                </div>
              )}
            </div>
            
            {/* Pay with Card — direct Stripe checkout */}
            <div className={`p-4 rounded-xl border-2 ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-indigo-400" />
                </div>
                <div className="flex-1">
                  <p className={`font-medium ${textPrimary}`}>Pay with Card</p>
                  <p className={`text-sm ${textSecondary}`}>Debit or credit card via Stripe</p>
                </div>
              </div>
              <Button
                onClick={handlePayWithCard}
                disabled={loading}
                className="w-full py-5 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white font-bold rounded-xl"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <ExternalLink className="w-5 h-5 mr-2" />
                    Pay ${shareAmount.toFixed(2)} with Card
                  </>
                )}
              </Button>
            </div>

            {/* Add Credits Option */}
            <div className={`p-4 rounded-xl border-2 ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center">
                  <Plus className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <p className={`font-medium ${textPrimary}`}>Add Credits Instead</p>
                  <p className={`text-sm ${textSecondary}`}>Top up wallet, then pay from balance</p>
                </div>
              </div>
              
              <Button
                onClick={handleAddCredits}
                variant="outline"
                className={`w-full py-5 border-cyan-400/50 text-cyan-400 hover:bg-cyan-500/10 font-bold rounded-xl`}
              >
                <CreditCard className="w-5 h-5 mr-2" />
                {hasEnoughCredits ? 'Add More Credits' : `Add $${Math.ceil(shortfall)} Credits`}
              </Button>
            </div>
            
            {/* Info note */}
            <p className={`text-xs ${textSecondary} text-center`}>
              Credits are stored in your wallet for future sessions and photo purchases
            </p>
          </div>
        )}
        
        {/* ============ STEP 3: SUCCESS ============ */}
        {step === 'success' && (
          <div className="p-8 text-center space-y-6">
            <div className="w-20 h-20 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
              <Check className="w-10 h-10 text-green-400" />
            </div>
            
            <div>
              <h2 className={`text-2xl font-bold ${textPrimary}`}>You're In!</h2>
              <p className={`${textSecondary} mt-2`}>
                Payment confirmed. Get ready to surf with {invite.captain?.name}!
              </p>
            </div>
            
            <div className={`p-4 rounded-xl ${sectionBg}`}>
              <p className={`text-sm ${textSecondary}`}>Session Location</p>
              <p className={`font-bold ${textPrimary} mt-1`}>{invite.location_name || 'TBD'}</p>
            </div>
            
            <Button
              onClick={() => {
                onSuccess?.();
                onClose();
              }}
              className="w-full py-5 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-bold rounded-xl"
            >
              <Zap className="w-5 h-5 mr-2" />
              Let's Surf!
            </Button>
          </div>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CrewPaymentModal;
