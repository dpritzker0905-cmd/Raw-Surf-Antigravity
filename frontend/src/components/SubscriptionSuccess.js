import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { CheckCircle, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const SubscriptionSuccess = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { _user, updateUser } = useAuth();
  const [status, setStatus] = useState('checking'); // checking, success, error
  const [tier, setTier] = useState(null);

  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    const tierParam = searchParams.get('tier');
    
    if (sessionId) {
      checkPaymentStatus(sessionId, tierParam);
    } else {
      setStatus('error');
    }
  }, [searchParams]);

  const checkPaymentStatus = async (sessionId, tierParam) => {
    let attempts = 0;
    const maxAttempts = 10;

    const poll = async () => {
      if (attempts >= maxAttempts) {
        setStatus('error');
        toast.error('Payment verification timeout. Please contact support.');
        return;
      }

      try {
        const response = await axios.get(`${API}/subscriptions/status/${sessionId}`);
        
        if (response.data.status === 'completed') {
          setStatus('success');
          setTier(response.data.tier || tierParam);
          updateUser({ subscription_tier: response.data.tier || tierParam });
          toast.success('Subscription activated!');
        } else if (response.data.status === 'paid') {
          setStatus('success');
          setTier(tierParam);
          updateUser({ subscription_tier: tierParam });
          toast.success('Subscription activated!');
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

  const getTierDisplay = () => {
    if (!tier) return 'your subscription';
    const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
    return `${tierName} subscription`;
  };

  if (status === 'checking') {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
        <Loader2 className="w-16 h-16 text-yellow-400 animate-spin mb-6" />
        <h1 className="text-2xl font-bold text-white mb-2" style={{ fontFamily: 'Oswald' }}>
          Verifying Payment
        </h1>
        <p className="text-gray-400 text-center">
          Please wait while we confirm your subscription...
        </p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
        <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mb-6">
          <XCircle className="w-10 h-10 text-red-400" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-2" style={{ fontFamily: 'Oswald' }}>
          Something Went Wrong
        </h1>
        <p className="text-gray-400 text-center mb-8 max-w-md">
          We couldn't verify your payment. Please try again or contact support if the issue persists.
        </p>
        <div className="flex gap-4">
          <Button
            onClick={() => navigate(-1)}
            variant="outline"
            className="border-zinc-600 text-white hover:bg-zinc-800"
          >
            Go Back
          </Button>
          <Button
            onClick={() => navigate('/feed')}
            className="bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold"
          >
            Continue to Feed
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        {/* Success Animation */}
        <div className="w-24 h-24 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-6 animate-pulse">
          <CheckCircle className="w-12 h-12 text-emerald-400" />
        </div>

        {/* Title */}
        <h1 className="text-4xl font-bold text-white mb-3" style={{ fontFamily: 'Oswald' }}>
          Welcome Aboard!
        </h1>
        
        <p className="text-gray-400 text-lg mb-8">
          Your {getTierDisplay()} is now active. Let's get you in the water!
        </p>

        {/* Tier Badge */}
        {tier && (
          <div className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-400/20 via-yellow-400/20 to-orange-400/20 border border-yellow-400/30 rounded-full mb-8">
            <span className="text-white font-bold text-lg capitalize">{tier}</span>
            <span className="text-gray-400">Plan Active</span>
          </div>
        )}

        {/* Features Unlocked */}
        <div className="bg-zinc-900 rounded-xl p-6 mb-8 border border-zinc-800 text-left">
          <h3 className="text-sm text-gray-400 uppercase tracking-wider mb-4">What you've unlocked:</h3>
          <ul className="space-y-3">
            {tier === 'premium' ? (
              <>
                <li className="flex items-center gap-3 text-emerald-400">
                  <CheckCircle className="w-5 h-5" />
                  <span>Track photographers worldwide</span>
                </li>
                <li className="flex items-center gap-3 text-emerald-400">
                  <CheckCircle className="w-5 h-5" />
                  <span>20% discount on all sessions</span>
                </li>
                <li className="flex items-center gap-3 text-emerald-400">
                  <CheckCircle className="w-5 h-5" />
                  <span>Priority notifications & support</span>
                </li>
                <li className="flex items-center gap-3 text-emerald-400">
                  <CheckCircle className="w-5 h-5" />
                  <span>Verified badge eligibility</span>
                </li>
              </>
            ) : tier === 'basic' ? (
              <>
                <li className="flex items-center gap-3 text-emerald-400">
                  <CheckCircle className="w-5 h-5" />
                  <span>Track photographers within 5 miles</span>
                </li>
                <li className="flex items-center gap-3 text-emerald-400">
                  <CheckCircle className="w-5 h-5" />
                  <span>10% discount on sessions</span>
                </li>
                <li className="flex items-center gap-3 text-emerald-400">
                  <CheckCircle className="w-5 h-5" />
                  <span>Ad-free experience</span>
                </li>
                <li className="flex items-center gap-3 text-emerald-400">
                  <CheckCircle className="w-5 h-5" />
                  <span>Session notifications</span>
                </li>
              </>
            ) : (
              <>
                <li className="flex items-center gap-3 text-emerald-400">
                  <CheckCircle className="w-5 h-5" />
                  <span>Full platform access</span>
                </li>
                <li className="flex items-center gap-3 text-emerald-400">
                  <CheckCircle className="w-5 h-5" />
                  <span>Book photo sessions</span>
                </li>
                <li className="flex items-center gap-3 text-emerald-400">
                  <CheckCircle className="w-5 h-5" />
                  <span>Connect with photographers</span>
                </li>
              </>
            )}
          </ul>
        </div>

        {/* CTA */}
        <Button
          onClick={() => navigate('/feed')}
          className="w-full h-14 text-lg bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 hover:from-emerald-500 hover:via-yellow-500 hover:to-orange-500 text-black font-bold"
          data-testid="continue-to-feed"
        >
          Start Exploring
        </Button>
      </div>
    </div>
  );
};
