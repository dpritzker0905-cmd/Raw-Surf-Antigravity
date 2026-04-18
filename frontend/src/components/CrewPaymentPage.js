import React, { useState, useEffect, useCallback } from 'react';

import { useParams, useNavigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';

import { useTheme } from '../contexts/ThemeContext';

import apiClient, { BACKEND_URL } from '../lib/apiClient';

import { 

  DollarSign, Clock, MapPin, Users, Check, 
  Loader2, ArrowLeft, CreditCard, Wallet, Timer,
  AlertCircle, Crown, Camera, CalendarCheck, MessageCircle
} from 'lucide-react';
import { Button } from './ui/button';

import { Card, CardHeader, CardTitle, CardContent } from './ui/card';

import { Progress } from './ui/progress';

import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';

import { toast } from 'sonner';

import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';


const API = process.env.REACT_APP_BACKEND_URL;

/**
 * CrewPaymentPage - Deep link destination for crew payment notifications
 * Accessed via /bookings/pay/:bookingId
 * 
 * Shows:
 * - Booking details (location, time, photographer)
 * - Captain info
 * - User's share amount
 * - Payment countdown timer
 * - Pay now button
 */

const CrewPaymentPage = () => {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [_paymentMethod, _setPaymentMethod] = useState('credits');
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [myShare, setMyShare] = useState(null);
  const [captain, setCaptain] = useState(null);

  const fetchBookingDetails = useCallback(async () => {
    try {
      const response = await apiClient.get(`/bookings/${bookingId}/crew-payment-details?user_id=${user.id}`);
      setBooking(response.data.booking);
      setMyShare(response.data.my_share);
      setCaptain(response.data.captain);
    } catch (error) {
      logger.error('Failed to fetch booking:', error);
      toast.error('Failed to load booking details');
      navigate('/bookings');
    } finally {
      setLoading(false);
    }
  }, [bookingId, user?.id, navigate]);

  useEffect(() => {
    if (user?.id && bookingId) {
      fetchBookingDetails();
    }
  }, [user?.id, bookingId, fetchBookingDetails]);

  // Payment window countdown
  useEffect(() => {
    if (!booking?.payment_window_expires_at) return;
    
    const updateTimer = () => {
      const now = new Date();
      const expires = new Date(booking.payment_window_expires_at);
      const diff = expires - now;
      
      if (diff <= 0) {
        setTimeRemaining({ expired: true });
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        setTimeRemaining({ hours, minutes, seconds, expired: false });
      }
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [booking?.payment_window_expires_at]);

  const handlePayWithCredits = async () => {
    if (!myShare || myShare.payment_status === 'Paid') {
      toast.info('Already paid!');
      return;
    }
    
    if ((user?.credit_balance || 0) < myShare.share_amount) {
      toast.error(`Insufficient credits. You need $${myShare.share_amount.toFixed(2)} but have $${(user?.credit_balance || 0).toFixed(2)}`);
      return;
    }
    
    setPaying(true);
    try {
      const response = await apiClient.post(
        `/bookings/${bookingId}/crew-pay`,
        {
          participant_id: user.id,
          amount: myShare.share_amount,
          payment_method: 'credits'
        }
      );
      
      // Update user balance
      updateUser({ credit_balance: response.data.new_balance });
      
      toast.success('Payment successful! You\'re in the crew.');
      
      // Refresh the page data
      fetchBookingDetails();
    } catch (error) {
      logger.error('Payment failed:', error);
      toast.error(error.response?.data?.detail || 'Payment failed');
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="p-4 text-center">
        <p className={isLight ? 'text-gray-600' : 'text-gray-400'}>Booking not found</p>
        <Button onClick={() => navigate('/bookings')} className="mt-4">
          Go to Bookings
        </Button>
      </div>
    );
  }

  const isPaid = myShare?.payment_status === 'Paid';
  const isExpired = timeRemaining?.expired;

  return (
    <div className="max-w-lg mx-auto p-4 space-y-6" data-testid="crew-payment-page">
      {/* Back Button */}
      <button
        onClick={() => navigate('/bookings')}
        className={`flex items-center gap-2 ${isLight ? 'text-gray-600' : 'text-gray-400'} hover:text-white transition-colors`}
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Bookings
      </button>

      {/* Header */}
      <div className="text-center">
        <h1 className={`text-2xl font-bold ${isLight ? 'text-gray-900' : 'text-white'}`} style={{ fontFamily: 'Oswald' }}>
          Crew Payment
        </h1>
        <p className={`${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
          {isPaid ? 'You\'re all set!' : 'Complete your payment to join'}
        </p>
      </div>

      {/* Payment Window Timer */}
      {!isPaid && !isExpired && timeRemaining && (
        <Card className={`${isLight ? 'bg-amber-50 border-amber-200' : 'bg-amber-500/10 border-amber-500/30'}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Timer className="w-5 h-5 text-amber-500" />
                <span className={isLight ? 'text-amber-700' : 'text-amber-400'}>
                  {booking.booking_type === 'on_demand' ? '60-minute window' : '24-hour window'}
                </span>
              </div>
              <div className={`text-xl font-bold font-mono ${isLight ? 'text-amber-600' : 'text-amber-400'}`}>
                {String(timeRemaining.hours).padStart(2, '0')}:
                {String(timeRemaining.minutes).padStart(2, '0')}:
                {String(timeRemaining.seconds).padStart(2, '0')}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Expired Warning */}
      {isExpired && !isPaid && (
        <Card className={`${isLight ? 'bg-red-50 border-red-200' : 'bg-red-500/10 border-red-500/30'}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <span className={isLight ? 'text-red-700' : 'text-red-400'}>
                Payment window expired. Contact the Captain.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Captain Info */}
      {captain && (
        <Card className={isLight ? 'bg-white border-gray-200' : 'bg-zinc-900 border-zinc-800'}>
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="relative">
                <Avatar className="w-14 h-14 border-2 border-yellow-400">
                  <AvatarImage src={getFullUrl(captain.avatar_url)} />
                  <AvatarFallback className="bg-yellow-400/20 text-yellow-400">
                    {captain.full_name?.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <Crown className="absolute -top-1 -right-1 w-5 h-5 text-yellow-400 fill-yellow-400" />
              </div>
              <div>
                <p className={`font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>
                  {captain.full_name}
                </p>
                <p className={`text-sm ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                  Captain
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Session Details */}
      <Card className={isLight ? 'bg-white border-gray-200' : 'bg-zinc-900 border-zinc-800'}>
        <CardHeader>
          <CardTitle className={`text-lg flex items-center gap-2 ${isLight ? 'text-gray-900' : 'text-white'}`}>
            <Camera className="w-5 h-5 text-cyan-400" />
            Session Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <MapPin className="w-4 h-4 text-gray-400" />
            <span className={isLight ? 'text-gray-700' : 'text-gray-300'}>{booking.location}</span>
          </div>
          <div className="flex items-center gap-3">
            <CalendarCheck className="w-4 h-4 text-gray-400" />
            <span className={isLight ? 'text-gray-700' : 'text-gray-300'}>
              {new Date(booking.session_date).toLocaleDateString()} at {new Date(booking.session_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-gray-400" />
            <span className={isLight ? 'text-gray-700' : 'text-gray-300'}>{booking.duration} minutes</span>
          </div>
          <div className="flex items-center gap-3">
            <Users className="w-4 h-4 text-gray-400" />
            <span className={isLight ? 'text-gray-700' : 'text-gray-300'}>
              {booking.participant_count || 1} crew member{(booking.participant_count || 1) > 1 ? 's' : ''}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Your Share */}
      <Card className={`${isPaid ? 
        (isLight ? 'bg-green-50 border-green-200' : 'bg-green-500/10 border-green-500/30') :
        (isLight ? 'bg-gradient-to-br from-cyan-50 to-blue-50 border-cyan-200' : 'bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-cyan-500/30')
      }`}>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <DollarSign className={`w-6 h-6 ${isPaid ? 'text-green-500' : 'text-cyan-400'}`} />
              <span className={`text-lg font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>
                Your Share
              </span>
            </div>
            <span className={`text-3xl font-bold ${isPaid ? 'text-green-500' : 'text-cyan-400'}`}>
              ${myShare?.share_amount?.toFixed(2) || '0.00'}
            </span>
          </div>
          
          {isPaid ? (
            <div className="flex items-center justify-center gap-2 py-4">
              <Check className="w-6 h-6 text-green-500" />
              <span className={`text-lg font-medium ${isLight ? 'text-green-700' : 'text-green-400'}`}>
                Payment Complete!
              </span>
            </div>
          ) : (
            <>
              {/* Credit Balance */}
              <div className={`flex items-center justify-between p-3 rounded-lg mb-4 ${isLight ? 'bg-white' : 'bg-zinc-900/50'}`}>
                <span className={isLight ? 'text-gray-600' : 'text-gray-400'}>Your Balance:</span>
                <span className={`font-bold ${(user?.credit_balance || 0) >= (myShare?.share_amount || 0) ? 'text-green-500' : 'text-red-500'}`}>
                  ${(user?.credit_balance || 0).toFixed(2)}
                </span>
              </div>

              {/* Pay Button */}
              <Button
                onClick={handlePayWithCredits}
                disabled={paying || isExpired || (user?.credit_balance || 0) < (myShare?.share_amount || 0)}
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white font-bold py-6 text-lg"
                data-testid="pay-crew-share-btn"
              >
                {paying ? (
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                ) : (
                  <Wallet className="w-5 h-5 mr-2" />
                )}
                Pay ${myShare?.share_amount?.toFixed(2)} with Credits
              </Button>
              
              {(user?.credit_balance || 0) < (myShare?.share_amount || 0) && (
                <div className="mt-3 text-center">
                  <Button
                    variant="outline"
                    onClick={() => navigate('/credits')}
                    className={isLight ? 'border-gray-300 text-gray-600' : 'border-zinc-600 text-gray-400'}
                  >
                    <CreditCard className="w-4 h-4 mr-2" />
                    Add Credits
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Session Progress */}
      {booking.payment_progress !== undefined && (
        <Card className={isLight ? 'bg-white border-gray-200' : 'bg-zinc-900 border-zinc-800'}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className={isLight ? 'text-gray-600' : 'text-gray-400'}>Session Payment Progress</span>
              <span className={isLight ? 'text-gray-900' : 'text-white'}>
                {booking.paid_count}/{booking.participant_count} paid
              </span>
            </div>
            <Progress value={booking.payment_progress} className="h-2" />
            {booking.payment_progress === 100 && (
              <p className="text-green-500 text-sm mt-2 flex items-center gap-1">
                <Check className="w-4 h-4" />
                All crew paid - session confirmed!
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Crew Chat Button */}
      <Button
        onClick={() => navigate(`/bookings/${bookingId}/chat`)}
        variant="outline"
        className={`w-full flex items-center justify-center gap-2 ${isLight ? 'border-cyan-500 text-cyan-600 hover:bg-cyan-50' : 'border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10'}`}
        data-testid="crew-payment-chat-btn"
      >
        <MessageCircle className="w-5 h-5" />
        Chat with Crew
      </Button>
    </div>
  );
};

export default CrewPaymentPage;
