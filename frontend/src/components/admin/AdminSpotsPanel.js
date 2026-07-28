import React, { useState, useEffect, useRef, useCallback } from 'react';
import apiClient from '../../lib/apiClient';
import { Search, CheckCircle,
  Loader2, Trash2, MapPin,
  Upload, Settings, RefreshCw
} from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { toast } from 'sonner';
import logger from '../../utils/logger';
import { AdminSpotsStats } from './AdminSpotsStats';
import { AdminSpotDuplicates } from './AdminSpotDuplicates';
import { AdminSpotsImportDialog } from './AdminSpotsImportDialog';
import '../../utils/leafletLoader'; // sets window.L (see file for why this was needed)

/**
 * AdminSpotsPanel - Extracted from UnifiedAdminConsole
 * Global spot manager with full CRUD, precision pin map, and surf data import.
 */
// Admin Spots Panel - Global Spot Manager
const AdminSpotsPanel = ({ userId }) => {
  const [stats, setStats] = useState(null);
  const [spotTotal, setSpotTotal] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  // Set when a live read failed, so the tiles can show "—" instead of a fabricated 0.
  const [loadError, setLoadError] = useState(null);
  // 'all' | 'flagged' | 'low_accuracy' | 'unverified' | 'verified' — the review state is the reason
  // to open this panel, so it needs to be filterable, not just countable. `flagged` is the UNION
  // and is now too coarse on its own: measured 2026-07-27 it holds 155 misplaced spots (fix the
  // COORDINATE) and 305 machine imports (confirm the SPOT EXISTS), which are different jobs.
  const [accuracyFilter, setAccuracyFilter] = useState('all');
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

  // ⚠️ RETURNS whether it succeeded. This used to swallow the error and leave `stats` null, which
  // renders as 0 through `stats?.total_spots || 0` — so a 401, a 500 or a dead backend produced a
  // confident "0 spots / 0 countries" that is indistinguishable from an empty database. Measured
  // 2026-07-28 against production: unauthenticated, /admin/spots/stats returns 401 and this panel
  // showed all zeros stamped "Live · updated 9:50:10 PM".
  const fetchStats = useCallback(async () => {
    try {
      const response = await apiClient.get(`/admin/spots/stats`);
      setStats(response.data);
      return true;
    } catch (error) {
      logger.error('Error fetching spot stats:', error);
      setStats(null);
      return false;
    }
  }, [userId]);

  // ★ Reads the ADMIN list, not the public one. This panel was written for admin data — the row
  // already renders `spot.is_verified_peak` — but it was fed `/surf-spots`, whose
  // SurfSpotResponse omits is_verified_peak, flagged_for_review and accuracy_flag entirely. Every
  // accuracy badge was therefore `undefined && ...` and silently rendered nothing, so 165 flagged
  // spots and 55 human-verified ones were invisible while the summary tiles counted them.
  const fetchSpots = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '5000' });
      if (filterCountry) params.append('country', filterCountry);
      if (accuracyFilter === 'flagged') params.append('flagged_only', 'true');
      const response = await apiClient.get(`/admin/spots/list?${params.toString()}`);
      setSpots(response.data.spots || []);
      setSpotTotal(response.data.total ?? (response.data.spots || []).length);
      return true;
    } catch (error) {
      logger.error('Error fetching spots:', error);
      return false;
    }
  }, [filterCountry, accuracyFilter]);

  // ONE refresh for every mutation. The tiles and the list read different endpoints, and
  // `handleUpdateSpot` used to refresh only the list — so editing a spot's accuracy left the
  // "Global Spot Database" counts showing the pre-edit numbers until a manual Refresh. Every
  // handler calls this instead of remembering to call both.
  // ⚠️ The timestamp is only stamped when the data ACTUALLY ARRIVED. It used to be set
  // unconditionally — both fetchers caught their own errors, so `Promise.all` always resolved and
  // the panel asserted "Live · updated <now>" over data that had never loaded. That timestamp
  // exists to make a stale panel distinguishable from a correct one, so certifying a failed load
  // was worse than having no timestamp at all.
  const refreshAll = useCallback(async () => {
    const [statsOk, spotsOk] = await Promise.all([fetchStats(), fetchSpots()]);
    if (statsOk && spotsOk) {
      setLoadError(null);
      setLastRefreshed(new Date());
    } else {
      setLoadError(
        statsOk || spotsOk
          ? 'Part of the live spot data could not be loaded — some counts may be missing.'
          : 'Live spot data could not be loaded. Check that you are signed in as an admin.'
      );
    }
  }, [fetchStats, fetchSpots]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await refreshAll();
      setLoading(false);
    };
    load();
  }, [refreshAll]);

  // The counts are a live view of production, so say when they were last read. Without it a stale
  // panel is indistinguishable from a correct one — which is exactly how the 165 flagged spots
  // went unnoticed.
  useEffect(() => {
    const id = setInterval(() => { refreshAll(); }, 60000);
    return () => clearInterval(id);
  }, [refreshAll]);

  // Import tier state

  const [importTier, setImportTier] = useState(0);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [includeOSM, setIncludeOSM] = useState(false);

  const handleImport = async () => {
    setImportLoading(true);
    try {
      const response = await apiClient.post(
        `/admin/spots/import?tier=${importTier}&include_osm=${includeOSM}`
      );
      const { total_imported: added = 0, skipped_existing: skipped = 0 } = response.data;
      // A green "success" on zero rows is what made this button look broken. It imports from 358
      // hardcoded CURATED_SPOTS and skips anything already present by (name, country) — and the
      // catalogue already contains all of them, so a CORRECT run adds nothing. Say so plainly
      // instead of reporting a win.
      if (added > 0) {
        toast.success(`Imported ${added} new spot${added === 1 ? '' : 's'}` +
          (skipped ? ` (${skipped} already in the catalogue)` : ''));
      } else {
        toast.warning(
          `Nothing to import — all ${skipped || 'curated'} spots are already in the catalogue.`,
          { description: 'This button only adds the built-in curated list. It cannot add new spots.' }
        );
      }
      setShowImportDialog(false);
      refreshAll();
    } catch (error) {
      logger.error('Import failed:', error);
      toast.error(error.response?.data?.detail || 'Import failed');
    } finally {
      setImportLoading(false);
    }
  };

  const handleUpdateSpot = async (spotId, updates) => {
    try {
      await apiClient.put(`/admin/spots/${spotId}`, null, { params: updates });
      toast.success('Spot updated');
      setEditingSpot(null);
      refreshAll();
    } catch (error) {
      toast.error('Update failed');
    }
  };

  const handleDeleteSpot = async (spotId, spotName) => {
    if (!window.confirm(`Delete "${spotName}"? This cannot be undone.`)) return;
    try {
      await apiClient.delete(`/admin/spots/${spotId}`);
      toast.success('Spot deleted');
      refreshAll();
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
      await apiClient.post(
        `/admin/spots/${pinMapSpot.id}/apply-refinement`,
        null,
        { params: { new_latitude: draggedPosition.lat, new_longitude: draggedPosition.lng } }
      );
      toast.success(`Peak location verified for ${pinMapSpot.name}`);
      setPrecisionPinOpen(false);
      setPinMapSpot(null);
      refreshAll();
    } catch (error) {
      toast.error('Failed to save pin location');
    }
  };

  const matchesAccuracy = (spot) => {
    if (accuracyFilter === 'all') return true;
    if (accuracyFilter === 'flagged') return !!spot.flagged_for_review;
    if (accuracyFilter === 'low_accuracy') return spot.accuracy_flag === 'low_accuracy';
    // Machine-imported and awaiting a human's "yes, this is a surf break". Measured 2026-07-27:
    // 305 of the 469 flagged spots are these, and every one of them is an EEA import.
    if (accuracyFilter === 'unverified') return spot.accuracy_flag === 'unverified';
    if (accuracyFilter === 'verified') {
      return ['verified', 'admin_verified', 'community_verified'].includes(spot.accuracy_flag);
    }
    return true;
  };

  const filteredSpots = spots.filter(spot =>
    matchesAccuracy(spot) && (
      spot.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (spot.country || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (spot.region || '').toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  // The one thing a reviewer needs to see at a glance, per row. Colour is paired with TEXT because
  // rating/accuracy state must never be conveyed by colour alone (accessibility mandate).
  const accuracyBadge = (spot) => {
    if (spot.flagged_for_review || spot.accuracy_flag === 'low_accuracy') {
      return { label: 'Misplaced — needs review', cls: 'bg-red-500/20 text-red-400' };
    }
    if (spot.accuracy_flag === 'offset_adjusted') {
      return { label: 'Relocated', cls: 'bg-amber-500/20 text-amber-500' };
    }
    if (['verified', 'admin_verified', 'community_verified'].includes(spot.accuracy_flag)) {
      return { label: 'Verified', cls: 'bg-emerald-500/20 text-emerald-400' };
    }
    return { label: 'Unverified', cls: 'bg-slate-500/20 text-muted-foreground' };
  };

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
      {/* Stats Overview — extracted to AdminSpotsStats.js (800-LOC ratchet, 2026-07-28) */}
      <AdminSpotsStats
        stats={stats}
        lastRefreshed={lastRefreshed}
        filterCountry={filterCountry}
        onFilterCountry={setFilterCountry}
        loadError={loadError}
      />

      {/* Duplicate review — live from the DB, so it also verifies a merge worked */}
      <AdminSpotDuplicates />

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button aria-label="Upload"
          onClick={() => setShowImportDialog(true)}
          className="bg-green-600 hover:bg-green-700"
        >
          <Upload className="w-4 h-4 mr-2" />
          Import Spots

        </Button>
        <Button aria-label="Refresh"
          variant="outline"
          onClick={() => refreshAll()}
          className="border-input"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Import tier picker — extracted to AdminSpotsImportDialog.js (LOC ratchet, 2026-07-28) */}
      <AdminSpotsImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        importTier={importTier}
        setImportTier={setImportTier}
        includeOSM={includeOSM}
        setIncludeOSM={setIncludeOSM}
        onImport={handleImport}
        importLoading={importLoading}
      />

      {/* Search & Filter */}
      <Card className="bg-card border-border">
        <CardContent className="pt-4">
          <div className="flex gap-2 mb-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input aria-label="Search spots..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search spots..."
                className="pl-10 bg-muted border-border text-foreground"
              />
            </div>
            <select
              value={filterCountry}
              onChange={(e) => setFilterCountry(e.target.value)}
              aria-label="Filter spots by country"
              className="bg-muted border border-border rounded-lg px-3 text-foreground"
            >
              <option value="">All Countries</option>
              {countries.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={accuracyFilter}
              onChange={(e) => setAccuracyFilter(e.target.value)}
              aria-label="Filter spots by accuracy state"
              className="bg-muted border border-border rounded-lg px-3 text-foreground"
            >
              <option value="all">All accuracy</option>
              <option value="flagged">Flagged for review</option>
              <option value="low_accuracy">Low accuracy (misplaced)</option>
              {/* The 2026-07-27 EEA import added 305 spots that are flagged for a DIFFERENT
                  reason than the misplaced ones: their coordinate is an official government
                  beach location, but nobody has confirmed a surf break is there. Reviewing them
                  means "is this a spot?", not "where is this spot?" — mixing the two queues makes
                  both unworkable, and `flagged` alone shows all 469 together. */}
              <option value="unverified">Newly imported (needs confirming)</option>
              <option value="verified">Verified by a human</option>
            </select>
          </div>
          {/* Same rule as the tiles: a failed read must not read as "0 in the database". */}
          <p className="text-xs text-muted-foreground mb-2" aria-live="polite">
            {loadError
              ? 'Spot list unavailable — the live read failed.'
              : <>Showing {Math.min(filteredSpots.length, 50)} of {filteredSpots.length} matching
                 {' '}({spotTotal} in the database)</>}
          </p>

          {/* Spots List */}
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {filteredSpots.slice(0, 50).map((spot) => (
              <div 
                key={spot.id} 
                className="flex items-center justify-between p-3 bg-muted rounded-lg hover:bg-input transition-colors"
              >
                <div className="flex-1">
                  <p className="text-foreground font-medium">{spot.name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{spot.country || 'Unknown'}</span>
                    {spot.state_province && <span>- {spot.state_province}</span>}
                    {spot.region && <span>- {spot.region}</span>}
                    {spot.wave_type && (
                      <Badge className="bg-blue-500/20 text-blue-400 text-[10px]">
                        {spot.wave_type}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={`${accuracyBadge(spot).cls} text-[10px]`}>
                    {accuracyBadge(spot).label}
                  </Badge>
                  <Badge className={spot.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}>
                    {spot.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                  <Button aria-label="Location"
                    size="sm"
                    variant="ghost"
                    onClick={() => openPrecisionPinMap(spot)}
                    className="text-cyan-400 hover:text-cyan-300"
                    title="Precision Pin - Drag to exact peak location"
                  >
                    <MapPin className="w-4 h-4" />
                  </Button>
                  <Button aria-label="Settings"
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingSpot(spot)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Settings className="w-4 h-4" />
                  </Button>
                  <Button aria-label="Delete"
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
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Edit Spot: {editingSpot?.name}</DialogTitle>
          </DialogHeader>
          {editingSpot && (
            <div className="modal-body px-4 sm:px-6 py-4 space-y-4">
              <div>
                <label className="text-sm text-muted-foreground">Name</label>
                <Input
                  value={editingSpot.name}
                  onChange={(e) => setEditingSpot({...editingSpot, name: e.target.value})}
                  className="bg-muted border-border text-foreground"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">Country</label>
                  <Input
                    value={editingSpot.country || ''}
                    onChange={(e) => setEditingSpot({...editingSpot, country: e.target.value})}
                    className="bg-muted border-border text-foreground"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">State/Province</label>
                  <Input
                    value={editingSpot.state_province || ''}
                    onChange={(e) => setEditingSpot({...editingSpot, state_province: e.target.value})}
                    className="bg-muted border-border text-foreground"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">Region</label>
                  <Input
                    value={editingSpot.region || ''}
                    onChange={(e) => setEditingSpot({...editingSpot, region: e.target.value})}
                    className="bg-muted border-border text-foreground"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Wave Type</label>
                  <Input
                    value={editingSpot.wave_type || ''}
                    onChange={(e) => setEditingSpot({...editingSpot, wave_type: e.target.value})}
                    className="bg-muted border-border text-foreground"
                    placeholder="Beach Break, Point Break..."
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">Latitude</label>
                  <Input
                    type="number"
                    step="0.0001"
                    value={editingSpot.latitude || ''}
                    onChange={(e) => setEditingSpot({...editingSpot, latitude: parseFloat(e.target.value)})}
                    className="bg-muted border-border text-foreground"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Longitude</label>
                  <Input
                    type="number"
                    step="0.0001"
                    value={editingSpot.longitude || ''}
                    onChange={(e) => setEditingSpot({...editingSpot, longitude: parseFloat(e.target.value)})}
                    className="bg-muted border-border text-foreground"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-muted-foreground">Active</label>
                <Button
                  variant={editingSpot.is_active ? 'default' : 'outline'}
                  onClick={() => setEditingSpot({...editingSpot, is_active: !editingSpot.is_active})}
                  className={editingSpot.is_active ? 'bg-green-600' : 'border-input'}
                >
                  {editingSpot.is_active ? 'Active' : 'Inactive'}
                </Button>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={() => handleUpdateSpot(editingSpot.id, editingSpot)}
                  className="flex-1 bg-cyan-600 hover:bg-cyan-700"
                >
                  Save Changes
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setEditingSpot(null)}
                  className="border-input"
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
        <DialogContent className="bg-card border-border max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
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
                  className={mapLayer === 'satellite' ? 'bg-cyan-600' : 'border-input'}
                >
                  Satellite
                </Button>
                <Button
                  size="sm"
                  variant={mapLayer === 'street' ? 'default' : 'outline'}
                  onClick={() => mapLayer !== 'street' && toggleMapLayer()}
                  className={mapLayer === 'street' ? 'bg-cyan-600' : 'border-input'}
                >
                  Street
                </Button>
              </div>
              
              {draggedPosition && (
                <div className="text-xs text-muted-foreground">
                  {draggedPosition.lat.toFixed(6)}, {draggedPosition.lng.toFixed(6)}
                </div>
              )}
            </div>
            
            {/* Map Container */}
            <div 
              ref={pinMapRef} 
              className="w-full h-[400px] rounded-lg border border-border overflow-hidden"
              style={{ background: '#1a1a1a' }}
            />
            
            {/* Original vs New Coordinates */}
            {pinMapSpot && draggedPosition && (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-muted-foreground text-xs mb-1">Original Location</p>
                  <p className="text-foreground font-mono">
                    {pinMapSpot.latitude.toFixed(6)}, {pinMapSpot.longitude.toFixed(6)}
                  </p>
                </div>
                <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3">
                  <p className="text-cyan-400 text-xs mb-1">New Peak Location</p>
                  <p className="text-foreground font-mono">
                    {draggedPosition.lat.toFixed(6)}, {draggedPosition.lng.toFixed(6)}
                  </p>
                </div>
              </div>
            )}
            
            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <Button aria-label="Check Circle"
                onClick={savePrecisionPin}
                className="flex-1 bg-gradient-to-r from-cyan-500 to-green-500 hover:from-cyan-600 hover:to-green-600"
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Verify & Save Peak Location
              </Button>
              <Button
                variant="outline"
                onClick={() => { setPrecisionPinOpen(false); setPinMapSpot(null); }}
                className="border-input"
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



export { AdminSpotsPanel };
