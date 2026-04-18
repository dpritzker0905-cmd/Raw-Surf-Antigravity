import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { toast } from 'sonner';
import { Check, X, Loader2, Calendar, MapPin, Zap, Bell, Shield } from 'lucide-react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
// Import from centralized config - SINGLE SOURCE OF TRUTH
import { SURFER_PLANS } from '../config/subscriptionPlans.config';
import logger from '../utils/logger';


// Use centralized config for subscription tiers
const SURFER_TIERS_MONTHLY = SURFER_PLANS.monthly;
const SURFER_TIERS_ANNUAL = SURFER_PLANS.annual;

export const SurferSubscription = () => {
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [selectedTier, setSelectedTier] = useState(null);
  const [billingPeriod, setBillingPeriod] = useState('monthly'); // 'monthly' or 'annual'

  const SURFER_TIERS = billingPeriod === 'monthly' ? SURFER_TIERS_MONTHLY : SURFER_TIERS_ANNUAL;

  const handleSelectTier = async (tier) => {
    setSelectedTier(tier.id);
    setLoading(true);

    try {
      if (tier.price === 0) {
        // Free tier - direct update via API
        const _response = await apiClient.post(
          `/subscriptions/checkout?user_id=${user.id}`,
          {
            tier_id: tier.id,
            origin_url: window.location.origin
          }
        );
        
        // Update local user state
        updateUser({ subscription_tier: 'free' });
        toast.success('Welcome to Raw Surf!');
        navigate('/feed');
      } else {
        // Paid tier - redirect to Stripe checkout
        const response = await apiClient.post(
          `/subscriptions/checkout?user_id=${user.id}`,
          {
            tier_id: tier.id,
            origin_url: window.location.origin
          }
        );
        
        // Redirect to Stripe
        window.location.href = response.data.checkout_url;
      }
    } catch (error) {
      logger.error('Subscription error:', error);
      toast.error(error.response?.data?.detail || 'Failed to process subscription');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black p-4 py-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <img
            src="https://customer-assets.emergentagent.com/job_raw-surf-os/artifacts/9llcl5mg_Rawig6-500x500.png"
            alt="Raw Surf"
            className="w-16 h-16 mx-auto mb-4"
          />
          <h1 className="text-4xl font-bold text-white mb-3" style={{ fontFamily: 'Oswald' }}>
            Choose Your Wave
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Unlock the full Raw Surf experience. Track live photographers, get session discounts, and never miss a moment.
          </p>
        </div>

        {/* Billing Period Toggle */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2 p-1 bg-zinc-800 rounded-full">
            <button
              onClick={() => setBillingPeriod('monthly')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                billingPeriod === 'monthly'
                  ? 'bg-yellow-400 text-black'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingPeriod('annual')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                billingPeriod === 'annual'
                  ? 'bg-yellow-400 text-black'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Calendar className="w-4 h-4" />
              Annual
              <span className="text-xs bg-emerald-500 text-white px-2 py-0.5 rounded-full">
                Save 20%
              </span>
            </button>
          </div>
        </div>

        {/* Tier Cards */}
        <div className={`grid gap-6 mb-8 ${billingPeriod === 'monthly' ? 'md:grid-cols-3' : 'md:grid-cols-2 max-w-3xl mx-auto'}`}>
          {SURFER_TIERS.map((tier) => (
            <Card
              key={tier.id}
              className={`relative overflow-hidden transition-all hover:scale-[1.02] ${
                tier.popular
                  ? 'border-2 border-yellow-400 bg-gradient-to-b from-yellow-400/10 to-zinc-900'
                  : 'border-zinc-700 bg-zinc-900'
              }`}
              data-testid={`tier-card-${tier.id}`}
            >
              {tier.badge && (
                <div className="absolute top-0 right-0 bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 text-black text-xs font-bold px-3 py-1 rounded-bl-lg">
                  {tier.badge}
                </div>
              )}
              <CardContent className="p-6">
                <div className="text-center mb-6">
                  <h3 className="text-2xl font-bold text-white mb-1" style={{ fontFamily: 'Oswald' }}>
                    {tier.name}
                  </h3>
                  <p className="text-gray-400 text-sm mb-4">{tier.description}</p>
                  <div className="flex flex-col items-center justify-center">
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-4xl font-bold text-white">
                        ${tier.price}
                      </span>
                      {tier.price > 0 && (
                        <span className="text-gray-400">/{tier.period}</span>
                      )}
                    </div>
                    {tier.monthlyEquiv && (
                      <div className="mt-2 text-sm">
                        <span className="text-gray-400 line-through">${tier.originalMonthly}/mo</span>
                        <span className="text-emerald-400 ml-2">${tier.monthlyEquiv}/mo</span>
                      </div>
                    )}
                    {tier.savings && (
                      <div className="mt-1 text-xs text-emerald-400">
                        Save {tier.savings}/year
                      </div>
                    )}
                  </div>
                </div>

                <ul className="space-y-3 mb-6">
                  {tier.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-3">
                      {feature.included ? (
                        <Check className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                          feature.highlight ? 'text-yellow-400' : 
                          feature.negative ? 'text-orange-400' : 'text-emerald-400'
                        }`} />
                      ) : (
                        <X className="w-5 h-5 flex-shrink-0 mt-0.5 text-zinc-600" />
                      )}
                      <span className={`text-sm ${
                        feature.included 
                          ? feature.highlight ? 'text-yellow-400 font-medium' : 'text-gray-300'
                          : 'text-zinc-600'
                      }`}>
                        {feature.text}
                      </span>
                    </li>
                  ))}
                </ul>

                <Button
                  onClick={() => handleSelectTier(tier)}
                  disabled={loading && selectedTier === tier.id}
                  className={`w-full min-h-[48px] font-bold ${
                    tier.popular
                      ? 'bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 hover:from-emerald-500 hover:via-yellow-500 hover:to-orange-500 text-black'
                      : 'bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-600'
                  }`}
                  data-testid={`select-tier-${tier.id}`}
                >
                  {loading && selectedTier === tier.id ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    tier.cta
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Benefits Section */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-12">
          {[
            { icon: MapPin, label: 'Live Tracking', desc: 'Find photographers near you' },
            { icon: Zap, label: 'Instant Delivery', desc: 'Get photos same day' },
            { icon: Bell, label: 'Smart Alerts', desc: 'Never miss a session' },
            { icon: Shield, label: 'Secure Payments', desc: 'Safe & protected' }
          ].map((benefit, idx) => (
            <div key={idx} className="text-center p-4">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-zinc-800 flex items-center justify-center">
                <benefit.icon className="w-6 h-6 text-yellow-400" />
              </div>
              <h4 className="font-bold text-white mb-1">{benefit.label}</h4>
              <p className="text-xs text-gray-400">{benefit.desc}</p>
            </div>
          ))}
        </div>

        {/* Skip Link */}
        <div className="text-center mt-8">
          <button
            onClick={() => handleSelectTier(SURFER_TIERS[0])}
            className="text-gray-500 hover:text-gray-300 text-sm underline"
            data-testid="skip-subscription"
          >
            Continue with Free tier
          </button>
        </div>
      </div>
    </div>
  );
};
