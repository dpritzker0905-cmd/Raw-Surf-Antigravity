import React, { useState, useEffect, useRef, useCallback, useId } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import apiClient from '../../lib/apiClient';
import '../../utils/leafletLoader'; // sets window.L

const EARTH_M = 6371000;
export const metresBetween = (a, b) => {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
};
const distanceText = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`);
const same = (a, b) => !!a && !!b && Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9;
const valid = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

/**
 * AdminCandidatePlacer — the placement helper (owner, 2026-11-18: "a helper tool that helps us place them at least
 * in the nearest known location first, before we confirm them").
 *
 * The pin starts on the nearest ocean shoreline point (worked out offline when the candidates were loaded), or on a
 * position a person already saved. The admin keeps it there or moves it to the break, then saves. Saving writes the
 * position on the CANDIDATE only: no surf spot is created or moved, and nothing on the public map changes.
 *
 * Two ways to move the pin, so the mouse is never required: drag it on the satellite picture, or type the latitude
 * and longitude. Every state is said in words (which position the pin is on, how far it is from the source).
 */
export const AdminCandidatePlacer = ({ candidate, onClose, onSaved }) => {
  const latId = useId();
  const lngId = useId();
  const source = { lat: Number(candidate.latitude), lng: Number(candidate.longitude) };
  const suggestion = candidate.suggested_latitude != null && candidate.suggested_longitude != null
    ? { lat: Number(candidate.suggested_latitude), lng: Number(candidate.suggested_longitude) } : null;
  const saved = candidate.proposed_latitude != null && candidate.proposed_longitude != null
    ? { lat: Number(candidate.proposed_latitude), lng: Number(candidate.proposed_longitude) } : null;
  const start = saved || suggestion || source;

  const [pin, setPin] = useState(start);
  const [latText, setLatText] = useState(String(start.lat));
  const [lngText, setLngText] = useState(String(start.lng));
  const [textIsPin, setTextIsPin] = useState(true);
  const [layer, setLayer] = useState('satellite');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const mapNodeRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);

  // One place moves the pin, wherever the move came from (drag, typing, a button).
  const movePin = useCallback((next, { fromMap = false, fromText = false } = {}) => {
    setPin(next);
    setError(null);
    if (!fromText) {
      setLatText(String(Number(next.lat.toFixed(6))));
      setLngText(String(Number(next.lng.toFixed(6))));
      setTextIsPin(true);
    }
    if (!fromMap && markerRef.current && mapRef.current) {
      markerRef.current.setLatLng([next.lat, next.lng]);
      mapRef.current.panTo([next.lat, next.lng]);
    }
  }, []);

  useEffect(() => {
    const L = typeof window !== 'undefined' ? window.L : null;
    let map = null;
    const timer = setTimeout(() => {
      if (!L || !mapNodeRef.current) return;
      map = L.map(mapNodeRef.current, { center: [start.lat, start.lng], zoom: 16, zoomControl: true });
      map._satellite = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Esri World Imagery', maxZoom: 19 });
      map._street = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        { subdomains: 'abcd', maxZoom: 19 });
      map._satellite.addTo(map);
      // The two reference positions carry a permanent text label: shape and words, not colour alone.
      L.circleMarker([source.lat, source.lng], { radius: 7, color: '#ffffff', weight: 2, fillColor: '#64748b', fillOpacity: 1 })
        .addTo(map).bindTooltip('Source position', { permanent: true, direction: 'top' });
      if (suggestion) {
        L.circleMarker([suggestion.lat, suggestion.lng],
          { radius: 9, color: '#ffffff', weight: 2, dashArray: '4 3', fillColor: '#0891b2', fillOpacity: 0.6 })
          .addTo(map).bindTooltip('Nearest shoreline', { permanent: true, direction: 'bottom' });
      }
      const icon = L.divIcon({
        className: 'candidate-placer-pin',
        html: '<div style="width:22px;height:22px;border-radius:50%;background:#ef4444;border:4px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.6)"></div>',
        iconSize: [22, 22], iconAnchor: [11, 11],
      });
      const marker = L.marker([start.lat, start.lng], { icon, draggable: true, keyboard: false, title: 'Candidate pin' }).addTo(map);
      marker.on('dragend', (e) => {
        const at = e.target.getLatLng();
        movePin({ lat: at.lat, lng: at.lng }, { fromMap: true });
      });
      mapRef.current = map;
      markerRef.current = marker;
    }, 100);
    return () => {
      clearTimeout(timer);
      if (map) map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // The map is built once per candidate; later moves go through movePin.
  }, [candidate.id]);

  const switchLayer = (next) => {
    const map = mapRef.current;
    if (map && next !== layer) {
      map.removeLayer(next === 'satellite' ? map._street : map._satellite);
      (next === 'satellite' ? map._satellite : map._street).addTo(map);
    }
    setLayer(next);
  };

  const typed = (which) => (e) => {
    const text = e.target.value;
    (which === 'lat' ? setLatText : setLngText)(text);
    const next = { lat: which === 'lat' ? Number(text) : pin.lat, lng: which === 'lng' ? Number(text) : pin.lng };
    const ok = text.trim() !== '' && valid(next);
    setTextIsPin(ok);
    if (ok) movePin(next, { fromText: true });
  };

  const onSuggestion = same(pin, suggestion);
  const where = onSuggestion ? 'On the shoreline suggestion'
    : same(pin, source) ? 'On the source position'
      : same(pin, saved) ? 'On the position saved earlier' : 'Moved by hand';

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.put(`/admin/spots/candidates/${candidate.id}/position`, {
        latitude: pin.lat, longitude: pin.lng, method: onSuggestion ? 'shoreline_suggestion' : 'manual',
      });
      onSaved(response.data);
    } catch (err) {
      setError(err?.response?.data?.detail || 'The position could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-card border-border max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <MapPin className="w-5 h-5 text-cyan-400" aria-hidden="true" />
            Place: {candidate.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3" data-testid="candidate-placer">
          <p className="text-sm text-muted-foreground">
            Drag the red pin to where the wave breaks, or type its position below. Saving stores the position on this
            candidate only. It does not create a surf spot.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" className="border-input"
              disabled={!suggestion} onClick={() => movePin(suggestion)}>
              Use shoreline suggestion
            </Button>
            <Button type="button" size="sm" variant="outline" className="border-input" onClick={() => movePin(source)}>
              Back to source position
            </Button>
            <span className="flex gap-1" role="group" aria-label="Map picture">
              <Button type="button" size="sm" variant="outline" className="border-input"
                aria-pressed={layer === 'satellite'} onClick={() => switchLayer('satellite')}>Satellite</Button>
              <Button type="button" size="sm" variant="outline" className="border-input"
                aria-pressed={layer === 'street'} onClick={() => switchLayer('street')}>Street</Button>
            </span>
          </div>
          {!suggestion && (
            <p className="text-xs text-muted-foreground">
              No shoreline suggestion: no ocean shoreline was found within 3 km of the source position.
            </p>
          )}

          <div ref={mapNodeRef} role="application" aria-label={`Map for placing ${candidate.name}`}
            className="w-full h-[45vh] min-h-[240px] rounded-lg border border-border overflow-hidden bg-muted" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor={latId} className="text-sm text-muted-foreground">Latitude</label>
              <Input id={latId} type="number" step="0.0001" inputMode="decimal" value={latText} onChange={typed('lat')}
                className="bg-muted border-border text-foreground" />
            </div>
            <div>
              <label htmlFor={lngId} className="text-sm text-muted-foreground">Longitude</label>
              <Input id={lngId} type="number" step="0.0001" inputMode="decimal" value={lngText} onChange={typed('lng')}
                className="bg-muted border-border text-foreground" />
            </div>
          </div>

          <p className="text-sm text-foreground" aria-live="polite" data-testid="candidate-placer-status">
            {where}. Pin at {pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}: {distanceText(metresBetween(source, pin))} from
            the source position{suggestion ? `, ${distanceText(metresBetween(suggestion, pin))} from the shoreline suggestion` : ''}.
          </p>
          {!textIsPin && (
            <p className="text-xs text-muted-foreground">The typed position is not a valid coordinate yet; the pin has not moved.</p>
          )}
          {error && <p role="alert" className="text-sm text-foreground border border-border rounded-lg p-2 bg-muted">{error}</p>}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" onClick={save} disabled={saving || !valid(pin) || !textIsPin} className="flex-1 bg-cyan-600 hover:bg-cyan-700 text-white">
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
              Save position
            </Button>
            <Button type="button" variant="outline" className="border-input" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AdminCandidatePlacer;
