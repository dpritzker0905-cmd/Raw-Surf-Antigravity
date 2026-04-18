import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { toast } from 'sonner';
import { 
  Heart, 
  Camera, 
  Gift, 
  Check, 
  X, 
  Loader2,
  ArrowLeft,
  Sparkles,
  Users,
  AlertCircle
} from 'lucide-react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { HOBBYIST_PLANS } from '../config/subscriptionPlans.config';
import logger from '../utils/logger';


/**
 * Hobbyist Funnel - Shown when Photographer selects $0 plan
 * 
 * Purpose: Convert Photographers who don't want to pay into Hobbyists
 * Hobbyists:
 * - Can upload photos for free
 * - Earn Gear Credits only (not withdrawable cash)
 * - Support Groms & Causes with their earnings
 * - Have ad-supported experience
 */
export const HobbyistFunnel = ({ onBack, onComplete }) => {
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);

  const hobbyistPlans = HOBBYIST_PLANS.monthly;

  const handleSelectPlan = async (plan) => {
    setSelectedPlan(plan.id);
    setLoading(true);

    try {
      // Convert to Hobbyist role and set subscription
      const response = await axios.post(
        `${API}/auth/convert-to-hobbyist?user_id=${user.id}`,
        {
          tier_id: plan.tier_id,
          origin_url: window.location.origin
        }
      );

      if (response.data.checkout_url) {
        // Paid tier - redirect to Stripe
        window.location.href = response.data.checkout_url;
      } else {
        // Free tier - update user and redirect
        updateUser({
          ...user,
          role: 'Hobbyist',
          subscription_tier: 'free',
          is_ad_supported: true
        });
        
        toast.success('Welcome to the Hobbyist community!');
        
        if (onComplete) {
          onComplete();
        } else {
          navigate('/feed');
        }
      }
    } catch (error) {
      logger.error('Hobbyist conversion error:', error);
      toast.error(error.response?.data?.detail || 'Failed to process. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black p-4 py-8">
      <div className="max-w-2xl mx-auto">
        {/* Back Button */}
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Photographer Plans
          </button>
        )}

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center">
            <Heart className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-3" style={{ fontFamily: 'Oswald' }}>
            Join as a Hobbyist
          </h1>
          <p className="text-gray-400 text-lg max-w-xl mx-auto">
            Share your surf photography for free and support the community. 
            Your earnings go to Gear Credits that help young surfers.
          </p>
        </div>

        {/* Info Banner */}
        <div className="bg-gradient-to-r from-orange-500/20 to-pink-500/20 border border-orange-400/30 rounded-xl p-4 mb-8">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-white font-medium mb-1">What's a Hobbyist?</h3>
              <p className="text-gray-300 text-sm">
                Hobbyists are passionate photographers who contribute to the surf community 
                without commercial goals. Your photo earnings become <span className="text-orange-400 font-medium">Gear Credits</span> that 
                can be used to buy surf gear or donated to support young surfers (Groms).
              </p>
            </div>
          </div>
        </div>

        {/* Comparison: Hobbyist vs Photographer */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
            <div className="flex items-center gap-2 mb-3">
              <Heart className="w-5 h-5 text-orange-400" />
              <h3 className="text-white font-medium">Hobbyist</h3>
              <span className="ml-auto text-emerald-400 text-sm font-bold">FREE</span>
            </div>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2 text-gray-300">
                <Check className="w-4 h-4 text-emerald-400" />
                Upload & share photos
              </li>
              <li className="flex items-center gap-2 text-gray-300">
                <Check className="w-4 h-4 text-emerald-400" />
                Earn Gear Credits
              </li>
              <li className="flex items-center gap-2 text-gray-300">
                <Check className="w-4 h-4 text-emerald-400" />
                Support Groms & Causes
              </li>
              <li className="flex items-center gap-2 text-gray-400">
                <X className="w-4 h-4 text-zinc-600" />
                Bank withdrawals
              </li>
              <li className="flex items-center gap-2 text-gray-400">
                <X className="w-4 h-4 text-zinc-600" />
                Priority placement
              </li>
            </ul>
          </div>
          
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
            <div className="flex items-center gap-2 mb-3">
              <Camera className="w-5 h-5 text-purple-400" />
              <h3 className="text-white font-medium">Photographer</h3>
              <span className="ml-auto text-yellow-400 text-sm font-bold">$18+/mo</span>
            </div>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2 text-gray-300">
                <Check className="w-4 h-4 text-emerald-400" />
                Everything in Hobbyist
              </li>
              <li className="flex items-center gap-2 text-gray-300">
                <Check className="w-4 h-4 text-emerald-400" />
                Withdrawable earnings
              </li>
              <li className="flex items-center gap-2 text-gray-300">
                <Check className="w-4 h-4 text-emerald-400" />
                Priority in search results
              </li>
              <li className="flex items-center gap-2 text-gray-300">
                <Check className="w-4 h-4 text-emerald-400" />
                AI tagging credits
              </li>
              <li className="flex items-center gap-2 text-gray-300">
                <Check className="w-4 h-4 text-emerald-400" />
                Lower platform fee
              </li>
            </ul>
          </div>
        </div>

        {/* Hobbyist Plans */}
        <h2 className="text-xl font-bold text-white mb-4" style={{ fontFamily: 'Oswald' }}>
          Choose Your Hobbyist Plan
        </h2>
        
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          {hobbyistPlans.map((plan) => {
            const Icon = plan.icon;
            return (
              <Card
                key={plan.id}
                className={`relative overflow-hidden transition-all hover:scale-[1.02] cursor-pointer ${
                  plan.popular
                    ? 'border-2 border-orange-400 bg-gradient-to-b from-orange-400/10 to-zinc-900'
                    : 'border-zinc-700 bg-zinc-900'
                }`}
                onClick={() => !loading && handleSelectPlan(plan)}
                data-testid={`hobbyist-plan-${plan.id}`}
              >
                {plan.badge && (
                  <div className="absolute top-0 right-0 bg-gradient-to-r from-orange-400 to-pink-400 text-black text-xs font-bold px-3 py-1 rounded-bl-lg">
                    {plan.badge}
                  </div>
                )}
                <CardContent className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${plan.bgColor}`}>
                      <Icon className={`w-5 h-5 ${plan.iconColor}`} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                      <p className="text-gray-400 text-sm">{plan.description}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-baseline gap-1 mb-4">
                    <span className="text-3xl font-bold text-white">${plan.price}</span>
                    <span className="text-gray-400">/{plan.period}</span>
                  </div>

                  <ul className="space-y-2 mb-4">
                    {plan.features.slice(0, 4).map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        {feature.included ? (
                          <Check className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                            feature.highlight ? 'text-orange-400' : 
                            feature.negative ? 'text-yellow-500' : 'text-emerald-400'
                          }`} />
                        ) : (
                          <X className="w-4 h-4 flex-shrink-0 mt-0.5 text-zinc-600" />
                        )}
                        <span className={`text-sm ${
                          feature.included 
                            ? feature.highlight ? 'text-orange-400' :
                              feature.negative ? 'text-yellow-500' : 'text-gray-300'
                            : 'text-zinc-600'
                        }`}>
                          {feature.text}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    disabled={loading && selectedPlan === plan.id}
                    className={`w-full ${
                      plan.popular
                        ? 'bg-gradient-to-r from-orange-400 to-pink-400 hover:from-orange-500 hover:to-pink-500 text-black'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-white'
                    }`}
                  >
                    {loading && selectedPlan === plan.id ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      plan.cta
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Benefits */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="text-center p-4 bg-zinc-900 rounded-xl">
            <Gift className="w-8 h-8 text-orange-400 mx-auto mb-2" />
            <h4 className="text-white font-medium text-sm">Gear Credits</h4>
            <p className="text-gray-400 text-xs">Earn credits for surf gear</p>
          </div>
          <div className="text-center p-4 bg-zinc-900 rounded-xl">
            <Users className="w-8 h-8 text-pink-400 mx-auto mb-2" />
            <h4 className="text-white font-medium text-sm">Support Groms</h4>
            <p className="text-gray-400 text-xs">Help young surfers grow</p>
          </div>
          <div className="text-center p-4 bg-zinc-900 rounded-xl">
            <Sparkles className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
            <h4 className="text-white font-medium text-sm">Community</h4>
            <p className="text-gray-400 text-xs">Join passionate creators</p>
          </div>
        </div>

        {/* Back to Pro Option */}
        <div className="text-center">
          <p className="text-gray-400 text-sm mb-3">
            Want to earn real money from your photos?
          </p>
          <Button
            variant="outline"
            onClick={onBack}
            className="border-purple-500/50 text-purple-400 hover:bg-purple-500/10"
          >
            <Camera className="w-4 h-4 mr-2" />
            View Photographer Plans ($18+/mo)
          </Button>
        </div>
      </div>
    </div>
  );
};

export default HobbyistFunnel;
