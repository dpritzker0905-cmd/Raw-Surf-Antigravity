/**
 * MapMarkerLayers Extracted from MapWebGL.js for LOC compliance.
 *
 * Renders all interactive map markers:
 *   - Spot clusters (supercluster)
 *   - Photographer markers (live/on-demand)
 *   - User location beacon
 *   - Dispatch tracking (photographer + surfer)
 *   - Friends on map
 */
import React, { useState } from 'react';
import { Marker } from 'react-map-gl/maplibre';

/**
 * @param {{
 *   spotClusters: Array,
 *   livePhotographers: Array,
 *   effectiveLocation: Object,
 *   activeDispatch: Object,
 *   friendsOnMap: Array,
 *   filter: string,
 *   pulsingMarkers: Set,
 *   onSpotClick: Function,
 *   onPhotographerClick: Function,
 *   mapRef: Object,
 * }} props
 */
var MapMarkerLayers = ({
  spotClusters,
  livePhotographers,
  effectiveLocation,
  activeDispatch,
  friendsOnMap,
  filter,
  pulsingMarkers,
  onSpotClick,
  onPhotographerClick,
  mapRef,
  surfMode = false,
  spotRatings = null,
  clusterRatings = null,
}) => {
  const [hoveredSpotId, setHoveredSpotId] = useState(null);
  return (
    <>
      {/* Spot Clusters */}
      {spotClusters.map(cluster => {
        const [lng, lat] = [cluster.longitude, cluster.latitude];
        if (cluster.isCluster) {
          // Rating mode: tint the bubble by the BEST rating among the cluster's spots so toggling Rating is
          // visible even when zoomed out / clustered (falls back to orange when no spot in it is rated).
          const cRating = surfMode && clusterRatings ? clusterRatings[cluster.id] : null;
          return (
            <Marker key={cluster.id} longitude={lng} latitude={lat} anchor="center">
              {/* Rating-mode activation parity (2026-07-11, user: clusters "aren't activating into a
                  glow"): the tint+static shadow WAS applied (live-verified) but individual glyphs
                  announce activation with an animated ping ring — without one the bubbles read as
                  inert. Same GPU-composited ping, honours reduced-motion. */}
              <div className="relative" style={{ width: 40, height: 40 }}>
                {cRating && (
                  <span
                    className="absolute rounded-full animate-ping motion-reduce:animate-none"
                    style={{ inset: 2, backgroundColor: cRating.color, opacity: 0.35 }}
                  />
                )}
                <div
                  className="relative w-10 h-10 rounded-full flex items-center justify-center text-white font-bold border-2 border-white shadow-lg cursor-pointer"
                  style={cRating ? {
                    backgroundColor: cRating.color,
                    boxShadow: `0 0 10px 2px ${cRating.color}, 0 2px 6px rgba(0,0,0,0.45)`,
                  } : { backgroundColor: 'rgba(249,115,22,0.8)' }}
                  title={cRating ? `Best here: ${cRating.label}` : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    mapRef.current.flyTo({
                      center: [lng, lat],
                      zoom: cluster.expansionZoom
                    });
                  }}
                >
                  {cluster.pointCount}
                </div>
              </div>
            </Marker>
          );
        }

        const hasPhotographers = cluster.active_photographers_count > 0;
        const isWithinGeofence = cluster.is_within_geofence;
        // Rating mode: this spot becomes a surf-quality glyph (colour = 7-level rating sampled from the grid).
        const rating = surfMode && spotRatings ? spotRatings[cluster.id] : null;
        return (
          <Marker
            key={`spot-${cluster.id}`}
            longitude={lng}
            latitude={lat}
            anchor="bottom"
            style={{ zIndex: hoveredSpotId === cluster.id ? 99999 : 1 }}
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              e.originalEvent.preventDefault();
              if (onSpotClick) onSpotClick(cluster.spot);
              mapRef.current.flyTo({
                center: [lng, lat],
                zoom: 14,
                pitch: 45,
                duration: 1500
              });
            }}
          >
            <div
              className="relative cursor-pointer"
              style={{ position: 'relative', width: 32, height: 32 }}
              onMouseEnter={() => setHoveredSpotId(cluster.id)}
              onMouseLeave={() => setHoveredSpotId(null)}
            >
              {rating ? (
                <div
                  style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {/* expanding pulse ring — GPU-composited transform/opacity, honours reduced-motion */}
                  <span
                    className="absolute rounded-full animate-ping motion-reduce:animate-none"
                    style={{ width: 30, height: 30, backgroundColor: rating.color, opacity: 0.4 }}
                  />
                  {/* soft static halo for depth (sized to at least match the 32px location pin so Rating mode
                      reads as the headline overlay, not a lesser marker) */}
                  <span
                    className="absolute rounded-full"
                    style={{ width: 38, height: 38, background: `radial-gradient(circle, ${rating.color}59 0%, transparent 70%)` }}
                  />
                  {/* solid core dot in the rating colour — bold ring + colour glow makes it unmistakable */}
                  <span
                    className="relative rounded-full"
                    style={{
                      width: 19, height: 19, backgroundColor: rating.color,
                      border: '2.5px solid rgba(255,255,255,0.92)',
                      boxShadow: `0 0 10px 3px ${rating.color}, 0 1px 3px rgba(0,0,0,0.5)`
                    }}
                  />
                </div>
              ) : (
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shadow-md ${
                    !isWithinGeofence
                      ? 'bg-zinc-800 border-2 border-zinc-600 opacity-60'
                      : hasPhotographers
                        ? 'bg-gradient-to-r from-emerald-400 to-yellow-400'
                        : 'bg-zinc-700 border-2 border-zinc-500'
                  }`}
                  style={{
                    width: 32, height: 32, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: !isWithinGeofence ? '#27272a' : hasPhotographers ? 'linear-gradient(to right, #34d399, #facc15)' : '#3f3f46',
                    border: !isWithinGeofence || !hasPhotographers ? '2px solid #52525b' : 'none',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                  }}
                >
                  <svg width="16" height="16" fill={hasPhotographers && isWithinGeofence ? '#000' : '#d4d4d8'} viewBox="0 0 24 24">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                  </svg>
                </div>
              )}
              {hasPhotographers && isWithinGeofence && (
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-[10px] text-white font-bold animate-pulse motion-reduce:animate-none"
                  style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'white', fontWeight: 'bold' }}
                >
                  {cluster.active_photographers_count}
                </div>
              )}
              {hoveredSpotId === cluster.id && (
                <div
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-zinc-950/95 backdrop-blur-md border border-white/10 text-white text-xs font-semibold rounded-lg shadow-2xl whitespace-nowrap pointer-events-none transition-all duration-200 transform -translate-y-1 z-50 animate-in fade-in zoom-in-95 duration-100"
                  style={{
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.6), 0 8px 10px -6px rgba(0, 0, 0, 0.6)'
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: rating ? rating.color : '#22d3ee' }}></span>
                    <span>{cluster.name || 'Surf Spot'}{rating ? ` · ${rating.label}` : ''}</span>
                  </div>
                  {/* LIVE surf height + period, as structured fields (the endpoint resolved them per-spot). Shown
                      whenever a rating exists so the hover always carries the current surf height, not just prose. */}
                  {rating && rating.surfHeightM != null && (
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] font-semibold text-cyan-300">
                      <span>{(rating.surfHeightM * 3.28084).toFixed(1)} ft</span>
                      {rating.periodS != null && <span className="text-zinc-400 font-normal">· {Math.round(rating.periodS)}s period</span>}
                    </div>
                  )}
                  {/* Rating reasoning (wind, tide) + confidence — the endpoint's explainable `why`. */}
                  {rating && rating.why && (
                    <div className="mt-0.5 text-[10px] font-normal text-zinc-300" style={{ maxWidth: 220, whiteSpace: 'normal' }}>
                      <span>{rating.why}</span>
                      {rating.confidence && (
                        <span className="text-[9px] uppercase tracking-wide text-zinc-500"> · {rating.confidence} conf</span>
                      )}
                    </div>
                  )}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-950/95"></div>
                </div>
              )}
            </div>
          </Marker>
        );
      })}

      {/* Photographer Markers */}
      {(filter === 'all' || filter === 'photographers') && livePhotographers.map(p => {
        if (!p.latitude || !p.longitude) return null;
        const isPulsing = pulsingMarkers?.has(p.id);
        const isShootingLive = p.is_streaming || p.is_live;
        const isOnDemand = p.on_demand_available || p.is_available_on_demand;
        const isBoth = isShootingLive && isOnDemand;

        return (
          <Marker
            key={`photo-${p.id}`}
            longitude={p.longitude}
            latitude={p.latitude}
            anchor="bottom"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              if (onPhotographerClick) onPhotographerClick(p);
            }}
          >
            <div className="relative w-12 h-12 cursor-pointer">
              {isPulsing && (
                <div className="absolute inset-0 w-16 h-16 -top-2 -left-2 rounded-full animate-ping motion-reduce:animate-none motion-reduce:hidden opacity-60 bg-cyan-400"></div>
              )}
              <div className={`relative w-12 h-12 rounded-full p-[3px] shadow-lg ${
                isBoth ? 'bg-purple-500' : isShootingLive ? 'bg-red-500' : isOnDemand ? 'bg-green-500' : 'bg-gradient-to-r from-cyan-400 to-blue-500'
              }`}>
                <div className="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden">
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                    : <span className="text-lg text-white">{p.full_name?.charAt(0) || '?'}</span>
                  }
                </div>
              </div>
            </div>
          </Marker>
        );
      })}

      {/* User Location Marker */}
      {effectiveLocation && effectiveLocation.lat && effectiveLocation.lng && (
        <Marker longitude={effectiveLocation.lng} latitude={effectiveLocation.lat} anchor="center">
          <div className="relative">
            <div className="absolute inset-0 w-6 h-6 rounded-full bg-blue-500 animate-ping motion-reduce:animate-none motion-reduce:opacity-10 opacity-30"></div>
            <div className="w-6 h-6 rounded-full bg-blue-500 border-2 border-white flex items-center justify-center shadow-lg">
              <div className="w-2 h-2 bg-white rounded-full"></div>
            </div>
          </div>
        </Marker>
      )}

      {/* Dispatch Tracking (Photographer) */}
      {activeDispatch?.photographer_location?.lat && activeDispatch?.photographer_location?.lng && (
        <Marker longitude={activeDispatch.photographer_location.lng} latitude={activeDispatch.photographer_location.lat} anchor="bottom">
          <div className="relative animate-bounce motion-reduce:animate-none">
            <div className="w-12 h-12 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4z"/>
                <circle cx="10" cy="11" r="3"/>
              </svg>
            </div>
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-cyan-500 rounded-full text-xs text-white font-bold whitespace-nowrap shadow-sm">
              {activeDispatch.estimated_arrival_minutes || '?'} min
            </div>
          </div>
        </Marker>
      )}

      {/* Dispatch Tracking (Surfer / Requester) */}
      {activeDispatch?.requester_location?.lat && activeDispatch?.requester_location?.lng && (
        <Marker longitude={activeDispatch.requester_location.lng} latitude={activeDispatch.requester_location.lat} anchor="bottom">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-gradient-to-r from-yellow-400 to-orange-500 flex items-center justify-center shadow-lg ring-4 ring-yellow-400/30">
              <span className="text-xl">{'\u{1F30A}'}</span>
            </div>
            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-yellow-500 rounded-full text-[10px] text-black font-bold shadow-sm">
              YOU
            </div>
          </div>
        </Marker>
      )}

      {/* Friends on Map */}
      {friendsOnMap && friendsOnMap.length > 0 && friendsOnMap.map(friend => (
        <Marker key={`friend-${friend.id}`} longitude={friend.longitude} latitude={friend.latitude} anchor="bottom">
          <div className="relative cursor-pointer hover:scale-110 transition-transform motion-reduce:transition-none">
            <div className="w-10 h-10 rounded-full p-[2px] bg-gradient-to-r from-pink-500 to-rose-400 shadow-lg">
              <div className="w-full h-full rounded-full bg-black overflow-hidden border border-zinc-800">
                {friend.avatar_url ? (
                  <img src={friend.avatar_url} alt="friend" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white bg-zinc-800">
                    {friend.full_name?.charAt(0) || '?'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </Marker>
      ))}
    </>
  );
};

// memo (2026-07-07, chip task_c5366c79 slice 2): MapWebGL re-renders on every radar frame step
// (~1.5s during animation) and this DOM-marker-heavy subtree re-rendered each time with
// unchanged props. Shallow-compare skips it; when any prop identity changes (clusters,
// photographers, filters, callbacks) it renders exactly as before — memo with occasionally-
// unstable props degrades to the old behavior, never past it.
export default React.memo(MapMarkerLayers);
