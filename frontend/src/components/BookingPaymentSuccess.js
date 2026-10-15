/**
 * Booking Payment Success Page
 * Handles Stripe payment confirmation for scheduled bookings
 */
import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../lib/apiClient';
import { forgetConfirmedCheckout } from '../lib/checkoutPurchase';
import { useTheme } from '../contexts/ThemeContext';
import { CheckCircle, Loader2, XCircle, Calendar, MapPin, Camera, Sparkles } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import logger from '../utils/logger';


const BookingPaymentSuccess = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();
  
  const sessionId = searchParams.get('session_id');
  const bookingId = searchParams.get('booking_id');
  
  const [status, setStatus] = useState('checking');
  const [_bookingData, setBookingData] = useState(null);
  const [retryCycle, setRetryCycle] = useState(0);
  const updateUserRef = useRef(updateUser);
  updateUserRef.current = updateUser;
  const { theme } = useTheme();
  const primary = theme === 'dark' ? 'text-white' : 'text-zinc-900';
  const secondary = theme === 'dark' ? 'text-gray-400' : 'text-zinc-600';
  const maxAttempts = 5;

  useEffect(() => {
    if (!sessionId || !bookingId) {
      setStatus('error');
      return;
    }
    if (!user?.id) return;
    let cancelled = false;
    let timer;
    let attempts = 0;
    const confirmBookingPayment = async () => {
      attempts += 1;
      try {
        const response = await apiClient.get(
          `/bookings/payment-success?session_id=${encodeURIComponent(sessionId)}&booking_id=${encodeURIComponent(bookingId)}`
        );
        if (cancelled) return;
        if (response.data.success) {
          setStatus('success');
          setBookingData(response.data);
          forgetConfirmedCheckout(user.id, 'scheduled', sessionId);
          try {
            const profile = await apiClient.get(`/profiles/${user.id}`);
            if (!cancelled && profile.data?.credit_balance !== undefined) {
              updateUserRef.current({ credit_balance: profile.data.credit_balance });
            }
          } catch (_) { logger.warn('Could not refresh user data'); }
          return;
        }
      } catch (error) {
        if (cancelled) return;
        const code = error.response?.status;
        if (code === 409 && error.response?.data?.detail?.reconciliation_required) {
          const state = error.response.data.detail.state;
          if (state === 'refunded') forgetConfirmedCheckout(user.id, 'scheduled', sessionId);
          setStatus(['refunded', 'refund_pending'].includes(state) ? state : 'review');
          return;
        }
        if (code >= 400 && code < 500) {
          setStatus('error');
          return;
        }
      }
      if (attempts <= maxAttempts) timer = setTimeout(confirmBookingPayment, 2000);
      else setStatus('timeout');
    };
    confirmBookingPayment();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [sessionId, bookingId, user?.id, retryCycle]);

  const renderContent = () => {
    switch (status) {
      case 'checking':
        return (
          <div data-testid="booking-payment-success" className="text-center">
            <Loader2 className="w-16 h-16 text-yellow-400 animate-spin mx-auto mb-4" />
            <h2 className={`text-2xl font-bold mb-2 ${primary}`}>Confirming Your Booking...</h2>
            <p className={secondary}>Please wait while we process your payment</p>
          </div>
        );
      
      case 'refunded':
      case 'refund_pending':
      case 'review':
        return <div role="alert" className="text-center">
          <h2 className={`text-2xl font-bold mb-2 ${primary}`}>{status === 'refunded' ? 'Payment refunded' : status === 'refund_pending' ? 'Refund pending' : 'Payment needs review'}</h2>
          <p className={`mb-6 ${secondary}`}>{status === 'refunded'
            ? 'Your payment was refunded. This booking was not confirmed.'
            : status === 'refund_pending'
              ? 'Your refund is pending. This booking was not confirmed. Do not pay again.'
              : 'We could not confirm this booking. Check your bookings or contact support before paying again.'}</p>
          <Button onClick={() => navigate('/bookings?tab=scheduled')}>View Bookings</Button>
        </div>;

      case 'success':
        return (
          <div className="text-center">
            {/* Success Animation */}
            <div className="relative inline-block mb-6">
              <div className="w-24 h-24 rounded-full bg-gradient-to-r from-green-500 to-emerald-500 flex items-center justify-center animate-pulse">
                <CheckCircle className="w-12 h-12 text-white" />
              </div>
              <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-yellow-400 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-black" />
              </div>
            </div>
            
            <h2 className={`text-2xl font-bold mb-2 ${primary}`}>Session Booked!</h2>
            <p className={`mb-6 ${secondary}`}>
              Your payment was successful and your session is confirmed.
            </p>
            
            {/* Booking Details Card */}
            <div className="bg-zinc-800 rounded-xl p-6 text-left mb-6 max-w-md mx-auto">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-zinc-700 flex items-center justify-center">
                  <Camera className="w-6 h-6 text-yellow-400" />
                </div>
                <div>
                  <p className="font-semibold text-white">Session Confirmed</p>
                  <Badge className="bg-green-500/20 text-green-400 text-xs">Paid</Badge>
                </div>
              </div>
              
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2 text-gray-400">
                  <Calendar className="w-4 h-4" />
                  <span>Check your notifications for session details</span>
                </div>
                <div className="flex items-center gap-2 text-gray-400">
                  <MapPin className="w-4 h-4" />
                  <span>Head to the Impact Zone on session day</span>
                </div>
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                onClick={() => navigate(`/bookings?tab=scheduled&highlight=${bookingId}`)}
                className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold"
              >
                View My Bookings
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/feed')}
                className={`border-zinc-700 ${primary}`}
              >
                Back to Feed
              </Button>
            </div>
          </div>
        );
      
      case 'timeout':
        return (
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-12 h-12 text-amber-400" />
            </div>
            <h2 className={`text-2xl font-bold mb-2 ${primary}`}>Still Processing...</h2>
            <p className={`mb-6 ${secondary}`}>
              Your payment is being processed. This may take a moment.
            </p>
            <Button
              onClick={() => {
                setRetryCycle(value => value + 1);
                setStatus('checking');
              }}
              className="bg-yellow-500 hover:bg-yellow-600 text-black"
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
            <h2 className={`text-2xl font-bold mb-2 ${primary}`}>Something Went Wrong</h2>
            <p className={`mb-6 ${secondary}`}>
              We couldn't confirm your booking. Please check your bookings or contact support.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                onClick={() => navigate(`/bookings?tab=scheduled${bookingId ? `&highlight=${bookingId}` : ''}`)}
                className="bg-yellow-500 hover:bg-yellow-600 text-black"
              >
                View Bookings
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/messages')}
                className={`border-zinc-700 ${primary}`}
              >
                Contact Support
              </Button>
            </div>
          </div>
        );
    }
  };

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${theme === 'dark' ? 'bg-zinc-950' : theme === 'beach' ? 'bg-orange-50' : 'bg-white'}`}>
      <div className="max-w-lg w-full">
        {renderContent()}
      </div>
    </div>
  );
};

export default BookingPaymentSuccess;
