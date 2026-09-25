/**
 * Regression (2026-09-23, owner: "surf spots aren't visible"): react-maplibre's onMove hands over the camera
 * the map is ABOUT to take, and useSpotClusteringData read mapInstance.getBounds() in that same render — i.e.
 * the PREVIOUS camera. After one large jump (z9 Miami -> z2 world) clustering stayed on the old 1° box and
 * 1,773 spots produced 0 clusters until the next pan. The hook must re-read bounds once the map settles.
 */
import { renderHook, act } from '@testing-library/react';
import { useSpotClusteringData } from './useSpotClusteringData';

const MIAMI = { west: -80.7, south: 25.4, east: -79.7, north: 26.2 };
const WORLD_ATLANTIC = { west: -62.3, south: -33.5, east: 66.2, north: 60.9 };

// Spots deliberately OUTSIDE the Miami box, inside the Atlantic/Europe view.
const SPOTS = [
  { id: 'supertubos', name: 'Supertubos', latitude: 39.34, longitude: -9.36 },
  { id: 'anchor', name: 'Anchor Point', latitude: 30.54, longitude: -9.72 },
  { id: 'hossegor', name: 'Hossegor', latitude: 43.66, longitude: -1.44 },
];

function makeMap(initial) {
  let camera = initial;
  const handlers = {};
  return {
    getBounds: () => ({
      getWest: () => camera.west, getSouth: () => camera.south,
      getEast: () => camera.east, getNorth: () => camera.north,
    }),
    on: (ev, fn) => { (handlers[ev] = handlers[ev] || new Set()).add(fn); },
    off: (ev, fn) => { handlers[ev] && handlers[ev].delete(fn); },
    applyCamera: (b) => { camera = b; },
    emit: (ev) => { (handlers[ev] || []).forEach((fn) => fn()); },
    listenerCount: (ev) => (handlers[ev] ? handlers[ev].size : 0),
  };
}

const visibleSpotCount = (clusters) =>
  clusters.reduce((n, c) => n + (c.isCluster ? c.pointCount : 1), 0);

describe('useSpotClusteringData — bounds after a large camera jump', () => {
  it('recovers the settled viewport on moveend instead of keeping the pre-jump box', () => {
    const map = makeMap(MIAMI);
    const { result, rerender } = renderHook((props) => useSpotClusteringData(props), {
      initialProps: {
        surfSpots: SPOTS, filter: 'all', mapInstance: map,
        viewState: { longitude: -80.2, latitude: 25.8, zoom: 9 },
      },
    });
    expect(visibleSpotCount(result.current.spotClusters)).toBe(0); // none in Miami — correct

    // onMove: React gets the NEW camera while the map still reports the OLD one (the race).
    rerender({
      surfSpots: SPOTS, filter: 'all', mapInstance: map,
      viewState: { longitude: 1.9, latitude: 20.4, zoom: 2 },
    });
    // The map then applies the camera and fires moveend — with no further viewState change.
    act(() => { map.applyCamera(WORLD_ATLANTIC); map.emit('moveend'); });

    expect(visibleSpotCount(result.current.spotClusters)).toBe(SPOTS.length);
  });

  it('control: without the settle event the race reproduces (proves the test exercises it)', () => {
    const map = makeMap(MIAMI);
    const { result, rerender } = renderHook((props) => useSpotClusteringData(props), {
      initialProps: {
        surfSpots: SPOTS, filter: 'all', mapInstance: map,
        viewState: { longitude: -80.2, latitude: 25.8, zoom: 9 },
      },
    });
    rerender({
      surfSpots: SPOTS, filter: 'all', mapInstance: map,
      viewState: { longitude: 1.9, latitude: 20.4, zoom: 2 },
    });
    act(() => { map.applyCamera(WORLD_ATLANTIC); });
    expect(visibleSpotCount(result.current.spotClusters)).toBe(0);
  });

  it('detaches its map listeners on unmount', () => {
    const map = makeMap(MIAMI);
    const { unmount } = renderHook(() => useSpotClusteringData({
      surfSpots: SPOTS, filter: 'all', mapInstance: map,
      viewState: { longitude: -80.2, latitude: 25.8, zoom: 9 },
    }));
    expect(map.listenerCount('moveend')).toBe(1);
    unmount();
    expect(map.listenerCount('moveend')).toBe(0);
    expect(map.listenerCount('resize')).toBe(0);
  });
});
