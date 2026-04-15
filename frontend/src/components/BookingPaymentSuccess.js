/**
 * Booking Payment Success Page
 * Handles Stripe payment confirmation for scheduled bookings
 */
import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { CheckCircle, Loader2, XCircle, Calendar, MapPin, Camera, Sparkles, Gift } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const BookingPaymentSuccess = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();
  
  const sessionId = searchParams.get('session_id');
  const bookingId = searchParams.get('booking_id');
  
  const [status, setStatus] = useState('checking');
  const [bookingData, setBookingData] = useState(null);
  const [pollAttempts, setPollAttempts] = useState(0);
  const maxAttempts = 5;

  useEffect(() => {
    if (!sessionId || !bookingId) {
      setStatus('error');
      return;
    }

    const confirmBookingPayment = async () => {
      try {
        const response = await axios.get(
          `${API}/bookings/payment-success?session_id=${sessionId}&booking_id=${bookingId}`
        );
        
        if (response.data.success) {
          setStatus('success');
          setBookingData(response.data);
          
          // Refresh user data to get updated credit balance
          try {
            const profileResponse = await axios.get(`${API}/profiles/${user?.id}`);
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
            setTimeout(confirmBookingPayment, 2000);
          } else {
            setStatus('timeout');
          }
        }
      } catch (error) {
        logger.error('Booking confirmation error:', error);
        
        if (pollAttempts < maxAttempts && error.response?.status !== 400) {
          setPollAttempts(prev => prev + 1);
          setTimeout(confirmBookingPayment, 2000);
        } else {
          setStatus('error');
        }
      }
    };

    confirmBookingPayment();
  }, [sessionId, bookingId, pollAttempts, user?.id, updateUser]);

  const renderContent = () => {
    switch (status) {
      case 'checking':
        return (
          <div className="text-center">
            <Loader2 className="w-16 h-16 text-yellow-400 animate-spin mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-white mb-2">Confirming Your Booking...</h2>
            <p className="text-gray-400">Please wait while we process your payment</p>
          </div>
        );
      
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
            
            <h2 className="text-2xl font-bold text-white mb-2">Session Booked!</h2>
            <p className="text-gray-400 mb-6">
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
            
            {/* XP Earned */}
            <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 mb-6 max-w-md mx-auto">
              <Gift className="w-5 h-5 text-purple-400" />
              <span className="font-medium text-white">+50 XP earned!</span>
              <Badge className="bg-purple-500/20 text-purple-400 text-xs">Passport</Badge>
            </div>
            
            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                onClick={() => navigate('/bookings?tab=scheduled')}
                className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold"
              >
                View My Bookings
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/feed')}
                className="border-zinc-700"
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
            <h2 className="text-2xl font-bold text-white mb-2">Still Processing...</h2>
            <p className="text-gray-400 mb-6">
              Your payment is being processed. This may take a moment.
            </p>
            <Button
              onClick={() => {
                setPollAttempts(0);
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
            <h2 className="text-2xl font-bold text-white mb-2">Something Went Wrong</h2>
            <p className="text-gray-400 mb-6">
              We couldn't confirm your booking. Please check your bookings or contact support.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                onClick={() => navigate('/bookings?tab=scheduled')}
                className="bg-yellow-500 hover:bg-yellow-600 text-black"
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
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="max-w-lg w-full">
        {renderContent()}
      </div>
    </div>
  );
};

export default BookingPaymentSuccess;
