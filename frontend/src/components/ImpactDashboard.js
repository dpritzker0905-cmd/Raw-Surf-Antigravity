import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import axios from 'axios';
import {
  Heart, Target, Search, Users, DollarSign, TrendingUp,
  ChevronRight, Loader2, ExternalLink, Check, Waves,
  Trophy, Star, Gift, ShoppingBag, Settings, Play
} from 'lucide-react';
import logger from '../utils/logger';

const API_URL = process.env.REACT_APP_BACKEND_URL;

const IMPACT_LEVELS = {
  Legend: { emoji: '🏆', color: 'from-yellow-400 to-amber-600' },
  Champion: { emoji: '🥇', color: 'from-amber-400 to-orange-500' },
  Hero: { emoji: '🦸', color: 'from-purple-400 to-indigo-500' },
  Patron: { emoji: '🌟', color: 'from-blue-400 to-cyan-500' },
  Supporter: { emoji: '💪', color: 'from-green-400 to-emerald-500' },
  Contributor: { emoji: '🤝', color: 'from-teal-400 to-cyan-500' },
  Starter: { emoji: '🌱', color: 'from-gray-400 to-zinc-500' }
};

const CAUSE_CATEGORIES = {
  ocean_conservation: { label: 'Ocean Conservation', color: 'bg-blue-500/20 text-blue-400' },
  environmental: { label: 'Environmental', color: 'bg-green-500/20 text-green-400' },
  youth_surfing: { label: 'Youth Surfing', color: 'bg-amber-500/20 text-amber-400' },
  community: { label: 'Community', color: 'bg-purple-500/20 text-purple-400' }
};

export const ImpactDashboard = () => {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  
  // Check if user is a Hobbyist (no payout access)
  const isHobbyist = user?.role === 'Hobbyist' || user?.role === 'Grom Parent' || user?.is_grom_parent === true;
  
  // Search states
  const [causes, setCauses] = useState([]);
  const [groms, setGroms] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  
  // Settings states
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [splitPercentage, setSplitPercentage] = useState(50);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user?.id) {
      fetchDashboard();
      fetchCauses();
    }
  }, [user?.id]);

  const fetchDashboard = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/impact/dashboard/${user.id}`);
      setDashboard(res.data);
      if (res.data.donation_settings?.split_percentage) {
        setSplitPercentage(res.data.donation_settings.split_percentage);
      }
    } catch (err) {
      logger.error('Failed to fetch impact dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCauses = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/impact/causes`);
      setCauses(res.data);
    } catch (err) {
      logger.error('Failed to fetch causes:', err);
    }
  };

  const searchGroms = async (query) => {
    if (!query) {
      setGroms([]);
      return;
    }
    setSearching(true);
    try {
      const res = await axios.get(`${API_URL}/api/impact/search-groms?search=${encodeURIComponent(query)}`);
      setGroms(res.data);
    } catch (err) {
      logger.error('Failed to search groms:', err);
    } finally {
      setSearching(false);
    }
  };

  const selectDestination = (type, item) => {
    setSelectedDestination({
      type,
      id: item.id,
      name: item.name || item.full_name,
      avatar_url: item.avatar_url || item.logo_url,
      is_cause: type === 'cause'
    });
  };

  const saveSettings = async () => {
    if (!selectedDestination) {
      toast.error('Please select a destination for your donations');
      return;
    }

    setSaving(true);
    try {
      await axios.put(`${API_URL}/api/impact/settings/${user.id}`, {
        donation_destination_type: selectedDestination.type,
        donation_destination_id: selectedDestination.is_cause ? null : selectedDestination.id,
        donation_cause_name: selectedDestination.is_cause ? selectedDestination.name : null,
        donation_split_percentage: dashboard?.is_pro ? splitPercentage : 100
      });
      toast.success('Impact settings saved!');
      fetchDashboard();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-cyan-500 dark:text-cyan-400 animate-spin" />
      </div>
    );
  }

  const level = dashboard?.impact_score ? IMPACT_LEVELS[
    dashboard.impact_score.total_credits_given >= 10000 ? 'Legend' :
    dashboard.impact_score.total_credits_given >= 5000 ? 'Champion' :
    dashboard.impact_score.total_credits_given >= 2500 ? 'Hero' :
    dashboard.impact_score.total_credits_given >= 1000 ? 'Patron' :
    dashboard.impact_score.total_credits_given >= 500 ? 'Supporter' :
    dashboard.impact_score.total_credits_given >= 100 ? 'Contributor' : 'Starter'
  ] : IMPACT_LEVELS.Starter;

  const levelName = dashboard?.impact_score?.total_credits_given >= 10000 ? 'Legend' :
    dashboard?.impact_score?.total_credits_given >= 5000 ? 'Champion' :
    dashboard?.impact_score?.total_credits_given >= 2500 ? 'Hero' :
    dashboard?.impact_score?.total_credits_given >= 1000 ? 'Patron' :
    dashboard?.impact_score?.total_credits_given >= 500 ? 'Supporter' :
    dashboard?.impact_score?.total_credits_given >= 100 ? 'Contributor' : 'Starter';

  return (
    <div 
      className="min-h-screen bg-background pb-24 md:pb-6"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)' }}
      data-testid="impact-dashboard"
    >
      {/* Header */}
      <div className="relative bg-gradient-to-r from-cyan-600/20 via-blue-500/10 to-cyan-600/20 border-b border-cyan-500/20">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-4">
            <div className={`p-3 rounded-xl bg-gradient-to-br ${level.color}`}>
              <Heart className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground">Impact Dashboard</h1>
              <p className="text-muted-foreground text-sm">Track your contributions to the surf community</p>
            </div>
          </div>
          
          {/* Impact Level Card */}
          <div className={`mt-6 p-6 rounded-xl bg-gradient-to-br ${level.color} bg-opacity-20`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-3xl">{level.emoji}</span>
                  <span className="text-foreground font-bold text-xl">{levelName}</span>
                </div>
                <p className="text-foreground/80 text-sm">Impact Level</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-foreground">
                  {dashboard?.impact_score?.total_credits_given?.toFixed(0) || 0}
                </p>
                <p className="text-foreground/80 text-sm">Credits Given</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="max-w-6xl mx-auto px-4 mt-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <Users className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-foreground">{dashboard?.impact_score?.total_groms_supported || 0}</p>
              <p className="text-muted-foreground text-sm">Groms Supported</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <Waves className="w-8 h-8 text-blue-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-foreground">{dashboard?.impact_score?.total_causes_supported || 0}</p>
              <p className="text-muted-foreground text-sm">Causes Supported</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <Gift className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-foreground">{dashboard?.impact_score?.sponsorships_given || 0}</p>
              <p className="text-muted-foreground text-sm">Sponsorships Given</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <DollarSign className="w-8 h-8 text-cyan-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-foreground">
                {dashboard?.is_pro && !isHobbyist
                  ? dashboard?.credits?.withdrawable?.toFixed(2) 
                  : dashboard?.credits?.gear_only?.toFixed(2) || '0.00'}
              </p>
              <p className="text-muted-foreground text-sm">
                {isHobbyist 
                  ? 'Community Impact' 
                  : dashboard?.is_pro 
                    ? 'Withdrawable' 
                    : 'Gear Credits'}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-6xl mx-auto px-4 mt-8">
        <div className="flex gap-2 border-b border-border pb-2">
          {['overview', 'causes', 'groms', 'settings'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-t-lg font-medium transition-all capitalize ${
                activeTab === tab
                  ? 'bg-cyan-500/20 text-cyan-500 dark:text-cyan-400 border-b-2 border-cyan-500'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              data-testid={`impact-tab-${tab}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-6xl mx-auto px-4 mt-6">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Athlete Stoke Generated - NEW */}
            <Card className="bg-gradient-to-br from-pink-500/10 via-background to-yellow-500/10 border-2 border-pink-500/30">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <Heart className="w-5 h-5 text-pink-500 dark:text-pink-400" />
                  Athlete Stoke Generated
                  <Badge className="ml-auto bg-pink-500/20 text-pink-600 dark:text-pink-400 border-0 text-xs">YOUR IMPACT</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="p-4 bg-pink-500/10 rounded-lg text-center">
                    <div className="text-3xl font-bold text-pink-500 dark:text-pink-400">
                      ${dashboard?.impact_score?.total_credits_given?.toFixed(0) || 0}
                    </div>
                    <div className="text-sm text-muted-foreground">Total Credits Given</div>
                  </div>
                  <div className="p-4 bg-yellow-500/10 rounded-lg text-center">
                    <div className="text-3xl font-bold text-yellow-500 dark:text-yellow-400">
                      {dashboard?.impact_score?.total_groms_supported || 0}
                    </div>
                    <div className="text-sm text-muted-foreground">Athletes Supported</div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  You helped Groms earn <span className="text-pink-500 dark:text-pink-400 font-bold">${dashboard?.impact_score?.total_credits_given?.toFixed(0) || 0}</span> in gear credits this month
                </p>
                <Button 
                  variant="outline"
                  className="w-full mt-4 border-pink-500/50 text-pink-600 dark:text-pink-400 hover:bg-pink-500/10"
                  onClick={() => window.location.href = '/career/stoke-sponsor'}
                >
                  <Heart className="w-4 h-4 mr-2" />
                  Sponsor More Athletes
                </Button>
              </CardContent>
            </Card>
            
            {/* Current Destination */}
            {dashboard?.donation_settings?.destination_info && (
              <Card className="bg-card border-cyan-500/30">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <Target className="w-5 h-5 text-cyan-500 dark:text-cyan-400" />
                    Current Impact Destination
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <Avatar className="w-16 h-16">
                      <AvatarImage src={dashboard.donation_settings.destination_info.avatar_url || dashboard.donation_settings.destination_info.logo_url} />
                      <AvatarFallback className="bg-cyan-900 text-cyan-400">
                        {dashboard.donation_settings.destination_info.name?.[0] || '?'}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-foreground font-semibold text-lg">
                        {dashboard.donation_settings.destination_info.name}
                      </p>
                      <Badge className={`${
                        dashboard.donation_settings.destination_type === 'grom' 
                          ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' 
                          : 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                      }`}>
                        {dashboard.donation_settings.destination_type === 'grom' ? 'Grom' : 'Cause'}
                      </Badge>
                    </div>
                    {dashboard?.is_pro && (
                      <div className="ml-auto text-right">
                        <p className="text-3xl font-bold text-cyan-500 dark:text-cyan-400">
                          {dashboard.donation_settings.split_percentage || 50}%
                        </p>
                        <p className="text-muted-foreground text-sm">of earnings donated</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Recent Sponsorships */}
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-foreground flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-500 dark:text-green-400" />
                  Recent Impact
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dashboard?.recent_sponsorships?.length > 0 ? (
                  <div className="space-y-3">
                    {dashboard.recent_sponsorships.map(s => (
                      <div key={s.id} className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
                        <Avatar>
                          <AvatarImage src={s.recipient_avatar} />
                          <AvatarFallback className="bg-muted">
                            {s.recipient_name?.[0] || '?'}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <p className="text-foreground font-medium">{s.recipient_name}</p>
                          <p className="text-muted-foreground text-sm">{s.recipient_type}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-green-500 dark:text-green-400 font-bold">${s.amount?.toFixed(2)}</p>
                          <p className="text-muted-foreground text-xs">
                            {new Date(s.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">
                    No sponsorships yet. Set a destination to start making an impact!
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'causes' && (
          <div className="grid md:grid-cols-2 gap-4">
            {causes.map(cause => (
              <Card 
                key={cause.id}
                className={`bg-card border-border hover:border-cyan-500/50 transition-all cursor-pointer ${
                  selectedDestination?.id === cause.id ? 'ring-2 ring-cyan-500' : ''
                }`}
                onClick={() => selectDestination('cause', cause)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-blue-500/20 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                      <Waves className="w-6 h-6 text-blue-500 dark:text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-foreground font-semibold">{cause.name}</h3>
                        {cause.is_featured && (
                          <Star className="w-4 h-4 text-amber-400" />
                        )}
                      </div>
                      <p className="text-muted-foreground text-sm mb-2">{cause.description}</p>
                      <div className="flex items-center gap-2">
                        <Badge className={CAUSE_CATEGORIES[cause.category]?.color || 'bg-muted'}>
                          {CAUSE_CATEGORIES[cause.category]?.label || cause.category}
                        </Badge>
                        {cause.website_url && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(cause.website_url, '_blank');
                            }}
                            className="text-muted-foreground hover:text-cyan-500 dark:hover:text-cyan-400"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    {selectedDestination?.id === cause.id && (
                      <Check className="w-6 h-6 text-cyan-500 dark:text-cyan-400" />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {activeTab === 'groms' && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search for a Grom to support..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  searchGroms(e.target.value);
                }}
                className="pl-10 bg-card border-border text-foreground"
              />
            </div>

            {searching ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 text-cyan-500 dark:text-cyan-400 animate-spin" />
              </div>
            ) : groms.length > 0 ? (
              <div className="grid md:grid-cols-2 gap-4">
                {groms.map(grom => (
                  <Card 
                    key={grom.id}
                    className={`bg-card border-border hover:border-amber-500/50 transition-all cursor-pointer ${
                      selectedDestination?.id === grom.id ? 'ring-2 ring-amber-500' : ''
                    }`}
                    onClick={() => selectDestination('grom', grom)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <Avatar className="w-14 h-14">
                          <AvatarImage src={grom.avatar_url} />
                          <AvatarFallback className="bg-amber-900 text-amber-400">
                            {grom.full_name?.[0] || '?'}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <h3 className="text-foreground font-semibold">{grom.full_name}</h3>
                          <p className="text-muted-foreground text-sm">{grom.location}</p>
                          {grom.skill_level && (
                            <Badge className="bg-amber-500/20 text-amber-600 dark:text-amber-400 mt-1">
                              {grom.skill_level}
                            </Badge>
                          )}
                        </div>
                        {selectedDestination?.id === grom.id && (
                          <Check className="w-6 h-6 text-amber-400" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : searchQuery ? (
              <p className="text-muted-foreground text-center py-8">No Groms found matching "{searchQuery}"</p>
            ) : (
              <p className="text-muted-foreground text-center py-8">
                Search for a Grom to support their surfing journey
              </p>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <Settings className="w-5 h-5 text-muted-foreground" />
                Impact Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Selected Destination */}
              <div>
                <label className="text-muted-foreground text-sm block mb-2">
                  Donation Destination
                </label>
                {selectedDestination ? (
                  <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
                    <Avatar>
                      <AvatarImage src={selectedDestination.avatar_url} />
                      <AvatarFallback className="bg-cyan-900 text-cyan-400">
                        {selectedDestination.name?.[0] || '?'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="text-foreground font-medium">{selectedDestination.name}</p>
                      <Badge className={selectedDestination.type === 'grom' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' : 'bg-blue-500/20 text-blue-600 dark:text-blue-400'}>
                        {selectedDestination.type === 'grom' ? 'Grom' : 'Cause'}
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedDestination(null)}
                      className="text-muted-foreground"
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <p className="text-muted-foreground p-4 bg-muted/50 rounded-lg">
                    Select a Grom or Cause from the tabs above
                  </p>
                )}
              </div>

              {/* Split Percentage (Pros only) */}
              {dashboard?.is_pro && (
                <div>
                  <label className="text-muted-foreground text-sm block mb-2">
                    Donation Split ({splitPercentage}% to destination)
                  </label>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={splitPercentage}
                    onChange={(e) => setSplitPercentage(parseInt(e.target.value))}
                    className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-cyan-500"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>10%</span>
                    <span>50%</span>
                    <span>100%</span>
                  </div>
                  <p className="text-muted-foreground text-sm mt-2">
                    {splitPercentage}% of your session earnings will go to your selected destination.
                    {splitPercentage < 100 && !isHobbyist && ` The remaining ${100 - splitPercentage}% goes to your withdrawable balance.`}
                  </p>
                </div>
              )}

              {/* Hobbyist Info - Focus on Community Impact */}
              {(dashboard?.is_hobbyist || isHobbyist) && (
                <div className="p-4 bg-gradient-to-r from-pink-500/10 to-cyan-500/10 border border-pink-500/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Heart className="w-5 h-5 text-pink-500 dark:text-pink-400" />
                    <span className="text-pink-600 dark:text-pink-400 font-medium">Your Impact Matters</span>
                  </div>
                  <p className="text-foreground/80 text-sm">
                    As a community photographer, your focus is on the 'Stoke' you generate for athletes. 
                    Every session you shoot helps surfers build their portfolios and attract sponsors.
                  </p>
                  <div className="mt-3 p-2 bg-pink-500/10 rounded-lg text-center">
                    <p className="text-pink-600 dark:text-pink-300 text-xs">
                      You've helped athletes earn <span className="font-bold">${dashboard?.impact_score?.total_credits_given?.toFixed(0) || 0}</span> in gear credits
                    </p>
                  </div>
                </div>
              )}

              <Button
                onClick={saveSettings}
                disabled={saving || !selectedDestination}
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white"
                data-testid="save-impact-settings"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Save Impact Settings
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};
