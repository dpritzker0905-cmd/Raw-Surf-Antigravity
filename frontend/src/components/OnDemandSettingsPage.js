import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import axios from 'axios';
import { 
  MapPin, DollarSign, Zap, Check, Loader2,
  Navigation, TrendingUp, Info, Waves, ChevronDown, ChevronUp,
  Settings
} from 'lucide-react';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Badge } from './ui/badge';
import { NumericStepper } from './ui/numeric-stepper';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { toast } from 'sonner';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * On-Demand Settings Page - For Pro/Approved Pro photographers
 * 
 * UI STANDARDS (Matches Gallery & Bookings):
 * - NO internal header/footer - matches Gallery content start
 * - Numeric Stepper inputs (no sliders)
 * - Standard content container (p-4 max-w-6xl mx-auto)
 * - Standard Primary Action Button (not full-width bar)
 * - 16px side gutters (p-4)
 * - Bottom safe zone (pb-24)
 */
export const OnDemandSettingsPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { theme } = useTheme();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [nearbySpots, setNearbySpots] = useState([]);
  const [selectedSpots, setSelectedSpots] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  
  // On-Demand Status Toggle
  const [onDemandActive, setOnDemandActive] = useState(false);
  const [selectedOnDemandSpot, setSelectedOnDemandSpot] = useState(null);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [isLiveShooting, setIsLiveShooting] = useState(false);  // Track if currently live shooting
  
  // Pricing settings (GPS and pricing logic preserved)
  const [baseRate, setBaseRate] = useState(75);
  const [peakPricingEnabled, setPeakPricingEnabled] = useState(false);
  const [peakMultiplier, setPeakMultiplier] = useState(1.5);
  const [onDemandPhotosIncluded, setOnDemandPhotosIncluded] = useState(3);
  const [onDemandFullGallery, setOnDemandFullGallery] = useState(false);
  
  // UI state
  const [showSpotsList, setShowSpotsList] = useState(true);
  const [showPricingSection, setShowPricingSection] = useState(true);
  
  // ============ THEME CLASSES - Beach Mode Support (matches Gallery/Bookings) ============
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const cardBg = isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-900 border-zinc-800';
  const borderClass = isLight ? 'border-gray-200' : 'border-zinc-800';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  const sectionBg = isLight ? 'bg-gray-50' : isBeach ? 'bg-zinc-900' : 'bg-zinc-800/50';
  
  // Check if user can access this page (Photographer, Pro, Approved Pro - NOT Hobbyist/Grom Parent)
  const canAccess = ['Photographer', 'Pro', 'Approved Pro'].includes(user?.role);
  
  // Geographic Range Logic (Role-Based) - LOGIC PRESERVED
  const getGeographicRadius = () => {
    if (user?.role === 'Approved Pro') return { min: 30, max: 50, default: 40 };
    if (user?.role === 'Pro') return { min: 30, max: 50, default: 40 };
    return { min: 10, max: 20, default: 15 }; // Standard Photographer
  };
  
  const geoRadius = getGeographicRadius();
  const isPro = ['Approved Pro', 'Pro'].includes(user?.role);
  
  // Check if navigated from Photo Hub init flow
  const searchParams = new URLSearchParams(window.location.search);
  const isInitFlow = searchParams.get('init') === 'true';
  
  useEffect(() => {
    if (!canAccess) {
      toast.error('On-Demand Settings is only available for Pro photographers');
      navigate('/map');
      return;
    }
    
    fetchSettings();
    requestLocation();
  }, [canAccess, navigate]);
  
  const requestLocation = () => {
    setLocationLoading(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };
          setUserLocation(location);
          fetchNearbySpots(location);
          setLocationLoading(false);
        },
        (error) => {
          logger.error('Geolocation error:', error);
          setLocationLoading(false);
          toast.error('Unable to get location. Please enable GPS.');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      setLocationLoading(false);
      toast.error('Geolocation not supported by your browser');
    }
  };
  
  const fetchNearbySpots = async (location) => {
    try {
      // Use role-based geographic radius - LOGIC PRESERVED
      const response = await axios.get(`${API}/surf-spots/nearby`, {
        params: {
          latitude: location.latitude,
          longitude: location.longitude,
          radius_miles: geoRadius.default
        }
      });
      setNearbySpots(response.data || []);
    } catch (error) {
      logger.error('Failed to fetch nearby spots:', error);
      try {
        const fallbackResponse = await axios.get(`${API}/surf-spots?limit=30`);
        setNearbySpots(fallbackResponse.data || []);
      } catch (e) {
        logger.error('Fallback also failed:', e);
      }
    }
  };
  
  const fetchSettings = async () => {
    try {
      const response = await axios.get(`${API}/photographer/${user?.id}/on-demand-settings`);
      if (response.data) {
        setBaseRate(response.data.base_rate || 75);
        setPeakPricingEnabled(response.data.peak_pricing_enabled || false);
        setPeakMultiplier(response.data.peak_multiplier || 1.5);
        setSelectedSpots(response.data.claimed_spots || []);
        setOnDemandPhotosIncluded(response.data.on_demand_photos_included || 3);
        setOnDemandFullGallery(response.data.on_demand_full_gallery || false);
      }
      
      // Also fetch on-demand status
      const statusResponse = await axios.get(`${API}/photographer/${user?.id}/on-demand-status`);
      if (statusResponse.data) {
        setOnDemandActive(statusResponse.data.is_available || false);
        if (statusResponse.data.spot_name) {
          setSelectedOnDemandSpot({
            id: statusResponse.data.spot_id,
            name: statusResponse.data.spot_name
          });
        }
      }
      
      // Also fetch photographer status to check if live shooting (for mutual exclusivity)
      try {
        const photographerStatusRes = await axios.get(`${API}/photographer/${user?.id}/status`);
        setIsLiveShooting(photographerStatusRes.data.is_shooting || false);
      } catch (e) {
        logger.error('Error fetching photographer status:', e);
      }
    } catch (error) {
      logger.error('Failed to fetch settings:', error);
    } finally {
      setLoading(false);
    }
  };
  
  // Toggle On-Demand Status
  const toggleOnDemandStatus = async () => {
    if (togglingStatus) return;
    
    // Check mutual exclusivity: cannot enable On-Demand while live shooting
    if (!onDemandActive && isLiveShooting) {
      toast.error('Cannot enable On-Demand while in an active live session. Please end your session first from Live Sessions.');
      return;
    }
    
    setTogglingStatus(true);
    try {
      if (onDemandActive) {
        // Turn off
        await axios.post(`${API}/photographer/${user.id}/on-demand-toggle`, {
          is_available: false
        });
        setOnDemandActive(false);
        setSelectedOnDemandSpot(null);
        toast.success('On-Demand mode deactivated');
      } else {
        // Need a spot to turn on - use first selected spot or first nearby spot
        const spotToUse = selectedSpots.length > 0 
          ? nearbySpots.find(s => selectedSpots.includes(s.id))
          : nearbySpots[0];
          
        if (!spotToUse) {
          toast.error('Please select at least one coverage spot first');
          setTogglingStatus(false);
          return;
        }
        
        await axios.post(`${API}/photographer/${user.id}/on-demand-toggle`, {
          is_available: true,
          spot_id: spotToUse.id,
          spot_name: spotToUse.name,
          latitude: spotToUse.latitude,
          longitude: spotToUse.longitude
        });
        setOnDemandActive(true);
        setSelectedOnDemandSpot(spotToUse);
        toast.success(`On-Demand activated at ${spotToUse.name}!`);
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update On-Demand status');
    } finally {
      setTogglingStatus(false);
    }
  };
  
  // Checkbox selection (multiple spots)
  const toggleSpotSelection = (spotId) => {
    setSelectedSpots(prev => 
      prev.includes(spotId) 
        ? prev.filter(id => id !== spotId)
        : [...prev, spotId]
    );
  };
  
  const selectAllSpots = () => {
    setSelectedSpots(nearbySpots.map(s => s.id));
  };
  
  const clearAllSpots = () => {
    setSelectedSpots([]);
  };
  
  const saveSettings = async () => {
    setSaving(true);
    try {
      await axios.post(`${API}/photographer/${user.id}/on-demand-settings`, {
        base_rate: baseRate,
        peak_pricing_enabled: peakPricingEnabled,
        peak_multiplier: peakMultiplier,
        claimed_spots: selectedSpots,
        latitude: userLocation?.latitude,
        longitude: userLocation?.longitude,
        on_demand_photos_included: onDemandPhotosIncluded,
        on_demand_full_gallery: onDemandFullGallery
      });
      
      toast.success('On-Demand settings saved!');
      
      // If from init flow, navigate back to map
      if (isInitFlow) {
        navigate('/map');
      }
    } catch (error) {
      logger.error('Failed to save settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
      </div>
    );
  }
  
  return (
    // MATCHES GALLERY STRUCTURE: p-4 max-w-6xl mx-auto, NO internal header/footer
    <div className="p-4 max-w-6xl mx-auto pb-24" data-testid="on-demand-settings-page">
      {/* Header - Same style as Gallery */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className={`text-2xl font-bold ${textPrimary} flex items-center gap-2`}>
            <MapPin className="w-7 h-7 text-green-400" />
            On-Demand Settings
          </h1>
          <p className={`${textSecondary} text-sm mt-1`}>
            {selectedSpots.length} coverage spots • {geoRadius.min}-{geoRadius.max} mile range
          </p>
        </div>
        
        <Button
          onClick={saveSettings}
          disabled={saving}
          className="bg-gradient-to-r from-green-400 to-cyan-400 text-black font-bold"
          data-testid="save-settings-btn"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
      
      {/* On-Demand Status Toggle - Primary Action */}
      <Card className={`mb-6 ${onDemandActive 
        ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-400/50' 
        : cardBg}`}
      >
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                onDemandActive ? 'bg-yellow-500/30' : 'bg-zinc-700'
              }`}>
                <Zap className={`w-6 h-6 ${onDemandActive ? 'text-yellow-400' : 'text-gray-400'}`} />
              </div>
              <div>
                <p className={`font-bold ${textPrimary}`}>On-Demand Status</p>
                <p className={`text-sm ${onDemandActive ? 'text-yellow-300' : textSecondary}`}>
                  {onDemandActive 
                    ? `Active at: ${selectedOnDemandSpot?.name || 'Your Area'}` 
                    : selectedSpots.length > 0 
                      ? 'Ready to activate' 
                      : 'Select coverage spots below'}
                </p>
              </div>
            </div>
            <button
              onClick={toggleOnDemandStatus}
              disabled={togglingStatus || (selectedSpots.length === 0 && !onDemandActive)}
              className={`w-14 h-8 rounded-full transition-colors relative ${
                onDemandActive 
                  ? 'bg-yellow-500' 
                  : selectedSpots.length > 0 
                    ? 'bg-zinc-600 hover:bg-zinc-500' 
                    : 'bg-zinc-700 opacity-50 cursor-not-allowed'
              }`}
              data-testid="on-demand-status-toggle"
            >
              {togglingStatus ? (
                <Loader2 className="w-5 h-5 animate-spin absolute top-1.5 left-1/2 -translate-x-1/2 text-white" />
              ) : (
                <span className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-transform shadow-md ${
                  onDemandActive ? 'right-1' : 'left-1'
                }`} />
              )}
            </button>
          </div>
          
          {/* Active spot info */}
          {onDemandActive && selectedOnDemandSpot && (
            <div className="mt-3 pt-3 border-t border-yellow-500/30 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-green-400" />
              <span className={`text-sm text-green-300`}>
                Accepting requests at {selectedOnDemandSpot.name}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Init Flow Banner */}
      {isInitFlow && (
        <div className={`mb-6 p-4 rounded-2xl bg-gradient-to-r ${isPro ? 'from-purple-500/20 to-cyan-500/20 border-purple-500/30' : 'from-cyan-500/20 to-blue-500/20 border-cyan-500/30'} border`}>
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl ${isPro ? 'bg-purple-500/30' : 'bg-cyan-500/30'} flex items-center justify-center`}>
              <Zap className={`w-6 h-6 ${isPro ? 'text-purple-400' : 'text-cyan-400'}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className={`font-bold ${textPrimary}`}>Go On-Demand</p>
                <Badge className={isPro ? 'bg-purple-500 text-white' : 'bg-cyan-500 text-white'}>
                  {geoRadius.min}-{geoRadius.max} mi
                </Badge>
              </div>
              <p className={`text-sm ${textSecondary}`}>
                {isPro 
                  ? 'Pro coverage: Select spots within your extended range'
                  : 'Standard coverage: Select spots within your local range'}
              </p>
            </div>
          </div>
        </div>
      )}
      
      {/* On-Demand Pricing Card - Same style as Gallery Pricing Card */}
      <Card className={`mb-6 ${cardBg}`}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className={`text-lg ${textPrimary} flex items-center gap-2`}>
              <DollarSign className="w-5 h-5 text-green-400" />
              On-Demand Pricing
            </CardTitle>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setShowPricingSection(!showPricingSection)}
              className={borderClass}
            >
              <Settings className="w-4 h-4 mr-2" />
              {showPricingSection ? 'Hide' : 'Show'}
            </Button>
          </div>
        </CardHeader>
        {showPricingSection && (
          <CardContent className="space-y-6">
            {/* Preview Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className={`p-3 rounded-xl ${sectionBg}`}>
                <p className={`text-xs ${textSecondary} mb-1`}>Base Rate</p>
                <p className="text-xl font-bold text-green-400">${baseRate}/hr</p>
              </div>
              <div className={`p-3 rounded-xl ${sectionBg}`}>
                <p className={`text-xs ${textSecondary} mb-1`}>Peak Rate</p>
                <p className="text-xl font-bold text-amber-400">
                  {peakPricingEnabled ? `$${(baseRate * peakMultiplier).toFixed(0)}/hr` : 'OFF'}
                </p>
              </div>
              <div className={`p-3 rounded-xl ${sectionBg}`}>
                <p className={`text-xs ${textSecondary} mb-1`}>Photos Included</p>
                <p className={`text-xl font-bold ${onDemandFullGallery ? 'text-green-400' : textPrimary}`}>
                  {onDemandFullGallery ? '∞ Full' : onDemandPhotosIncluded}
                </p>
              </div>
              <div className={`p-3 rounded-xl ${sectionBg}`}>
                <p className={`text-xs ${textSecondary} mb-1`}>Coverage</p>
                <p className="text-xl font-bold text-cyan-400">{selectedSpots.length} spots</p>
              </div>
            </div>
            
            {/* Base Rate - NUMERIC STEPPER */}
            <NumericStepper
              label="On-Demand Base Rate"
              value={baseRate}
              onChange={setBaseRate}
              min={25}
              max={300}
              step={5}
              prefix="$"
              suffix="/hr"
              description="Premium rate for On-Demand requests (above standard bookings)"
              theme={theme}
            />
            
            {/* Peak/Swell Pricing Toggle */}
            <div className={`p-4 rounded-xl ${isLight ? 'bg-amber-50 border-amber-200' : 'bg-amber-500/10 border-amber-500/30'} border`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Waves className="w-5 h-5 text-amber-400" />
                  <div>
                    <p className={`font-medium ${textPrimary}`}>Peak/Swell Pricing</p>
                    <p className={`text-xs ${textSecondary}`}>Auto-increase rate during high demand</p>
                  </div>
                </div>
                <Switch
                  checked={peakPricingEnabled}
                  onCheckedChange={setPeakPricingEnabled}
                />
              </div>
              
              {peakPricingEnabled && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-sm ${textPrimary}`}>Peak Multiplier</span>
                    <span className="text-lg font-bold text-amber-400">{peakMultiplier}x</span>
                  </div>
                  <div className="flex gap-2">
                    {[1.25, 1.5, 1.75, 2.0].map(mult => (
                      <button
                        key={mult}
                        onClick={() => setPeakMultiplier(mult)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                          peakMultiplier === mult
                            ? 'bg-amber-500 text-black'
                            : isLight ? 'bg-gray-200 text-gray-700' : 'bg-zinc-700 text-gray-300'
                        }`}
                      >
                        {mult}x
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            {/* Photos Included - NUMERIC STEPPER */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <label className={`font-medium ${textPrimary}`}>Photos Included</label>
                  {onDemandFullGallery && (
                    <Badge className="bg-green-500 text-white text-xs">FULL GALLERY</Badge>
                  )}
                </div>
              </div>
              
              {/* Full Gallery Toggle */}
              <div className={`p-3 rounded-xl mb-4 ${isLight ? 'bg-green-50 border-green-200' : 'bg-green-500/10 border-green-500/30'} border`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-green-400" />
                    <div>
                      <p className={`font-medium ${textPrimary}`}>Full Gallery Access</p>
                      <p className={`text-xs ${textSecondary}`}>All photos included - unlimited downloads</p>
                    </div>
                  </div>
                  <Switch
                    checked={onDemandFullGallery}
                    onCheckedChange={setOnDemandFullGallery}
                  />
                </div>
              </div>
              
              {!onDemandFullGallery && (
                <NumericStepper
                  value={onDemandPhotosIncluded}
                  onChange={setOnDemandPhotosIncluded}
                  min={0}
                  max={999}
                  step={1}
                  description="Photos included free with on-demand buy-in. Additional charged per resolution."
                  theme={theme}
                />
              )}
            </div>
          </CardContent>
        )}
      </Card>
      
      {/* Coverage Spots Card - Same style as Gallery Folders */}
      <Card className={cardBg}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className={`text-lg ${textPrimary} flex items-center gap-2`}>
              <MapPin className="w-5 h-5 text-cyan-400" />
              Coverage Spots
              <Badge className={isPro ? 'bg-purple-500 text-white' : 'bg-cyan-500 text-white'}>
                {geoRadius.min}-{geoRadius.max} mi
              </Badge>
            </CardTitle>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setShowSpotsList(!showSpotsList)}
              className={borderClass}
            >
              {showSpotsList ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </CardHeader>
        
        {showSpotsList && (
          <CardContent>
            {/* Location Status */}
            <div className={`p-3 rounded-xl mb-4 ${sectionBg} flex items-center gap-3`}>
              <div className={`w-8 h-8 rounded-lg ${userLocation ? 'bg-green-500/20' : 'bg-amber-500/20'} flex items-center justify-center`}>
                <Navigation className={`w-4 h-4 ${userLocation ? 'text-green-400' : 'text-amber-400'}`} />
              </div>
              <div className="flex-1">
                <p className={`text-sm font-medium ${textPrimary}`}>
                  {userLocation ? 'GPS Active' : 'Location unavailable'}
                </p>
              </div>
              {!userLocation && !locationLoading && (
                <Button onClick={requestLocation} size="sm" variant="outline">
                  Enable
                </Button>
              )}
              {locationLoading && (
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
              )}
            </div>
            
            {/* Quick Actions */}
            <div className="flex gap-2 mb-4">
              <Button variant="outline" size="sm" onClick={selectAllSpots} className={`flex-1 ${borderClass}`}>
                Select All
              </Button>
              <Button variant="outline" size="sm" onClick={clearAllSpots} className={`flex-1 ${borderClass}`}>
                Clear All
              </Button>
            </div>
            
            {/* Spots List - High-Contrast Checkbox Style */}
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1" style={{ WebkitOverflowScrolling: 'touch' }}>
              {nearbySpots.length === 0 ? (
                <p className={`text-center py-4 ${textSecondary}`}>
                  {locationLoading ? 'Finding nearby spots...' : 'No spots found nearby'}
                </p>
              ) : (
                nearbySpots.map(spot => (
                  <button
                    key={spot.id}
                    onClick={() => toggleSpotSelection(spot.id)}
                    className={`w-full p-3 rounded-xl flex items-center gap-3 transition-all border-2 ${
                      selectedSpots.includes(spot.id)
                        ? 'bg-cyan-500/20 border-cyan-500'
                        : isLight ? 'bg-white border-gray-200 hover:border-gray-300' : 'bg-zinc-800/50 border-zinc-700 hover:border-zinc-600'
                    }`}
                    data-testid={`spot-${spot.id}`}
                  >
                    {/* Checkbox Style Circle */}
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                      selectedSpots.includes(spot.id) 
                        ? 'border-cyan-500 bg-cyan-500' 
                        : isLight ? 'border-gray-400' : 'border-zinc-500'
                    }`}>
                      {selectedSpots.includes(spot.id) && (
                        <Check className="w-4 h-4 text-white" />
                      )}
                    </div>
                    
                    <div className="flex-1 text-left">
                      <p className={`font-medium ${textPrimary}`}>{spot.name}</p>
                      <p className={`text-xs ${textSecondary}`}>
                        {spot.region || spot.city || 'Florida'}
                        {spot.distance_miles && ` • ${spot.distance_miles.toFixed(1)} mi`}
                      </p>
                    </div>
                    
                    {spot.active_photographers_count > 0 && (
                      <Badge className="bg-green-500/20 text-green-400 text-xs">
                        {spot.active_photographers_count} active
                      </Badge>
                    )}
                  </button>
                ))
              )}
            </div>
            
            <p className={`text-xs ${textSecondary} mt-3 flex items-start gap-1`}>
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
              Surfers searching at these spots will see you in On-Demand results
            </p>
          </CardContent>
        )}
      </Card>
    </div>
  );
};

export default OnDemandSettingsPage;
