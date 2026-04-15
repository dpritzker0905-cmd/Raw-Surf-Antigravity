/**
 * Subscription Plans Configuration - SINGLE SOURCE OF TRUTH
 * 
 * This file defines ALL subscription tiers for the entire application.
 * Both Signup flows AND Settings > Account & Billing MUST use this config.
 * 
 * DO NOT define subscription tiers anywhere else in the codebase.
 * Any change here automatically syncs to both Signup and Settings.
 * 
 * STOKED CREDIT CONVERSION: 1 Credit = $1.00 USD (1:1 RATIO)
 * A $20 subscription costs exactly 20 Stoked Credits.
 * 
 * USER TYPE BREAKDOWN:
 * =====================
 * SURFERS (buy photos, don't sell):
 *   - Free: Basic access, 5GB storage, ads
 *   - Basic ($5/mo): Ad-free, discounts on sessions, 50GB storage
 *   - Premium ($10/mo): Gold-Pass priority booking, unlimited storage, biggest discounts
 * 
 * GROMS (young surfers, parent-managed):
 *   - Free: Basic profile, parent oversight
 *   - Basic ($3/mo): Ad-free, competition tracking
 *   - Premium ($8/mo): Featured placement, sponsor visibility
 * 
 * PHOTOGRAPHERS (sell photos, pay commission):
 *   - Basic ($18/mo): Start selling, 20% commission
 *   - Premium ($30/mo): Lower 15% commission, AI credits, priority placement
 * 
 * HOBBYISTS (contribute photos, don't cash out):
 *   - Free: Contribute for Gear Credits only
 *   - Basic ($5/mo): Ad-free contribution
 * 
 * GROM PARENTS (book for kids + optionally surf themselves):
 *   - Free: Manage grom accounts
 *   - Basic ($5/mo): Ad-free
 *   - Premium ($10/mo): Surfer Hybrid - can book for themselves too
 * 
 * BUSINESSES (schools, shops, shapers, resorts):
 *   - Custom pricing, contact for enterprise
 */

import { Shield, Zap, Crown, Camera, Sparkles } from 'lucide-react';

// Stoked Credit conversion rate - SIMPLIFIED 1:1 RATIO
export const CREDIT_TO_USD_RATE = 1; // 1 credit = $1.00

// ============================================================
// SURFER SUBSCRIPTION PLANS
// ============================================================

export const SURFER_PLANS = {
  monthly: [
    {
      id: 'surfer_free',
      tier_id: 'tier_1',  // Maps to backend SUBSCRIPTION_TIERS
      name: 'Free',
      price: 0,
      period: 'forever',
      description: 'Get started with the basics',
      icon: Shield,
      iconColor: 'text-gray-400',
      bgColor: 'bg-gray-500/20',
      storage_gb: 5,
      gold_pass: false,
      features: [
        { text: 'Profile & social features', included: true },
        { text: 'Book photo sessions', included: true },
        { text: 'Find photographers within 1 mile', included: true, highlight: true },
        { text: '5GB photo storage', included: true },
        { text: 'Ads supported', included: true, negative: true },
        { text: 'Session discounts', included: false },
        { text: 'Priority notifications', included: false },
        { text: 'Gold-Pass priority booking', included: false }
      ],
      cta: 'Start Free',
      popular: false
    },
    {
      id: 'surfer_basic',
      tier_id: 'tier_2',
      name: 'Basic',
      price: 5,  // WHOLE DOLLAR - 5 Credits
      period: 'month',
      description: 'For the weekend warrior',
      icon: Zap,
      iconColor: 'text-blue-400',
      bgColor: 'bg-blue-500/20',
      storage_gb: 50,
      gold_pass: false,
      features: [
        { text: 'Everything in Free', included: true },
        { text: 'Ad-free experience', included: true, highlight: true },
        { text: 'Find photographers within 5 miles', included: true },
        { text: '50GB photo storage', included: true },
        { text: '10% discount on photo sessions', included: true, highlight: true },
        { text: 'Session notifications', included: true },
        { text: 'Priority support', included: true },
        { text: 'Gold-Pass priority booking', included: false }
      ],
      cta: 'Go Basic',
      popular: false
    },
    {
      id: 'surfer_premium',
      tier_id: 'tier_3',
      name: 'Premium',
      price: 10,  // OFFICIAL: $10 = 10 Credits
      period: 'month',
      description: 'For the daily dawn patroller',
      icon: Crown,
      iconColor: 'text-yellow-400',
      bgColor: 'bg-yellow-500/20',
      storage_gb: -1, // Unlimited
      gold_pass: true,
      features: [
        { text: 'Everything in Basic', included: true },
        { text: 'Find photographers WORLDWIDE', included: true, highlight: true },
        { text: 'Unlimited photo storage', included: true, highlight: true },
        { text: '20% discount on photo sessions', included: true, highlight: true },
        { text: 'Gold-Pass 2hr priority booking', included: true, highlight: true },
        { text: 'Priority notifications & support', included: true },
        { text: 'Verified badge eligibility', included: true },
        { text: 'Advanced privacy controls', included: true }
      ],
      cta: 'Go Premium',
      popular: true,
      badge: 'Best Value'
    }
  ],
  annual: [
    {
      id: 'surfer_basic_annual',
      tier_id: 'tier_2',
      name: 'Basic Annual',
      price: 48,  // $5 * 12 * 0.8 = $48
      monthlyEquiv: 4,
      originalMonthly: 5,
      period: 'year',
      savings: '$12',
      description: 'For the weekend warrior',
      icon: Zap,
      iconColor: 'text-blue-400',
      bgColor: 'bg-blue-500/20',
      storage_gb: 50,
      gold_pass: false,
      features: [
        { text: 'Everything in Free', included: true },
        { text: 'Ad-free experience', included: true, highlight: true },
        { text: 'Find photographers within 5 miles', included: true },
        { text: '50GB photo storage', included: true },
        { text: '10% discount on photo sessions', included: true },
        { text: '20% annual discount', included: true, highlight: true }
      ],
      cta: 'Go Basic Annual',
      popular: false,
      badge: 'Save 20%'
    },
    {
      id: 'surfer_premium_annual',
      tier_id: 'tier_3',
      name: 'Premium Annual',
      price: 96,  // OFFICIAL: $10 * 12 * 0.8 = $96
      monthlyEquiv: 8,
      originalMonthly: 10,
      period: 'year',
      savings: '$24',
      description: 'For the daily dawn patroller',
      icon: Crown,
      iconColor: 'text-yellow-400',
      bgColor: 'bg-yellow-500/20',
      storage_gb: -1,
      gold_pass: true,
      features: [
        { text: 'Everything in Basic', included: true },
        { text: 'Find photographers WORLDWIDE', included: true, highlight: true },
        { text: 'Unlimited photo storage', included: true, highlight: true },
        { text: '20% discount on photo sessions', included: true },
        { text: 'Gold-Pass 2hr priority booking', included: true, highlight: true },
        { text: '20% annual discount', included: true, highlight: true }
      ],
      cta: 'Go Premium Annual',
      popular: true,
      badge: 'Best Value'
    }
  ]
};

// ============================================================
// GROM SUBSCRIPTION PLANS (Parent-managed)
// ============================================================

export const GROM_PLANS = {
  monthly: [
    {
      id: 'grom_free',
      tier_id: 'tier_1',
      name: 'Free',
      price: 0,
      period: 'forever',
      description: 'Basic Grom experience',
      icon: Shield,
      iconColor: 'text-gray-400',
      bgColor: 'bg-gray-500/20',
      storage_gb: 5,
      features: [
        { text: 'Profile & social (parent-approved)', included: true },
        { text: 'View tagged photos', included: true },
        { text: '5GB storage', included: true },
        { text: 'Parent oversight dashboard', included: true },
        { text: 'Competition tracking', included: false },
        { text: 'Priority event access', included: false }
      ],
      cta: 'Start Free',
      popular: false
    },
    {
      id: 'grom_basic',
      tier_id: 'tier_2',
      name: 'Grom Basic',
      price: 3,  // WHOLE DOLLAR - 3 Credits
      period: 'month',
      description: 'For the aspiring ripper',
      icon: Zap,
      iconColor: 'text-blue-400',
      bgColor: 'bg-blue-500/20',
      storage_gb: 25,
      features: [
        { text: 'Everything in Free', included: true },
        { text: 'Ad-free experience', included: true },
        { text: '25GB storage', included: true },
        { text: 'Competition tracking', included: true, highlight: true },
        { text: 'Grom Leaderboard eligibility', included: true },
        { text: 'Priority event access', included: false }
      ],
      cta: 'Go Basic',
      popular: false
    },
    {
      id: 'grom_premium',
      tier_id: 'tier_3',
      name: 'Grom Premium',
      price: 8,  // WHOLE DOLLAR - 8 Credits
      period: 'month',
      description: 'For the competitive Grom',
      icon: Crown,
      iconColor: 'text-yellow-400',
      bgColor: 'bg-yellow-500/20',
      storage_gb: -1,
      features: [
        { text: 'Everything in Basic', included: true },
        { text: 'Unlimited storage', included: true, highlight: true },
        { text: 'Priority event registration', included: true, highlight: true },
        { text: 'Featured in Grom Rising section', included: true },
        { text: 'Sponsor visibility boost', included: true },
        { text: 'Advanced performance analytics', included: true }
      ],
      cta: 'Go Premium',
      popular: true,
      badge: 'Rising Star'
    }
  ]
};

// ============================================================
// PHOTOGRAPHER SUBSCRIPTION PLANS
// ============================================================

export const PHOTOGRAPHER_PLANS = {
  monthly: [
    {
      id: 'photographer_basic',
      tier_id: 'tier_2',
      name: 'Basic',
      price: 18,
      period: 'month',
      yearlyPrice: 216,
      description: 'Start earning from your shots',
      icon: Camera,
      iconColor: 'text-orange-400',
      bgColor: 'bg-orange-500/20',
      commission: '20%',
      commission_rate: 0.20,
      features: [
        { text: 'Unlimited cloud storage', included: true },
        { text: 'Set your own prices', included: true },
        { text: '20% platform commission', included: true, highlight: true },
        { text: 'Track surfers within 5 miles', included: true },
        { text: '24/7 email support', included: true },
        { text: 'Customizable location tags', included: true },
        { text: 'Purchase AI credits ($9.99/100)', included: true },
        { text: 'Priority booking', included: false },
        { text: 'Coupon codes for clients', included: false },
        { text: 'Free monthly AI credits', included: false }
      ],
      cta: 'Start Basic',
      popular: false
    },
    {
      id: 'photographer_premium',
      tier_id: 'tier_3',
      name: 'Premium',
      price: 30,
      period: 'month',
      yearlyPrice: 360,
      description: 'Maximize your earning potential',
      icon: Sparkles,
      iconColor: 'text-purple-400',
      bgColor: 'bg-purple-500/20',
      commission: '15%',
      commission_rate: 0.15,
      gold_pass: true,
      features: [
        { text: 'Everything in Basic', included: true },
        { text: '15% platform commission', included: true, highlight: true },
        { text: 'Track surfers WORLDWIDE', included: true, highlight: true },
        { text: '50 free AI credits/month ($50 value)', included: true, highlight: true },
        { text: '24/7 priority email support', included: true },
        { text: 'Priority booking placement', included: true },
        { text: 'Coupon codes for clients', included: true },
        { text: 'Custom pricing packages', included: true },
        { text: 'Featured photographer eligibility', included: true },
        { text: 'Advanced analytics', included: true }
      ],
      cta: 'Go Premium',
      popular: true,
      badge: 'Best for Pros',
      savings: 'Save 5% on every sale!'
    }
  ],
  annual: [
    {
      id: 'photographer_basic_annual',
      tier_id: 'tier_2',
      name: 'Basic Annual',
      price: 172.80,
      monthlyEquiv: 14.40,
      originalMonthly: 18,
      period: 'year',
      savings: '$43.20',
      description: 'Start earning from your shots',
      icon: Camera,
      iconColor: 'text-orange-400',
      bgColor: 'bg-orange-500/20',
      commission: '20%',
      commission_rate: 0.20,
      features: [
        { text: 'Unlimited cloud storage', included: true },
        { text: 'Set your own prices', included: true },
        { text: '20% platform commission', included: true, highlight: true },
        { text: 'Track surfers within 5 miles', included: true },
        { text: '20% annual discount', included: true, highlight: true }
      ],
      cta: 'Start Basic Annual',
      popular: false,
      badge: 'Save 20%'
    },
    {
      id: 'photographer_premium_annual',
      tier_id: 'tier_3',
      name: 'Premium Annual',
      price: 288.00,
      monthlyEquiv: 24.00,
      originalMonthly: 30,
      period: 'year',
      savings: '$72.00',
      description: 'Maximize your earning potential',
      icon: Sparkles,
      iconColor: 'text-purple-400',
      bgColor: 'bg-purple-500/20',
      commission: '15%',
      commission_rate: 0.15,
      gold_pass: true,
      features: [
        { text: 'Everything in Basic', included: true },
        { text: '15% platform commission', included: true, highlight: true },
        { text: 'Track surfers WORLDWIDE', included: true, highlight: true },
        { text: '50 free AI credits/month', included: true, highlight: true },
        { text: '20% annual discount', included: true, highlight: true }
      ],
      cta: 'Go Premium Annual',
      popular: true,
      badge: 'Best Value'
    }
  ]
};

// ============================================================
// VERIFIED PRO PHOTOGRAPHER SUBSCRIPTION PLANS
// Higher tier with lower commission, more features
// ============================================================

export const VERIFIED_PRO_PLANS = {
  monthly: [
    {
      id: 'verified_pro_basic',
      tier_id: 'tier_2',
      name: 'Basic',
      price: 25,
      period: 'month',
      yearlyPrice: 300,
      description: 'Verified professional photographer',
      icon: Sparkles,
      iconColor: 'text-yellow-400',
      bgColor: 'bg-yellow-500/20',
      commission: '12%',
      commission_rate: 0.12,
      features: [
        { text: 'Verified Pro badge', included: true, highlight: true },
        { text: '12% platform commission', included: true, highlight: true },
        { text: 'Priority in searches', included: true },
        { text: 'Unlimited cloud storage', included: true },
        { text: 'Set your own prices', included: true },
        { text: '24/7 priority support', included: true },
        { text: 'Featured placement', included: false },
        { text: 'Free monthly AI credits', included: false }
      ],
      cta: 'Start Verified Basic',
      popular: false
    },
    {
      id: 'verified_pro_premium',
      tier_id: 'tier_3',
      name: 'Premium',
      price: 50,
      period: 'month',
      yearlyPrice: 600,
      description: 'Maximum visibility & lowest commission',
      icon: Crown,
      iconColor: 'text-purple-400',
      bgColor: 'bg-purple-500/20',
      commission: '10%',
      commission_rate: 0.10,
      gold_pass: true,
      features: [
        { text: 'Everything in Basic', included: true },
        { text: '10% platform commission', included: true, highlight: true },
        { text: 'Featured placement', included: true, highlight: true },
        { text: '100 free AI credits/month', included: true, highlight: true },
        { text: 'Priority booking placement', included: true },
        { text: 'Custom pricing packages', included: true },
        { text: 'Advanced analytics', included: true },
        { text: 'Priority support', included: true }
      ],
      cta: 'Go Premium',
      popular: true,
      badge: 'Best for Verified Pros',
      savings: 'Lowest commission rate!'
    }
  ],
  annual: [
    {
      id: 'verified_pro_basic_annual',
      tier_id: 'tier_2',
      name: 'Basic Annual',
      price: 240,
      monthlyEquiv: 20,
      originalMonthly: 25,
      period: 'year',
      savings: '$60',
      description: 'Verified professional photographer',
      icon: Sparkles,
      iconColor: 'text-yellow-400',
      bgColor: 'bg-yellow-500/20',
      commission: '12%',
      commission_rate: 0.12,
      features: [
        { text: 'Verified Pro badge', included: true, highlight: true },
        { text: '12% platform commission', included: true, highlight: true },
        { text: 'Priority in searches', included: true },
        { text: '20% annual discount', included: true, highlight: true }
      ],
      cta: 'Start Verified Basic Annual',
      popular: false,
      badge: 'Save 20%'
    },
    {
      id: 'verified_pro_premium_annual',
      tier_id: 'tier_3',
      name: 'Premium Annual',
      price: 480,
      monthlyEquiv: 40,
      originalMonthly: 50,
      period: 'year',
      savings: '$120',
      description: 'Maximum visibility & lowest commission',
      icon: Crown,
      iconColor: 'text-purple-400',
      bgColor: 'bg-purple-500/20',
      commission: '10%',
      commission_rate: 0.10,
      gold_pass: true,
      features: [
        { text: 'Everything in Basic', included: true },
        { text: '10% platform commission', included: true, highlight: true },
        { text: 'Featured placement', included: true, highlight: true },
        { text: '100 free AI credits/month', included: true, highlight: true },
        { text: '20% annual discount', included: true, highlight: true }
      ],
      cta: 'Go Premium Annual',
      popular: true,
      badge: 'Best Value'
    }
  ]
};

// ============================================================
// GROM PARENT SUBSCRIPTION PLANS (NEW - Surfer Hybrid at Premium)
// ============================================================

export const GROM_PARENT_PLANS = {
  monthly: [
    {
      id: 'grom_parent_free',
      tier_id: 'tier_1',
      name: 'Free',
      price: 0,
      period: 'forever',
      description: 'Basic parent dashboard',
      icon: Shield,
      iconColor: 'text-gray-400',
      bgColor: 'bg-gray-500/20',
      is_ad_supported: true,
      features: [
        { text: 'Grom management dashboard', included: true },
        { text: 'Link & monitor Grom accounts', included: true },
        { text: 'Book sessions for Groms', included: true },
        { text: 'Ad-supported experience', included: true, negative: true },
        { text: 'Gold-Pass booking', included: false },
        { text: 'Advanced analytics', included: false }
      ],
      cta: 'Start Free',
      popular: false
    },
    {
      id: 'grom_parent_basic',
      tier_id: 'tier_2',
      name: 'Basic',
      price: 5,  // OFFICIAL: $5 = 5 Credits (Ad-Free)
      period: 'month',
      description: 'Ad-free parenting',
      icon: Zap,
      iconColor: 'text-blue-400',
      bgColor: 'bg-blue-500/20',
      is_ad_supported: false,
      features: [
        { text: 'Everything in Free', included: true },
        { text: 'Ad-free experience', included: true, highlight: true },
        { text: 'Priority session notifications', included: true },
        { text: 'Grom progress reports', included: true },
        { text: 'Gold-Pass booking', included: false },
        { text: 'Advanced analytics', included: false }
      ],
      cta: 'Go Basic',
      popular: false
    },
    {
      id: 'grom_parent_premium',
      tier_id: 'tier_3',
      name: 'Premium',
      price: 10,  // OFFICIAL: $10 = 10 Credits (Surfer Hybrid)
      period: 'month',
      description: 'Surfer Hybrid - Full access',
      icon: Crown,
      iconColor: 'text-yellow-400',
      bgColor: 'bg-yellow-500/20',
      is_ad_supported: false,
      gold_pass: true,
      is_surfer_hybrid: true,
      features: [
        { text: 'Everything in Basic', included: true },
        { text: 'Gold-Pass 2hr priority booking', included: true, highlight: true },
        { text: 'Surfer Hybrid - track YOUR sessions', included: true, highlight: true },
        { text: 'Advanced Grom analytics', included: true },
        { text: 'Sponsor visibility for Groms', included: true },
        { text: 'Priority support', included: true }
      ],
      cta: 'Go Premium',
      popular: true,
      badge: 'Surfer Hybrid'
    }
  ]
};

// ============================================================
// HOBBYIST PHOTOGRAPHER PLANS (Contribution-Only, No Premium)
// ============================================================

export const HOBBYIST_PLANS = {
  monthly: [
    {
      id: 'hobbyist_free',
      tier_id: 'tier_1',
      name: 'Free',
      price: 0,
      period: 'forever',
      description: 'Contribute to the community',
      icon: Shield,
      iconColor: 'text-gray-400',
      bgColor: 'bg-gray-500/20',
      is_ad_supported: true,
      contribution_only: true,
      features: [
        { text: 'Upload & share photos', included: true },
        { text: 'Earnings go to Gear Credits only', included: true, highlight: true },
        { text: 'Support Groms & Causes', included: true },
        { text: 'Ad-supported experience', included: true, negative: true },
        { text: 'Bank transfer', included: false },
        { text: 'Priority placement', included: false }
      ],
      cta: 'Start Free',
      popular: false
    },
    {
      id: 'hobbyist_basic',
      tier_id: 'tier_2',
      name: 'Basic',
      price: 5,  // OFFICIAL: $5 = 5 Credits (Ad-Free)
      period: 'month',
      description: 'Ad-free contribution',
      icon: Zap,
      iconColor: 'text-blue-400',
      bgColor: 'bg-blue-500/20',
      is_ad_supported: false,
      contribution_only: true,
      features: [
        { text: 'Everything in Free', included: true },
        { text: 'Ad-free experience', included: true, highlight: true },
        { text: 'Priority in local searches', included: true },
        { text: 'Gear Credits earnings', included: true },
        { text: 'Support Groms & Causes', included: true },
        { text: 'Bank transfer', included: false }
      ],
      cta: 'Go Basic',
      popular: true,
      badge: 'Best for Hobbyists'
    }
    // NO PREMIUM TIER - Hobbyists max out at Basic (Ad-Free)
  ]
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Get plans by user type
 * @param {string} userType - 'surfer', 'grom', 'photographer', 'grom_parent', 'hobbyist'
 * @param {string} billingPeriod - 'monthly' or 'annual'
 */
export const getPlans = (userType, billingPeriod = 'monthly') => {
  switch (userType) {
    case 'surfer':
      return SURFER_PLANS[billingPeriod] || SURFER_PLANS.monthly;
    case 'grom':
      return GROM_PLANS[billingPeriod] || GROM_PLANS.monthly;
    case 'photographer':
      return PHOTOGRAPHER_PLANS[billingPeriod] || PHOTOGRAPHER_PLANS.monthly;
    case 'verified_pro':
    case 'approved_pro':
      return VERIFIED_PRO_PLANS[billingPeriod] || VERIFIED_PRO_PLANS.monthly;
    case 'grom_parent':
      return GROM_PARENT_PLANS[billingPeriod] || GROM_PARENT_PLANS.monthly;
    case 'hobbyist':
      return HOBBYIST_PLANS[billingPeriod] || HOBBYIST_PLANS.monthly;
    default:
      return SURFER_PLANS.monthly;
  }
};

/**
 * Get a specific plan by ID
 * @param {string} planId - The plan ID (e.g., 'surfer_premium')
 */
export const getPlanById = (planId) => {
  const allPlans = [
    ...SURFER_PLANS.monthly,
    ...SURFER_PLANS.annual,
    ...GROM_PLANS.monthly,
    ...PHOTOGRAPHER_PLANS.monthly,
    ...PHOTOGRAPHER_PLANS.annual,
    ...VERIFIED_PRO_PLANS.monthly,
    ...VERIFIED_PRO_PLANS.annual,
    ...GROM_PARENT_PLANS.monthly,
    ...HOBBYIST_PLANS.monthly
  ];
  return allPlans.find(p => p.id === planId);
};

/**
 * Get plan by tier_id for Settings display
 * @param {string} tierId - The tier ID (e.g., 'tier_1', 'tier_2', 'tier_3')
 * @param {string} userType - 'surfer', 'grom', or 'photographer'
 */
export const getPlanByTierId = (tierId, userType = 'surfer') => {
  const plans = getPlans(userType, 'monthly');
  return plans.find(p => p.tier_id === tierId);
};

/**
 * Map subscription_tier string to tier_id
 * @param {string} subscriptionTier - The subscription tier string ('free', 'basic', 'premium')
 */
export const subscriptionTierToTierId = (subscriptionTier) => {
  const mapping = {
    'free': 'tier_1',
    'basic': 'tier_2',
    'premium': 'tier_3'
  };
  return mapping[subscriptionTier] || 'tier_1';
};

/**
 * Check if a plan has Gold-Pass feature
 * @param {string} tierId - The tier ID
 */
export const hasGoldPass = (tierId) => {
  return tierId === 'tier_3';
};

/**
 * Get Gold-Pass priority booking window in hours
 */
export const GOLD_PASS_BOOKING_WINDOW_HOURS = 2;

// Export tier ID constants for consistency
export const TIER_IDS = {
  FREE: 'tier_1',
  BASIC: 'tier_2',
  PREMIUM: 'tier_3'
};

export default {
  SURFER_PLANS,
  GROM_PLANS,
  PHOTOGRAPHER_PLANS,
  VERIFIED_PRO_PLANS,
  GROM_PARENT_PLANS,
  HOBBYIST_PLANS,
  getPlans,
  getPlanById,
  getPlanByTierId,
  subscriptionTierToTierId,
  hasGoldPass,
  GOLD_PASS_BOOKING_WINDOW_HOURS,
  TIER_IDS
};
