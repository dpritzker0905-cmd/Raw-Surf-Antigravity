import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { toast } from 'sonner';
import { Check, X, Loader2, Calendar, Camera, Globe, Tag, Gift, Percent, Heart } from 'lucide-react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
// Import from centralized config - SINGLE SOURCE OF TRUTH
import { PHOTOGRAPHER_PLANS, VERIFIED_PRO_PLANS } from '../config/subscriptionPlans.config';
import { HobbyistFunnel } from './HobbyistFunnel';
import logger from '../utils/logger';


export const PhotographerSubscription = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, _updateUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [selectedTier, setSelectedTier] = useState(null);
  const [billingPeriod, setBillingPeriod] = useState('monthly');
  const [showHobbyistFunnel, setShowHobbyistFunnel] = useState(false);
  
  // Determine if this is a Verified Pro user based on location state or user role
  const isVerifiedPro = location.state?.userType === 'verified_pro' || 
                        user?.role === 'Approved Pro' || 
                        user?.role === 'approved_pro';
  
  // Use appropriate plans based on user type
  const PLANS = isVerifiedPro ? VERIFIED_PRO_PLANS : PHOTOGRAPHER_PLANS;
  const PHOTOGRAPHER_TIERS = billingPeriod === 'monthly' ? PLANS.monthly : PLANS.annual;

  const handleSelectTier = async (tier) => {
    setSelectedTier(tier.id);
    setLoading(true);

    try {
      // Redirect to Stripe checkout
      const response = await apiClient.post(
        `/subscriptions/checkout?user_id=${user.id}`,
        {
          tier_id: tier.id,
          origin_url: window.location.origin
        }
      );
      
      // Redirect to Stripe
      window.location.href = response.data.checkout_url;
    } catch (error) {
      logger.error('Subscription error:', error);
      toast.error(error.response?.data?.detail || 'Failed to process subscription');
      setLoading(false);
    }
  };

  const handleHobbyistComplete = () => {
    navigate('/feed');
  };

  // Show Hobbyist Funnel if user selected $0 option
  if (showHobbyistFunnel) {
    return (
      <HobbyistFunnel 
        onBack={() => setShowHobbyistFunnel(false)}
        onComplete={handleHobbyistComplete}
      />
    );
  }

  return (
    <div className="min-h-screen bg-black p-4 py-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <img
            src="https://customer-assets.emergentagent.com/job_raw-surf-os/artifacts/9llcl5mg_Rawig6-500x500.png"
            alt="Raw Surf"
            className="w-16 h-16 mx-auto mb-4"
          />
          <h1 className="text-4xl font-bold text-white mb-3" style={{ fontFamily: 'Oswald' }}>
            {isVerifiedPro ? 'Verified Pro Plans' : 'Start Earning'}
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            {isVerifiedPro 
              ? 'Choose your Verified Pro subscription. Enjoy lower commissions, verified badge, and priority placement.'
              : 'Turn your surf photography into income. Set your prices, reach more surfers, and keep more of what you earn.'
            }
          </p>
        </div>

        {/* Commission Comparison Banner */}
        <div className="bg-gradient-to-r from-emerald-500/20 via-yellow-500/20 to-orange-500/20 border border-yellow-400/30 rounded-xl p-4 mb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Percent className="w-5 h-5 text-yellow-400" />
            <span className="text-white font-bold">Lower Commission = More Money</span>
          </div>
          <p className="text-gray-300 text-sm">
            {isVerifiedPro 
              ? <>Premium Verified Pros keep <span className="text-yellow-400 font-bold">90%</span> of every sale vs Basic's 88%</>
              : <>Premium photographers keep <span className="text-yellow-400 font-bold">85%</span> of every sale vs Basic's 80%</>
            }
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
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {PHOTOGRAPHER_TIERS.map((tier) => (
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
                    <div className="flex items-baseline justify-center gap-1 mb-2">
                      <span className="text-4xl font-bold text-white">
                        ${tier.price}
                      </span>
                      <span className="text-gray-400">/{tier.period}</span>
                    </div>
                    {tier.monthlyEquiv && (
                      <div className="text-sm">
                        <span className="text-gray-400 line-through">${tier.originalMonthly}/mo</span>
                        <span className="text-emerald-400 ml-2">${tier.monthlyEquiv}/mo</span>
                      </div>
                    )}
                    {tier.savings && (
                      <p className="text-emerald-400 text-sm font-medium mt-1">Save {tier.savings}/year</p>
                    )}
                  </div>
                  <div className="mt-3 inline-flex items-center gap-2 bg-zinc-800 px-3 py-1 rounded-full">
                    <span className="text-sm text-gray-400">Platform fee:</span>
                    <span className={`font-bold ${tier.popular ? 'text-yellow-400' : 'text-white'}`}>
                      {tier.commission}
                    </span>
                  </div>
                </div>

                <ul className="space-y-3 mb-6">
                  {tier.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-3">
                      {feature.included ? (
                        <Check className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                          feature.highlight ? 'text-yellow-400' : 'text-emerald-400'
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

        {/* Hobbyist Funnel Option - Free Contribution */}
        <div className="bg-gradient-to-r from-orange-500/10 to-pink-500/10 border border-orange-400/30 rounded-xl p-6 mb-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center flex-shrink-0">
                <Heart className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">Just Want to Contribute?</h3>
                <p className="text-gray-400 text-sm">
                  Join as a Hobbyist - share photos for free and earn Gear Credits to support young surfers.
                </p>
              </div>
            </div>
            <Button
              onClick={() => setShowHobbyistFunnel(true)}
              variant="outline"
              className="border-orange-400/50 text-orange-400 hover:bg-orange-500/10 whitespace-nowrap"
              data-testid="hobbyist-option-btn"
            >
              <Heart className="w-4 h-4 mr-2" />
              Start Free as Hobbyist
            </Button>
          </div>
        </div>

        {/* Benefits Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-12">
          {[
            { icon: Camera, label: 'Unlimited Storage', desc: 'Upload all your shots' },
            { icon: Globe, label: 'Global Reach', desc: 'Connect with surfers anywhere' },
            { icon: Tag, label: 'Set Your Prices', desc: 'You control your rates' },
            { icon: Gift, label: 'AI Tools', desc: 'Enhance & tag automatically' }
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

        {/* FAQ Note */}
        <div className="text-center mt-12 p-6 bg-zinc-900 rounded-xl border border-zinc-800">
          <h3 className="text-lg font-bold text-white mb-2">How does commission work?</h3>
          <p className="text-gray-400 text-sm">
            When a surfer purchases your photos or joins your session, Raw Surf takes a small platform fee. 
            Premium photographers keep <span className="text-yellow-400">85%</span> of every sale, 
            while Basic keeps <span className="text-white">80%</span>. The rest covers payment processing, 
            storage, and platform maintenance.
          </p>
        </div>
      </div>
    </div>
  );
};
