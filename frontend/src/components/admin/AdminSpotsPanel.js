import React, { useState, useEffect, useRef, useCallback } from 'react';
import apiClient from '../../lib/apiClient';
import { Search, CheckCircle,
  Loader2, Trash2, MapPin,
  Upload, Settings, RefreshCw
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { toast } from 'sonner';
import logger from '../../utils/logger';
import '../../utils/leafletLoader'; // sets window.L (see file for why this was needed)

/**
 * AdminSpotsPanel - Extracted from UnifiedAdminConsole
 * Global spot manager with full CRUD, precision pin map, and surf data import.
 */
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
      const response = await apiClient.get(`/admin/spots/stats`);
      setStats(response.data);
    } catch (error) {
      logger.error('Error fetching spot stats:', error);
    }
  }, [userId]);

  const fetchSpots = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterCountry) params.append('country', filterCountry);
      const response = await apiClient.get(`/surf-spots?${params.toString()}`);
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
      const response = await apiClient.post(
        `/admin/spots/import?tier=${importTier}&include_osm=${includeOSM}`
      );
      toast.success(response.data.message || `Imported ${response.data.total_imported} spots successfully`);
      setShowImportDialog(false);
      fetchSpots();
      fetchStats();
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
      fetchSpots();
    } catch (error) {
      toast.error('Update failed');
    }
  };

  const handleDeleteSpot = async (spotId, spotName) => {
    if (!window.confirm(`Delete "${spotName}"? This cannot be undone.`)) return;
    try {
      await apiClient.delete(`/admin/spots/${spotId}`);
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
      await apiClient.post(
        `/admin/spots/${pinMapSpot.id}/apply-refinement`,
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
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <MapPin className="w-5 h-5 text-cyan-400" />
            Global Spot Database
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-muted rounded-lg p-3 text-center">
              <p className="text-3xl font-bold text-foreground">{stats?.total_spots || 0}</p>
              <p className="text-xs text-muted-foreground">Total Spots</p>
            </div>
            <div className="bg-muted rounded-lg p-3 text-center">
              <p className="text-3xl font-bold text-cyan-400">{stats?.by_country?.length || 0}</p>
              <p className="text-xs text-muted-foreground">Countries</p>
            </div>
            <div className="bg-muted rounded-lg p-3 text-center">
              <p className="text-3xl font-bold text-green-400">{stats?.by_tier?.tier_1 || 0}</p>
              <p className="text-xs text-muted-foreground">Tier 1 (East Coast)</p>
            </div>
            <div className="bg-muted rounded-lg p-3 text-center">
              <p className="text-3xl font-bold text-purple-400">{stats?.by_tier?.tier_3 || 0}</p>
              <p className="text-xs text-muted-foreground">Tier 3 (Global)</p>
            </div>
          </div>

          {/* Countries breakdown */}
          <div className="flex flex-wrap gap-2">
            {stats?.by_country?.slice(0, 10).map((item) => (
              <Badge 
                key={item.country} 
                className="bg-input text-gray-300 cursor-pointer hover:bg-muted"
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
        <Button aria-label="Upload"
          onClick={() => setShowImportDialog(true)}
          className="bg-green-600 hover:bg-green-700"
        >
          <Upload className="w-4 h-4 mr-2" />
          Import Spots

        </Button>
        <Button aria-label="Refresh"
          variant="outline"
          onClick={() => { fetchStats(); fetchSpots(); }}
          className="border-input"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Import Tier Selection Dialog */}

      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="bg-card border border-border sm:max-w-md w-[95vw] sm:w-full rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Upload className="w-5 h-5 text-green-400" />
              Import Global Surf Spots

            </DialogTitle>
          </DialogHeader>
          
          <div className="modal-body px-4 sm:px-6 py-4 space-y-4">
            <p className="text-muted-foreground text-sm">
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
                      : 'border-border bg-muted hover:border-input'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      importTier === tier.value ? 'border-green-500' : 'border-zinc-500'
                    }`}>
                      {importTier === tier.value && <div className="w-2 h-2 rounded-full bg-green-500" />}
                    </div>
                    <div>
                      <p className="text-foreground font-medium text-sm sm:text-base">{tier.label}</p>
                      <p className="text-xs text-muted-foreground">{tier.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="flex items-start gap-2 p-3 bg-muted rounded-lg border border-border">
              <input aria-label="Checkbox"
                type="checkbox"
                id="include-osm"
                checked={includeOSM}
                onChange={(e) => setIncludeOSM(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-input flex-shrink-0"
              />
              <label htmlFor="include-osm" className="text-sm text-gray-300 leading-tight">
                Also fetch from OSM Overpass API (slower, more spots)
              </label>
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowImportDialog(false)}
              className="border-input text-gray-300 hover:text-foreground"
            >
              Cancel
            </Button>
            <Button aria-label="Loader2"
              onClick={handleImport}
              disabled={importLoading}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {importLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Start Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              className="bg-muted border border-border rounded-lg px-3 text-foreground"
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
                  {spot.is_verified_peak && (
                    <Badge className="bg-cyan-500/20 text-cyan-400 text-[10px]">
                      Verified
                    </Badge>
                  )}
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
