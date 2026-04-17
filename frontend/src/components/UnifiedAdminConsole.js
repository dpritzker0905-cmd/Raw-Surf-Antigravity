import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePersona, ALL_PERSONAS, getExpandedRoleInfo } from '../contexts/PersonaContext';
import { useTheme } from '../contexts/ThemeContext';
import axios from 'axios';
import {
  Shield, Zap, Users, DollarSign, Search, Ban, CheckCircle, XCircle, 
  Loader2, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Eye, Trash2, UserX, UserCheck, 
  Crown, Trophy, Radio, MapPin, Camera, Play, Square, Image, Video, 
  Upload, X, Check, User, FileText, ArrowLeft, Settings, Activity,
  Megaphone, History, RefreshCw, TrendingUp, PieChart, BarChart3, Wallet, AlertCircle, Edit, BarChart2,
  Headphones, Server, Flag, Mail, Layout, Lock
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { toast } from 'sonner';
import { AdminCompetitionVerification } from './AdminCompetitionVerification';
import { AdminPricingEditor } from './admin/AdminPricingEditor';
import { AdminPrecisionQueue } from './admin/AdminPrecisionQueue';
import { AdminSpotEditor } from './admin/AdminSpotEditor';
import { AdminUnifiedAnalytics } from './admin/AdminUnifiedAnalytics';
import { AdminModerationDashboard } from './admin/AdminModerationDashboard';
import { AdminP1Dashboard } from './admin/AdminP1Dashboard';
import { AdminSupportDashboard } from './admin/AdminSupportDashboard';
import { AdminSystemDashboard } from './admin/AdminSystemDashboard';
import { AdminFinanceDashboard } from './admin/AdminFinanceDashboard';
import { AdminContentModDashboard } from './admin/AdminContentModDashboard';
import { AdminCommunicationsDashboard } from './admin/AdminCommunicationsDashboard';
import { AdminContentMgmtDashboard } from './admin/AdminContentMgmtDashboard';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Unified Admin Console - Combines Admin Dashboard + God Mode
 * Single entry point for all admin functionality
 */
const UnifiedAdminConsole = () => {
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

  // Tab state
  const [activeTab, setActiveTab] = useState('overview');
  
  // Data states
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [userToSuspend, setUserToSuspend] = useState(null);
  
  // Live Session Override states
  const [simulatePhotographers, setSimulatePhotographers] = useState([]);
  const [surfSpots, setSurfSpots] = useState([]);
  const [loadingPhotographers, setLoadingPhotographers] = useState(false);
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
  const [seedingSpots, setSeedingSpots] = useState(false);
  const fileInputRef = useRef(null);

  // Site Access Control states
  const [siteSettings, setSiteSettings] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Theme classes
  const isLight = theme === 'light';
  const bgClass = isLight ? 'bg-gray-50' : 'bg-background';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-card border-border';
  const textClass = isLight ? 'text-gray-900' : 'text-foreground';
  const textSecondary = isLight ? 'text-gray-600' : 'text-muted-foreground';

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

  // Fetch admin data
  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [statsRes, usersRes, logsRes, settingsRes] = await Promise.all([
        axios.get(`${API}/admin/stats?admin_id=${user.id}`).catch(() => ({ data: null })),
        axios.get(`${API}/admin/users?admin_id=${user.id}&limit=50`).catch(() => ({ data: { users: [] } })),
        axios.get(`${API}/admin/logs?admin_id=${user.id}&limit=50`).catch(() => ({ data: [] })),
        axios.get(`${API}/admin/platform-settings?admin_id=${user.id}`).catch(() => ({ data: null }))
      ]);
      
      setStats(statsRes.data);
      setUsers(usersRes.data.users || []);
      setLogs(logsRes.data || []);
      setSiteSettings(settingsRes.data || { access_code_enabled: false, access_code: '' });
    } catch (error) {
      logger.error('Admin data error:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  // Fetch session simulation data
  const fetchSessionData = useCallback(async () => {
    if (!user?.is_admin) return;
    setLoadingPhotographers(true);
    try {
      const [photosRes, spotsRes, sessionsRes] = await Promise.all([
        axios.get(`${API}/admin/photographers`).catch(() => ({ data: [] })),
        axios.get(`${API}/surf-spots`).catch(() => ({ data: [] })),
        axios.get(`${API}/admin/active-sessions`).catch(() => ({ data: [] }))
      ]);
      setSimulatePhotographers(photosRes.data || []);
      setSurfSpots(spotsRes.data || []);
      setActiveSessions(sessionsRes.data || []);
    } catch (error) {
      logger.error('Failed to fetch simulation data:', error);
    } finally {
      setLoadingPhotographers(false);
    }
  }, [user?.is_admin]);

  useEffect(() => {
    if (user?.id) {
      fetchData();
      fetchSessionData();
    }
  }, [user?.id, fetchData, fetchSessionData]);

  // User management handlers
  const handleSearch = async () => {
    try {
      const response = await axios.get(
        `${API}/admin/users?admin_id=${user.id}&search=${searchQuery}&limit=50`
      );
      setUsers(response.data.users);
    } catch (error) {
      toast.error('Search failed');
    }
  };

  const handleSuspend = async () => {
    if (!userToSuspend || !suspendReason) return;
    try {
      await axios.post(
        `${API}/admin/users/${userToSuspend.id}/suspend?admin_id=${user.id}`,
        { reason: suspendReason }
      );
      toast.success(`${userToSuspend.email} suspended`);
      setShowSuspendModal(false);
      setSuspendReason('');
      setUserToSuspend(null);
      fetchData();
    } catch (error) {
      toast.error('Failed to suspend user');
    }
  };

  const handleSeedMissingSpots = async () => {
    if (!user?.is_admin) return;
    setSeedingSpots(true);
    let successCount = 0;
    
    const missingSpots = [
      {"name": "Cox Bay", "region": "Tofino", "country": "Canada", "latitude": 49.1023, "longitude": -125.8770, "difficulty": "Intermediate", "wave_type": "Beach Break"},
      {"name": "Chesterman Beach", "region": "Tofino", "country": "Canada", "latitude": 49.1172, "longitude": -125.8890, "difficulty": "Beginner", "wave_type": "Beach Break"},
      {"name": "Lawrencetown Beach", "region": "Nova Scotia", "country": "Canada", "latitude": 44.6460, "longitude": -63.3510, "difficulty": "Intermediate", "wave_type": "Beach Break"},
      {"name": "Martinique Beach", "region": "Nova Scotia", "country": "Canada", "latitude": 44.7070, "longitude": -63.1490, "difficulty": "Intermediate", "wave_type": "Beach Break"},
      {"name": "Sandvik", "region": "Reykjanes", "country": "Iceland", "latitude": 63.8500, "longitude": -22.7160, "difficulty": "Intermediate", "wave_type": "Beach Break"},
      {"name": "Thorlasnes", "region": "South Coast", "country": "Iceland", "latitude": 63.8440, "longitude": -22.4280, "difficulty": "Advanced", "wave_type": "Reef Break"},
      {"name": "Unstad", "region": "Lofoten Islands", "country": "Norway", "latitude": 68.2670, "longitude": 13.5850, "difficulty": "Advanced", "wave_type": "Point Break"},
      {"name": "Hoddevik", "region": "Stadlandet", "country": "Norway", "latitude": 62.1190, "longitude": 5.1430, "difficulty": "Intermediate", "wave_type": "Beach Break"},
      {"name": "Playa Grande", "region": "Mar del Plata", "country": "Argentina", "latitude": -38.0330, "longitude": -57.5330, "difficulty": "Intermediate", "wave_type": "Beach Break"},
      {"name": "Biologia", "region": "Mar del Plata", "country": "Argentina", "latitude": -38.0300, "longitude": -57.5300, "difficulty": "Beginner", "wave_type": "Beach Break"},
      {"name": "Miramar", "region": "Buenos Aires", "country": "Argentina", "latitude": -38.2830, "longitude": -57.8330, "difficulty": "Intermediate", "wave_type": "Beach Break"},
      {"name": "La Olla", "region": "Punta del Este", "country": "Uruguay", "latitude": -34.9540, "longitude": -54.9350, "difficulty": "Intermediate", "wave_type": "Beach Break"},
      {"name": "Playa El Emir", "region": "Punta del Este", "country": "Uruguay", "latitude": -34.9610, "longitude": -54.9380, "difficulty": "Intermediate", "wave_type": "Beach Break"},
      {"name": "Los Botes", "region": "La Paloma", "country": "Uruguay", "latitude": -34.6620, "longitude": -54.1610, "difficulty": "Intermediate", "wave_type": "Point Break"},
      {"name": "Santa Iria", "region": "Sao Miguel", "country": "Portugal", "latitude": 37.8180, "longitude": -25.5900, "difficulty": "Intermediate", "wave_type": "Reef Break"},
      {"name": "Ribeira Grande", "region": "Sao Miguel", "country": "Portugal", "latitude": 37.8220, "longitude": -25.5220, "difficulty": "Intermediate", "wave_type": "Beach Break"},
      {"name": "Faja da Caldeira", "region": "Sao Jorge", "country": "Portugal", "latitude": 38.6250, "longitude": -27.9300, "difficulty": "Advanced", "wave_type": "Point Break"},
      {"name": "Jardim do Mar", "region": "Madeira", "country": "Portugal", "latitude": 32.7380, "longitude": -17.2120, "difficulty": "Expert", "wave_type": "Point Break"},
      {"name": "Paul do Mar", "region": "Madeira", "country": "Portugal", "latitude": 32.7520, "longitude": -17.2340, "difficulty": "Advanced", "wave_type": "Point Break"},
      {"name": "Ponta Preta", "region": "Sal", "country": "Cape Verde", "latitude": 16.5860, "longitude": -22.9230, "difficulty": "Expert", "wave_type": "Reef Break"},
      {"name": "Kite Beach", "region": "Sal", "country": "Cape Verde", "latitude": 16.6110, "longitude": -22.8880, "difficulty": "Beginner", "wave_type": "Beach Break"},
      {"name": "Tamarin Bay", "region": "Black River", "country": "Mauritius", "latitude": -20.3220, "longitude": 57.3730, "difficulty": "Expert", "wave_type": "Reef Break"},
      {"name": "One Eye", "region": "Le Morne", "country": "Mauritius", "latitude": -20.4630, "longitude": 57.3110, "difficulty": "Expert", "wave_type": "Reef Break"},
      {"name": "Maconde", "region": "South Coast", "country": "Mauritius", "latitude": -20.4850, "longitude": 57.3820, "difficulty": "Advanced", "wave_type": "Point Break"},
      {"name": "St. Leu", "region": "West Coast", "country": "Reunion Island", "latitude": -21.1680, "longitude": 55.2820, "difficulty": "Advanced", "wave_type": "Reef Break"},
      {"name": "Boucan Canot", "region": "West Coast", "country": "Reunion Island", "latitude": -21.0280, "longitude": 55.2260, "difficulty": "Advanced", "wave_type": "Beach Break"},
      {"name": "Trois Bassins", "region": "West Coast", "country": "Reunion Island", "latitude": -21.1110, "longitude": 55.2590, "difficulty": "Intermediate", "wave_type": "Reef Break"},
      {"name": "Levanto", "region": "Liguria", "country": "Italy", "latitude": 44.1700, "longitude": 9.6100, "difficulty": "Intermediate", "wave_type": "Beach Break"},
      {"name": "Buggerru", "region": "Sardinia", "country": "Italy", "latitude": 39.3980, "longitude": 8.3980, "difficulty": "Intermediate", "wave_type": "Beach Break"},
      {"name": "Varazze", "region": "Liguria", "country": "Italy", "latitude": 44.3580, "longitude": 8.5750, "difficulty": "Advanced", "wave_type": "Reef Break"},
      {"name": "Cold Hawaii (Klitmoller)", "region": "Jutland", "country": "Denmark", "latitude": 57.0420, "longitude": 8.4750, "difficulty": "Intermediate", "wave_type": "Reef Break"},
      {"name": "Vorupor", "region": "Nationalpark Thy", "country": "Denmark", "latitude": 56.9550, "longitude": 8.3680, "difficulty": "Intermediate", "wave_type": "Beach Break"},
      {"name": "Scheveningen", "region": "The Hague", "country": "Netherlands", "latitude": 52.1140, "longitude": 4.2740, "difficulty": "Beginner", "wave_type": "Beach Break"},
      {"name": "Zandvoort", "region": "North Holland", "country": "Netherlands", "latitude": 52.3780, "longitude": 4.5200, "difficulty": "Beginner", "wave_type": "Beach Break"},
      {"name": "Eisbach River", "region": "Munich", "country": "Germany", "latitude": 48.1432, "longitude": 11.5878, "difficulty": "Advanced", "wave_type": "River Break"},
      {"name": "Brandenburger Strand", "region": "Sylt", "country": "Germany", "latitude": 54.9120, "longitude": 8.3120, "difficulty": "Intermediate", "wave_type": "Beach Break"},
      {"name": "Jungmun Beach", "region": "Jeju Island", "country": "South Korea", "latitude": 33.2430, "longitude": 126.4120, "difficulty": "Intermediate", "wave_type": "Beach Break"},
      {"name": "Surfyy Beach", "region": "Yangyang", "country": "South Korea", "latitude": 38.0330, "longitude": 128.7280, "difficulty": "Beginner", "wave_type": "Beach Break"},
      {"name": "Songjeong Beach", "region": "Busan", "country": "South Korea", "latitude": 35.1780, "longitude": 129.2000, "difficulty": "Beginner", "wave_type": "Beach Break"}
    ];

    toast.loading(`Seeding ${missingSpots.length} missing global spots...`, { id: 'seeding' });
    
    for (const spot of missingSpots) {
      try {
        await axios.post(
          `${API}/admin/spots/create`,
          {
            ...spot,
            override_land_warning: true
          },
          { params: { admin_id: user.id } }
        );
        successCount++;
      } catch (err) {
        console.error(`Failed to seed ${spot.name}:`, err);
      }
    }
    
    toast.dismiss('seeding');
    toast.success(`Successfully seeded ${successCount}/${missingSpots.length} global spots!`);
    fetchSessionData(); // Refresh spots list
    setSeedingSpots(false);
  };

  const handleUnsuspend = async (targetUser) => {
    try {
      await axios.post(
        `${API}/admin/users/${targetUser.id}/unsuspend?admin_id=${user.id}`
      );
      toast.success(`${targetUser.email} unsuspended`);
      fetchData();
    } catch (error) {
      toast.error('Failed to unsuspend user');
    }
  };

  const handleVerify = async (targetUser) => {
    try {
      await axios.patch(
        `${API}/admin/users/${targetUser.id}?admin_id=${user.id}`,
        { is_verified: !targetUser.is_verified }
      );
      toast.success(`Verification ${targetUser.is_verified ? 'removed' : 'added'}`);
      fetchData();
    } catch (error) {
      toast.error('Failed to update verification');
    }
  };

  const handleToggleAdmin = async (targetUser) => {
    try {
      if (targetUser.is_admin) {
        await axios.post(`${API}/admin/revoke-admin/${targetUser.id}?admin_id=${user.id}`);
      } else {
        await axios.post(`${API}/admin/make-admin/${targetUser.id}?admin_id=${user.id}`);
      }
      toast.success('Admin status updated');
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update admin status');
    }
  };

  // Site Access Control handler
  const updateSiteSettings = async (updates) => {
    setSavingSettings(true);
    try {
      await axios.put(`${API}/admin/platform-settings?admin_id=${user.id}`, updates);
      setSiteSettings(prev => ({ ...prev, ...updates }));
      toast.success('Settings saved');
    } catch (error) {
      toast.error('Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  // Session simulation handlers
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
    
    const reader = new FileReader();
    reader.onload = (e) => {
      setMediaPreview(e.target.result);
      setConditionMedia(e.target.result);
    };
    reader.readAsDataURL(file);
  };

  const clearMedia = () => {
    setConditionMedia(null);
    setConditionMediaType(null);
    setMediaPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleForceStart = async () => {
    if (!selectedPhotographer || !selectedSpot) {
      toast.error('Please select both a photographer and a surf spot');
      return;
    }
    
    setForceStartLoading(true);
    try {
      const response = await axios.post(`${API}/admin/force-start-session`, {
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
      
      // Refresh data and reset form
      fetchSessionData();
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

  const handleForceEnd = async (photographerId) => {
    setForceEndLoading(photographerId);
    try {
      const response = await axios.post(`${API}/admin/force-end-session/${photographerId}`);
      toast.success(response.data.message);
      fetchSessionData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to force end session');
    } finally {
      setForceEndLoading(null);
    }
  };

  // Persona handlers
  const handleSelectPersona = (persona) => {
    setPersona(persona.id);
    toast.success(`Now viewing as: ${persona.label}`, {
      icon: <Zap className="w-4 h-4 text-yellow-400" />
    });
  };

  const handleExitGodMode = () => {
    exitPersonaMode();
    toast.success('Exited God Mode - back to your real role');
  };

  // Filter functions
  const filteredPhotographers = simulatePhotographers.filter(p => 
    p.full_name?.toLowerCase().includes(photographerSearch.toLowerCase()) ||
    p.email?.toLowerCase().includes(photographerSearch.toLowerCase())
  );

  const filteredSpots = surfSpots.filter(s =>
    s.name?.toLowerCase().includes(spotSearch.toLowerCase()) ||
    s.region?.toLowerCase().includes(spotSearch.toLowerCase())
  );

  if (!user?.is_admin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center p-4">
        <Shield className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
        <p className="text-gray-400">You need admin privileges to access this page.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
      </div>
    );
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'access', label: 'Access Control', icon: Lock },
    { id: 'moderation', label: 'Moderation', icon: Shield },
    { id: 'content-mod', label: 'Content Queue', icon: Flag },
    { id: 'verification', label: 'Verification', icon: UserCheck },
    { id: 'analytics', label: 'Analytics', icon: BarChart2 },
    { id: 'support', label: 'Support', icon: Headphones },
    { id: 'communications', label: 'Comms', icon: Mail },
    { id: 'system', label: 'System', icon: Server },
    { id: 'finance', label: 'Finance', icon: Wallet },
    { id: 'content-mgmt', label: 'Content', icon: Layout },
    { id: 'persona', label: 'Persona', icon: Zap },
    { id: 'sessions', label: 'Live Sessions', icon: Radio },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'spots', label: 'Spots', icon: MapPin },
    { id: 'map-editor', label: 'Map Editor', icon: Edit },
    { id: 'queue', label: 'Queue', icon: AlertCircle },
    { id: 'pricing', label: 'Pricing', icon: DollarSign },
    { id: 'ads', label: 'Ads', icon: Megaphone },
    { id: 'competition', label: 'Competition', icon: Trophy },
    { id: 'logs', label: 'Logs', icon: History },
  ];

  return (
    <div className={`min-h-screen ${bgClass} pb-20`} data-testid="unified-admin-console">
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
            <Shield className="w-5 h-5 text-red-500" />
            Admin Console
          </h1>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSeedMissingSpots}
              disabled={seedingSpots}
              className="text-emerald-400 border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 whitespace-nowrap hidden md:flex"
            >
              {seedingSpots ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MapPin className="w-4 h-4 mr-2" />}
              Seed Global Spots
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { fetchData(); fetchSessionData(); }}
              className="text-gray-400"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        {/* Current Persona Banner */}
        {activePersona && (
          <div className="px-4 pb-3">
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-400" />
                <span className="text-sm text-yellow-400">
                  Viewing as: <span className="font-bold">{getExpandedRoleInfo(activePersona)?.label || activePersona}</span>
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleExitGodMode}
                className="text-red-400 hover:bg-red-500/10 h-6 px-2"
              >
                <X className="w-3 h-3 mr-1" />
                Exit
              </Button>
            </div>
          </div>
        )}
        
        {/* Tabs - Horizontally scrollable with scroll buttons */}
        <div className="relative group">
          {/* Left scroll button */}
          <button 
            onClick={() => {
              const container = document.getElementById('admin-tabs-container');
              if (container) container.scrollBy({ left: -200, behavior: 'smooth' });
            }}
            className="absolute left-0 top-0 bottom-0 w-10 bg-gradient-to-r from-black via-black/80 to-transparent z-20 flex items-center justify-start pl-1 opacity-70 hover:opacity-100 transition-opacity"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          
          {/* Right scroll button */}
          <button 
            onClick={() => {
              const container = document.getElementById('admin-tabs-container');
              if (container) container.scrollBy({ left: 200, behavior: 'smooth' });
            }}
            className="absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-black via-black/80 to-transparent z-20 flex items-center justify-end pr-1 opacity-70 hover:opacity-100 transition-opacity"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-5 h-5 text-white" />
          </button>
          
          <div 
            id="admin-tabs-container"
            className="flex overflow-x-auto px-12 pb-2 gap-1 scroll-smooth"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                    isActive
                      ? 'bg-red-500 text-white'
                      : 'bg-zinc-800/50 text-gray-400 hover:text-white hover:bg-zinc-800'
                  }`}
                data-testid={`admin-tab-${tab.id}`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 space-y-4">
        {/* Overview Tab */}
        {activeTab === 'overview' && stats && (
          <div className="space-y-4">
            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard icon={Users} label="Total Users" value={stats.users?.total || 0} subtext={`${stats.users?.new_this_week || 0} this week`} color="cyan" />
              <StatCard icon={FileText} label="Total Posts" value={stats.content?.total_posts || 0} color="blue" />
              <StatCard icon={Image} label="Gallery Items" value={stats.content?.total_gallery_items || 0} color="purple" />
              <StatCard icon={DollarSign} label="Revenue (30d)" value={`$${stats.revenue?.last_30_days || 0}`} color="green" />
            </div>

            {/* Users by Role */}
            <Card className={cardBgClass}>
              <CardHeader>
                <CardTitle className={`${textClass} text-sm`}>Users by Role</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {stats.users?.by_role && Object.entries(stats.users.by_role).map(([role, count]) => (
                    <div key={role} className="bg-zinc-800/50 rounded-lg p-2">
                      <p className="text-gray-400 text-xs capitalize">{role.replace(/_/g, ' ')}</p>
                      <p className="text-white font-bold">{count}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card className={cardBgClass}>
              <CardHeader>
                <CardTitle className={`${textClass} text-sm`}>Quick Navigation</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={() => navigate('/map')} className="border-zinc-700">
                  Test Map
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate('/bookings')} className="border-zinc-700">
                  Test Bookings
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate('/gallery')} className="border-zinc-700">
                  Test Gallery
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate('/profile')} className="border-zinc-700">
                  Test Profile
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Access Control Tab - Site Access Code */}
        {activeTab === 'access' && (
          <Card className={cardBgClass}>
            <CardHeader>
              <CardTitle className={`${textClass} text-sm flex items-center gap-2`}>
                <Lock className="w-4 h-4 text-cyan-400" />
                Site Access Control
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Require access code to view the site during private beta
              </p>
            </CardHeader>
            <CardContent>
              {!siteSettings ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Enable/Disable Toggle */}
                  <div className="flex items-center justify-between p-4 bg-zinc-800/50 rounded-lg">
                    <div>
                      <p className="text-white font-medium">Access Code Required</p>
                      <p className="text-gray-400 text-sm">
                        {siteSettings.access_code_enabled 
                          ? 'Visitors must enter code to access the site' 
                          : 'Site is publicly accessible'}
                      </p>
                    </div>
                    <button
                      onClick={() => updateSiteSettings({ access_code_enabled: !siteSettings.access_code_enabled })}
                      disabled={savingSettings}
                      className={`relative w-14 h-8 rounded-full transition-colors ${
                        siteSettings.access_code_enabled ? 'bg-cyan-500' : 'bg-zinc-600'
                      }`}
                      data-testid="access-code-toggle"
                    >
                      <span className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-transform ${
                        siteSettings.access_code_enabled ? 'left-7' : 'left-1'
                      }`} />
                    </button>
                  </div>
                  
                  {/* Access Code Input */}
                  {siteSettings.access_code_enabled && (
                    <div className="p-4 bg-zinc-800/50 rounded-lg">
                      <label className="block text-white font-medium mb-2">Access Code</label>
                      <div className="flex gap-2">
                        <Input
                          value={siteSettings.access_code || ''}
                          onChange={(e) => setSiteSettings(prev => ({ ...prev, access_code: e.target.value.toUpperCase() }))}
                          placeholder="Enter access code"
                          className="bg-zinc-700 border-zinc-600 text-white uppercase tracking-widest font-mono"
                          data-testid="access-code-input"
                        />
                        <Button
                          onClick={() => updateSiteSettings({ access_code: siteSettings.access_code })}
                          disabled={savingSettings}
                          className="bg-cyan-500 hover:bg-cyan-600"
                          data-testid="save-access-code-btn"
                        >
                          {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                        </Button>
                      </div>
                      <p className="text-yellow-400 text-xs mt-2">
                        ⚠️ Changing the code will require ALL users to re-enter the new code
                      </p>
                    </div>
                  )}
                  
                  {/* Status Indicator */}
                  <div className={`p-4 rounded-lg border ${
                    siteSettings.access_code_enabled 
                      ? 'bg-yellow-500/10 border-yellow-500/30' 
                      : 'bg-green-500/10 border-green-500/30'
                  }`}>
                    <p className={`text-sm font-medium ${
                      siteSettings.access_code_enabled ? 'text-yellow-400' : 'text-green-400'
                    }`}>
                      {siteSettings.access_code_enabled 
                        ? `🔒 Site is protected - Current code: ${siteSettings.access_code || 'Not set'}` 
                        : '🌐 Site is public - Anyone can access'}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Moderation Tab - Disputes, Reports, Holds, Audit */}
        {activeTab === 'moderation' && (
          <AdminModerationDashboard />
        )}

        {/* Verification Tab - P1 Features: Identity Verification, Impersonation, Fraud, Journey */}
        {activeTab === 'verification' && (
          <AdminP1Dashboard />
        )}

        {/* Analytics Tab - Unified: Metrics, Funnel, Cohorts, A/B Tests, Growth Tools */}
        {activeTab === 'analytics' && (
          <AdminUnifiedAnalytics />
        )}

        {/* Support Tab - Ticketing System */}
        {activeTab === 'support' && (
          <AdminSupportDashboard />
        )}

        {/* Communications Tab - Announcements, Templates, Campaigns */}
        {activeTab === 'communications' && (
          <AdminCommunicationsDashboard />
        )}

        {/* System Tab - Health Monitoring */}
        {activeTab === 'system' && (
          <AdminSystemDashboard />
        )}

        {/* Finance Tab - Refunds, Payouts, Failed Payments */}
        {activeTab === 'finance' && (
          <AdminFinanceDashboard />
        )}

        {/* Content Moderation Tab - Flagged Content Queue */}
        {activeTab === 'content-mod' && (
          <AdminContentModDashboard />
        )}

        {/* Content Management Tab - Featured, Banners, SEO, API Keys */}
        {activeTab === 'content-mgmt' && (
          <AdminContentMgmtDashboard />
        )}

        {/* Persona Tab */}
        {activeTab === 'persona' && (
          <div className="space-y-4">
            <p className={`text-sm ${textSecondary} text-center`}>
              Select a persona to test how different users experience the app
            </p>
            
            <div className="grid grid-cols-1 gap-2">
              {ALL_PERSONAS.map((persona) => {
                const isActive = activePersona === persona.id;
                const roleInfo = getExpandedRoleInfo(persona.id);
                const colorClass = `text-${roleInfo?.color || 'cyan'}-400`;
                
                return (
                  <button
                    key={persona.id}
                    onClick={() => handleSelectPersona(persona)}
                    className={`p-3 rounded-xl border-2 transition-all duration-200 ${
                      isActive 
                        ? 'border-yellow-400 bg-yellow-400/10' 
                        : `${cardBgClass} hover:border-zinc-500`
                    }`}
                    data-testid={`persona-${persona.id.replace(/\s+/g, '-').toLowerCase()}`}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="w-10 h-10 border-2 border-current">
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
                      {isActive && <Check className="w-5 h-5 text-yellow-400" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Live Sessions Tab */}
        {activeTab === 'sessions' && (
          <div className="space-y-4">
            {loadingPhotographers ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                <span className={`ml-2 text-sm ${textSecondary}`}>Loading data...</span>
              </div>
            ) : (
              <>
                {/* Force Start Section */}
                <Card className={`${cardBgClass} border-green-500/30`}>
                  <CardHeader>
                    <CardTitle className={`${textClass} text-sm flex items-center gap-2`}>
                      <Play className="w-4 h-4 text-green-500" />
                      Force Start Session
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Photographer Selector */}
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
                        className="w-full h-10 px-3 rounded-md bg-zinc-900 border border-zinc-600 text-white text-sm"
                      >
                        <option value="">Select photographer...</option>
                        {filteredPhotographers.map((p) => (
                          <option key={p.id} value={p.id} disabled={p.is_shooting}>
                            {p.full_name} {p.is_shooting ? '(LIVE)' : ''} - {p.role}
                          </option>
                        ))}
                      </select>
                    </div>
                    
                    {/* Location Selector */}
                    <div>
                      <label className={`text-xs ${textSecondary} mb-1 block`}>Surf Spot</label>
                      <Input
                        placeholder="Search spots..."
                        value={spotSearch}
                        onChange={(e) => setSpotSearch(e.target.value)}
                        className="mb-2 bg-zinc-900 border-zinc-600 h-9 text-sm"
                      />
                      <select
                        value={selectedSpot}
                        onChange={(e) => setSelectedSpot(e.target.value)}
                        className="w-full h-10 px-3 rounded-md bg-zinc-900 border border-zinc-600 text-white text-sm"
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
                    
                    {/* Media Upload */}
                    <div>
                      <label className={`text-xs ${textSecondary} mb-1 block`}>Conditions Media</label>
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
                            <video src={mediaPreview} className="w-full h-24 object-cover rounded-lg" controls />
                          ) : (
                            <img src={mediaPreview} alt="Conditions" className="w-full h-24 object-cover rounded-lg" />
                          )}
                          <button
                            onClick={clearMedia}
                            className="absolute top-1 right-1 p-1 bg-black/60 rounded-full"
                          >
                            <X className="w-4 h-4 text-white" />
                          </button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full border-dashed border-zinc-600 h-16"
                        >
                          <Upload className="w-4 h-4 mr-2" />
                          Upload Photo/Video
                        </Button>
                      )}
                    </div>
                    
                    {/* Notes */}
                    <div>
                      <label className={`text-xs ${textSecondary} mb-1 block`}>Spot Notes</label>
                      <Textarea
                        placeholder="e.g., 3-4ft, glassy..."
                        value={spotNotes}
                        onChange={(e) => setSpotNotes(e.target.value)}
                        className="bg-zinc-900 border-zinc-600 text-sm h-14 resize-none"
                      />
                    </div>
                    
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
                  </CardContent>
                </Card>
                
                {/* Active Sessions */}
                <Card className={`${cardBgClass} border-red-500/30`}>
                  <CardHeader>
                    <CardTitle className={`${textClass} text-sm flex items-center gap-2`}>
                      <Square className="w-4 h-4 text-red-500" />
                      Active Sessions ({activeSessions.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {activeSessions.length === 0 ? (
                      <p className={`text-sm ${textSecondary} text-center py-4`}>
                        No active sessions
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {activeSessions.map((session) => (
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
                              onClick={() => handleForceEnd(session.photographer_id)}
                              disabled={forceEndLoading === session.photographer_id}
                              className="bg-red-600 hover:bg-red-700"
                            >
                              {forceEndLoading === session.photographer_id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <>
                                  <Square className="w-3 h-3 mr-1" />
                                  End
                                </>
                              )}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <UsersTabContent 
            users={users}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            handleSearch={handleSearch}
            setSelectedUser={setSelectedUser}
            handleVerify={handleVerify}
            handleUnsuspend={handleUnsuspend}
            setUserToSuspend={setUserToSuspend}
            setShowSuspendModal={setShowSuspendModal}
            cardBgClass={cardBgClass}
            textClass={textClass}
            textSecondary={textSecondary}
            adminId={user.id}
            onUserUpdate={fetchData}
          />
        )}

        {/* Pricing Tab */}
        {activeTab === 'pricing' && <AdminPricingEditor />}

        {/* Spots Tab - Global Spot Manager */}
        {activeTab === 'spots' && <AdminSpotsPanel userId={user?.id} />}

        {/* Map Editor Tab - Visual Pin Editor */}
        {activeTab === 'map-editor' && <AdminSpotEditor />}

        {/* Queue Tab - Precision Queue & Photographer Suggestions */}
        {activeTab === 'queue' && <AdminPrecisionQueue />}

        {/* Ads Tab */}
        {activeTab === 'ads' && <AdControlsPanel user={user} />}

        {/* Competition Tab */}
        {activeTab === 'competition' && <AdminCompetitionVerification />}

        {/* Logs Tab */}
        {activeTab === 'logs' && (
          <Card className={cardBgClass}>
            <CardHeader>
              <CardTitle className={`${textClass} text-sm`}>Admin Action Logs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-center gap-3 p-2 bg-zinc-800/50 rounded-lg">
                    <div className="flex-1">
                      <p className="text-white text-sm">
                        <span className="text-yellow-400">{log.admin_name || 'Unknown'}</span>
                        {' '}{log.action?.replace(/_/g, ' ')}{' '}
                        <span className="text-gray-500">({log.target_type})</span>
                      </p>
                    </div>
                    <span className="text-gray-500 text-xs">
                      {log.created_at ? new Date(log.created_at).toLocaleString() : ''}
                    </span>
                  </div>
                ))}
                {logs.length === 0 && (
                  <p className="text-gray-400 text-center py-4">No admin logs yet</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* User Detail Modal */}
      {selectedUser && (
        <UserDetailModal
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onToggleAdmin={handleToggleAdmin}
        />
      )}

      {/* Suspend Modal */}
      <Dialog open={showSuspendModal} onOpenChange={setShowSuspendModal}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <Ban className="w-5 h-5" />
              Suspend User
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <p className="text-gray-400">
              Suspending <span className="text-white">{userToSuspend?.email}</span>
            </p>
            <Textarea
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Reason for suspension..."
              className="bg-zinc-800 border-zinc-700 text-white"
              rows={3}
            />
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowSuspendModal(false)}
                className="flex-1 border-zinc-700 text-white"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSuspend}
                disabled={!suspendReason}
                className="flex-1 bg-red-500 hover:bg-red-600"
              >
                Suspend User
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Stat Card Component
const StatCard = ({ icon: Icon, label, value, subtext, color }) => {
  const colors = {
    cyan: 'text-cyan-400',
    blue: 'text-blue-400',
    purple: 'text-purple-400',
    green: 'text-green-400',
    red: 'text-red-400'
  };

  return (
    <div className="bg-zinc-900 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${colors[color]}`} />
        <span className="text-gray-400 text-xs">{label}</span>
      </div>
      <p className="text-xl font-bold text-white">{value}</p>
      {subtext && <p className="text-xs text-gray-500">{subtext}</p>}
    </div>
  );
};

// User Detail Modal Component
const UserDetailModal = ({ user: targetUser, onClose, onToggleAdmin }) => {
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle>User Details</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="flex items-center gap-4">
            <Avatar className="w-16 h-16">
              <AvatarImage src={targetUser.avatar_url} />
              <AvatarFallback className="bg-zinc-700 text-2xl">
                {targetUser.full_name?.[0] || targetUser.email[0]}
              </AvatarFallback>
            </Avatar>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                {targetUser.full_name || 'No name'}
                {targetUser.is_admin && <Crown className="w-5 h-5 text-yellow-400" />}
              </h3>
              <p className="text-gray-400 text-sm">{targetUser.email}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-zinc-800 rounded-lg p-2">
              <p className="text-gray-400 text-xs">Role</p>
              <p className="text-white capitalize">{targetUser.role?.replace(/_/g, ' ')}</p>
            </div>
            <div className="bg-zinc-800 rounded-lg p-2">
              <p className="text-gray-400 text-xs">Subscription</p>
              <p className="text-white capitalize">{targetUser.subscription_tier || 'None'}</p>
            </div>
            <div className="bg-zinc-800 rounded-lg p-2">
              <p className="text-gray-400 text-xs">Credits</p>
              <p className="text-green-400">${targetUser.credit_balance?.toFixed(2)}</p>
            </div>
            <div className="bg-zinc-800 rounded-lg p-2">
              <p className="text-gray-400 text-xs">Joined</p>
              <p className="text-white">{targetUser.created_at ? new Date(targetUser.created_at).toLocaleDateString() : 'N/A'}</p>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => onToggleAdmin(targetUser)}
              className={`flex-1 border-zinc-700 ${targetUser.is_admin ? 'text-yellow-400' : 'text-white'}`}
            >
              <Crown className="w-4 h-4 mr-2" />
              {targetUser.is_admin ? 'Remove Admin' : 'Make Admin'}
            </Button>
            <Button variant="outline" onClick={onClose} className="flex-1 border-zinc-700 text-white">
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Role options for dropdown
const ROLE_OPTIONS = [
  { value: 'Grom', label: 'Grom' },
  { value: 'Surfer', label: 'Surfer' },
  { value: 'Comp Surfer', label: 'Comp Surfer' },
  { value: 'Pro', label: 'Pro' },
  { value: 'Grom Parent', label: 'Grom Parent' },
  { value: 'Hobbyist', label: 'Hobbyist' },
  { value: 'Photographer', label: 'Photographer' },
  { value: 'Approved Pro', label: 'Approved Pro' },
  { value: 'School', label: 'School' },
  { value: 'Coach', label: 'Coach' },
  { value: 'Resort', label: 'Resort' },
  { value: 'Wave Pool', label: 'Wave Pool' },
  { value: 'Shop', label: 'Shop' },
  { value: 'Shaper', label: 'Shaper' },
  { value: 'Destination', label: 'Destination' },
];

// Subscription tier options
const SUBSCRIPTION_OPTIONS = [
  { value: 'free', label: 'Free' },
  { value: 'basic', label: 'Basic' },
  { value: 'premium', label: 'Premium' },
];

// Dropdown Badge Component
const DropdownBadge = ({ value, options, onChange, colorClass, isLoading }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  const displayValue = options.find(o => o.value.toLowerCase() === value?.toLowerCase())?.label || value || 'Unknown';
  
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        className={`px-2 py-0.5 rounded text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity flex items-center gap-1 ${colorClass}`}
      >
        {isLoading ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <>
            <span className="capitalize">{displayValue?.replace(/_/g, ' ')}</span>
            <ChevronDown className="w-3 h-3" />
          </>
        )}
      </button>
      
      {isOpen && (
        <div className="absolute z-50 mt-1 left-0 bg-zinc-800 border border-zinc-600 rounded-lg shadow-xl py-1 min-w-[140px] max-h-[200px] overflow-y-auto">
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-700 transition-colors ${
                option.value.toLowerCase() === value?.toLowerCase() 
                  ? 'text-cyan-400 bg-cyan-500/10' 
                  : 'text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// Users Tab Content Component with editable badges and bulk actions
const UsersTabContent = ({ 
  users, 
  searchQuery, 
  setSearchQuery, 
  handleSearch, 
  setSelectedUser,
  handleVerify,
  handleUnsuspend,
  setUserToSuspend,
  setShowSuspendModal,
  cardBgClass,
  textClass,
  textSecondary,
  adminId,
  onUserUpdate
}) => {
  const [loadingUser, setLoadingUser] = useState(null);
  const [loadingField, setLoadingField] = useState(null);
  const [selectedUsers, setSelectedUsers] = useState(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showBulkRoleDropdown, setShowBulkRoleDropdown] = useState(false);
  const [showBulkSubDropdown, setShowBulkSubDropdown] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const bulkRoleRef = useRef(null);
  const bulkSubRef = useRef(null);
  const roleDropdownRef = useRef(null);
  const planDropdownRef = useRef(null);
  
  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Check both button and dropdown for role
      const clickedInsideRoleButton = bulkRoleRef.current && bulkRoleRef.current.contains(event.target);
      const clickedInsideRoleDropdown = roleDropdownRef.current && roleDropdownRef.current.contains(event.target);
      if (!clickedInsideRoleButton && !clickedInsideRoleDropdown) {
        setShowBulkRoleDropdown(false);
      }
      
      // Check both button and dropdown for plan
      const clickedInsidePlanButton = bulkSubRef.current && bulkSubRef.current.contains(event.target);
      const clickedInsidePlanDropdown = planDropdownRef.current && planDropdownRef.current.contains(event.target);
      if (!clickedInsidePlanButton && !clickedInsidePlanDropdown) {
        setShowBulkSubDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  const handleUpdateRole = async (userId, newRole) => {
    setLoadingUser(userId);
    setLoadingField('role');
    try {
      await axios.patch(
        `${API}/admin/users/${userId}?admin_id=${adminId}`,
        { role: newRole }
      );
      toast.success(`Role updated to ${newRole}`);
      onUserUpdate();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update role');
    } finally {
      setLoadingUser(null);
      setLoadingField(null);
    }
  };
  
  const handleUpdateSubscription = async (userId, newTier) => {
    setLoadingUser(userId);
    setLoadingField('subscription');
    try {
      await axios.patch(
        `${API}/admin/users/${userId}?admin_id=${adminId}`,
        { subscription_tier: newTier }
      );
      toast.success(`Subscription updated to ${newTier}`);
      onUserUpdate();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update subscription');
    } finally {
      setLoadingUser(null);
      setLoadingField(null);
    }
  };
  
  // Toggle user selection
  const toggleUserSelection = (userId) => {
    setSelectedUsers(prev => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };
  
  // Select/Deselect all users
  const toggleSelectAll = () => {
    if (selectedUsers.size === users.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(users.map(u => u.id)));
    }
  };
  
  // Bulk update role
  const handleBulkUpdateRole = async (newRole) => {
    if (selectedUsers.size === 0) return;
    
    setBulkLoading(true);
    setShowBulkRoleDropdown(false);
    
    try {
      const userIds = Array.from(selectedUsers);
      await axios.post(
        `${API}/admin/users/bulk-update?admin_id=${adminId}`,
        { user_ids: userIds, role: newRole }
      );
      toast.success(`Updated ${userIds.length} users to ${newRole}`);
      setSelectedUsers(new Set());
      onUserUpdate();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Bulk update failed');
    } finally {
      setBulkLoading(false);
    }
  };
  
  // Bulk update subscription
  const handleBulkUpdateSubscription = async (newTier) => {
    if (selectedUsers.size === 0) return;
    
    setBulkLoading(true);
    setShowBulkSubDropdown(false);
    
    try {
      const userIds = Array.from(selectedUsers);
      await axios.post(
        `${API}/admin/users/bulk-update?admin_id=${adminId}`,
        { user_ids: userIds, subscription_tier: newTier }
      );
      toast.success(`Updated ${userIds.length} users to ${newTier}`);
      setSelectedUsers(new Set());
      onUserUpdate();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Bulk update failed');
    } finally {
      setBulkLoading(false);
    }
  };
  
  // Bulk delete users - show confirmation modal
  const handleBulkDelete = () => {
    if (selectedUsers.size === 0) return;
    setShowDeleteConfirm(true);
  };
  
  // Actually perform the bulk delete after confirmation
  const confirmBulkDelete = async () => {
    setShowDeleteConfirm(false);
    setBulkLoading(true);
    
    const count = selectedUsers.size;
    
    try {
      const userIds = Array.from(selectedUsers);
      const response = await axios.post(
        `${API}/admin/users/bulk-delete?admin_id=${adminId}`,
        { user_ids: userIds }
      );
      toast.success(response.data.message || `Deleted ${count} users`);
      if (response.data.errors?.length > 0) {
        toast.warning(`Some errors occurred: ${response.data.errors.join(', ')}`);
      }
      setSelectedUsers(new Set());
      onUserUpdate();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Bulk delete failed');
    } finally {
      setBulkLoading(false);
    }
  };
  
  const hasSelection = selectedUsers.size > 0;
  const allSelected = users.length > 0 && selectedUsers.size === users.length;
  
  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex gap-2">
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by email or name..."
          className="bg-zinc-800 border-zinc-700 text-white"
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <Button onClick={handleSearch} className="bg-red-500 hover:bg-red-600">
          <Search className="w-4 h-4" />
        </Button>
      </div>
      
      {/* Bulk Actions Bar - Mobile Responsive */}
      {hasSelection && (
        <div className="sticky top-0 z-40 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 rounded-lg p-2 backdrop-blur-sm">
          {/* Top row: Selection count and clear */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-cyan-400 flex-shrink-0" />
              <span className="text-white font-medium text-sm">
                {selectedUsers.size} selected
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedUsers(new Set())}
              className="text-gray-400 hover:text-white p-1 h-auto"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          
          {/* Bottom row: Action buttons - wrap on mobile */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Bulk Role Change */}
            <div className="relative" ref={bulkRoleRef}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowBulkSubDropdown(false);
                  setShowBulkRoleDropdown(!showBulkRoleDropdown);
                }}
                disabled={bulkLoading}
                className="border-zinc-600 text-white hover:bg-zinc-700 text-xs px-2 h-8 whitespace-nowrap"
              >
                {bulkLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <User className="w-3 h-3 mr-1" />
                )}
                Role
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </div>
            
            {/* Bulk Subscription Change */}
            <div className="relative" ref={bulkSubRef}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowBulkRoleDropdown(false);
                  setShowBulkSubDropdown(!showBulkSubDropdown);
                }}
                disabled={bulkLoading}
                className="border-zinc-600 text-white hover:bg-zinc-700 text-xs px-2 h-8 whitespace-nowrap"
              >
                {bulkLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Crown className="w-3 h-3 mr-1" />
                )}
                Plan
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </div>
            
            {/* Bulk Delete */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleBulkDelete()}
              disabled={bulkLoading}
              className="border-red-500/50 text-red-400 hover:bg-red-500/20 text-xs px-2 h-8 whitespace-nowrap"
            >
              {bulkLoading ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <Trash2 className="w-3 h-3 mr-1" />
              )}
              Delete
            </Button>
          </div>
          
          {/* Role Dropdown - rendered outside scroll container */}
          {showBulkRoleDropdown && (
            <div 
              ref={roleDropdownRef}
              className="absolute left-2 mt-1 bg-zinc-800 border border-zinc-600 rounded-lg shadow-xl py-1 min-w-[160px] max-h-[250px] overflow-y-auto z-[100]"
            >
              {ROLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleBulkUpdateRole(option.value)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-700 text-white transition-colors"
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          
          {/* Plan Dropdown - rendered outside scroll container */}
          {showBulkSubDropdown && (
            <div 
              ref={planDropdownRef}
              className="absolute left-20 mt-1 bg-zinc-800 border border-zinc-600 rounded-lg shadow-xl py-1 min-w-[120px] z-[100]"
            >
              {SUBSCRIPTION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleBulkUpdateSubscription(option.value)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-700 transition-colors ${
                    option.value === 'premium' ? 'text-yellow-400' : 'text-white'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Select All Header */}
      <div className="flex items-center gap-2 px-1">
        <button
          onClick={toggleSelectAll}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            allSelected 
              ? 'bg-cyan-500 border-cyan-500' 
              : 'border-zinc-500 hover:border-cyan-400'
          }`}
        >
          {allSelected && <Check className="w-3 h-3 text-black" />}
        </button>
        <span className={`text-sm ${textSecondary}`}>
          {allSelected ? 'Deselect all' : 'Select all'} ({users.length} users)
        </span>
      </div>

      {/* Users List */}
      <div className="space-y-2">
        {users.map((u) => {
          const isSelected = selectedUsers.has(u.id);
          
          return (
            <Card 
              key={u.id} 
              className={`${cardBgClass} transition-all ${
                isSelected ? 'ring-2 ring-cyan-500/50' : ''
              }`}
            >
              <CardContent className="p-3 overflow-visible">
                <div className="flex items-center gap-3">
                  {/* Checkbox */}
                  <button
                    onClick={() => toggleUserSelection(u.id)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                      isSelected 
                        ? 'bg-cyan-500 border-cyan-500' 
                        : 'border-zinc-500 hover:border-cyan-400'
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3 text-black" />}
                  </button>
                  
                  <Avatar className="w-10 h-10">
                    <AvatarImage src={u.avatar_url} />
                    <AvatarFallback className="bg-zinc-700">
                      {u.full_name?.[0] || u.email[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium ${textClass} flex items-center gap-2 truncate`}>
                      {u.full_name || 'No name'}
                      {u.is_admin && <Crown className="w-3 h-3 text-yellow-400 flex-shrink-0" />}
                      {u.is_verified && <CheckCircle className="w-3 h-3 text-cyan-400 flex-shrink-0" />}
                    </p>
                    <p className={`text-xs ${textSecondary} truncate`}>{u.email}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedUser(u)}
                      className="h-8 w-8 p-0"
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleVerify(u)}
                      className={`h-8 w-8 p-0 ${u.is_verified ? 'text-cyan-400' : ''}`}
                    >
                      <CheckCircle className="w-4 h-4" />
                    </Button>
                    {u.is_suspended ? (
                      <Button
                        size="sm"
                        onClick={() => handleUnsuspend(u)}
                        className="bg-emerald-500 hover:bg-emerald-600 h-8 w-8 p-0"
                      >
                        <UserCheck className="w-4 h-4" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => { setUserToSuspend(u); setShowSuspendModal(true); }}
                        className="bg-red-500 hover:bg-red-600 h-8 w-8 p-0"
                        disabled={u.is_admin}
                      >
                        <UserX className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 mt-2 flex-wrap ml-8">
                  {/* Role Dropdown Badge */}
                  <DropdownBadge
                    value={u.role}
                    options={ROLE_OPTIONS}
                    onChange={(newRole) => handleUpdateRole(u.id, newRole)}
                    colorClass="bg-zinc-700 text-white"
                    isLoading={loadingUser === u.id && loadingField === 'role'}
                  />
                  
                  {/* Subscription Dropdown Badge */}
                  <DropdownBadge
                    value={u.subscription_tier || 'free'}
                    options={SUBSCRIPTION_OPTIONS}
                    onChange={(newTier) => handleUpdateSubscription(u.id, newTier)}
                    colorClass={u.subscription_tier === 'premium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-zinc-700 text-gray-400'}
                    isLoading={loadingUser === u.id && loadingField === 'subscription'}
                  />
                  
                  {/* Credit Balance - View Only */}
                  <Badge className="bg-green-500/20 text-green-400">
                    ${u.credit_balance?.toFixed(2) || '0.00'}
                  </Badge>
                  
                  {u.is_suspended && (
                    <Badge className="bg-red-500/20 text-red-400">Suspended</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      
      {/* Delete Confirmation Modal */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="bg-zinc-900 border-zinc-700 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-500" />
              Confirm Delete
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-zinc-300">
              Are you sure you want to delete <span className="text-red-400 font-semibold">{selectedUsers.size} user{selectedUsers.size > 1 ? 's' : ''}</span>?
            </p>
            <p className="text-zinc-500 text-sm mt-2">
              This action cannot be undone.
            </p>
          </div>
          <div className="flex gap-3 justify-end">
            <Button
              variant="outline"
              onClick={() => setShowDeleteConfirm(false)}
              className="border-zinc-600 text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmBulkDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete Users
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Analytics Tab Content Component - Platform Mission Control
const AnalyticsTabContent = ({ user, cardBgClass, textClass, textSecondary }) => {
  const [financial, setFinancial] = useState(null);
  const [ecosystem, setEcosystem] = useState(null);
  const [priceImpact, setPriceImpact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchAnalytics();
  }, [user?.id]);

  const fetchAnalytics = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [financialRes, ecosystemRes, priceRes] = await Promise.all([
        axios.get(`${API}/admin/analytics/financial?admin_id=${user.id}&days=30`).catch(() => ({ data: null })),
        axios.get(`${API}/admin/analytics/ecosystem?admin_id=${user.id}`).catch(() => ({ data: null })),
        axios.get(`${API}/admin/analytics/price-impact?admin_id=${user.id}&days=90`).catch(() => ({ data: null }))
      ]);
      setFinancial(financialRes.data);
      setEcosystem(ecosystemRes.data);
      setPriceImpact(priceRes.data);
    } catch (error) {
      logger.error('Analytics fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshCache = async () => {
    setRefreshing(true);
    try {
      await axios.post(`${API}/admin/analytics/refresh-cache?admin_id=${user.id}`);
      toast.success('Metrics cache refreshed');
      fetchAnalytics();
    } catch (error) {
      toast.error('Failed to refresh cache');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        <span className="ml-3 text-gray-400">Loading analytics...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Refresh */}
      <div className="flex items-center justify-between">
        <h2 className={`text-lg font-bold ${textClass} flex items-center gap-2`}>
          <TrendingUp className="w-5 h-5 text-cyan-400" />
          Platform Mission Control
        </h2>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRefreshCache}
          disabled={refreshing}
          className="border-zinc-700"
        >
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ml-1">Refresh</span>
        </Button>
      </div>

      {/* Financial Oversight */}
      <Card className={`${cardBgClass} border-green-500/30`}>
        <CardHeader className="pb-2">
          <CardTitle className={`${textClass} text-sm flex items-center gap-2`}>
            <Wallet className="w-4 h-4 text-green-500" />
            Financial Oversight (Sitewide)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Total Credit Liability - KEY METRIC */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-red-500/10 to-orange-500/10 border border-red-500/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 text-red-400" />
                  Total Stoked Credits Liability
                </p>
                <p className="text-3xl font-bold text-red-400">
                  ${financial?.total_credit_liability?.toLocaleString() || '0'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Sum of all credits in user wallets
                </p>
              </div>
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
                <DollarSign className="w-8 h-8 text-red-400" />
              </div>
            </div>
          </div>

          {/* Credit Distribution */}
          {financial?.credit_distribution && (
            <div>
              <p className={`text-xs ${textSecondary} mb-2`}>Credit Distribution</p>
              <div className="grid grid-cols-5 gap-1">
                {Object.entries(financial.credit_distribution).map(([range, count]) => (
                  <div key={range} className="bg-zinc-800 rounded p-2 text-center">
                    <p className="text-white font-bold text-sm">{count}</p>
                    <p className="text-gray-500 text-[10px]">${range}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Revenue Metrics */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-zinc-800 rounded-lg p-3 text-center">
              <p className="text-gray-400 text-xs">30-Day Revenue</p>
              <p className="text-green-400 font-bold text-lg">
                ${financial?.total_revenue_period?.toLocaleString() || '0'}
              </p>
            </div>
            <div className="bg-zinc-800 rounded-lg p-3 text-center">
              <p className="text-gray-400 text-xs">Ad Revenue</p>
              <p className="text-purple-400 font-bold text-lg">
                ${financial?.ad_revenue?.toLocaleString() || '0'}
              </p>
            </div>
            <div className="bg-zinc-800 rounded-lg p-3 text-center">
              <p className="text-gray-400 text-xs">Subscription</p>
              <p className="text-cyan-400 font-bold text-lg">
                ${financial?.revenue_by_type?.subscription?.toLocaleString() || '0'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ecosystem Health */}
      <Card className={`${cardBgClass} border-cyan-500/30`}>
        <CardHeader className="pb-2">
          <CardTitle className={`${textClass} text-sm flex items-center gap-2`}>
            <PieChart className="w-4 h-4 text-cyan-500" />
            Ecosystem Health
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Role Distribution */}
          {ecosystem?.role_categories && (
            <div>
              <p className={`text-xs ${textSecondary} mb-2`}>User Categories</p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(ecosystem.role_categories).map(([category, data]) => (
                  <div key={category} className="bg-zinc-800 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-gray-400 text-xs capitalize">{category.replace('_', ' ')}</p>
                      <span className="text-cyan-400 text-xs">{data.percentage}%</span>
                    </div>
                    <p className="text-white font-bold">{data.count}</p>
                    <div className="w-full h-1 bg-zinc-700 rounded mt-1">
                      <div 
                        className="h-1 bg-cyan-500 rounded" 
                        style={{ width: `${data.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Booking Efficiency */}
          {ecosystem?.booking_efficiency && (
            <div>
              <p className={`text-xs ${textSecondary} mb-2`}>Booking Efficiency</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-500/30 rounded-lg p-3">
                  <p className="text-orange-400 text-xs">On-Demand</p>
                  <p className="text-white font-bold text-xl">{ecosystem.booking_efficiency.on_demand?.count || 0}</p>
                  <p className="text-orange-400 text-xs">{ecosystem.booking_efficiency.on_demand?.percentage || 0}%</p>
                </div>
                <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30 rounded-lg p-3">
                  <p className="text-blue-400 text-xs">Scheduled</p>
                  <p className="text-white font-bold text-xl">{ecosystem.booking_efficiency.scheduled?.count || 0}</p>
                  <p className="text-blue-400 text-xs">{ecosystem.booking_efficiency.scheduled?.percentage || 0}%</p>
                </div>
              </div>
            </div>
          )}

          {/* Spot Activity Heatmap Preview */}
          {ecosystem?.spot_heatmap && ecosystem.spot_heatmap.length > 0 && (
            <div>
              <p className={`text-xs ${textSecondary} mb-2`}>Top Spots by Bookings</p>
              <div className="space-y-1">
                {ecosystem.spot_heatmap.slice(0, 5).map((spot, i) => (
                  <div key={i} className="flex items-center justify-between bg-zinc-800 rounded p-2">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3 h-3 text-cyan-400" />
                      <span className="text-white text-sm truncate max-w-[150px]">{spot.location}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge className="bg-cyan-500/20 text-cyan-400 text-xs">{spot.bookings} bookings</Badge>
                      <span className="text-green-400 text-xs">${spot.revenue?.toFixed(0)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Price Impact Tracking */}
      <Card className={`${cardBgClass} border-yellow-500/30`}>
        <CardHeader className="pb-2">
          <CardTitle className={`${textClass} text-sm flex items-center gap-2`}>
            <BarChart3 className="w-4 h-4 text-yellow-500" />
            Price Impact Markers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {priceImpact?.price_change_markers && priceImpact.price_change_markers.length > 0 ? (
            <div className="space-y-2">
              <p className={`text-xs ${textSecondary}`}>
                Recent pricing changes - correlate with signup trends
              </p>
              {priceImpact.price_change_markers.slice(0, 5).map((marker, i) => (
                <div key={i} className="flex items-center justify-between bg-zinc-800 rounded p-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-yellow-400 rounded-full" />
                    <span className="text-white text-sm">{marker.action}</span>
                  </div>
                  <span className="text-gray-500 text-xs">
                    {marker.date ? new Date(marker.date).toLocaleDateString() : 'N/A'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className={`text-sm ${textSecondary}`}>
                No pricing changes recorded yet. Changes made in God Mode Pricing will appear here.
              </p>
            </div>
          )}

          {/* Signup Trend Summary */}
          {priceImpact?.signup_trend && priceImpact.signup_trend.length > 0 && (
            <div className="mt-4 p-3 bg-zinc-800 rounded-lg">
              <p className="text-xs text-gray-400 mb-2">Signup Trend (Last 90 Days)</p>
              <div className="flex items-end gap-0.5 h-12">
                {priceImpact.signup_trend.slice(-30).map((day, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-cyan-500 rounded-t"
                    style={{ height: `${Math.min(100, (day.signups || 0) * 20)}%`, minHeight: '2px' }}
                    title={`${day.date}: ${day.signups} signups`}
                  />
                ))}
              </div>
              <p className="text-[10px] text-gray-500 mt-1 text-center">Last 30 days</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// Ad Controls Panel Component with Approval Queue
const AdControlsPanel = ({ user }) => {
  const [config, setConfig] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('overview'); // 'overview', 'queue', 'variants'
  const [processingAd, setProcessingAd] = useState(null);
  const [editingAd, setEditingAd] = useState(null);
  const [editForm, setEditForm] = useState({});

  useEffect(() => {
    fetchAdData();
  }, [user?.id]);

  const fetchAdData = async () => {
    try {
      const [configRes, analyticsRes, queueRes] = await Promise.all([
        axios.get(`${API}/admin/ads/config?admin_id=${user.id}`).catch(() => ({ data: { config: null } })),
        axios.get(`${API}/admin/ads/analytics?admin_id=${user.id}`).catch(() => ({ data: null })),
        axios.get(`${API}/admin/ads/queue?admin_id=${user.id}&status=pending`).catch(() => ({ data: { queue: [], counts: {} } }))
      ]);
      setConfig(configRes.data?.config);
      setAnalytics(analyticsRes.data);
      setQueue(queueRes.data);
    } catch (error) {
      logger.error('Failed to fetch ad config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFrequencyChange = async (newFreq) => {
    setSaving(true);
    try {
      await axios.patch(`${API}/admin/ads/frequency?admin_id=${user.id}&frequency=${newFreq}`);
      setConfig(prev => ({ ...prev, frequency: newFreq }));
      toast.success(`Ad frequency updated to 1 per ${newFreq} posts`);
    } catch (error) {
      toast.error('Failed to update frequency');
    } finally {
      setSaving(false);
    }
  };

  const toggleVariant = async (variantId, isActive) => {
    try {
      await axios.patch(`${API}/admin/ads/variant/${variantId}/toggle?admin_id=${user.id}&is_active=${isActive}`);
      setConfig(prev => ({
        ...prev,
        variants: prev.variants.map(v => v.id === variantId ? { ...v, is_active: isActive } : v)
      }));
      toast.success(`Variant ${isActive ? 'enabled' : 'disabled'}`);
    } catch (error) {
      toast.error('Failed to toggle variant');
    }
  };

  const handleApproveAd = async (adId) => {
    setProcessingAd(adId);
    try {
      await axios.post(`${API}/admin/ads/queue/${adId}/action?admin_id=${user.id}`, {
        action: 'approve'
      });
      toast.success('Ad approved and activated!');
      fetchAdData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to approve ad');
    } finally {
      setProcessingAd(null);
    }
  };

  const handleRejectAd = async (adId, reason) => {
    setProcessingAd(adId);
    try {
      await axios.post(`${API}/admin/ads/queue/${adId}/action?admin_id=${user.id}`, {
        action: 'reject',
        reason: reason || 'Does not meet advertising guidelines'
      });
      toast.success('Ad rejected');
      fetchAdData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to reject ad');
    } finally {
      setProcessingAd(null);
    }
  };

  const handleEditAd = async (adId) => {
    setProcessingAd(adId);
    try {
      await axios.post(`${API}/admin/ads/queue/${adId}/action?admin_id=${user.id}`, {
        action: 'edit',
        edited_content: editForm
      });
      toast.success('Ad content updated');
      setEditingAd(null);
      setEditForm({});
      fetchAdData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to edit ad');
    } finally {
      setProcessingAd(null);
    }
  };

  const startEditing = (ad) => {
    setEditingAd(ad.id);
    setEditForm({
      headline: ad.headline,
      description: ad.description || ad.body,
      cta: ad.cta,
      cta_link: ad.cta_link
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex border-b border-zinc-700">
        <button
          onClick={() => setActiveSubTab('overview')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            activeSubTab === 'overview' 
              ? 'text-white border-b-2 border-cyan-400' 
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveSubTab('queue')}
          className={`flex-1 py-2 text-sm font-medium transition-colors relative ${
            activeSubTab === 'queue' 
              ? 'text-white border-b-2 border-cyan-400' 
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Approval Queue
          {queue?.counts?.pending > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
              {queue.counts.pending}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveSubTab('variants')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            activeSubTab === 'variants' 
              ? 'text-white border-b-2 border-cyan-400' 
              : 'text-gray-400 hover:text-white'
          }`}
        >
          All Variants
        </button>
      </div>

      {/* Overview Sub-Tab */}
      {activeSubTab === 'overview' && (
        <>
          {/* Analytics */}
          {analytics && (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-white text-sm">Ad Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-zinc-800 rounded-lg p-2 text-center">
                    <p className="text-gray-400 text-xs">Impressions</p>
                    <p className="text-white font-bold">{analytics.analytics?.total_impressions || 0}</p>
                  </div>
                  <div className="bg-zinc-800 rounded-lg p-2 text-center">
                    <p className="text-gray-400 text-xs">Clicks</p>
                    <p className="text-white font-bold">{analytics.analytics?.total_clicks || 0}</p>
                  </div>
                  <div className="bg-zinc-800 rounded-lg p-2 text-center">
                    <p className="text-gray-400 text-xs">Ad-Free Users</p>
                    <p className="text-green-400 font-bold">{analytics.ad_free_users || 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Frequency Control */}
          {config && (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-white text-sm">Ad Frequency</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <p className="text-gray-400 text-sm flex-1">
                    Show 1 ad every <span className="text-cyan-400 font-bold">{config.frequency}</span> posts
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleFrequencyChange(Math.max(3, (config.frequency || 6) - 1))}
                      disabled={saving || config.frequency <= 3}
                      className="border-zinc-700 w-8 h-8 p-0"
                    >
                      -
                    </Button>
                    <span className="text-white font-bold w-8 text-center">{config.frequency}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleFrequencyChange(Math.min(20, (config.frequency || 6) + 1))}
                      disabled={saving || config.frequency >= 20}
                      className="border-zinc-700 w-8 h-8 p-0"
                    >
                      +
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Queue Summary */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-white text-sm">Approval Queue Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-center">
                  <p className="text-yellow-400 text-xs">Pending</p>
                  <p className="text-white font-bold text-xl">{queue?.counts?.pending || 0}</p>
                </div>
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-center">
                  <p className="text-green-400 text-xs">Approved</p>
                  <p className="text-white font-bold text-xl">{queue?.counts?.approved || 0}</p>
                </div>
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center">
                  <p className="text-red-400 text-xs">Rejected</p>
                  <p className="text-white font-bold text-xl">{queue?.counts?.rejected || 0}</p>
                </div>
              </div>
              {queue?.counts?.pending > 0 && (
                <Button 
                  onClick={() => setActiveSubTab('queue')}
                  className="w-full mt-3 bg-yellow-500 hover:bg-yellow-600 text-black"
                >
                  Review {queue.counts.pending} Pending Ad{queue.counts.pending > 1 ? 's' : ''}
                </Button>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Approval Queue Sub-Tab */}
      {activeSubTab === 'queue' && (
        <div className="space-y-3">
          {(!queue?.pending || queue?.pending?.length === 0) ? (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="py-8 text-center">
                <Megaphone className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400">No pending ads to review</p>
                <p className="text-gray-500 text-sm mt-1">
                  User-submitted ads will appear here for approval
                </p>
              </CardContent>
            </Card>
          ) : (
            queue?.pending?.map((ad) => (
              <Card key={ad.id} className="bg-zinc-900 border-yellow-500/30">
                <CardContent className="p-4">
                  {editingAd === ad.id ? (
                    // Edit Mode
                    <div className="space-y-3">
                      <Input
                        value={editForm.headline}
                        onChange={(e) => setEditForm(prev => ({ ...prev, headline: e.target.value }))}
                        placeholder="Headline"
                        className="bg-zinc-800 border-zinc-700 text-white"
                      />
                      <Textarea
                        value={editForm.description}
                        onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Description"
                        className="bg-zinc-800 border-zinc-700 text-white"
                        rows={2}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          value={editForm.cta}
                          onChange={(e) => setEditForm(prev => ({ ...prev, cta: e.target.value }))}
                          placeholder="CTA Text"
                          className="bg-zinc-800 border-zinc-700 text-white"
                        />
                        <Input
                          value={editForm.cta_link}
                          onChange={(e) => setEditForm(prev => ({ ...prev, cta_link: e.target.value }))}
                          placeholder="CTA Link"
                          className="bg-zinc-800 border-zinc-700 text-white"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleEditAd(ad.id)}
                          disabled={processingAd === ad.id}
                          className="flex-1 bg-cyan-500 hover:bg-cyan-600"
                        >
                          {processingAd === ad.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => { setEditingAd(null); setEditForm({}); }}
                          className="border-zinc-700"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // View Mode
                    <>
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="text-white font-medium">{ad.headline}</p>
                          <p className="text-gray-400 text-sm">{ad.description || ad.body}</p>
                        </div>
                        <Badge className="bg-yellow-500/20 text-yellow-400">
                          {ad.approval_status || 'pending'}
                        </Badge>
                      </div>
                      
                      <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
                        <span>By: {ad.submitted_by_name || 'Unknown'}</span>
                        <span>Budget: ${ad.budget_credits || 0}</span>
                        <span>CTA: {ad.cta}</span>
                      </div>
                      
                      {/* Media Preview - Support for both images and videos */}
                      {(ad.image_url || ad.video_url) && (
                        <div className="mb-3 relative rounded-lg overflow-hidden">
                          {ad.media_type === 'video' || ad.video_url ? (
                            <>
                              <video 
                                src={ad.video_url || ad.image_url} 
                                poster={ad.thumbnail_url}
                                className="w-full h-32 object-cover" 
                                controls
                              />
                              <div className="absolute top-2 left-2">
                                <Badge className="bg-red-500/90 text-white text-xs">
                                  <Video className="w-3 h-3 mr-1" />
                                  Video
                                </Badge>
                              </div>
                            </>
                          ) : (
                            <>
                              <img 
                                src={ad.image_url} 
                                alt="Ad preview" 
                                className="w-full h-32 object-cover" 
                              />
                              <div className="absolute top-2 left-2">
                                <Badge className="bg-blue-500/90 text-white text-xs">
                                  <Image className="w-3 h-3 mr-1" />
                                  Image
                                </Badge>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleApproveAd(ad.id)}
                          disabled={processingAd === ad.id}
                          className="flex-1 bg-green-500 hover:bg-green-600"
                        >
                          {processingAd === ad.id ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                            <>
                              <Check className="w-4 h-4 mr-1" />
                              Approve
                            </>
                          )}
                        </Button>
                        <Button
                          onClick={() => handleRejectAd(ad.id)}
                          disabled={processingAd === ad.id}
                          className="flex-1 bg-red-500 hover:bg-red-600"
                        >
                          <X className="w-4 h-4 mr-1" />
                          Reject
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => startEditing(ad)}
                          className="border-zinc-700"
                        >
                          <FileText className="w-4 h-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* All Variants Sub-Tab */}
      {activeSubTab === 'variants' && config?.variants && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-white text-sm">All Ad Variants ({config.variants.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {config.variants.map((variant) => (
                <div key={variant.id} className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg">
                  <div className="flex-1">
                    <p className="text-white font-medium text-sm">{variant.headline}</p>
                    <p className="text-gray-400 text-xs">
                      {variant.type} • {variant.cta}
                      {variant.submitted_by_name && (
                        <span className="text-cyan-400 ml-2">by {variant.submitted_by_name}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {variant.approval_status && (
                      <Badge className={
                        variant.approval_status === 'approved' ? 'bg-green-500/20 text-green-400' :
                        variant.approval_status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }>
                        {variant.approval_status}
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant={variant.is_active ? 'default' : 'outline'}
                      onClick={() => toggleVariant(variant.id, !variant.is_active)}
                      className={variant.is_active ? 'bg-green-500 hover:bg-green-600' : 'border-zinc-600'}
                    >
                      {variant.is_active ? 'Active' : 'Disabled'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};


// Admin Spots Panel - Global Spot Manager
const AdminSpotsPanel = ({ userId }) => {
  const [stats, setStats] = useState(null);
  const [spots, setSpots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [editingSpot, setEditingSpot] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  
  // Precision Pin Map Modal state
  const [precisionPinOpen, setPrecisionPinOpen] = useState(false);
  const [pinMapSpot, setPinMapSpot] = useState(null);
  const [draggedPosition, setDraggedPosition] = useState(null);
  const [mapLayer, setMapLayer] = useState('satellite'); // 'satellite' or 'street'
  const pinMapRef = useRef(null);
  const pinMapInstanceRef = useRef(null);
  const pinMarkerRef = useRef(null);

  const fetchStats = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/admin/spots/stats?admin_id=${userId}`);
      setStats(response.data);
    } catch (error) {
      logger.error('Error fetching spot stats:', error);
    }
  }, [userId]);

  const fetchSpots = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterCountry) params.append('country', filterCountry);
      const response = await axios.get(`${API}/surf-spots?${params.toString()}`);
      setSpots(response.data);
    } catch (error) {
      logger.error('Error fetching spots:', error);
    }
  }, [filterCountry]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchStats(), fetchSpots()]);
      setLoading(false);
    };
    load();
  }, [fetchStats, fetchSpots]);

  // Import tier state
  const [importTier, setImportTier] = useState(0);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [includeOSM, setIncludeOSM] = useState(false);

  const handleImport = async () => {
    setImportLoading(true);
    try {
      const response = await axios.post(
        `${API}/admin/spots/import?admin_id=${user.id}&tier=${importTier}&include_osm=${includeOSM}`
      );
      toast.success(`Imported ${response.data.total_imported} spots (${response.data.tier_name})`);
      setShowImportDialog(false);
      fetchStats();
      fetchSpots();
    } catch (error) {
      toast.error('Import failed');
    } finally {
      setImportLoading(false);
    }
  };

  const handleUpdateSpot = async (spotId, updates) => {
    try {
      await axios.put(`${API}/admin/spots/${spotId}?admin_id=${user.id}`, null, { params: updates });
      toast.success('Spot updated');
      setEditingSpot(null);
      fetchSpots();
    } catch (error) {
      toast.error('Update failed');
    }
  };

  const handleDeleteSpot = async (spotId, spotName) => {
    if (!window.confirm(`Delete "${spotName}"? This cannot be undone.`)) return;
    try {
      await axios.delete(`${API}/admin/spots/${spotId}?admin_id=${user.id}`);
      toast.success('Spot deleted');
      fetchSpots();
      fetchStats();
    } catch (error) {
      toast.error('Delete failed');
    }
  };

  // Precision Pin Map Functions
  const openPrecisionPinMap = (spot) => {
    setPinMapSpot(spot);
    setDraggedPosition({ lat: spot.latitude, lng: spot.longitude });
    setPrecisionPinOpen(true);
  };

  const initPrecisionMap = useCallback(() => {
    if (!pinMapRef.current || !window.L || !pinMapSpot) return;
    
    // Clean up existing map
    if (pinMapInstanceRef.current) {
      pinMapInstanceRef.current.remove();
      pinMapInstanceRef.current = null;
    }
    
    const map = window.L.map(pinMapRef.current, {
      center: [pinMapSpot.latitude, pinMapSpot.longitude],
      zoom: 18,
      zoomControl: true
    });
    
    // Satellite layer (Esri World Imagery - free)
    const satelliteLayer = window.L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Esri World Imagery', maxZoom: 19 }
    );
    
    // Street layer
    const streetLayer = window.L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 19 }
    );
    
    // Add initial layer
    if (mapLayer === 'satellite') {
      satelliteLayer.addTo(map);
    } else {
      streetLayer.addTo(map);
    }
    
    // Store layers for toggling
    map._satelliteLayer = satelliteLayer;
    map._streetLayer = streetLayer;
    
    // Create draggable marker
    const icon = window.L.divIcon({
      className: 'precision-pin-marker',
      html: `
        <div class="relative">
          <div class="w-6 h-6 rounded-full bg-red-500 border-4 border-white shadow-lg flex items-center justify-center">
            <div class="w-2 h-2 bg-white rounded-full"></div>
          </div>
          <div class="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-red-500"></div>
        </div>
      `,
      iconSize: [24, 32],
      iconAnchor: [12, 32]
    });
    
    const marker = window.L.marker([pinMapSpot.latitude, pinMapSpot.longitude], {
      icon,
      draggable: true
    }).addTo(map);
    
    // Track drag events
    marker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      setDraggedPosition({ lat: pos.lat, lng: pos.lng });
    });
    
    pinMarkerRef.current = marker;
    pinMapInstanceRef.current = map;
  }, [pinMapSpot, mapLayer]);

  // Initialize map when modal opens
  useEffect(() => {
    if (precisionPinOpen && pinMapSpot) {
      // Small delay to ensure DOM is ready
      setTimeout(() => initPrecisionMap(), 100);
    }
    
    return () => {
      if (pinMapInstanceRef.current) {
        pinMapInstanceRef.current.remove();
        pinMapInstanceRef.current = null;
      }
    };
  }, [precisionPinOpen, pinMapSpot, initPrecisionMap]);

  // Toggle map layer
  const toggleMapLayer = () => {
    const map = pinMapInstanceRef.current;
    if (!map) return;
    
    if (mapLayer === 'satellite') {
      map.removeLayer(map._satelliteLayer);
      map._streetLayer.addTo(map);
      setMapLayer('street');
    } else {
      map.removeLayer(map._streetLayer);
      map._satelliteLayer.addTo(map);
      setMapLayer('satellite');
    }
  };

  // Save precision pin location
  const savePrecisionPin = async () => {
    if (!pinMapSpot || !draggedPosition) return;
    
    try {
      await axios.post(
        `${API}/admin/spots/${pinMapSpot.id}/apply-refinement?admin_id=${userId}`,
        null,
        { params: { new_latitude: draggedPosition.lat, new_longitude: draggedPosition.lng } }
      );
      toast.success(`Peak location verified for ${pinMapSpot.name}`);
      setPrecisionPinOpen(false);
      setPinMapSpot(null);
      fetchSpots();
      fetchStats();
    } catch (error) {
      toast.error('Failed to save pin location');
    }
  };

  const filteredSpots = spots.filter(spot => 
    spot.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (spot.country || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (spot.region || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const countries = [...new Set(spots.map(s => s.country).filter(Boolean))].sort();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="admin-spots-panel">
      {/* Stats Overview */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <MapPin className="w-5 h-5 text-cyan-400" />
            Global Spot Database
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-zinc-800 rounded-lg p-3 text-center">
              <p className="text-3xl font-bold text-white">{stats?.total_spots || 0}</p>
              <p className="text-xs text-gray-400">Total Spots</p>
            </div>
            <div className="bg-zinc-800 rounded-lg p-3 text-center">
              <p className="text-3xl font-bold text-cyan-400">{stats?.by_country?.length || 0}</p>
              <p className="text-xs text-gray-400">Countries</p>
            </div>
            <div className="bg-zinc-800 rounded-lg p-3 text-center">
              <p className="text-3xl font-bold text-green-400">{stats?.by_tier?.tier_1 || 0}</p>
              <p className="text-xs text-gray-400">Tier 1 (East Coast)</p>
            </div>
            <div className="bg-zinc-800 rounded-lg p-3 text-center">
              <p className="text-3xl font-bold text-purple-400">{stats?.by_tier?.tier_3 || 0}</p>
              <p className="text-xs text-gray-400">Tier 3 (Global)</p>
            </div>
          </div>

          {/* Countries breakdown */}
          <div className="flex flex-wrap gap-2">
            {stats?.by_country?.slice(0, 10).map((item) => (
              <Badge 
                key={item.country} 
                className="bg-zinc-700 text-gray-300 cursor-pointer hover:bg-zinc-600"
                onClick={() => setFilterCountry(item.country)}
              >
                {item.country}: {item.count}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => setShowImportDialog(true)}
          className="bg-green-600 hover:bg-green-700"
        >
          <Upload className="w-4 h-4 mr-2" />
          Import Spots
        </Button>
        <Button
          variant="outline"
          onClick={() => { fetchStats(); fetchSpots(); }}
          className="border-zinc-600"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Import Tier Selection Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="bg-zinc-900 border border-zinc-700 sm:max-w-md w-[95vw] sm:w-full rounded-xl flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="p-4 sm:p-6 pb-2 border-b border-zinc-800">
            <DialogTitle className="text-white flex items-center gap-2">
              <Upload className="w-5 h-5 text-green-400" />
              Import Global Surf Spots
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 overflow-y-auto max-h-[55vh] custom-scrollbar p-4 sm:p-6">
            <p className="text-gray-400 text-sm">
              Select which region tier to import surf spots from:
            </p>
            
            <div className="space-y-2">
              {[
                { value: 0, label: 'All Curated Spots', desc: 'Import entire curated database (~70 spots)' },
                { value: 1, label: 'Tier 1: East Coast USA', desc: 'Florida to Maine (~25 spots)' },
                { value: 2, label: 'Tier 2: West Coast & Islands', desc: 'California, Hawaii, Puerto Rico (~15 spots)' },
                { value: 3, label: 'Tier 3: Global', desc: 'Australia, Indonesia, Europe, etc. (~30 spots)' },
              ].map((tier) => (
                <div
                  key={tier.value}
                  onClick={() => setImportTier(tier.value)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    importTier === tier.value 
                      ? 'border-green-500 bg-green-500/10' 
                      : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      importTier === tier.value ? 'border-green-500' : 'border-zinc-500'
                    }`}>
                      {importTier === tier.value && <div className="w-2 h-2 rounded-full bg-green-500" />}
                    </div>
                    <div>
                      <p className="text-white font-medium text-sm sm:text-base">{tier.label}</p>
                      <p className="text-xs text-gray-400">{tier.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="flex items-start gap-2 p-3 bg-zinc-800 rounded-lg border border-zinc-700">
              <input
                type="checkbox"
                id="include-osm"
                checked={includeOSM}
                onChange={(e) => setIncludeOSM(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-zinc-600 flex-shrink-0"
              />
              <label htmlFor="include-osm" className="text-sm text-gray-300 leading-tight">
                Also fetch from OSM Overpass API (slower, more spots)
              </label>
            </div>
          </div>
          
          <div className="p-4 sm:p-6 pt-3 border-t border-zinc-800 bg-zinc-900/50 flex flex-col sm:flex-row gap-2">
            <Button
              onClick={handleImport}
              disabled={importLoading}
              className="w-full sm:flex-1 bg-green-600 hover:bg-green-700 text-white order-1 sm:order-2"
            >
              {importLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Start Import
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowImportDialog(false)}
              className="w-full sm:flex-1 border-zinc-600 text-gray-300 hover:text-white order-2 sm:order-1"
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Search & Filter */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="pt-4">
          <div className="flex gap-2 mb-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search spots..."
                className="pl-10 bg-zinc-800 border-zinc-700 text-white"
              />
            </div>
            <select
              value={filterCountry}
              onChange={(e) => setFilterCountry(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 text-white"
            >
              <option value="">All Countries</option>
              {countries.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Spots List */}
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {filteredSpots.slice(0, 50).map((spot) => (
              <div 
                key={spot.id} 
                className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors"
              >
                <div className="flex-1">
                  <p className="text-white font-medium">{spot.name}</p>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>{spot.country || 'Unknown'}</span>
                    {spot.state_province && <span>• {spot.state_province}</span>}
                    {spot.region && <span>• {spot.region}</span>}
                    {spot.wave_type && (
                      <Badge className="bg-blue-500/20 text-blue-400 text-[10px]">
                        {spot.wave_type}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {spot.is_verified_peak && (
                    <Badge className="bg-cyan-500/20 text-cyan-400 text-[10px]">
                      Verified
                    </Badge>
                  )}
                  <Badge className={spot.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}>
                    {spot.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openPrecisionPinMap(spot)}
                    className="text-cyan-400 hover:text-cyan-300"
                    title="Precision Pin - Drag to exact peak location"
                  >
                    <MapPin className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingSpot(spot)}
                    className="text-gray-400 hover:text-white"
                  >
                    <Settings className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDeleteSpot(spot.id, spot.name)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
            {filteredSpots.length > 50 && (
              <p className="text-center text-gray-500 text-sm py-2">
                Showing 50 of {filteredSpots.length} spots
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Edit Spot Dialog */}
      <Dialog open={!!editingSpot} onOpenChange={() => setEditingSpot(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-700">
          <DialogHeader>
            <DialogTitle className="text-white">Edit Spot: {editingSpot?.name}</DialogTitle>
          </DialogHeader>
          {editingSpot && (
            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-400">Name</label>
                <Input
                  value={editingSpot.name}
                  onChange={(e) => setEditingSpot({...editingSpot, name: e.target.value})}
                  className="bg-zinc-800 border-zinc-700 text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-400">Country</label>
                  <Input
                    value={editingSpot.country || ''}
                    onChange={(e) => setEditingSpot({...editingSpot, country: e.target.value})}
                    className="bg-zinc-800 border-zinc-700 text-white"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-400">State/Province</label>
                  <Input
                    value={editingSpot.state_province || ''}
                    onChange={(e) => setEditingSpot({...editingSpot, state_province: e.target.value})}
                    className="bg-zinc-800 border-zinc-700 text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-400">Region</label>
                  <Input
                    value={editingSpot.region || ''}
                    onChange={(e) => setEditingSpot({...editingSpot, region: e.target.value})}
                    className="bg-zinc-800 border-zinc-700 text-white"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-400">Wave Type</label>
                  <Input
                    value={editingSpot.wave_type || ''}
                    onChange={(e) => setEditingSpot({...editingSpot, wave_type: e.target.value})}
                    className="bg-zinc-800 border-zinc-700 text-white"
                    placeholder="Beach Break, Point Break..."
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-400">Latitude</label>
                  <Input
                    type="number"
                    step="0.0001"
                    value={editingSpot.latitude || ''}
                    onChange={(e) => setEditingSpot({...editingSpot, latitude: parseFloat(e.target.value)})}
                    className="bg-zinc-800 border-zinc-700 text-white"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-400">Longitude</label>
                  <Input
                    type="number"
                    step="0.0001"
                    value={editingSpot.longitude || ''}
                    onChange={(e) => setEditingSpot({...editingSpot, longitude: parseFloat(e.target.value)})}
                    className="bg-zinc-800 border-zinc-700 text-white"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-400">Active</label>
                <Button
                  variant={editingSpot.is_active ? 'default' : 'outline'}
                  onClick={() => setEditingSpot({...editingSpot, is_active: !editingSpot.is_active})}
                  className={editingSpot.is_active ? 'bg-green-600' : 'border-zinc-600'}
                >
                  {editingSpot.is_active ? 'Active' : 'Inactive'}
                </Button>
              </div>
              <div className="flex gap-2 pt-4">
                <Button
                  onClick={() => handleUpdateSpot(editingSpot.id, editingSpot)}
                  className="flex-1 bg-cyan-600 hover:bg-cyan-700"
                >
                  Save Changes
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setEditingSpot(null)}
                  className="border-zinc-600"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Precision Pin Map Modal */}
      <Dialog open={precisionPinOpen} onOpenChange={() => { setPrecisionPinOpen(false); setPinMapSpot(null); }}>
        <DialogContent className="bg-zinc-900 border-zinc-700 max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <MapPin className="w-5 h-5 text-cyan-400" />
              Precision Pin: {pinMapSpot?.name}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Instructions */}
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3">
              <p className="text-sm text-cyan-300">
                Drag the red pin to the exact peak location in the water. The satellite view helps you identify where waves actually break.
              </p>
            </div>
            
            {/* Map Layer Toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={mapLayer === 'satellite' ? 'default' : 'outline'}
                  onClick={() => mapLayer !== 'satellite' && toggleMapLayer()}
                  className={mapLayer === 'satellite' ? 'bg-cyan-600' : 'border-zinc-600'}
                >
                  Satellite
                </Button>
                <Button
                  size="sm"
                  variant={mapLayer === 'street' ? 'default' : 'outline'}
                  onClick={() => mapLayer !== 'street' && toggleMapLayer()}
                  className={mapLayer === 'street' ? 'bg-cyan-600' : 'border-zinc-600'}
                >
                  Street
                </Button>
              </div>
              
              {draggedPosition && (
                <div className="text-xs text-gray-400">
                  {draggedPosition.lat.toFixed(6)}, {draggedPosition.lng.toFixed(6)}
                </div>
              )}
            </div>
            
            {/* Map Container */}
            <div 
              ref={pinMapRef} 
              className="w-full h-[400px] rounded-lg border border-zinc-700 overflow-hidden"
              style={{ background: '#1a1a1a' }}
            />
            
            {/* Original vs New Coordinates */}
            {pinMapSpot && draggedPosition && (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-zinc-800 rounded-lg p-3">
                  <p className="text-gray-400 text-xs mb-1">Original Location</p>
                  <p className="text-white font-mono">
                    {pinMapSpot.latitude.toFixed(6)}, {pinMapSpot.longitude.toFixed(6)}
                  </p>
                </div>
                <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3">
                  <p className="text-cyan-400 text-xs mb-1">New Peak Location</p>
                  <p className="text-white font-mono">
                    {draggedPosition.lat.toFixed(6)}, {draggedPosition.lng.toFixed(6)}
                  </p>
                </div>
              </div>
            )}
            
            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <Button
                onClick={savePrecisionPin}
                className="flex-1 bg-gradient-to-r from-cyan-500 to-green-500 hover:from-cyan-600 hover:to-green-600"
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Verify & Save Peak Location
              </Button>
              <Button
                variant="outline"
                onClick={() => { setPrecisionPinOpen(false); setPinMapSpot(null); }}
                className="border-zinc-600"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};


export default UnifiedAdminConsole;
