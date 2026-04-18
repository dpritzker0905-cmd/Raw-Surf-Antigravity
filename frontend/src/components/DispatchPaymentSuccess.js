/**
 * Dispatch Payment Success Page
 * Handles Stripe payment confirmation for on-demand dispatch sessions
 * Shows selfie upload modal after payment confirmation
 */
import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { CheckCircle, Loader2, XCircle, Camera, Sparkles, Upload } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { RequestProSelfieModal } from './RequestProSelfieModal';
import logger from '../utils/logger';


const DispatchPaymentSuccess = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();
  
  const sessionId = searchParams.get('session_id');
  const dispatchId = searchParams.get('dispatch_id');
  
  const [status, setStatus] = useState('checking');
  const [pollAttempts, setPollAttempts] = useState(0);
  const [showSelfieModal, setShowSelfieModal] = useState(false);
  const maxAttempts = 5;

  useEffect(() => {
    if (!sessionId || !dispatchId) {
      setStatus('error');
      return;
    }

    const confirmDispatchPayment = async () => {
      try {
        // Step 1: Confirm payment with Stripe
        const response = await apiClient.get(
          `/dispatch/payment-success?session_id=${sessionId}&dispatch_id=${dispatchId}`
        );
        
        if (response.data.success) {
          // Step 2: VERIFICATION - Check that participant record was created with metadata
          // This prevents "phantom" bookings where payment succeeded but metadata was lost
          try {
            const verifyResponse = await apiClient.get(
              `/dispatch/${dispatchId}/verify-payment?user_id=${user?.id}`
            );
            
            if (!verifyResponse.data.verified) {
              logger.warn('Payment verified but metadata not stored, retrying...');
              // Retry verification a few times
              if (pollAttempts < maxAttempts) {
                setPollAttempts(prev => prev + 1);
                setTimeout(confirmDispatchPayment, 2000);
                return;
              }
            }
            
            // Check if selfie is needed
            if (verifyResponse.data.needs_selfie) {
              setShowSelfieModal(true);
            }
          } catch (verifyError) {
            logger.warn('Could not verify payment record:', verifyError);
          }
          
          setStatus('success');
          toast.success('Payment confirmed! Now add your selfie so the photographer can find you.');
          
          // Immediately show selfie modal
          setShowSelfieModal(true);
          
          // Refresh user data
          try {
            const profileResponse = await apiClient.get(`/profiles/${user?.id}`);
            if (profileResponse.data?.credit_balance !== undefined) {
              updateUser({ credit_balance: profileResponse.data.credit_balance });
            }
          } catch (e) {
            logger.warn('Could not refresh user data');
          }
        } else {
          // Try again
          if (pollAttempts < maxAttempts) {
            setPollAttempts(prev => prev + 1);
            setTimeout(confirmDispatchPayment, 2000);
          } else {
            setStatus('timeout');
          }
        }
      } catch (error) {
        logger.error('Dispatch payment confirmation error:', error);
        
        if (pollAttempts < maxAttempts && error.response?.status !== 400) {
          setPollAttempts(prev => prev + 1);
          setTimeout(confirmDispatchPayment, 2000);
        } else {
          setStatus('error');
        }
      }
    };

    confirmDispatchPayment();
  }, [sessionId, dispatchId, pollAttempts, user?.id, updateUser]);

  const handleSelfieSuccess = (_selfieUrl) => {
    setShowSelfieModal(false);
    toast.success('Selfie uploaded! The photographer can now find you.');
    // Navigate to bookings page where they can track the request
    navigate('/bookings?tab=live_now');
  };

  const handleSkipSelfie = () => {
    setShowSelfieModal(false);
    toast.info('You can add a selfie later from the booking screen.');
    navigate('/bookings?tab=live_now');
  };

  const renderContent = () => {
    switch (status) {
      case 'checking':
        return (
          <div className="text-center">
            <Loader2 className="w-16 h-16 text-amber-400 animate-spin mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-white mb-2">Confirming Your Payment...</h2>
            <p className="text-gray-400">Please wait while we process your payment</p>
          </div>
        );
      
      case 'success':
        return (
          <div className="text-center">
            {/* Success Animation */}
            <div className="relative inline-block mb-6">
              <div className="w-24 h-24 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 flex items-center justify-center animate-pulse">
                <CheckCircle className="w-12 h-12 text-white" />
              </div>
              <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-green-400 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-black" />
              </div>
            </div>
            
            <h2 className="text-2xl font-bold text-white mb-2">Payment Successful!</h2>
            <p className="text-gray-400 mb-6">
              Your on-demand session request is being processed.
            </p>
            
            {/* Next Step Card */}
            <div className="bg-zinc-800 rounded-xl p-6 text-left mb-6 max-w-md mx-auto">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center">
                  <Camera className="w-6 h-6 text-amber-400" />
                </div>
                <div>
                  <p className="font-semibold text-white">Next Step: Add Your Selfie</p>
                  <p className="text-xs text-gray-400">Help the photographer find you</p>
                </div>
              </div>
              
              <p className="text-sm text-gray-400 mb-4">
                Take a quick selfie with your surfboard so the photographer can identify you when they arrive.
              </p>
              
              <Button
                onClick={() => setShowSelfieModal(true)}
                className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold"
                data-testid="add-selfie-btn"
              >
                <Upload className="w-4 h-4 mr-2" />
                Add Selfie Now
              </Button>
            </div>
            
            {/* Skip Option */}
            <Button
              variant="ghost"
              onClick={handleSkipSelfie}
              className="text-gray-400 hover:text-white"
              data-testid="skip-selfie-btn"
            >
              Skip for now, I'll add it later
            </Button>
          </div>
        );
      
      case 'timeout':
        return (
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-12 h-12 text-amber-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Still Processing...</h2>
            <p className="text-gray-400 mb-6">
              Your payment is being processed. This may take a moment.
            </p>
            <Button
              onClick={() => {
                setPollAttempts(0);
                setStatus('checking');
              }}
              className="bg-amber-500 hover:bg-amber-600 text-black"
            >
              Check Again
            </Button>
          </div>
        );
      
      case 'error':
      default:
        return (
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
              <XCircle className="w-12 h-12 text-red-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Something Went Wrong</h2>
            <p className="text-gray-400 mb-6">
              We couldn't confirm your payment. Please check your bookings or contact support.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                onClick={() => navigate('/bookings?tab=live_now')}
                className="bg-amber-500 hover:bg-amber-600 text-black"
              >
                View Bookings
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/messages')}
                className="border-zinc-700"
              >
                Contact Support
              </Button>
            </div>
          </div>
        );
    }
  };

  return (
    <>
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="max-w-lg w-full" data-testid="dispatch-payment-success">
          {renderContent()}
        </div>
      </div>
      
      {/* Selfie Modal */}
      <RequestProSelfieModal
        dispatchId={dispatchId}
        isOpen={showSelfieModal}
        onClose={() => setShowSelfieModal(false)}
        onSuccess={handleSelfieSuccess}
      />
    </>
  );
};

export default DispatchPaymentSuccess;
