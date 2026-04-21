import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MapPin, Plus, Trash2, AlertTriangle, Search, RefreshCw, Loader2, Eye, X, Edit2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '../ui/select';
import { useAuth } from '../../contexts/AuthContext';
import apiClient, { BACKEND_URL } from '../../lib/apiClient';
import { toast } from 'sonner';
import logger from '../../utils/logger';


// NOAA Buoy stations - comprehensive list for all supported regions
const NOAA_BUOYS = [
  // Florida
  { id: '41009', name: 'Canaveral 20NM', region: 'FL', lat: 28.519, lon: -80.166 },
  { id: '41010', name: 'Canaveral 120NM', region: 'FL', lat: 28.878, lon: -78.485 },
  { id: '41114', name: 'Fort Pierce', region: 'FL', lat: 27.551, lon: -80.225 },
  { id: '41113', name: 'Cape Canaveral Nearshore', region: 'FL', lat: 28.400, lon: -80.534 },
  { id: '41117', name: 'St Augustine', region: 'FL', lat: 30.000, lon: -81.078 },
  // New York / New Jersey
  { id: '44025', name: 'Long Island', region: 'NY', lat: 40.251, lon: -73.164 },
  { id: '44065', name: 'New York Harbor Entrance', region: 'NY', lat: 40.369, lon: -73.703 },
  { id: '44017', name: 'Montauk Point', region: 'NY', lat: 40.694, lon: -72.048 },
  { id: '44091', name: 'Barnegat', region: 'NJ', lat: 39.769, lon: -73.769 },
  // North Carolina
  { id: '41025', name: 'Diamond Shoals', region: 'NC', lat: 35.006, lon: -75.402 },
  { id: '41036', name: 'Wilmington', region: 'NC', lat: 34.207, lon: -76.949 },
  { id: '41159', name: 'Onslow Bay Outer', region: 'NC', lat: 34.150, lon: -76.400 },
  // California
  { id: '46025', name: 'Santa Monica Basin', region: 'CA', lat: 33.749, lon: -119.053 },
  { id: '46221', name: 'Santa Cruz', region: 'CA', lat: 36.750, lon: -121.900 },
  { id: '46026', name: 'San Francisco', region: 'CA', lat: 37.759, lon: -122.833 },
  { id: '46214', name: 'Point Reyes', region: 'CA', lat: 37.946, lon: -123.470 },
  { id: '46053', name: 'East Santa Barbara', region: 'CA', lat: 34.252, lon: -119.841 },
  { id: '46086', name: 'San Clemente Basin', region: 'CA', lat: 32.491, lon: -118.034 },
  { id: '46232', name: 'Point Loma South', region: 'CA', lat: 32.530, lon: -117.431 },
  // Hawaii
  { id: '51201', name: 'Waimea Bay', region: 'HI', lat: 21.670, lon: -158.116 },
  { id: '51202', name: 'Mokapu Point', region: 'HI', lat: 21.417, lon: -157.679 },
  { id: '51203', name: 'Kaneohe Bay', region: 'HI', lat: 21.477, lon: -157.752 },
  { id: '51204', name: 'Hilo', region: 'HI', lat: 19.780, lon: -154.970 },
  { id: '51207', name: 'Kailua-Kona', region: 'HI', lat: 19.529, lon: -156.052 },
  // Puerto Rico & Caribbean
  { id: '41053', name: 'San Juan', region: 'PR', lat: 18.476, lon: -66.009 },
  { id: '41056', name: 'Vieques Passage', region: 'PR', lat: 18.260, lon: -65.010 },
  { id: '41043', name: 'NE Puerto Rico', region: 'PR', lat: 21.124, lon: -64.966 },
  { id: '42059', name: 'Eastern Caribbean', region: 'Caribbean', lat: 15.000, lon: -67.500 },
  // Costa Rica / Central America
  { id: '42058', name: 'West Caribbean', region: 'Costa Rica', lat: 14.888, lon: -74.544 },
  { id: '42057', name: 'Caribbean Buoy', region: 'Central America', lat: 16.908, lon: -81.422 },
  // Pacific Islands (Fiji, Samoa, Tonga)
  { id: '51000', name: 'Northern Hawaii', region: 'Pacific', lat: 23.546, lon: -162.279 },
  { id: '52200', name: 'Pago Pago', region: 'American Samoa', lat: -14.280, lon: -170.688 },
  // El Salvador / South America
  { id: '42060', name: 'Caribbean South', region: 'South Caribbean', lat: 16.434, lon: -63.329 },
  { id: '32012', name: 'West Colombia Basin', region: 'Pacific SA', lat: 8.075, lon: -84.046 }
];

// Group buoys by region for easier selection
const NOAA_BUOY_REGIONS = {
  'Florida': NOAA_BUOYS.filter(b => b.region === 'FL'),
  'New York/NJ': NOAA_BUOYS.filter(b => b.region === 'NY' || b.region === 'NJ'),
  'North Carolina': NOAA_BUOYS.filter(b => b.region === 'NC'),
  'California': NOAA_BUOYS.filter(b => b.region === 'CA'),
  'Hawaii': NOAA_BUOYS.filter(b => b.region === 'HI'),
  'Caribbean': NOAA_BUOYS.filter(b => ['PR', 'Caribbean', 'Central America', 'South Caribbean'].includes(b.region)),
  'Pacific': NOAA_BUOYS.filter(b => ['Pacific', 'American Samoa', 'Pacific SA', 'Costa Rica'].includes(b.region)),
};

/**
 * AdminSpotEditor - Precision Map-Editor for Admin Dashboard
 * 
 * Features:
 * - Click-and-drag to move existing pins
 * - Double-click to create new pins
 * - Right-click or delete button to remove pins
 * - "Water Check" warning when pin is on land
 * - NOAA Buoy assignment for each spot
 * - Satellite imagery toggle
 */
export const AdminSpotEditor = () => {
  const { user } = useAuth();
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const [mapContainerReady, setMapContainerReady] = useState(false);
  
  // Callback ref to detect when map container is in the DOM
  const setMapRef = useCallback((node) => {
    mapContainerRef.current = node;
    if (node) {
      setMapContainerReady(true);
    }
  }, []);
  
  // State
  const [spots, setSpots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingCoords, setPendingCoords] = useState(null);
  const [landWarning, setLandWarning] = useState(null);
  const [saving, setSaving] = useState(false);
  const [leafletReady, setLeafletReady] = useState(false);
  const [satelliteView, setSatelliteView] = useState(true);
  
  // Check if Leaflet is loaded
  useEffect(() => {
    const checkLeaflet = () => {
      if (window.L) {
        logger.debug('[AdminMap] Leaflet is ready');
        setLeafletReady(true);
        return true;
      }
      return false;
    };
    
    if (checkLeaflet()) return;
    
    // Poll for Leaflet availability
    const interval = setInterval(() => {
      if (checkLeaflet()) {
        clearInterval(interval);
      }
    }, 100);
    
    // Timeout after 5 seconds
    const timeout = setTimeout(() => {
      clearInterval(interval);
      if (!window.L) {
        logger.error('[AdminMap] Leaflet failed to load');
        toast.error('Map library failed to load. Please refresh the page.');
      }
    }, 5000);
    
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);
  
  // Form state for create/edit
  const [formData, setFormData] = useState({
    name: '',
    region: '',
    country: 'USA',
    difficulty: 'Intermediate',
    wave_type: 'Beach Break',
    noaa_buoy_id: ''
  });

  // Fetch spots - no limit to get all spots
  const fetchSpots = useCallback(async () => {
    try {
      const response = await apiClient.get(`/admin/spots/list`, {
        params: { limit: 5000 }  // High limit to fetch all spots
      });
      setSpots(response.data.spots || []);
    } catch (error) {
      toast.error('Failed to load spots');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) {
      fetchSpots();
    }
  }, [user?.id, fetchSpots]);

  // Initialize map
  useEffect(() => {
    logger.debug('[AdminMap] Init effect running. mapContainerReady:', mapContainerReady, 'leafletReady:', leafletReady, 'mapInstance:', !!mapInstanceRef.current);
    
    if (!mapContainerRef.current || !leafletReady || !mapContainerReady || mapInstanceRef.current) {
      logger.debug('[AdminMap] Skipping init - conditions not met');
      return;
    }

    logger.debug('[AdminMap] Creating Leaflet map...');
    
    const map = window.L.map(mapContainerRef.current, {
      center: [25.7617, -80.1918], // Miami
      zoom: 6,
      doubleClickZoom: false // Disable default double-click zoom
    });

    logger.debug('[AdminMap] Map created, adding tile layers...');

    // Satellite layer (ESRI)
    const satelliteLayer = window.L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'ESRI', maxZoom: 19 }
    );

    // Street layer (ESRI)
    const streetLayer = window.L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'ESRI', maxZoom: 19 }
    );

    if (satelliteView) {
      satelliteLayer.addTo(map);
    } else {
      streetLayer.addTo(map);
    }

    mapInstanceRef.current = map;

    // Force map to refresh its size after initialization
    setTimeout(() => {
      if (map) {
        map.invalidateSize();
        logger.debug('[AdminMap] Map size invalidated');
      }
    }, 200);

    // Double-click to create new spot
    map.on('dblclick', (e) => {
      if (editMode) {
        setPendingCoords({ lat: e.latlng.lat, lng: e.latlng.lng });
        setFormData({
          name: '',
          region: '',
          country: 'USA',
          difficulty: 'Intermediate',
          wave_type: 'Beach Break',
          noaa_buoy_id: ''
        });
        setShowCreateModal(true);
      }
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [leafletReady, mapContainerReady]);

  // Toggle satellite/street view
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    
    const map = mapInstanceRef.current;
    
    // Remove existing tile layers
    map.eachLayer((layer) => {
      if (layer instanceof window.L.TileLayer) {
        map.removeLayer(layer);
      }
    });
    
    if (satelliteView) {
      window.L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'ESRI', maxZoom: 19 }
      ).addTo(map);
    } else {
      window.L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'ESRI', maxZoom: 19 }
      ).addTo(map);
    }
  }, [satelliteView]);

  // Render markers
  useEffect(() => {
    if (!mapInstanceRef.current || !spots.length) return;

    const map = mapInstanceRef.current;

    // Clear existing markers
    Object.values(markersRef.current).forEach(marker => {
      map.removeLayer(marker);
    });
    markersRef.current = {};

    // Add markers for each spot
    spots.forEach(spot => {
      // Validate coordinates before creating marker
      if (!spot.latitude || !spot.longitude || 
          isNaN(spot.latitude) || isNaN(spot.longitude)) {
        return;
      }
      
      const icon = window.L.divIcon({
        className: 'admin-spot-marker',
        html: `
          <div class="relative group">
            <div class="w-6 h-6 rounded-full ${spot.community_verified ? 'bg-emerald-500' : spot.is_verified_peak ? 'bg-cyan-500' : 'bg-yellow-500'} border-2 border-white shadow-lg flex items-center justify-center cursor-pointer">
              ${spot.community_verified ? '✓' : spot.flagged_for_review ? '!' : ''}
            </div>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      const marker = window.L.marker([spot.latitude, spot.longitude], {
        icon,
        draggable: editMode
      }).addTo(map);

      // Popup
      marker.bindPopup(`
        <div class="p-2">
          <strong>${spot.name}</strong><br/>
          <span class="text-sm text-gray-500">${spot.region || 'No region'}</span><br/>
          <span class="text-xs">(${spot.latitude.toFixed(4)}, ${spot.longitude.toFixed(4)})</span>
        </div>
      `);

      // Click to select
      marker.on('click', () => {
        setSelectedSpot(spot);
      });

      // Drag end - move spot
      marker.on('dragend', async (e) => {
        const newPos = e.target.getLatLng();
        try {
          setSaving(true);
          const response = await apiClient.put(
            `/admin/spots/${spot.id}/move`,
            { latitude: newPos.lat, longitude: newPos.lng, override_land_warning: false }
          );
          
          if (response.data.warning === 'land_detected') {
            setLandWarning({
              spotId: spot.id,
              message: response.data.message,
              coords: { lat: newPos.lat, lng: newPos.lng }
            });
            // Revert marker position
            marker.setLatLng([spot.latitude, spot.longitude]);
          } else {
            toast.success(`Moved ${spot.name}`);
            fetchSpots();
          }
        } catch (error) {
          toast.error('Failed to move spot');
          marker.setLatLng([spot.latitude, spot.longitude]);
        } finally {
          setSaving(false);
        }
      });

      markersRef.current[spot.id] = marker;
    });
  }, [spots, editMode, user?.id, fetchSpots]);

  // Update marker draggable state when edit mode changes
  useEffect(() => {
    Object.values(markersRef.current).forEach(marker => {
      if (editMode) {
        marker.dragging.enable();
      } else {
        marker.dragging.disable();
      }
    });
  }, [editMode]);

  // Create new spot
  const handleCreateSpot = async (overrideLandWarning = false) => {
    if (!pendingCoords || !formData.name) {
      toast.error('Please fill in spot name');
      return;
    }

    setSaving(true);
    try {
      const response = await apiClient.post(
        `/admin/spots/create`,
        {
          ...formData,
          latitude: pendingCoords.lat,
          longitude: pendingCoords.lng,
          override_land_warning: overrideLandWarning
        }
      );

      if (response.data.warning === 'land_detected') {
        setLandWarning({
          isCreate: true,
          message: response.data.message
        });
        return;
      }

      toast.success(`Created ${formData.name}`);
      setShowCreateModal(false);
      setPendingCoords(null);
      setLandWarning(null);
      fetchSpots();
    } catch (error) {
      toast.error('Failed to create spot');
    } finally {
      setSaving(false);
    }
  };

  // Update spot
  const handleUpdateSpot = async () => {
    if (!selectedSpot) return;

    setSaving(true);
    try {
      await apiClient.put(
        `/admin/spots/${selectedSpot.id}/update`,
        formData
      );
      toast.success(`Updated ${selectedSpot.name}`);
      setShowEditModal(false);
      fetchSpots();
    } catch (error) {
      toast.error('Failed to update spot');
    } finally {
      setSaving(false);
    }
  };

  // Delete spot
  const handleDeleteSpot = async () => {
    if (!selectedSpot) return;

    setSaving(true);
    try {
      await apiClient.delete(`/admin/spots/${selectedSpot.id}`);
      toast.success(`Deleted ${selectedSpot.name}`);
      setShowDeleteConfirm(false);
      setSelectedSpot(null);
      fetchSpots();
    } catch (error) {
      toast.error('Failed to delete spot');
    } finally {
      setSaving(false);
    }
  };

  // Confirm land warning override
  const handleConfirmLandWarning = async () => {
    if (landWarning?.isCreate) {
      await handleCreateSpot(true);
    } else if (landWarning?.spotId) {
      // Move with override
      try {
        setSaving(true);
        await apiClient.put(
          `/admin/spots/${landWarning.spotId}/move`,
          { ...landWarning.coords, override_land_warning: true }
        );
        toast.success('Spot moved (land warning overridden)');
        fetchSpots();
      } catch (error) {
        toast.error('Failed to move spot');
      } finally {
        setSaving(false);
      }
    }
    setLandWarning(null);
  };

  // Search spots
  const filteredSpots = spots.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.region?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Center map on spot
  const centerOnSpot = (spot) => {
    if (mapInstanceRef.current && spot?.latitude && spot?.longitude &&
        !isNaN(spot.latitude) && !isNaN(spot.longitude)) {
      mapInstanceRef.current.setView([spot.latitude, spot.longitude], 14);
      setSelectedSpot(spot);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Edit Mode Toggle */}
        <Button
          onClick={() => setEditMode(!editMode)}
          className={editMode ? 'bg-red-500 hover:bg-red-600' : 'bg-cyan-500 hover:bg-cyan-600'}
          data-testid="admin-edit-mode-toggle"
        >
          {editMode ? (
            <>
              <X className="w-4 h-4 mr-2" />
              Exit Edit Mode
            </>
          ) : (
            <>
              <Edit2 className="w-4 h-4 mr-2" />
              Precision Edit
            </>
          )}
        </Button>

        {/* Satellite Toggle */}
        <Button
          variant="outline"
          onClick={() => setSatelliteView(!satelliteView)}
          className="border-zinc-600"
        >
          <Eye className="w-4 h-4 mr-2" />
          {satelliteView ? 'Street View' : 'Satellite'}
        </Button>

        {/* Search */}
        <div className="flex-1 max-w-xs">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search spots..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-zinc-800 border-zinc-700"
            />
          </div>
        </div>

        {/* Refresh */}
        <Button variant="outline" onClick={fetchSpots} className="border-zinc-600">
          <RefreshCw className="w-4 h-4" />
        </Button>

        {/* Stats */}
        <Badge className="bg-zinc-700 text-white">
          {spots.length} spots
        </Badge>
      </div>

      {/* Edit Mode Instructions */}
      {editMode && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-red-400 text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Edit Mode Active
          </p>
          <ul className="text-gray-400 text-xs mt-2 space-y-1">
            <li>• <strong>Drag</strong> any pin to relocate it</li>
            <li>• <strong>Double-click</strong> on the map to create a new spot</li>
            <li>• <strong>Click</strong> a pin to select it, then use Edit/Delete buttons</li>
          </ul>
        </div>
      )}

      {/* Map Container */}
      <div className="flex gap-4">
        {/* Map */}
        <div className="flex-1 relative">
          {!leafletReady && (
            <div className="absolute inset-0 bg-zinc-900 rounded-xl flex items-center justify-center z-10">
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mx-auto mb-2" />
                <p className="text-gray-400">Loading map...</p>
              </div>
            </div>
          )}
          <div
            ref={setMapRef}
            className="w-full rounded-xl overflow-hidden border border-zinc-700"
            style={{ height: '500px', minHeight: '500px', backgroundColor: '#1a1a2e' }}
            data-testid="admin-spot-map"
          />
        </div>

        {/* Spot List Sidebar */}
        <div className="w-72 bg-zinc-800 rounded-xl p-4 max-h-[500px] overflow-y-auto">
          <h3 className="text-white font-bold mb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-cyan-400" />
            Spots ({filteredSpots.length})
          </h3>
          <div className="space-y-2">
            {filteredSpots.slice(0, 50).map(spot => (
              <div
                key={spot.id}
                onClick={() => centerOnSpot(spot)}
                className={`p-2 rounded-lg cursor-pointer transition-colors ${
                  selectedSpot?.id === spot.id
                    ? 'bg-cyan-500/20 border border-cyan-500'
                    : 'bg-zinc-700/50 hover:bg-zinc-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${
                    spot.community_verified ? 'bg-emerald-500' :
                    spot.flagged_for_review ? 'bg-orange-500' :
                    spot.is_verified_peak ? 'bg-cyan-500' : 'bg-yellow-500'
                  }`} />
                  <span className="text-white text-sm font-medium truncate">{spot.name}</span>
                </div>
                <p className="text-gray-400 text-xs truncate">{spot.region}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Selected Spot Actions */}
      {selectedSpot && (
        <div className="p-4 bg-zinc-800 rounded-xl flex items-center justify-between">
          <div>
            <h4 className="text-white font-bold">{selectedSpot.name || 'Unknown Spot'}</h4>
            <p className="text-gray-400 text-sm">
              {selectedSpot.region || 'No region'} • ({(selectedSpot.latitude || 0).toFixed(4)}, {(selectedSpot.longitude || 0).toFixed(4)})
            </p>
            <div className="flex items-center gap-2 mt-1">
              {selectedSpot.community_verified && (
                <Badge className="bg-emerald-500 text-white text-xs">Community Verified</Badge>
              )}
              {selectedSpot.flagged_for_review && (
                <Badge className="bg-orange-500 text-white text-xs">Needs Review</Badge>
              )}
              <Badge className="bg-zinc-600 text-xs">
                Votes: {selectedSpot.verification_votes_yes || 0}✓ / {selectedSpot.verification_votes_no || 0}✗
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setFormData({
                  name: selectedSpot.name,
                  region: selectedSpot.region || '',
                  country: selectedSpot.country || 'USA',
                  difficulty: selectedSpot.difficulty || 'Intermediate',
                  wave_type: selectedSpot.wave_type || 'Beach Break',
                  noaa_buoy_id: selectedSpot.noaa_buoy_id || ''
                });
                setShowEditModal(true);
              }}
              className="border-cyan-500 text-cyan-400"
              data-testid="admin-edit-spot-btn"
            >
              <Edit2 className="w-4 h-4 mr-1" />
              Edit
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowDeleteConfirm(true)}
              className="border-red-500 text-red-400"
              data-testid="admin-delete-spot-btn"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Delete
            </Button>
          </div>
        </div>
      )}

      {/* Create Spot Modal - z-[1000] to appear above Leaflet map */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="bg-zinc-900 border-zinc-700 z-[1000]">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Plus className="w-5 h-5 text-cyan-400" />
              Create New Spot
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <p className="text-gray-400 text-sm">
              Coordinates: ({pendingCoords?.lat.toFixed(6)}, {pendingCoords?.lng.toFixed(6)})
            </p>
            
            <Input
              placeholder="Spot Name *"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="bg-zinc-800 border-zinc-700"
            />
            
            <Input
              placeholder="Region (e.g., Central Florida)"
              value={formData.region}
              onChange={(e) => setFormData({ ...formData, region: e.target.value })}
              className="bg-zinc-800 border-zinc-700"
            />
            
            <div className="grid grid-cols-2 gap-4">
              <Select value={formData.difficulty} onValueChange={(v) => setFormData({ ...formData, difficulty: v })}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700">
                  <SelectValue placeholder="Difficulty" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Beginner">Beginner</SelectItem>
                  <SelectItem value="Intermediate">Intermediate</SelectItem>
                  <SelectItem value="Advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
              
              <Select value={formData.wave_type} onValueChange={(v) => setFormData({ ...formData, wave_type: v })}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700">
                  <SelectValue placeholder="Wave Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Beach Break">Beach Break</SelectItem>
                  <SelectItem value="Point Break">Point Break</SelectItem>
                  <SelectItem value="Reef Break">Reef Break</SelectItem>
                  <SelectItem value="River Mouth">River Mouth</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <Select value={formData.noaa_buoy_id || 'none'} onValueChange={(v) => setFormData({ ...formData, noaa_buoy_id: v === 'none' ? '' : v })}>
              <SelectTrigger className="bg-zinc-800 border-zinc-700">
                <SelectValue placeholder="NOAA Buoy (optional)" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <SelectItem value="none">None</SelectItem>
                {Object.entries(NOAA_BUOY_REGIONS).map(([region, buoys]) => (
                  <SelectGroup key={region}>
                    <SelectLabel className="text-cyan-400 font-semibold">{region}</SelectLabel>
                    {buoys.map(buoy => (
                      <SelectItem key={buoy.id} value={buoy.id}>
                        {buoy.name} ({buoy.id})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button
              onClick={() => handleCreateSpot(false)}
              disabled={saving || !formData.name}
              className="bg-cyan-500 hover:bg-cyan-600"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Spot'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Spot Modal - z-[1000] to appear above Leaflet map */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="bg-zinc-900 border-zinc-700 z-[1000]">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Edit2 className="w-5 h-5 text-cyan-400" />
              Edit Spot
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <Input
              placeholder="Spot Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="bg-zinc-800 border-zinc-700"
            />
            
            <Input
              placeholder="Region"
              value={formData.region}
              onChange={(e) => setFormData({ ...formData, region: e.target.value })}
              className="bg-zinc-800 border-zinc-700"
            />
            
            <div className="grid grid-cols-2 gap-4">
              <Select value={formData.difficulty} onValueChange={(v) => setFormData({ ...formData, difficulty: v })}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700">
                  <SelectValue placeholder="Difficulty" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Beginner">Beginner</SelectItem>
                  <SelectItem value="Intermediate">Intermediate</SelectItem>
                  <SelectItem value="Advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
              
              <Select value={formData.wave_type} onValueChange={(v) => setFormData({ ...formData, wave_type: v })}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700">
                  <SelectValue placeholder="Wave Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Beach Break">Beach Break</SelectItem>
                  <SelectItem value="Point Break">Point Break</SelectItem>
                  <SelectItem value="Reef Break">Reef Break</SelectItem>
                  <SelectItem value="River Mouth">River Mouth</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <Select value={formData.noaa_buoy_id || 'none'} onValueChange={(v) => setFormData({ ...formData, noaa_buoy_id: v === 'none' ? '' : v })}>
              <SelectTrigger className="bg-zinc-800 border-zinc-700">
                <SelectValue placeholder="NOAA Buoy" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <SelectItem value="none">None</SelectItem>
                {Object.entries(NOAA_BUOY_REGIONS).map(([region, buoys]) => (
                  <SelectGroup key={region}>
                    <SelectLabel className="text-cyan-400 font-semibold">{region}</SelectLabel>
                    {buoys.map(buoy => (
                      <SelectItem key={buoy.id} value={buoy.id}>
                        {buoy.name} ({buoy.id})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditModal(false)}>Cancel</Button>
            <Button
              onClick={handleUpdateSpot}
              disabled={saving}
              className="bg-cyan-500 hover:bg-cyan-600"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal - z-[1000] to appear above Leaflet map */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="bg-zinc-900 border-zinc-700 z-[1000]">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-400" />
              Delete Spot?
            </DialogTitle>
          </DialogHeader>
          
          <p className="text-gray-400">
            Are you sure you want to delete <strong className="text-white">{selectedSpot?.name}</strong>?
            This action cannot be undone.
          </p>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
            <Button
              onClick={handleDeleteSpot}
              disabled={saving}
              className="bg-red-500 hover:bg-red-600"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Land Warning Modal - z-[1000] to appear above Leaflet map */}
      <Dialog open={!!landWarning} onOpenChange={() => setLandWarning(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-700 z-[1000]">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-400" />
              Pin on Land Detected
            </DialogTitle>
          </DialogHeader>
          
          <p className="text-gray-400">
            {landWarning?.message}
          </p>
          <p className="text-gray-500 text-sm">
            Click "Confirm" to place the pin anyway (for river/inlet spots), or "Cancel" to choose a different location.
          </p>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setLandWarning(null)}>Cancel</Button>
            <Button
              onClick={handleConfirmLandWarning}
              disabled={saving}
              className="bg-orange-500 hover:bg-orange-600"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm Offshore Peak'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminSpotEditor;
