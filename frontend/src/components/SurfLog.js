import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen, Plus, Waves, Clock, MapPin, Star, Trash2, Edit3,
  ChevronLeft, Loader2, Calendar, Thermometer, Wind, Users, Save
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getThemeTokens } from '../utils/themeTokens';
import PreSessionConfigModal from './PreSessionConfigModal';
import LiveSessionDashboard from './LiveSessionDashboard';
import GpxUploadModal from './GpxUploadModal';
import { LocationPicker } from './LocationPicker';

const MOODS = [
  { id: 'stoked', label: 'Stoked', icon: '🤙', color: 'text-green-400' },
  { id: 'happy', label: 'Happy', icon: '😊', color: 'text-yellow-400' },
  { id: 'mellow', label: 'Mellow', icon: '😌', color: 'text-blue-400' },
  { id: 'frustrated', label: 'Frustrated', icon: '😤', color: 'text-orange-400' },
  { id: 'exhausted', label: 'Exhausted', icon: '😩', color: 'text-red-400' },
];

const CROWD_LEVELS = ['Empty', 'Light', 'Moderate', 'Crowded', 'Packed'];
const TIDE_OPTIONS = ['Low', 'Rising', 'High', 'Falling'];
const WIND_OPTIONS = ['Offshore', 'Cross-offshore', 'Cross-shore', 'Cross-onshore', 'Onshore', 'Calm'];
const TIME_OPTIONS = ['Dawn Patrol', 'Morning', 'Midday', 'Afternoon', 'Sunset', 'Night'];

/* --- Stats Banner -------------------------------------------- */
const StatsBanner = ({ stats, isLight }) => {
  if (!stats || stats.total_sessions === 0) return null;
  const items = [
    { label: 'Sessions', value: stats.total_sessions, icon: Waves, gradient: 'from-cyan-500/20 to-blue-500/20', border: 'border-cyan-500/30' },
    { label: 'Hours', value: stats.total_hours, icon: Clock, gradient: 'from-purple-500/20 to-pink-500/20', border: 'border-purple-500/30' },
    { label: 'Avg Rating', value: stats.avg_personal_rating ?? '-', icon: Star, gradient: 'from-yellow-500/20 to-orange-500/20', border: 'border-yellow-500/30' },
  ];
  return (
    <div className="px-4 md:px-0 mb-4">
      <div className="grid grid-cols-3 gap-3">
        {items.map(s => (
          <div key={s.label} className={`p-3 md:p-4 rounded-xl border text-center bg-gradient-to-br ${s.gradient} ${s.border} transition-all hover:scale-[1.02]`}>
            <s.icon className="w-4 h-4 md:w-5 md:h-5 mx-auto mb-1.5 text-cyan-400" />
            <p className={`text-xl md:text-2xl font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>{s.value}</p>
            <p className={`text-[10px] md:text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>{s.label}</p>
          </div>
        ))}
      </div>
      {stats.favourite_spot && (
        <div className={`mt-3 p-3 rounded-xl border ${isLight ? 'bg-white/80 border-gray-200' : 'bg-zinc-800/60 border-zinc-700'} flex items-center gap-2`}>
          <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className={`text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
            Favourite: <span className={`font-medium ${isLight ? 'text-gray-900' : 'text-white'}`}>{stats.favourite_spot}</span> ({stats.favourite_spot_count}x)
          </span>
        </div>
      )}
    </div>
  );
};

/* --- Entry Card ---------------------------------------------- */
const EntryCard = ({ entry, isLight, onEdit, onDelete }) => {
  const mood = MOODS.find(m => m.id === entry.mood);
  return (
    <div className={`p-4 rounded-xl border transition-all hover:scale-[1.01] hover:shadow-lg ${isLight ? 'bg-white border-gray-200 shadow-sm hover:shadow-gray-200/50' : 'bg-zinc-800/60 border-zinc-700 hover:border-zinc-600 hover:shadow-cyan-500/5'}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-cyan-400" />
          <span className={`text-sm font-semibold ${isLight ? 'text-gray-900' : 'text-white'}`}>
            {new Date(entry.session_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
          {entry.session_time && <Badge variant="outline" className="text-[10px] py-0">{entry.session_time}</Badge>}
          {mood && <span title={mood.label}>{mood.icon}</span>}
        </div>
        <div className="flex items-center gap-1">
          <button aria-label="Edit3" onClick={() => onEdit(entry)} className={`p-1.5 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-700'}`}><Edit3 className="w-3.5 h-3.5 text-gray-400" /></button>
          <button aria-label="Delete" onClick={() => onDelete(entry.id)} className={`p-1.5 rounded-lg ${isLight ? 'hover:bg-red-50' : 'hover:bg-red-500/10'}`}><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
        </div>
      </div>

      {entry.spot_name && (
        <div className="flex items-center gap-1.5 mb-2">
          <MapPin className="w-3 h-3 text-cyan-400" />
          <span className={`text-xs font-medium ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>{entry.spot_name}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mb-2">
        {entry.wave_height && <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]"><Waves className="w-2.5 h-2.5 mr-0.5" />{entry.wave_height}</Badge>}
        {entry.duration_minutes && <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-[10px]"><Clock className="w-2.5 h-2.5 mr-0.5" />{entry.duration_minutes}min</Badge>}
        {entry.wind_direction && <Badge className="bg-teal-500/20 text-teal-400 border-teal-500/30 text-[10px]"><Wind className="w-2.5 h-2.5 mr-0.5" />{entry.wind_direction}</Badge>}
        {entry.crowd_level && <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-[10px]"><Users className="w-2.5 h-2.5 mr-0.5" />{entry.crowd_level}</Badge>}
        {entry.water_temp && <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-[10px]"><Thermometer className="w-2.5 h-2.5 mr-0.5" />{entry.water_temp}</Badge>}
        {entry.board_model && <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px]">{String.fromCodePoint(0x1F3C4)} {entry.board_model}</Badge>}
      </div>

      {entry.personal_rating && (
        <div className="flex items-center gap-0.5 mb-1">
          {[1,2,3,4,5].map(s => <Star key={s} className={`w-3 h-3 ${s <= entry.personal_rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`} />)}
        </div>
      )}

      {entry.notes && <p className={`text-xs mt-1 ${isLight ? 'text-gray-600' : 'text-gray-400'} line-clamp-2`}>{entry.notes}</p>}
      {entry.source !== 'manual' && <Badge variant="outline" className="text-[9px] mt-1 py-0">auto: {entry.source}</Badge>}
    </div>
  );
};

/* --- Create / Edit Modal ------------------------------------- */
const EntryModal = ({ isOpen, onClose, entry, userId, onSaved, prefillMetrics, prefillGear, prefillLocation }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const bg = isLight ? 'bg-white' : 'bg-zinc-900';
  const inputCls = `w-full px-3 py-2 rounded-lg border text-sm ${isLight ? 'bg-white border-gray-300 text-gray-900' : 'bg-zinc-800 border-zinc-700 text-white'}`;

  const [form, setForm] = useState({
    session_date: new Date().toISOString().split('T')[0],
    session_time: '', duration_minutes: '', spot_name: '',
    wave_height: '', wind_direction: '', tide_status: '', water_temp: '', crowd_level: '',
    board_model: '', wetsuit: '', fin_setup: '',
    notes: '', mood: '', personal_rating: 0, conditions_rating: 0,
    latitude: '', longitude: ''
  });
  const [saving, setSaving] = useState(false);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);

  useEffect(() => {
    if (entry) {
      setForm({
        session_date: entry.session_date || new Date().toISOString().split('T')[0],
        session_time: entry.session_time || '', duration_minutes: entry.duration_minutes || '',
        spot_name: entry.spot_name || '', wave_height: entry.wave_height || '',
        wind_direction: entry.wind_direction || '', tide_status: entry.tide_status || '',
        water_temp: entry.water_temp || '', crowd_level: entry.crowd_level || '',
        board_model: entry.board_model || '', wetsuit: entry.wetsuit || '', fin_setup: entry.fin_setup || '',
        notes: entry.notes || '', mood: entry.mood || '',
        personal_rating: entry.personal_rating || 0, conditions_rating: entry.conditions_rating || 0,
        latitude: entry.latitude || '', longitude: entry.longitude || ''
      });
    } else {
      setForm(f => ({ 
        ...f, 
        session_date: new Date().toISOString().split('T')[0],
        duration_minutes: prefillMetrics ? Math.floor(prefillMetrics.duration_minutes || 0) : '',
        board_model: prefillGear || '',
        spot_name: prefillLocation?.name || '',
        latitude: prefillLocation?.lat || '',
        longitude: prefillLocation?.lng || '',
        notes: prefillMetrics ? `Distance: ${(prefillMetrics.distance / 1000).toFixed(2)}km | Waves: ${prefillMetrics.waveCount} | Top Speed: ${(prefillMetrics.topSpeed * 3.6).toFixed(1)}km/h` : ''
      }));
    }
  }, [entry, isOpen, prefillMetrics, prefillGear, prefillLocation]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.session_date) { toast.error('Session date is required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, duration_minutes: form.duration_minutes ? parseInt(form.duration_minutes, 10) : null };
      if (entry?.id) {
        await apiClient.patch(`/surf-log/${userId}/${entry.id}`, payload);
        toast.success('Entry updated');
      } else {
        await apiClient.post(`/surf-log/${userId}`, payload);
        toast.success('Session logged! 🤙');
      }
      onSaved();
      onClose();
    } catch (err) {
      logger.error('Save surf log entry failed:', err);
      toast.error(err.response?.data?.detail || 'Failed to save entry');
    } finally { setSaving(false); }
  };

  const handleLocationSelected = async (loc) => {
    set('latitude', loc.lat);
    set('longitude', loc.lng);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.lat}&lon=${loc.lng}`);
      const data = await res.json();
      if (data && data.address) {
        const spotName = data.address.beach || data.address.suburb || data.address.town || data.address.city || data.display_name.split(',')[0];
        set('spot_name', spotName);
      }
    } catch (e) {
      console.warn("Reverse geocode failed", e);
    }
  };

  const ChipSelect = ({ options, value, onChange, label }) => (
    <div className="space-y-1">
      <label className={`text-xs font-medium ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => (
          <button key={o} type="button" onClick={() => onChange(value === o ? '' : o)}
            className={`px-2.5 py-1 rounded-full text-[11px] transition-all ${value === o ? 'bg-cyan-500 text-white' : isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-zinc-800 text-gray-300 hover:bg-zinc-700'}`}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${bg} border-zinc-800 max-w-md md:max-w-lg max-h-[85vh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle className={`text-lg font-bold ${isLight ? 'text-gray-900' : 'text-white'} flex items-center gap-2`}>
            <BookOpen className="w-5 h-5 text-cyan-400" />
            {entry ? 'Edit Session' : 'Log a Session'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-3">
            <div><label className={`text-xs font-medium ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>Date *</label><input type="date" value={form.session_date} onChange={e => set('session_date', e.target.value)} className={inputCls} /></div>
            <div>
              <label className={`text-xs font-medium ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>Time of Day</label>
              <select value={form.session_time} onChange={e => set('session_time', e.target.value)} className={inputCls}>
                <option value="">Select...</option>
                {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Duration & Spot */}
          <div className="grid grid-cols-2 gap-3">
            <div><label className={`text-xs font-medium ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>Duration (min)</label><input type="number" value={form.duration_minutes} onChange={e => set('duration_minutes', e.target.value)} placeholder="90" className={inputCls} /></div>
            <div>
              <label className={`text-xs font-medium ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>Spot Name</label>
              <div className="flex gap-2">
                <input type="text" value={form.spot_name} onChange={e => set('spot_name', e.target.value)} placeholder="Pipeline" className={inputCls} />
                <button type="button" onClick={() => setLocationPickerOpen(true)} className="px-3 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white flex-shrink-0" title="Pick on map">
                  <MapPin className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Conditions */}
          <div className={`p-3 rounded-xl ${isLight ? 'bg-blue-50' : 'bg-blue-500/10'} space-y-3`}>
            <p className={`text-xs font-semibold ${isLight ? 'text-blue-700' : 'text-blue-300'} flex items-center gap-1`}><Waves className="w-3.5 h-3.5" /> Conditions</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={`text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Wave Height</label><input type="text" value={form.wave_height} onChange={e => set('wave_height', e.target.value)} placeholder="3-5ft" className={inputCls} /></div>
              <div><label className={`text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Water Temp</label><input type="text" value={form.water_temp} onChange={e => set('water_temp', e.target.value)} placeholder="72-F" className={inputCls} /></div>
            </div>
            <ChipSelect label="Wind" options={WIND_OPTIONS} value={form.wind_direction} onChange={v => set('wind_direction', v)} />
            <ChipSelect label="Tide" options={TIDE_OPTIONS} value={form.tide_status} onChange={v => set('tide_status', v)} />
            <ChipSelect label="Crowd" options={CROWD_LEVELS} value={form.crowd_level} onChange={v => set('crowd_level', v)} />
            <div>
              <label className={`text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Conditions Rating</label>
              <div className="flex gap-1 mt-1">{[1,2,3,4,5].map(s => <button key={s} type="button" onClick={() => set('conditions_rating', s)}><Star className={`w-5 h-5 ${s <= form.conditions_rating ? 'text-cyan-400 fill-cyan-400' : 'text-gray-600'}`} /></button>)}</div>
            </div>
          </div>

          {/* Gear */}
          <div className={`p-3 rounded-xl ${isLight ? 'bg-yellow-50' : 'bg-yellow-500/10'} space-y-3`}>
              <p className={`text-xs font-semibold ${isLight ? 'text-yellow-700' : 'text-yellow-300'}`}>{String.fromCodePoint(0x1F3C4)} Gear</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={`text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Board</label><input type="text" value={form.board_model} onChange={e => set('board_model', e.target.value)} placeholder="6'2 shortboard" className={inputCls} /></div>
              <div><label className={`text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Wetsuit</label><input type="text" value={form.wetsuit} onChange={e => set('wetsuit', e.target.value)} placeholder="3/2mm" className={inputCls} /></div>
            </div>
          </div>

          {/* Mood & Rating */}
          <div>
            <label className={`text-xs font-medium ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>Mood</label>
            <div className="flex gap-2 mt-1">
              {MOODS.map(m => (
                <button key={m.id} type="button" onClick={() => set('mood', form.mood === m.id ? '' : m.id)}
                  className={`flex flex-col items-center p-2 rounded-xl transition-all ${form.mood === m.id ? 'bg-cyan-500/20 ring-1 ring-cyan-500' : isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-800'}`}>
                  <span className="text-lg">{m.icon}</span>
                  <span className={`text-[9px] ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={`text-xs font-medium ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>Session Rating</label>
            <div className="flex gap-1 mt-1">{[1,2,3,4,5].map(s => <button key={s} type="button" onClick={() => set('personal_rating', s)}><Star className={`w-6 h-6 ${s <= form.personal_rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`} /></button>)}</div>
          </div>

          {/* Notes */}
          <div>
            <label className={`text-xs font-medium ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="How was the session..." rows={3}
              className={`${inputCls} mt-1`} maxLength={1000} />
          </div>

          <Button aria-label="Loader2" onClick={handleSave} disabled={saving} className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-bold py-3">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {entry ? 'Update Session' : 'Log Session'}
          </Button>
        </div>
      </DialogContent>

      <LocationPicker 
        isOpen={locationPickerOpen} 
        onClose={() => setLocationPickerOpen(false)} 
        onLocationSelected={handleLocationSelected} 
      />
    </Dialog>
  );
};

/* --- Main SurfLog Page --------------------------------------- */
const SurfLog = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { theme } = useTheme();
  const t = getThemeTokens(theme);
  const isLight = t.isLight;

  const [entries, setEntries] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [isLiveTracking, setIsLiveTracking] = useState(false);
  const [selectedGear, setSelectedGear] = useState('');
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [trackingMetrics, setTrackingMetrics] = useState(null);
  const [gpxModalOpen, setGpxModalOpen] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [entriesRes, statsRes] = await Promise.allSettled([
        apiClient.get(`/surf-log/${user.id}?limit=100`),
        apiClient.get(`/surf-log/${user.id}/stats`),
      ]);
      if (entriesRes.status === 'fulfilled') setEntries(entriesRes.value.data.entries || []);
      if (statsRes.status === 'fulfilled') setStats(statsRes.value.data);
    } catch (err) {
      logger.error('Failed to fetch surf log:', err);
    } finally { setLoading(false); }
  }, [user?.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Handle Strava OAuth Callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    if (code && state) {
      const exchangeToken = async () => {
        try {
          const res = await apiClient.get(`/strava/callback?code=${code}&state=${state}`);
          if (res.data.success) {
            toast.success("Strava successfully connected! 🤙");
            // Clean up the URL
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        } catch (err) {
          logger.error("Failed to connect Strava:", err);
          toast.error("Failed to finalize Strava connection.");
        }
      };
      exchangeToken();
    } else if (error) {
      toast.error(`Strava connection denied: ${error}`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleDelete = async (entryId) => {
    if (!window.confirm('Delete this session?')) return;
    try {
      await apiClient.delete(`/surf-log/${user.id}/${entryId}`);
      toast.success('Entry deleted');
      fetchData();
    } catch (err) {
      toast.error('Failed to delete');
    }
  };

  const handleEdit = (entry) => { setEditEntry(entry); setModalOpen(true); };
  const handleCreate = () => { setEditEntry(null); setConfigModalOpen(true); };

  if (isLiveTracking) {
    return (
      <LiveSessionDashboard 
        userId={user?.id}
        spotId={null}
        selectedBoard={selectedGear}
        onEndSession={(metrics, board, activeSeconds) => {
          setIsLiveTracking(false);
          if (metrics) {
            setTrackingMetrics({
              ...metrics,
              duration_minutes: activeSeconds ? activeSeconds / 60 : 0
            });
            setSelectedGear(board);
            setEditEntry(null);
            setModalOpen(true);
          }
        }}
      />
    );
  }

  return (
    <div className={`max-w-2xl mx-auto pb-24 ${isLight ? 'bg-gray-50/50 min-h-screen' : 'min-h-screen'}`}>
      {/* Header */}
      <div className={`sticky top-0 z-40 backdrop-blur-xl border-b ${isLight ? 'bg-white/90 border-gray-200' : 'bg-zinc-900/95 border-zinc-800'}`}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className={`p-1.5 rounded-full ${isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-800'} transition-colors md:hidden`} aria-label="Previous">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-cyan-400" />
              </div>
              <div>
                <h1 className={`text-lg font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>Surf Log</h1>
                <p className={`text-[10px] hidden md:block ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>Track your sessions & progress</p>
              </div>
            </div>
          </div>
          <Button size="sm" onClick={handleCreate} className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white shadow-lg shadow-cyan-500/20 transition-all hover:shadow-cyan-500/40" aria-label="Add">
            <Plus className="w-4 h-4 mr-1" /> Log Session
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
          <p className={`text-sm ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>Loading your sessions...</p>
        </div>
      ) : (
        <>
          <div className="mt-4">
            <StatsBanner stats={stats} isLight={isLight} />
          </div>

          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center mb-5 animate-pulse">
                <BookOpen className="w-10 h-10 text-cyan-400" />
              </div>
              <h3 className={`font-bold text-xl mb-2 ${isLight ? 'text-gray-900' : 'text-white'}`}>No sessions yet</h3>
              <p className={`text-sm mb-6 max-w-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>Start logging your surf sessions to track your progress, conditions, and stoke level.</p>
              <Button onClick={handleCreate} className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white px-6 py-3 shadow-lg shadow-cyan-500/20" aria-label="Add">
                <Plus className="w-4 h-4 mr-1" /> Log Your First Session
              </Button>
            </div>
          ) : (
            <div className="mt-2 px-4 md:px-0">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {entries.map(e => <EntryCard key={e.id} entry={e} isLight={isLight} onEdit={handleEdit} onDelete={handleDelete} />)}
              </div>
            </div>
          )}
        </>
      )}

      <PreSessionConfigModal 
        isOpen={configModalOpen} 
        onClose={() => setConfigModalOpen(false)}
        onStartLive={(board, location) => {
          setSelectedGear(board);
          setSelectedLocation(location);
          setConfigModalOpen(false);
          setIsLiveTracking(true);
        }}
        onSyncWatch={() => {
          setConfigModalOpen(false);
          setGpxModalOpen(true);
        }}
        onManualEntry={(board, location) => {
          setSelectedGear(board);
          setSelectedLocation(location);
          setConfigModalOpen(false);
          setEditEntry(null);
          setModalOpen(true);
        }}
      />

      <GpxUploadModal
        isOpen={gpxModalOpen}
        onClose={() => setGpxModalOpen(false)}
        onParsed={(metrics) => {
          setGpxModalOpen(false);
          setTrackingMetrics(metrics);
          setEditEntry(null);
          setModalOpen(true);
        }}
      />

      <EntryModal 
        isOpen={modalOpen} 
        onClose={() => { setModalOpen(false); setEditEntry(null); setTrackingMetrics(null); setSelectedLocation(null); }} 
        entry={editEntry} 
        userId={user?.id} 
        onSaved={fetchData} 
        prefillMetrics={trackingMetrics}
        prefillGear={selectedGear}
        prefillLocation={selectedLocation}
      />
      
      {!loading && (
        <button 
          onClick={() => setConfigModalOpen(true)}
          className="fixed bottom-20 right-6 z-50 w-14 h-14 bg-cyan-500 hover:bg-cyan-600 text-white rounded-full shadow-lg shadow-cyan-500/30 flex items-center justify-center transition-transform hover:scale-110"
          aria-label="Track Session"
        >
          <MapPin className="w-6 h-6" />
        </button>
      )}
    </div>
  );
};

export default SurfLog;
