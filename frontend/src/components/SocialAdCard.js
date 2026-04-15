/**
 * SocialAdCard - Sponsored content card for ad-supported users
 * Mimics organic posts but clearly labeled "Sponsored"
 * Only renders if user.is_ad_supported === true
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Sparkles, X, ExternalLink, Zap } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

// Ad content pool - rotates through these
const AD_CONTENT = [
  {
    id: 'upgrade_pro',
    type: 'upgrade',
    headline: 'Go Ad-Free with Pro',
    description: 'Support Raw Surf and unlock premium features. Remove all ads and get priority booking.',
    cta: 'Upgrade Now',
    ctaLink: '/settings?tab=billing',
    gradient: 'from-cyan-500 to-blue-600',
    icon: Sparkles,
    image: null
  },
  {
    id: 'gold_pass',
    type: 'upgrade',
    headline: 'Get the Gold Pass',
    description: 'Unlimited sessions, priority access to Pro photographers, and zero ads.',
    cta: 'Learn More',
    ctaLink: '/settings?tab=billing',
    gradient: 'from-yellow-500 to-orange-500',
    icon: Zap,
    image: null
  },
  {
    id: 'credits_promo',
    type: 'promo',
    headline: 'Top Up Your Stoked Credits',
    description: 'Load up on credits and never miss a session. Any purchase removes ads!',
    cta: 'Add Credits',
    ctaLink: '/wallet',
    gradient: 'from-emerald-500 to-cyan-500',
    icon: Sparkles,
    image: null
  }
];

// Get a deterministic ad based on position
const getAdForPosition = (position) => {
  return AD_CONTENT[position % AD_CONTENT.length];
};

export const SocialAdCard = ({ position = 0, onDismiss }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const isLight = theme === 'light';
  
  // Only render for ad-supported users
  if (!user?.is_ad_supported) {
    return null;
  }
  
  const ad = getAdForPosition(position);
  const IconComponent = ad.icon;
  
  const handleCtaClick = () => {
    navigate(ad.ctaLink);
  };
  
  const cardBg = isLight ? 'bg-white' : 'bg-zinc-900';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const borderColor = isLight ? 'border-gray-200' : 'border-zinc-800';
  
  return (
    <div 
      className={`${cardBg} ${borderColor} border-y relative overflow-hidden`}
      data-testid="social-ad-card"
    >
      {/* Sponsored Label */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/50">
        <div className="flex items-center gap-2">
          <Badge className="bg-zinc-700/50 text-zinc-400 text-[10px] font-medium px-2 py-0.5">
            Sponsored
          </Badge>
          <span className={`text-xs ${textSecondary}`}>Raw Surf</span>
        </div>
        {onDismiss && (
          <button 
            onClick={onDismiss}
            className="text-zinc-600 hover:text-zinc-400 transition-colors"
            aria-label="Dismiss ad"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      
      {/* Ad Content */}
      <div className="p-4">
        {/* Gradient Banner */}
        <div className={`bg-gradient-to-r ${ad.gradient} rounded-xl p-6 mb-4 relative overflow-hidden`}>
          {/* Background Pattern */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-24 h-24 bg-white rounded-full translate-y-1/2 -translate-x-1/2" />
          </div>
          
          <div className="relative z-10 flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
              <IconComponent className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-white font-bold text-lg mb-1">{ad.headline}</h3>
              <p className="text-white/80 text-sm">{ad.description}</p>
            </div>
          </div>
        </div>
        
        {/* CTA Button */}
        <Button
          onClick={handleCtaClick}
          className={`w-full bg-gradient-to-r ${ad.gradient} text-white font-bold py-3 rounded-xl hover:opacity-90 transition-opacity`}
          data-testid="ad-cta-button"
        >
          {ad.cta}
          <ExternalLink className="w-4 h-4 ml-2" />
        </Button>
        
        {/* Ad-Free Teaser */}
        <p className={`text-center text-xs ${textSecondary} mt-3`}>
          Any purchase removes all ads
        </p>
      </div>
    </div>
  );
};

/**
 * Helper function to inject ads into a posts array
 * Injects one ad every 5-7 posts
 * @param {Array} posts - Original posts array
 * @param {boolean} isAdSupported - Whether user sees ads
 * @returns {Array} Posts with ad markers injected
 */
export const injectAdsIntoPosts = (posts, isAdSupported) => {
  if (!isAdSupported || !posts || posts.length === 0) {
    return posts.map(p => ({ ...p, isAd: false }));
  }
  
  const result = [];
  let adCounter = 0;
  const AD_FREQUENCY = 6; // Show ad every 6 posts
  
  posts.forEach((post, index) => {
    result.push({ ...post, isAd: false });
    
    // Inject ad after every AD_FREQUENCY posts
    if ((index + 1) % AD_FREQUENCY === 0 && index < posts.length - 1) {
      result.push({ 
        id: `ad-${adCounter}`, 
        isAd: true, 
        adPosition: adCounter 
      });
      adCounter++;
    }
  });
  
  return result;
};

export default SocialAdCard;
