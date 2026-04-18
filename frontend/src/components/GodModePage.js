import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { usePersona, ALL_PERSONAS, getExpandedRoleInfo } from '../contexts/PersonaContext';
import { useTheme } from '../contexts/ThemeContext';
import { ArrowLeft, Zap, Check, X, Camera, Radio, MapPin, Loader2, Upload, Play, Square, Image, Video } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { toast } from 'sonner';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import logger from '../utils/logger';

const API = process.env.REACT_APP_BACKEND_URL;

/**
 * God Mode Page - Admin Control Panel
 * - Persona switching for testing different user experiences
 * - Live Session Testing & Override panel for manual session control
 */
const GodModePage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { 
    activePersona, 
    setPersona, 
    exitPersonaMode, 
    isGodMode, 
    enableGodMode 
  } = usePersona();

  // State for Live Session Override
  const [simulatePhotographers, setSimulatePhotographers] = useState([]);
  const [surfSpots, setSurfSpots] = useState([]);
  const [loadingPhotographers, setLoadingPhotographers] = useState(false);
  const [_simulatingId, _setSimulatingId] = useState(null);
  
  // Enhanced session control state
  const [selectedPhotographer, setSelectedPhotographer] = useState('');
  const [selectedSpot, setSelectedSpot] = useState('');
  const [photographerSearch, setPhotographerSearch] = useState('');
  const [spotSearch, setSpotSearch] = useState('');
  const [sessionPrice, setSessionPrice] = useState('25');
  const [spotNotes, setSpotNotes] = useState('');
  const [conditionMedia, setConditionMedia] = useState(null);
  const [conditionMediaType, setConditionMediaType] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [activeSessions, setActiveSessions] = useState([]);
  const [forceStartLoading, setForceStartLoading] = useState(false);
  const [forceEndLoading, setForceEndLoading] = useState(null);
  const fileInputRef = useRef(null);

  // Redirect non-admins
  useEffect(() => {
    if (user && !user.is_admin) {
      toast.error('Admin access required');
      navigate('/settings');
    }
  }, [user, navigate]);

  // Auto-enable God Mode when accessing this page
  useEffect(() => {
    if (user?.is_admin && !isGodMode) {
      enableGodMode();
    }
  }, [user, isGodMode, enableGodMode]);

  // Fetch photographers, surf spots, and active sessions
  useEffect(() => {
    const fetchData = async () => {
      setLoadingPhotographers(true);
      try {
        const [photosRes, spotsRes, sessionsRes] = await Promise.all([
          apiClient.get(`/api/admin/photographers`),
          apiClient.get(`/api/surf-spots`),
          apiClient.get(`/api/admin/active-sessions`).catch(() => ({ data: [] }))
        ]);
        setSimulatePhotographers(photosRes.data);
        setSurfSpots(spotsRes.data);
        setActiveSessions(sessionsRes.data || []);
      } catch (error) {
        logger.error('Failed to fetch simulation data:', error);
      } finally {
        setLoadingPhotographers(false);
      }
    };
    
    if (user?.is_admin) {
      fetchData();
    }
  }, [user]);

  // Handle media file selection
  const handleMediaSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    
    if (!isVideo && !isImage) {
      toast.error('Please select an image or video file');
      return;
    }
    
    setConditionMediaType(isVideo ? 'video' : 'photo');
    
    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setMediaPreview(e.target.result);
      setConditionMedia(e.target.result);
    };
    reader.readAsDataURL(file);
  };

  // Clear media
  const clearMedia = () => {
    setConditionMedia(null);
    setConditionMediaType(null);
    setMediaPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Force Start Session
  const handleForceStart = async () => {
    if (!selectedPhotographer || !selectedSpot) {
      toast.error('Please select both a photographer and a surf spot');
      return;
    }
    
    setForceStartLoading(true);
    try {
      const response = await apiClient.post(`/api/admin/force-start-session`, {
        photographer_id: selectedPhotographer,
        spot_id: selectedSpot,
        session_price: parseFloat(sessionPrice) || 25,
        condition_media: conditionMedia,
        condition_media_type: conditionMediaType,
        spot_notes: spotNotes
      });
      
      toast.success(response.data.message, {
        icon: <Radio className="w-4 h-4 text-red-500 animate-pulse" />
      });
      
      // Refresh data
      const [photosRes, sessionsRes] = await Promise.all([
        apiClient.get(`/api/admin/photographers`),
        apiClient.get(`/api/admin/active-sessions`).catch(() => ({ data: [] }))
      ]);
      setSimulatePhotographers(photosRes.data);
      setActiveSessions(sessionsRes.data || []);
      
      // Reset form
      setSelectedPhotographer('');
      setSelectedSpot('');
      setSpotNotes('');
      clearMedia();
      
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to force start session');
    } finally {
      setForceStartLoading(false);
    }
  };

  // Force End Session
  const handleForceEnd = async (photographerId, _photographerName) => {
    setForceEndLoading(photographerId);
    try {
      const response = await apiClient.post(`/api/admin/force-end-session/${photographerId}`);
      
      toast.success(response.data.message, {
        icon: <Square className="w-4 h-4 text-gray-500" />
      });
      
      // Refresh data
      const [photosRes, sessionsRes] = await Promise.all([
        apiClient.get(`/api/admin/photographers`),
        apiClient.get(`/api/admin/active-sessions`).catch(() => ({ data: [] }))
      ]);
      setSimulatePhotographers(photosRes.data);
      setActiveSessions(sessionsRes.data || []);
      
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to force end session');
    } finally {
      setForceEndLoading(null);
    }
  };

  // Filter photographers by search
  const filteredPhotographers = simulatePhotographers.filter(p => 
    p.full_name?.toLowerCase().includes(photographerSearch.toLowerCase()) ||
    p.email?.toLowerCase().includes(photographerSearch.toLowerCase())
  );

  // Filter spots by search
  const filteredSpots = surfSpots.filter(s =>
    s.name?.toLowerCase().includes(spotSearch.toLowerCase()) ||
    s.region?.toLowerCase().includes(spotSearch.toLowerCase())
  );

  const isLight = theme === 'light';
  const bgClass = isLight ? 'bg-gray-50' : 'bg-background';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-card border-border';
  const textClass = isLight ? 'text-gray-900' : 'text-foreground';
  const textSecondary = isLight ? 'text-gray-600' : 'text-muted-foreground';

  // Get role info for color coding
  const _getRoleColor = (role) => {
    const info = getExpandedRoleInfo(role);
    return info?.color || 'cyan';
  };

  const handleSelectPersona = (persona) => {
    // Pass persona.id (string) to context, not the full object
    setPersona(persona.id);
    toast.success(`Now viewing as: ${persona.label}`, {
      icon: <Zap className="w-4 h-4 text-yellow-400" />
    });
  };

  const handleExitGodMode = () => {
    exitPersonaMode();
    toast.success('Exited God Mode - back to your real role');
    navigate('/settings');
  };

  if (!user?.is_admin) {
    return null;
  }

  return (
    <div className={`min-h-screen ${bgClass} pb-20`} data-testid="god-mode-page">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black/90 backdrop-blur-lg border-b border-zinc-800">
        <div className="flex items-center justify-between p-4">
          <button 
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>
          <h1 className="text-lg font-bold text-yellow-400 flex items-center gap-2">
            <Zap className="w-5 h-5" />
            God Mode
          </h1>
          <div className="w-16" /> {/* Spacer for centering */}
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-4">
        {/* Current Status */}
        <Card className={`${cardBgClass} border-yellow-500/30 bg-gradient-to-r from-yellow-500/10 to-orange-500/10`}>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-sm ${textSecondary}`}>Currently viewing as:</p>
                <p className={`font-bold ${textClass}`}>
                  {activePersona ? getExpandedRoleInfo(activePersona).label : user?.role || 'Your real role'}
                </p>
              </div>
              {activePersona && (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleExitGodMode}
                  className="border-red-500/50 text-red-400 hover:bg-red-500/10"
                >
                  <X className="w-4 h-4 mr-1" />
                  Exit
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Instructions */}
        <p className={`text-sm ${textSecondary} text-center`}>
          Select a persona below to test how different users experience the app
        </p>

        {/* Persona Grid */}
        <div className="grid grid-cols-1 gap-3">
          {ALL_PERSONAS.map((persona) => {
            // activePersona is now a string (the persona.id)
            const isActive = activePersona === persona.id;
            const roleInfo = getExpandedRoleInfo(persona.id);
            const colorClass = `text-${roleInfo?.color || 'cyan'}-400`;
            
            return (
              <button
                key={persona.id}
                onClick={() => handleSelectPersona(persona)}
                className={`p-4 rounded-xl border-2 transition-all duration-200 ${
                  isActive 
                    ? 'border-yellow-400 bg-yellow-400/10' 
                    : `${cardBgClass} hover:border-zinc-500`
                }`}
                data-testid={`persona-${persona.id.replace(/\s+/g, '-').toLowerCase()}`}
              >
                <div className="flex items-center gap-3">
                  <Avatar className="w-12 h-12 border-2 border-current">
                    <AvatarFallback className={`bg-zinc-800 ${colorClass}`}>
                      {persona.label.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className={`font-bold ${textClass}`}>{persona.label}</span>
                      {isActive && (
                        <span className="px-2 py-0.5 bg-yellow-400 text-black text-xs font-bold rounded-full">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <p className={`text-xs ${textSecondary}`}>
                      {roleInfo?.category || 'User'} • {roleInfo?.description || 'Test this role'}
                    </p>
                  </div>
                  {isActive && (
                    <Check className="w-5 h-5 text-yellow-400" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Quick Actions */}
        <Card className={cardBgClass}>
          <CardHeader>
            <CardTitle className={`${textClass} text-sm`}>Quick Navigation</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => navigate('/map')}
              className="border-zinc-700"
            >
              Test Map
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => navigate('/bookings')}
              className="border-zinc-700"
            >
              Test Bookings
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => navigate('/gallery')}
              className="border-zinc-700"
            >
              Test Gallery
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => navigate('/profile')}
              className="border-zinc-700"
            >
              Test Profile
            </Button>
          </CardContent>
        </Card>

        {/* ============ LIVE SESSION TESTING & OVERRIDE ============ */}
        <Card className={`${cardBgClass} border-red-500/30`}>
          <CardHeader>
            <CardTitle className={`${textClass} text-base flex items-center gap-2`}>
              <Radio className="w-5 h-5 text-red-500 animate-pulse" />
              Live Session Testing & Override
            </CardTitle>
            <p className={`text-xs ${textSecondary}`}>
              Manually inject photographers into "Live" state for system testing. Sessions behave exactly like user-initiated ones.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingPhotographers ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                <span className={`ml-2 text-sm ${textSecondary}`}>Loading data...</span>
              </div>
            ) : (
              <>
                {/* Force Start Section */}
                <div className="p-4 rounded-lg border border-zinc-700 bg-zinc-800/50 space-y-4">
                  <h3 className={`font-bold text-sm ${textClass} flex items-center gap-2`}>
                    <Play className="w-4 h-4 text-green-500" />
                    Force Start Session
                  </h3>
                  
                  {/* Photographer Selector with Search */}
                  <div>
                    <label className={`text-xs ${textSecondary} mb-1 block`}>Photographer</label>
                    <Input
                      placeholder="Search photographers..."
                      value={photographerSearch}
                      onChange={(e) => setPhotographerSearch(e.target.value)}
                      className="mb-2 bg-zinc-900 border-zinc-600 h-9 text-sm"
                    />
                    <select
                      value={selectedPhotographer}
                      onChange={(e) => setSelectedPhotographer(e.target.value)}
                      className="w-full h-10 px-3 rounded-md bg-zinc-900 border border-zinc-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    >
                      <option value="">Select photographer...</option>
                      {filteredPhotographers.map((p) => (
                        <option key={p.id} value={p.id} disabled={p.is_shooting}>
                          {p.full_name} {p.is_shooting ? '(LIVE)' : ''} - {p.role}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  {/* Location Selector with Search */}
                  <div>
                    <label className={`text-xs ${textSecondary} mb-1 block`}>Surf Spot Location</label>
                    <Input
                      placeholder="Search spots..."
                      value={spotSearch}
                      onChange={(e) => setSpotSearch(e.target.value)}
                      className="mb-2 bg-zinc-900 border-zinc-600 h-9 text-sm"
                    />
                    <select
                      value={selectedSpot}
                      onChange={(e) => setSelectedSpot(e.target.value)}
                      className="w-full h-10 px-3 rounded-md bg-zinc-900 border border-zinc-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    >
                      <option value="">Select surf spot...</option>
                      {filteredSpots.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} - {s.region}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  {/* Session Price */}
                  <div>
                    <label className={`text-xs ${textSecondary} mb-1 block`}>Buy-in Price ($)</label>
                    <Input
                      type="number"
                      value={sessionPrice}
                      onChange={(e) => setSessionPrice(e.target.value)}
                      className="bg-zinc-900 border-zinc-600 h-9 text-sm w-24"
                      min="0"
                    />
                  </div>
                  
                  {/* Conditions Media Upload */}
                  <div>
                    <label className={`text-xs ${textSecondary} mb-1 block`}>Conditions Media (Optional)</label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,video/*"
                      onChange={handleMediaSelect}
                      className="hidden"
                    />
                    {mediaPreview ? (
                      <div className="relative">
                        {conditionMediaType === 'video' ? (
                          <video src={mediaPreview} className="w-full h-32 object-cover rounded-lg" controls />
                        ) : (
                          <img src={mediaPreview} alt="Conditions" className="w-full h-32 object-cover rounded-lg" />
                        )}
                        <button
                          onClick={clearMedia}
                          className="absolute top-1 right-1 p-1 bg-black/60 rounded-full hover:bg-black/80"
                        >
                          <X className="w-4 h-4 text-white" />
                        </button>
                        <div className="absolute bottom-1 left-1 px-2 py-0.5 bg-black/60 rounded text-xs text-white flex items-center gap-1">
                          {conditionMediaType === 'video' ? <Video className="w-3 h-3" /> : <Image className="w-3 h-3" />}
                          {conditionMediaType}
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full border-dashed border-zinc-600 h-20"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        Upload Photo/Video
                      </Button>
                    )}
                  </div>
                  
                  {/* Spot Notes */}
                  <div>
                    <label className={`text-xs ${textSecondary} mb-1 block`}>Spot Notes (Optional)</label>
                    <Textarea
                      placeholder="e.g., 3-4ft, glassy, offshore winds..."
                      value={spotNotes}
                      onChange={(e) => setSpotNotes(e.target.value)}
                      className="bg-zinc-900 border-zinc-600 text-sm h-16 resize-none"
                    />
                  </div>
                  
                  {/* Force Start Button */}
                  <Button
                    onClick={handleForceStart}
                    disabled={forceStartLoading || !selectedPhotographer || !selectedSpot}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-bold"
                  >
                    {forceStartLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Play className="w-4 h-4 mr-2" />
                    )}
                    Force Start Session
                  </Button>
                </div>
                
                {/* Active Sessions / Force End Section */}
                <div className="p-4 rounded-lg border border-zinc-700 bg-zinc-800/50 space-y-3">
                  <h3 className={`font-bold text-sm ${textClass} flex items-center gap-2`}>
                    <Square className="w-4 h-4 text-red-500" />
                    Active Sessions ({activeSessions.length})
                  </h3>
                  
                  {activeSessions.length === 0 ? (
                    <p className={`text-sm ${textSecondary} text-center py-4`}>
                      No active sessions
                    </p>
                  ) : (
                    activeSessions.map((session) => (
                      <div 
                        key={session.id}
                        className="p-3 rounded-lg border border-red-500/30 bg-red-500/5 flex items-center gap-3"
                      >
                        <Avatar className="w-10 h-10">
                          <AvatarImage src={session.photographer_avatar} />
                          <AvatarFallback className="bg-zinc-700">
                            <Camera className="w-4 h-4" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium text-sm ${textClass} truncate flex items-center gap-2`}>
                            {session.photographer_name}
                            <span className="px-1.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded animate-pulse">
                              LIVE
                            </span>
                          </p>
                          <p className={`text-xs ${textSecondary} flex items-center gap-1`}>
                            <MapPin className="w-3 h-3" />
                            {session.spot_name}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleForceEnd(session.photographer_id, session.photographer_name)}
                          disabled={forceEndLoading === session.photographer_id}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          {forceEndLoading === session.photographer_id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <Square className="w-3 h-3 mr-1" />
                              Force End
                            </>
                          )}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default GodModePage;
