import React, { useState, useEffect } from 'react';

import { useNavigate } from 'react-router-dom';

import apiClient from '../lib/apiClient';

import { 

  Zap, Heart, DollarSign, Users, ShoppingBag, Camera, Loader2, TrendingUp, Sparkles, CheckCircle
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';

import { Badge } from './ui/badge';

import { Button } from './ui/button';

import { Progress } from './ui/progress';

import { usePersona } from '../contexts/PersonaContext';

import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';
import { ROLES } from '../constants/roles';



// Default stoke level for new/empty users
const DEFAULT_STOKE_LEVEL = {
  current: { min: 0, name: "Rising Tide", emoji: "🌊", color: "blue" },
  next: { min: 100, name: "Wave Rider", emoji: "🏄", color: "cyan" },
  progress_percent: 0,
  credits_to_next: 100
};

// Default credit uses based on role
const getDefaultCreditUses = (effectiveRole) => {
  if (effectiveRole === ROLES.GROM) {
    return [
      { icon: "🏄", title: "Gear & Equipment", description: "Boards, wetsuits, and accessories" },
      { icon: "🎓", title: "Surf Lessons", description: "Training with local coaches" },
      { icon: "🏆", title: "Competition Entry", description: "Local and regional contests" },
    ];
  } else if (effectiveRole === ROLES.COMP_SURFER) {
    return [
      { icon: "✈️", title: "Travel & Contests", description: "Competition travel expenses" },
      { icon: "🏄", title: "Pro Equipment", description: "High-performance gear" },
    ];
  } else if (effectiveRole === ROLES.PRO) {
    return [
      { icon: "💰", title: "Cash Out", description: "Withdraw to your bank account" },
      { icon: "🎁", title: "Pay It Forward", description: "Support other surfers" },
      { icon: "🏄", title: "Premium Gear", description: "Top-tier equipment" },
    ];
  }
  return [
    { icon: "🏄", title: "Gear & Equipment", description: "Boards, wetsuits, and accessories" },
    { icon: "📸", title: "Photo Sessions", description: "Book pro photographers" },
    { icon: "🎓", title: "Coaching", description: "Level up your skills" },
  ];
};

/**
 * StokedTab - Profile tab for Surfers to see their impact/credits received
 * Shows: Credits received, Photographer supporters, Gear/Session purchases
 * 
 * NOTE: This component is only rendered when Profile.js determines the user
 * should see the Stoked tab (based on isStokedEligible). So we always show
 * the UI here, using default values if backend returns no data.
 */
export const StokedTab = ({ userId, isOwnProfile }) => {
  const navigate = useNavigate();
  const { getEffectiveRole } = usePersona();
  const [loading, setLoading] = useState(true);
  const [stokedData, setStokedData] = useState(null);
  const [activeSection, setActiveSection] = useState('overview'); // 'overview', 'supporters', 'purchases'

  useEffect(() => {
    if (userId) {
      fetchStokedData();
    }
  }, [userId]);

  const fetchStokedData = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/stoked/${userId}`);
      setStokedData(response.data);
    } catch (error) {
      logger.error('Failed to fetch stoked data:', error);
      // Set empty data structure - UI will use defaults
      setStokedData({});
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-yellow-400 animate-spin" />
      </div>
    );
  }

  // Get effective role for default credit uses
  const effectiveRole = getEffectiveRole();

  // Use data from backend if available, otherwise use defaults
  // This ensures the UI always renders when the tab is shown
  const credits = stokedData?.credits || { total_received: 0, available_balance: 0, times_supported: 0 };
  const stoke_level = stokedData?.stoke_level || DEFAULT_STOKE_LEVEL;
  const supporters = stokedData?.supporters || { total_count: 0, list: [] };
  const recent_support = stokedData?.recent_support || [];
  const gear_purchases = stokedData?.gear_purchases || { total_spent: 0, count: 0, list: [] };
  const session_purchases = stokedData?.session_purchases || { total_spent: 0, count: 0, list: [] };
  const _credit_uses = stokedData?.credit_uses || getDefaultCreditUses(effectiveRole);

  // Section navigation
  const sections = [
    { id: 'overview', label: 'Overview', icon: Sparkles },
    { id: 'supporters', label: `Supporters (${supporters?.total_count || 0})`, icon: Heart },
    { id: 'purchases', label: 'Purchases', icon: ShoppingBag },
  ];

  return (
    <div className="p-4 space-y-6" data-testid="stoked-tab">
      {/* Section Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
        {sections.map((section) => (
          <button
            key={section.id}
            onClick={() => setActiveSection(section.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              activeSection === section.id
                ? 'bg-gradient-to-r from-yellow-400 to-orange-400 text-black'
                : 'bg-zinc-800 text-gray-400 hover:bg-zinc-700'
            }`}
            data-testid={`stoked-section-${section.id}`}
          >
            <section.icon className="w-4 h-4" />
            {section.label}
          </button>
        ))}
      </div>

      {/* Overview Section */}
      {activeSection === 'overview' && (
        <div className="space-y-6">
          {/* Stoke Level Card */}
          <div className="bg-gradient-to-br from-yellow-500/20 to-orange-500/20 rounded-2xl p-6 border border-yellow-500/30">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="text-4xl">{stoke_level?.current?.emoji || '🌊'}</div>
                <div>
                  <h3 className="text-white font-bold text-lg">{stoke_level?.current?.name || 'Rising Tide'}</h3>
                  <p className="text-yellow-400/80 text-sm">Stoke Level</p>
                </div>
              </div>
              <Zap className="w-8 h-8 text-yellow-400" />
            </div>
            
            {/* Progress to next level */}
            {stoke_level?.next && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Progress to {stoke_level.next.emoji} {stoke_level.next.name}</span>
                  <span className="text-yellow-400 font-medium">{Math.round(stoke_level.progress_percent || 0)}%</span>
                </div>
                <Progress value={stoke_level.progress_percent || 0} className="h-2 bg-zinc-800" />
                <p className="text-xs text-gray-500 text-center">
                  ${(stoke_level.credits_to_next || 0).toFixed(0)} more to unlock
                </p>
              </div>
            )}
          </div>

          {/* Credits Summary */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 rounded-xl p-4 border border-emerald-500/30">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-5 h-5 text-emerald-400" />
                <span className="text-sm text-gray-400">Total Received</span>
              </div>
              <p className="text-2xl font-bold text-emerald-400">
                ${(credits?.total_received || 0).toFixed(2)}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {credits?.times_supported || 0} donations
              </p>
            </div>
            
            <div className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 rounded-xl p-4 border border-cyan-500/30">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-5 h-5 text-cyan-400" />
                <span className="text-sm text-gray-400">Available</span>
              </div>
              <p className="text-2xl font-bold text-cyan-400">
                ${(credits?.available_balance || 0).toFixed(2)}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Ready to use
              </p>
            </div>
          </div>

          {/* View Stoked Dashboard CTA */}
          {isOwnProfile && (
            <button
              onClick={() => navigate('/stoked')}
              className="w-full py-3 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-black font-semibold rounded-lg transition-all"
              data-testid="view-stoked-dashboard-btn"
            >
              View Stoked Dashboard
            </button>
          )}
        </div>
      )}

      {/* Supporters Section */}
      {activeSection === 'supporters' && (
        <div className="space-y-4">
          {supporters?.list?.length > 0 ? (
            <>
              {/* Thank You Banner */}
              <div className="bg-gradient-to-r from-pink-500/20 to-purple-500/20 rounded-xl p-4 border border-pink-500/30 text-center">
                <Heart className="w-8 h-8 text-pink-400 mx-auto mb-2" />
                <p className="text-white font-semibold">Thank You to Your Supporters!</p>
                <p className="text-pink-400/80 text-sm">
                  {supporters.total_count} photographer{supporters.total_count !== 1 ? 's' : ''} believe{supporters.total_count === 1 ? 's' : ''} in your journey
                </p>
              </div>

              {/* Supporters List */}
              <div className="space-y-3">
                {supporters.list.map((supporter) => (
                  <div 
                    key={supporter.id}
                    onClick={() => navigate(`/profile/${supporter.id}`)}
                    className="flex items-center gap-3 p-3 bg-zinc-900/60 rounded-xl border border-zinc-800 hover:border-pink-500/30 transition-all cursor-pointer"
                    data-testid={`supporter-${supporter.id}`}
                  >
                    <Avatar className="w-12 h-12 border-2 border-pink-500/30">
                      <AvatarImage src={getFullUrl(supporter.avatar_url)} />
                      <AvatarFallback className="bg-zinc-800 text-pink-400">
                        {supporter.full_name?.[0] || '?'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium truncate">{supporter.full_name}</p>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Badge className="bg-zinc-800 text-gray-400 border-0 text-xs px-2 py-0">
                          {supporter.role}
                        </Badge>
                        <span>{supporter.times_supported}x supported</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-pink-400 font-bold">${(supporter.total_given || 0).toFixed(0)}</p>
                      <p className="text-xs text-gray-500">total</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
                <Users className="w-8 h-8 text-gray-500" />
              </div>
              <h3 className="text-white font-semibold mb-1">No Supporters Yet</h3>
              <p className="text-gray-400 text-sm">
                When photographers support you, they'll appear here.
              </p>
            </div>
          )}

          {/* Recent Support Transactions */}
          {recent_support?.length > 0 && (
            <div className="space-y-3 pt-4 border-t border-zinc-800">
              <h4 className="text-white font-semibold">Recent Support</h4>
              {recent_support.slice(0, 5).map((transaction) => (
                <div 
                  key={transaction.id}
                  className="flex items-center gap-3 p-2 bg-zinc-900/40 rounded-lg"
                >
                  <Avatar className="w-8 h-8">
                    <AvatarImage src={transaction.donor_avatar} />
                    <AvatarFallback className="bg-zinc-800 text-xs">
                      {transaction.donor_name?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-300 truncate">{transaction.donor_name}</p>
                    {transaction.message && (
                      <p className="text-xs text-gray-500 truncate">"{transaction.message}"</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-emerald-400 font-medium text-sm">+${transaction.amount?.toFixed(0)}</p>
                    {transaction.shaka_sent && (
                      <span className="text-xs text-yellow-400">🤙 Thanked</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Purchases Section */}
      {activeSection === 'purchases' && (
        <div className="space-y-6">
          {/* Purchase Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-zinc-900/60 rounded-xl p-4 border border-zinc-800">
              <div className="flex items-center gap-2 mb-2">
                <ShoppingBag className="w-5 h-5 text-purple-400" />
                <span className="text-sm text-gray-400">Gear</span>
              </div>
              <p className="text-xl font-bold text-purple-400">
                ${(gear_purchases?.total_spent || 0).toFixed(0)}
              </p>
              <p className="text-xs text-gray-500">{gear_purchases?.count || 0} items</p>
            </div>
            
            <div className="bg-zinc-900/60 rounded-xl p-4 border border-zinc-800">
              <div className="flex items-center gap-2 mb-2">
                <Camera className="w-5 h-5 text-cyan-400" />
                <span className="text-sm text-gray-400">Sessions</span>
              </div>
              <p className="text-xl font-bold text-cyan-400">
                ${(session_purchases?.total_spent || 0).toFixed(0)}
              </p>
              <p className="text-xs text-gray-500">{session_purchases?.count || 0} sessions</p>
            </div>
          </div>

          {/* Gear Purchases */}
          {gear_purchases?.list?.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-white font-semibold flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-purple-400" />
                Gear Purchased
              </h4>
              {gear_purchases.list.map((purchase) => (
                <div 
                  key={purchase.id}
                  className="flex items-center gap-3 p-3 bg-zinc-900/60 rounded-xl border border-zinc-800"
                  data-testid={`gear-purchase-${purchase.id}`}
                >
                  {purchase.item_image ? (
                    <img 
                      src={purchase.item_image} 
                      alt={purchase.item_name}
                      className="w-14 h-14 rounded-lg object-cover bg-zinc-800"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-zinc-800 flex items-center justify-center">
                      <ShoppingBag className="w-6 h-6 text-gray-600" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{purchase.item_name}</p>
                    <div className="flex items-center gap-2 text-xs">
                      <Badge className="bg-purple-500/20 text-purple-400 border-0 px-2 py-0">
                        {purchase.item_category || 'Gear'}
                      </Badge>
                      <span className="text-gray-500">{purchase.affiliate_partner}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-purple-400 font-bold">${purchase.credits_spent?.toFixed(0)}</p>
                    {purchase.status === 'clicked' && (
                      <Badge className="bg-yellow-500/20 text-yellow-400 border-0 text-xs">
                        Pending
                      </Badge>
                    )}
                    {purchase.status === 'completed' && (
                      <Badge className="bg-green-500/20 text-green-400 border-0 text-xs">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Done
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Session Purchases */}
          {session_purchases?.list?.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-white font-semibold flex items-center gap-2">
                <Camera className="w-4 h-4 text-cyan-400" />
                Sessions Booked
              </h4>
              {session_purchases.list.map((session) => (
                <div 
                  key={session.id}
                  className="flex items-center gap-3 p-3 bg-zinc-900/60 rounded-xl border border-zinc-800"
                  data-testid={`session-purchase-${session.id}`}
                >
                  <Avatar className="w-12 h-12 border-2 border-cyan-500/30">
                    <AvatarImage src={session.photographer_avatar} />
                    <AvatarFallback className="bg-zinc-800 text-cyan-400">
                      {session.photographer_name?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{session.photographer_name}</p>
                    <p className="text-xs text-gray-500 truncate">{session.location}</p>
                    {session.photos_received > 0 && (
                      <Badge className="bg-cyan-500/20 text-cyan-400 border-0 text-xs mt-1">
                        {session.photos_received} photos
                      </Badge>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-cyan-400 font-bold">${session.amount_paid?.toFixed(0)}</p>
                    <p className="text-xs text-gray-500">
                      {session.session_date ? new Date(session.session_date).toLocaleDateString() : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty State */}
          {(!gear_purchases?.list?.length && !session_purchases?.list?.length) && (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
                <ShoppingBag className="w-8 h-8 text-gray-500" />
              </div>
              <h3 className="text-white font-semibold mb-1">No Purchases Yet</h3>
              <p className="text-gray-400 text-sm mb-4">
                Use your credits at the Gear Hub or book photo sessions!
              </p>
              {isOwnProfile && (
                <Button 
                  onClick={() => navigate('/gear-hub')}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 text-white"
                >
                  <ShoppingBag className="w-4 h-4 mr-2" />
                  Browse Gear Hub
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default StokedTab;
