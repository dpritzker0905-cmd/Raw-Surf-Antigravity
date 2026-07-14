/**
 * ACCESSIBILITY goldens for MapMarkerLayers (user mandate 2026-07-14, §0a item 1).
 * The rating glyph is the map's core data display: rating must NOT be conveyed by color alone,
 * every marker interaction must be a real <button> (keyboard-operable), and the hover detail
 * card must open on keyboard focus too. These tests pin that contract.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MapMarkerLayers, {
  spotGlyphAriaLabel, clusterBubbleAriaLabel, photographerAriaLabel,
} from './MapMarkerLayers';

// react-map-gl/maplibre resolves to src/testMocks/reactMapGlMaplibre.js (moduleNameMapper in
// craco.config.js) — Marker renders as a passthrough div in jsdom.

const RATING = {
  score: 55, level: 'fair', color: '#eab308', label: 'Fair',
  surfHeightM: 1.0, periodS: 12.2, why: 'Clean 3ft groundswell, light offshore wind', confidence: 'high',
};

function spot(over = {}) {
  return {
    id: 's1', latitude: 27.86, longitude: -80.45, name: 'Sebastian Inlet',
    isCluster: false, is_within_geofence: true, active_photographers_count: 0,
    spot: { id: 's1', name: 'Sebastian Inlet' },
    ...over,
  };
}

function baseProps(over = {}) {
  return {
    spotClusters: [], livePhotographers: [], effectiveLocation: null, activeDispatch: null,
    friendsOnMap: [], filter: 'all', pulsingMarkers: new Set(),
    onSpotClick: jest.fn(), onPhotographerClick: jest.fn(),
    mapRef: { current: { flyTo: jest.fn() } },
    surfMode: false, spotRatings: null, clusterRatings: null,
    ...over,
  };
}

describe('pure aria-label builders', () => {
  it('spot glyph label carries name + rating + height + period (the color-independent equivalent)', () => {
    expect(spotGlyphAriaLabel(spot(), RATING)).toBe('Sebastian Inlet: Fair, 3.3 ft at 12 seconds');
  });

  it('degrades gracefully without height/period and without a rating', () => {
    expect(spotGlyphAriaLabel(spot(), { label: 'Poor' })).toBe('Sebastian Inlet: Poor');
    expect(spotGlyphAriaLabel(spot(), null)).toBe('Sebastian Inlet');
    expect(spotGlyphAriaLabel({}, null)).toBe('Surf spot');
  });

  it('cluster label carries count and best rating when rated', () => {
    expect(clusterBubbleAriaLabel({ pointCount: 12 }, null)).toBe('12 surf spots — zoom in');
    expect(clusterBubbleAriaLabel({ pointCount: 12 }, { label: 'Good' }))
      .toBe('12 surf spots — zoom in; best rating here: Good');
  });

  it('photographer label reflects live/on-demand state', () => {
    expect(photographerAriaLabel({ full_name: 'Kai' })).toBe('Kai — photographer');
    expect(photographerAriaLabel({ full_name: 'Kai', is_live: true })).toBe('Kai — shooting live');
    expect(photographerAriaLabel({ full_name: 'Kai', on_demand_available: true })).toBe('Kai — available on demand');
    expect(photographerAriaLabel({ full_name: 'Kai', is_live: true, on_demand_available: true }))
      .toBe('Kai — shooting live and available on demand');
  });
});

describe('spot glyph button', () => {
  it('renders a real button with the rating text equivalent as its accessible name', () => {
    render(<MapMarkerLayers {...baseProps({
      spotClusters: [spot()], surfMode: true, spotRatings: { s1: RATING },
    })} />);
    expect(screen.getByRole('button', { name: 'Sebastian Inlet: Fair, 3.3 ft at 12 seconds' })).toBeTruthy();
  });

  it('activates the spot on click (keyboard Enter/Space fire click on a native button)', () => {
    const props = baseProps({ spotClusters: [spot()], surfMode: true, spotRatings: { s1: RATING } });
    render(<MapMarkerLayers {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Sebastian Inlet/ }));
    expect(props.onSpotClick).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
    expect(props.mapRef.current.flyTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 14 }));
  });

  it('opens the detail card (rating why-text) on keyboard FOCUS, not just hover, and closes on blur', () => {
    render(<MapMarkerLayers {...baseProps({
      spotClusters: [spot()], surfMode: true, spotRatings: { s1: RATING },
    })} />);
    const btn = screen.getByRole('button', { name: /Sebastian Inlet/ });
    expect(screen.queryByText(/Clean 3ft groundswell/)).toBeNull();
    fireEvent.focus(btn);
    expect(screen.getByText(/Clean 3ft groundswell/)).toBeTruthy();
    fireEvent.blur(btn);
    expect(screen.queryByText(/Clean 3ft groundswell/)).toBeNull();
  });

  it('unrated spot still gets a named button', () => {
    render(<MapMarkerLayers {...baseProps({ spotClusters: [spot()] })} />);
    expect(screen.getByRole('button', { name: 'Sebastian Inlet' })).toBeTruthy();
  });
});

describe('cluster bubble button', () => {
  const cluster = { id: 'c1', latitude: 27, longitude: -80, isCluster: true, pointCount: 7, expansionZoom: 9 };

  it('is a labeled button; click zooms to the expansion zoom', () => {
    const props = baseProps({ spotClusters: [cluster], surfMode: true, clusterRatings: { c1: { label: 'Good', color: '#22c55e' } } });
    render(<MapMarkerLayers {...props} />);
    const btn = screen.getByRole('button', { name: '7 surf spots — zoom in; best rating here: Good' });
    fireEvent.click(btn);
    expect(props.mapRef.current.flyTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 9 }));
  });
});

describe('photographer marker button', () => {
  it('is a labeled button; click opens the photographer', () => {
    const p = { id: 'p1', latitude: 27, longitude: -80, full_name: 'Kai', is_live: true };
    const props = baseProps({ livePhotographers: [p] });
    render(<MapMarkerLayers {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Kai — shooting live' }));
    expect(props.onPhotographerClick).toHaveBeenCalledWith(p);
  });
});
