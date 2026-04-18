import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { toast } from 'sonner';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import {
  Camera, Wrench, Package, Waves, Search, ShoppingBag,
  ExternalLink, Loader2, Target,
  Percent, BadgeCheck
} from 'lucide-react';
import logger from '../utils/logger';
import { ROLES } from '../constants/roles';

const API_URL = process.env.REACT_APP_BACKEND_URL;

const CATEGORY_ICONS = {
  camera: Camera,
  lens: Camera,
  housing: Package,
  drone: Package,
  accessories: Wrench,
  surfboard: Waves,
  wetsuit: Waves,
  surf_accessories: Wrench
};

const CATEGORY_LABELS = {
  camera: 'Cameras',
  lens: 'Lenses',
  housing: 'Housings',
  drone: 'Drones',
  accessories: 'Accessories',
  surfboard: 'Surfboards',
  wetsuit: 'Wetsuits',
  surf_accessories: 'Surf Gear'
};

export const GearHub = () => {
  const { user } = useAuth();
  const [gearItems, setGearItems] = useState([]);
  const [userProgress, setUserProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [purchasing, setPurchasing] = useState(null);
  const [targetGear, setTargetGear] = useState(null);

  useEffect(() => {
    fetchGearCatalog();
    if (user?.id) {
      fetchUserProgress();
    }
  }, [user?.id, selectedCategory, searchQuery]);

  const fetchGearCatalog = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedCategory) params.append('category', selectedCategory);
      if (searchQuery) params.append('search', searchQuery);
      
      const res = await apiClient.get(`/gear-hub?${params}`);
      setGearItems(res.data);
    } catch (err) {
      logger.error('Failed to fetch gear catalog:', err);
      toast.error('Failed to load gear catalog');
    } finally {
      setLoading(false);
    }
  };

  const fetchUserProgress = async () => {
    try {
      const res = await apiClient.get(`/gear-hub/user/${user.id}/progress`);
      setUserProgress(res.data);
      
      // Find target gear if user has one set
      if (res.data.progress_items) {
        const target = res.data.progress_items.find(item => item.can_afford);
        setTargetGear(target);
      }
    } catch (err) {
      logger.error('Failed to fetch user progress:', err);
    }
  };

  const handlePurchase = async (item) => {
    if (!user?.id) {
      toast.error('Please log in to purchase');
      return;
    }

    if (!userProgress?.can_purchase) {
      toast.error('You cannot purchase gear with your account type');
      return;
    }

    if (userProgress.available_credits < item.price_credits) {
      toast.error(`Not enough Gear Credits. You have ${userProgress.available_credits}, need ${item.price_credits}`);
      return;
    }

    setPurchasing(item.id);
    try {
      const res = await apiClient.post(`/gear-hub/${item.id}/purchase?user_id=${user.id}`);
      
      toast.success(res.data.message);
      
      // Open affiliate link in new tab
      if (res.data.affiliate_url) {
        window.open(res.data.affiliate_url, '_blank');
      }
      
      // Refresh user progress
      fetchUserProgress();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to purchase item');
    } finally {
      setPurchasing(null);
    }
  };

  const setAsTarget = async (item) => {
    if (!user?.id) return;
    try {
      await apiClient.patch(`/api/profiles/me?user_id=${user.id}`, {
        target_gear_item_id: item.id,
      });
      setTargetGear(item);
      toast.success(`Set ${item.name} as your savings goal!`);
    } catch (err) {
      logger.error('Failed to set target gear:', err);
      toast.error('Could not save your goal. Try again.');
    }
  };

  const _categories = [...new Set(gearItems.map(item => item.category))];

  const isHobbyist = user?.role === ROLES.HOBBYIST || user?.role === ROLES.GROM_PARENT || user?.is_grom_parent === true;

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black pb-20 md:pb-6">
      {/* Header */}
      <div className="relative bg-gradient-to-r from-amber-600/20 via-orange-500/10 to-amber-600/20 border-b border-amber-500/20">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-amber-500/20 rounded-xl">
              <ShoppingBag className="w-7 h-7 text-amber-400" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-white">Gear Hub</h1>
              <p className="text-zinc-400 text-sm">Redeem your Gear Credits for pro equipment</p>
            </div>
          </div>
          
          {/* Credits Balance Card */}
          {userProgress && (
            <div className="mt-6 p-4 bg-zinc-900/80 border border-amber-500/30 rounded-xl">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-zinc-400 text-sm">Your Gear Credits</p>
                  <p className="text-3xl font-bold text-amber-400">
                    {userProgress.available_credits?.toFixed(2) || '0.00'}
                  </p>
                </div>
                {isHobbyist && (
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-emerald-400 text-sm">
                      <BadgeCheck className="w-4 h-4" />
                      <span>Hobbyist Account</span>
                    </div>
                    <p className="text-zinc-500 text-xs mt-1">
                      Earn credits from sessions & bookings
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Target Progress (if set) */}
      {targetGear && (
        <div className="max-w-6xl mx-auto px-4 mt-6">
          <Card className="bg-gradient-to-r from-amber-900/30 to-orange-900/20 border-amber-500/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-zinc-800 rounded-lg overflow-hidden flex-shrink-0">
                  {targetGear.image_url ? (
                    <img src={getFullUrl(targetGear.image_url)} alt={targetGear.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Target className="w-8 h-8 text-zinc-500" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-amber-400" />
                    <span className="text-amber-400 text-sm font-medium">Savings Goal</span>
                  </div>
                  <p className="text-white font-semibold truncate">{targetGear.name}</p>
                  <div className="mt-2">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-zinc-400">Progress</span>
                      <span className="text-amber-400">
                        {userProgress?.available_credits?.toFixed(0) || 0} / {targetGear.price_credits} credits
                      </span>
                    </div>
                    <div className="w-full bg-zinc-800 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-amber-500 to-orange-500 h-2 rounded-full transition-all"
                        style={{ width: `${Math.min(100, (userProgress?.available_credits / targetGear.price_credits) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search & Filters */}
      <div className="max-w-6xl mx-auto px-4 mt-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            <Input
              type="text"
              placeholder="Search cameras, lenses, surfboards..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-zinc-900/60 border-zinc-800 text-white placeholder:text-zinc-500"
            />
          </div>
        </div>

        {/* Category Filters */}
        <div className="flex flex-wrap gap-2 mt-4">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
              !selectedCategory 
                ? 'bg-amber-500 text-black' 
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            All
          </button>
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
            const Icon = CATEGORY_ICONS[key];
            return (
              <button
                key={key}
                onClick={() => setSelectedCategory(key)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                  selectedCategory === key 
                    ? 'bg-amber-500 text-black' 
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {Icon && <Icon className="w-4 h-4" />}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Gear Grid */}
      <div className="max-w-6xl mx-auto px-4 mt-8">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          </div>
        ) : gearItems.length === 0 ? (
          <div className="text-center py-20">
            <ShoppingBag className="w-16 h-16 text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-500">No gear found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {gearItems.map((item) => {
              const Icon = CATEGORY_ICONS[item.category] || Package;
              const canAfford = userProgress && userProgress.available_credits >= item.price_credits;
              const progress = userProgress ? Math.min(100, (userProgress.available_credits / item.price_credits) * 100) : 0;
              
              return (
                <Card 
                  key={item.id}
                  className={`bg-zinc-900/60 border-zinc-800 overflow-hidden hover:border-amber-500/50 transition-all ${
                    item.is_featured ? 'ring-2 ring-amber-500/30' : ''
                  }`}
                >
                  {item.is_featured && (
                    <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-black text-xs font-bold px-3 py-1 text-center">
                      FEATURED
                    </div>
                  )}
                  
                  {/* Product Image */}
                  <div className="aspect-video bg-zinc-800 relative">
                    {item.image_url ? (
                      <img 
                        src={getFullUrl(item.image_url)} 
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Icon className="w-16 h-16 text-zinc-700" />
                      </div>
                    )}
                    
                    {/* Category Badge */}
                    <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-full flex items-center gap-1">
                      <Icon className="w-3 h-3 text-amber-400" />
                      <span className="text-xs text-white capitalize">{item.category}</span>
                    </div>
                    
                    {/* Affiliate Badge */}
                    <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-full">
                      <span className="text-xs text-zinc-300">{item.affiliate_partner?.toUpperCase()}</span>
                    </div>
                  </div>
                  
                  <CardContent className="p-4">
                    {/* Brand & Name */}
                    {item.brand && (
                      <p className="text-amber-400 text-xs font-medium mb-1">{item.brand}</p>
                    )}
                    <h3 className="text-white font-semibold mb-2 line-clamp-2">{item.name}</h3>
                    
                    {/* Description */}
                    {item.description && (
                      <p className="text-zinc-500 text-sm mb-3 line-clamp-2">{item.description}</p>
                    )}
                    
                    {/* Pricing */}
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-2xl font-bold text-amber-400">{item.price_credits}</p>
                        <p className="text-zinc-500 text-xs">Gear Credits</p>
                      </div>
                      {item.retail_price_usd && (
                        <div className="text-right">
                          <p className="text-zinc-400 text-sm">${item.retail_price_usd.toFixed(2)}</p>
                          <p className="text-zinc-600 text-xs">Retail Price</p>
                        </div>
                      )}
                    </div>
                    
                    {/* Progress Bar */}
                    {userProgress && !canAfford && (
                      <div className="mb-3">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-zinc-500">Your progress</span>
                          <span className="text-amber-400">{progress.toFixed(0)}%</span>
                        </div>
                        <div className="w-full bg-zinc-800 rounded-full h-1.5">
                          <div 
                            className="bg-gradient-to-r from-amber-500 to-orange-500 h-1.5 rounded-full"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                    
                    {/* Actions */}
                    <div className="flex gap-2">
                      {canAfford ? (
                        <Button
                          onClick={() => handlePurchase(item)}
                          disabled={purchasing === item.id}
                          className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-semibold"
                          data-testid={`purchase-gear-${item.id}`}
                        >
                          {purchasing === item.id ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          ) : (
                            <ShoppingBag className="w-4 h-4 mr-2" />
                          )}
                          Redeem Credits
                        </Button>
                      ) : (
                        <Button
                          onClick={() => setAsTarget(item)}
                          variant="outline"
                          className="flex-1 border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
                        >
                          <Target className="w-4 h-4 mr-2" />
                          Set as Goal
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => window.open(item.affiliate_url, '_blank')}
                        className="text-zinc-400 hover:text-white"
                        title="View on retailer site"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Info Footer */}
      <div className="max-w-6xl mx-auto px-4 mt-12">
        <Card className="bg-zinc-900/40 border-zinc-800">
          <CardContent className="p-6">
            <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
              <Percent className="w-5 h-5 text-amber-400" />
              How Gear Credits Work
            </h3>
            <div className="grid md:grid-cols-3 gap-4 text-sm">
              <div className="text-zinc-400">
                <p className="text-white font-medium mb-1">Earn Credits</p>
                <p>Host live sessions or bookings as a Hobbyist. Your earnings go directly to Gear Credits.</p>
              </div>
              <div className="text-zinc-400">
                <p className="text-white font-medium mb-1">Save & Redeem</p>
                <p>Set a savings goal and track your progress. Once you have enough credits, redeem them here.</p>
              </div>
              <div className="text-zinc-400">
                <p className="text-white font-medium mb-1">Shop Partners</p>
                <p>Get the real gear from trusted retailers like B&H Photo and Adorama through our affiliate links.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
