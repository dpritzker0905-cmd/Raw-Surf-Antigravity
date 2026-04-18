/**
 * Payment Success Page
 * Polls Stripe for payment status and shows confirmation
 */
import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { CheckCircle, Loader2, XCircle, ArrowLeft } from 'lucide-react';
import { Button } from './ui/button';
import logger from '../utils/logger';


const PaymentSuccess = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = searchParams.get('session_id');
  
  const [status, setStatus] = useState('checking');
  const [paymentData, setPaymentData] = useState(null);
  const [pollAttempts, setPollAttempts] = useState(0);
  const maxAttempts = 5;

  useEffect(() => {
    if (!sessionId) {
      setStatus('error');
      return;
    }

    const pollPaymentStatus = async () => {
      try {
        const response = await apiClient.get(`/payments/checkout/status/${sessionId}`);
        const data = response.data;
        
        setPaymentData(data);
        
        if (data.payment_status === 'paid') {
          setStatus('success');
          return;
        } else if (data.status === 'expired') {
          setStatus('expired');
          return;
        }
        
        // Continue polling if not yet paid
        if (pollAttempts < maxAttempts) {
          setPollAttempts(prev => prev + 1);
          setTimeout(pollPaymentStatus, 2000);
        } else {
          setStatus('timeout');
        }
      } catch (error) {
        logger.error('Payment status check error:', error);
        setStatus('error');
      }
    };

    pollPaymentStatus();
  }, [sessionId, pollAttempts]);

  const renderContent = () => {
    switch (status) {
      case 'checking':
        return (
          <div className="text-center">
            <Loader2 className="w-16 h-16 text-cyan-400 animate-spin mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-white mb-2">Processing Payment...</h2>
            <p className="text-gray-400">Please wait while we confirm your payment</p>
          </div>
        );
      
      case 'success':
        return (
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-12 h-12 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Payment Successful!</h2>
            <p className="text-gray-400 mb-4">
              Your deposit of ${(paymentData?.amount_total / 100).toFixed(2)} has been received.
            </p>
            <div className="bg-zinc-800/50 rounded-lg p-4 mb-6 text-left">
              <p className="text-sm text-gray-400 mb-1">Amount</p>
              <p className="text-lg text-white font-bold">${(paymentData?.amount_total / 100).toFixed(2)} {paymentData?.currency?.toUpperCase()}</p>
            </div>
            <p className="text-sm text-gray-500 mb-6">
              Credits have been added to your wallet. You can now request a photographer!
            </p>
            <Button 
              onClick={() => navigate('/map')}
              className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
            >
              Back to Map
            </Button>
          </div>
        );
      
      case 'expired':
        return (
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-yellow-500/20 flex items-center justify-center mx-auto mb-4">
              <XCircle className="w-12 h-12 text-yellow-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Session Expired</h2>
            <p className="text-gray-400 mb-6">
              Your payment session has expired. Please try again.
            </p>
            <Button 
              onClick={() => navigate('/map')}
              className="w-full bg-zinc-700 text-white hover:bg-zinc-600"
            >
              Return to Map
            </Button>
          </div>
        );
      
      case 'timeout':
        return (
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-yellow-500/20 flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-12 h-12 text-yellow-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Still Processing</h2>
            <p className="text-gray-400 mb-6">
              Payment is taking longer than expected. Please check your email for confirmation.
            </p>
            <Button 
              onClick={() => navigate('/map')}
              className="w-full bg-zinc-700 text-white hover:bg-zinc-600"
            >
              Return to Map
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
            <h2 className="text-2xl font-bold text-white mb-2">Payment Error</h2>
            <p className="text-gray-400 mb-6">
              There was an error processing your payment. Please try again.
            </p>
            <Button 
              onClick={() => navigate('/map')}
              className="w-full bg-zinc-700 text-white hover:bg-zinc-600"
            >
              Return to Map
            </Button>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-zinc-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <button
          onClick={() => navigate('/map')}
          className="flex items-center gap-2 text-gray-400 hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Map
        </button>
        
        <div className="bg-zinc-800/50 rounded-2xl p-8 border border-zinc-700">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default PaymentSuccess;
