import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import axios from 'axios';
import { DollarSign, CreditCard, CheckCircle, Coins, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { toast } from 'sonner';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const Credits = () => {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [amount, setAmount] = useState(25);
  const [loading, setLoading] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState(false);
  const [creditsAdded, setCreditsAdded] = useState(0);
  
  // Get return info from location state or localStorage
  const returnTo = location.state?.returnTo || localStorage.getItem('credits_return_to');
  const returnReason = location.state?.reason || localStorage.getItem('credits_return_reason');
  const openCrewInvite = location.state?.openCrewInvite || localStorage.getItem('credits_open_crew_invite') === 'true';
  const dispatchId = location.state?.dispatchId || localStorage.getItem('credits_dispatch_id');
  
  // Store return info when coming from another page
  useEffect(() => {
    if (location.state?.returnTo) {
      localStorage.setItem('credits_return_to', location.state.returnTo);
      localStorage.setItem('credits_return_reason', location.state.reason || '');
    }
    if (location.state?.openCrewInvite) {
      localStorage.setItem('credits_open_crew_invite', 'true');
      localStorage.setItem('credits_dispatch_id', location.state.dispatchId || '');
    }
    if (location.state?.requiredAmount) {
      setAmount(Math.ceil(location.state.requiredAmount));
    }
  }, [location.state]);

  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    if (sessionId) {
      checkPaymentStatus(sessionId);
    }
  }, [searchParams]);

  const checkPaymentStatus = async (sessionId) => {
    setCheckingStatus(true);
    let attempts = 0;
    const maxAttempts = 10;

    const poll = async () => {
      if (attempts >= maxAttempts) {
        toast.error('Payment verification timeout. Please contact support.');
        setCheckingStatus(false);
        return;
      }

      try {
        const response = await axios.get(`${API}/credits/status/${sessionId}`);
        if (response.data.status === 'completed') {
          setPurchaseSuccess(true);
          setCreditsAdded(response.data.credits_added || 0);
          updateUser({ credit_balance: response.data.new_balance });
          toast.success(`${response.data.credits_added} credits added to your account!`);
          setCheckingStatus(false);
        } else if (response.data.status === 'paid') {
          setPurchaseSuccess(true);
          setCheckingStatus(false);
        } else {
          attempts++;
          setTimeout(poll, 2000);
        }
      } catch (error) {
        logger.error('Error checking status:', error);
        attempts++;
        setTimeout(poll, 2000);
      }
    };

    poll();
  };

  const handlePurchase = async () => {
    if (!user) {
      toast.error('Please log in to purchase credits');
      return;
    }

    if (amount < 1) {
      toast.error('Minimum purchase is 1 credit ($1)');
      return;
    }

    setLoading(true);

    try {
      const originUrl = window.location.origin;
      const response = await axios.post(`${API}/credits/purchase?user_id=${user.id}`, {
        amount: parseFloat(amount),
        origin_url: originUrl
      });

      window.location.href = response.data.checkout_url;
    } catch (error) {
      logger.error('Error creating checkout:', error);
      toast.error(error.response?.data?.detail || 'Failed to create checkout session');
      setLoading(false);
    }
  };

  // Payment verification screen
  if (checkingStatus) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
        <Loader2 className="w-12 h-12 text-yellow-400 animate-spin mb-4" />
        <h2 className="text-xl font-bold text-white mb-2" style={{ fontFamily: 'Oswald' }}>
          Verifying Payment
        </h2>
        <p className="text-gray-400">Please wait while we confirm your purchase...</p>
      </div>
    );
  }

  // Handle navigation after success
  const handleSuccessNavigate = () => {
    // Clear stored return info
    const savedOpenCrewInvite = localStorage.getItem('credits_open_crew_invite') === 'true';
    const savedDispatchId = localStorage.getItem('credits_dispatch_id');
    
    localStorage.removeItem('credits_return_to');
    localStorage.removeItem('credits_return_reason');
    localStorage.removeItem('credits_open_crew_invite');
    localStorage.removeItem('credits_dispatch_id');
    
    if (returnTo) {
      // Pass state to re-open crew payment modal if needed
      if (openCrewInvite || savedOpenCrewInvite) {
        navigate(returnTo, { 
          state: { 
            openCrewInvite: true, 
            dispatchId: dispatchId || savedDispatchId 
          } 
        });
      } else {
        navigate(returnTo);
      }
    } else {
      navigate('/feed');
    }
  };

  // Success screen
  if (purchaseSuccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
        <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mb-6">
          <CheckCircle className="w-10 h-10 text-emerald-400" />
        </div>
        <h2 className="text-3xl font-bold text-white mb-2" style={{ fontFamily: 'Oswald' }}>
          Purchase Complete!
        </h2>
        <p className="text-gray-400 mb-6">
          {creditsAdded > 0 ? `${creditsAdded} credits have been added to your account` : 'Your credits have been added'}
        </p>
        <div className="bg-zinc-800 rounded-xl p-6 mb-6">
          <div className="text-gray-400 text-sm mb-1">New Balance</div>
          <div className="text-4xl font-bold text-yellow-400">${(user?.credit_balance || 0).toFixed(2)}</div>
        </div>
        <Button
          onClick={handleSuccessNavigate}
          className="bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold"
        >
          {returnReason === 'crew_session_payment' ? 'Complete Your Booking' : 'Back to Feed'}
        </Button>
      </div>
    );
  }

  const packages = [
    { amount: 10, bonus: 0 },
    { amount: 25, bonus: 0 },
    { amount: 50, bonus: 5 },
    { amount: 100, bonus: 15 },
  ];

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto" data-testid="credits-page">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-r from-yellow-400 to-orange-400 flex items-center justify-center">
          <Coins className="w-8 h-8 text-black" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-2" style={{ fontFamily: 'Oswald' }}>
          Buy Credits
        </h1>
        <p className="text-gray-400">1 Credit = $1 USD • Use for sessions, tips, and more</p>
      </div>

      {/* Current Balance */}
      <div className="bg-zinc-900 rounded-xl p-6 mb-6 border border-zinc-800">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-gray-400 text-sm">Current Balance</div>
            <div className="text-3xl font-bold text-white">${(user?.credit_balance || 0).toFixed(2)}</div>
          </div>
          <div className="w-12 h-12 rounded-full bg-yellow-400/20 flex items-center justify-center">
            <DollarSign className="w-6 h-6 text-yellow-400" />
          </div>
        </div>
      </div>

      {/* Quick Packages */}
      <div className="mb-6">
        <h3 className="text-lg font-bold text-white mb-4" style={{ fontFamily: 'Oswald' }}>
          Quick Packages
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {packages.map((pkg) => (
            <button
              key={pkg.amount}
              onClick={() => setAmount(pkg.amount)}
              className={`relative p-4 rounded-xl border-2 transition-all ${
                amount === pkg.amount
                  ? 'border-yellow-400 bg-yellow-400/10'
                  : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
              }`}
              data-testid={`package-${pkg.amount}`}
            >
              {pkg.bonus > 0 && (
                <div className="absolute -top-2 -right-2 px-2 py-0.5 bg-emerald-500 rounded-full text-xs font-bold text-white">
                  +{pkg.bonus} FREE
                </div>
              )}
              <div className="text-2xl font-bold text-white">${pkg.amount}</div>
              <div className="text-sm text-gray-400">
                {pkg.amount} credits{pkg.bonus > 0 ? ` + ${pkg.bonus} bonus` : ''}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Custom Amount */}
      <div className="bg-zinc-900 rounded-xl p-4 mb-6 border border-zinc-800">
        <h3 className="text-sm font-medium text-gray-400 mb-3">Custom Amount</h3>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
            <Input
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value) || 1))}
              className="pl-8 bg-zinc-800 border-zinc-700 text-white h-12"
              data-testid="custom-amount-input"
            />
          </div>
        </div>
      </div>

      {/* Purchase Button */}
      <Button
        onClick={handlePurchase}
        disabled={loading || amount < 1}
        className="w-full h-14 text-lg bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 hover:from-emerald-500 hover:via-yellow-500 hover:to-orange-500 text-black font-bold"
        data-testid="purchase-credits-button"
      >
        {loading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <>
            <CreditCard className="w-5 h-5 mr-2" />
            Purchase {amount} Credits for ${amount}
          </>
        )}
      </Button>

      {/* Footer */}
      <p className="text-center text-gray-500 text-sm mt-4">
        Secure payment powered by Stripe
      </p>
    </div>
  );
};
