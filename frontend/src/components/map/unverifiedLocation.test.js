/**
 * The mark for a spot whose location nobody has verified (owner, 2026-11-18: "Yes, dashed ring"; "Unverified spots
 * we should have an admin toggle to make them visible or not").
 *
 * Pins: an unflagged pin (every pin that exists today) is drawn and named exactly as before; a flagged pin gets the
 * dashed ring, a hollow fill and the WORDS, in both the plain and the rating view; only a strict `true` counts; the
 * kill switch removes all of it; and the admin switch reads, creates and flips one feature flag and never shows a
 * failed read as "Hidden".
 */
import React from 'react';
jest.mock('react-router-dom', () => jest.requireActual('react-router'), { virtual: true });
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('./tideClient', () => ({
  ...jest.requireActual('./tideClient'), getCachedTideState: jest.fn(() => null),
}));
jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));

import apiClient from '../../lib/apiClient';
import MapMarkerLayers from './MapMarkerLayers';
import {
  UNVERIFIED_LOCATION_TEXT, isLocationUnverified, unverifiedPinMarkDisabled, withUnverifiedLocation,
} from './unverifiedLocation';
import { AdminUnverifiedSpotsToggle, UNVERIFIED_SPOTS_FLAG_KEY } from '../admin/AdminUnverifiedSpotsToggle';

const RATING = { score: 55, level: 'fair', color: '#eab308', label: 'Fair', surfHeightM: 1.0, periodS: 12.2 };
const spot = (over = {}) => ({
  id: 's1', latitude: 27.86, longitude: -80.45, name: 'Rocky Point', isCluster: false,
  is_within_geofence: true, active_photographers_count: 0, spot: { id: 's1', name: 'Rocky Point' }, ...over,
});
const props = (over = {}) => ({
  spotClusters: [], livePhotographers: [], effectiveLocation: null, activeDispatch: null,
  friendsOnMap: [], filter: 'all', pulsingMarkers: new Set(), onSpotClick: jest.fn(), onPhotographerClick: jest.fn(),
  mapRef: { current: { flyTo: jest.fn() } }, surfMode: false, spotRatings: null, clusterRatings: null, ...over,
});
const pin = () => screen.getByRole('button', { name: /Rocky Point/ });

beforeEach(() => { jest.clearAllMocks(); delete window.__RAW_DISABLE_UNVERIFIED_PIN_MARK__; });

describe('helpers', () => {
  it('only a strict true from the server counts', () => {
    expect(isLocationUnverified({ location_unverified: true })).toBe(true);
    for (const value of [false, undefined, null, 'true', 1]) {
      expect(isLocationUnverified({ location_unverified: value })).toBe(false);
    }
    expect(isLocationUnverified(null)).toBe(false);
  });

  it('the kill switch needs a strict true and turns the mark off', () => {
    expect(unverifiedPinMarkDisabled({ __RAW_DISABLE_UNVERIFIED_PIN_MARK__: true })).toBe(true);
    expect(unverifiedPinMarkDisabled({ __RAW_DISABLE_UNVERIFIED_PIN_MARK__: 'true' })).toBe(false);
    expect(unverifiedPinMarkDisabled({})).toBe(false);
    expect(isLocationUnverified({ location_unverified: true }, { __RAW_DISABLE_UNVERIFIED_PIN_MARK__: true })).toBe(false);
  });

  it('appends the words to an accessible name', () => {
    expect(withUnverifiedLocation('Rocky Point: Fair, 3.3 ft', true)).toBe('Rocky Point: Fair, 3.3 ft, unverified location');
    expect(withUnverifiedLocation('Rocky Point', false)).toBe('Rocky Point');
  });
});

describe('the pin on the map', () => {
  it('an unflagged pin is named and drawn exactly as before', () => {
    render(<MapMarkerLayers {...props({ spotClusters: [spot()] })} />);
    expect(pin()).toHaveAccessibleName('Rocky Point');
    expect(pin()).not.toHaveAttribute('data-location-unverified');
    expect(screen.queryByTestId('unverified-location-ring')).not.toBeInTheDocument();
    fireEvent.focus(pin());
    expect(screen.queryByTestId('glyph-unverified-location')).not.toBeInTheDocument();
  });

  it('a flagged pin wears a dashed ring, a hollow fill and the words', () => {
    render(<MapMarkerLayers {...props({ spotClusters: [spot({ location_unverified: true })] })} />);
    expect(pin()).toHaveAccessibleName('Rocky Point, unverified location');
    const ring = screen.getByTestId('unverified-location-ring');
    expect(ring).toHaveAttribute('aria-hidden', 'true');           // decoration: the words carry the meaning
    expect(ring.style.border).toContain('dashed');
    expect(pin().querySelector('div').style.background).toBe('rgba(24, 24, 27, 0.35)');   // hollow, not the solid fill
    fireEvent.focus(pin());                                        // the card opens on keyboard focus too
    expect(screen.getByTestId('glyph-unverified-location')).toHaveTextContent(`${UNVERIFIED_LOCATION_TEXT}: the pin may not be on the break`);
  });

  it('in the rating view the ring and the words are added and the rating text is kept', () => {
    render(<MapMarkerLayers {...props({
      spotClusters: [spot({ location_unverified: true })], surfMode: true, spotRatings: { s1: RATING },
    })} />);
    expect(pin()).toHaveAccessibleName('Rocky Point: Fair, 3.3 ft at 12 seconds, unverified location');
    expect(screen.getByTestId('unverified-location-ring').style.border).toContain('dashed');
  });

  it('kill switch: a flagged pin is drawn and named like any other', () => {
    window.__RAW_DISABLE_UNVERIFIED_PIN_MARK__ = true;
    render(<MapMarkerLayers {...props({ spotClusters: [spot({ location_unverified: true })] })} />);
    expect(pin()).toHaveAccessibleName('Rocky Point');
    expect(screen.queryByTestId('unverified-location-ring')).not.toBeInTheDocument();
    expect(pin().querySelector('div').style.background).not.toBe('rgba(24, 24, 27, 0.35)');
  });
});

describe('the admin switch', () => {
  const flags = (rows) => ({ data: { feature_flags: rows } });
  const control = () => screen.getByRole('switch', { name: 'Show unverified-location spots to the public' });

  it('reads Hidden when the flag has never been set, and creates it switched on', async () => {
    apiClient.get.mockResolvedValueOnce(flags([{ id: 'f9', key: 'other', is_enabled: true }]))
      .mockResolvedValue(flags([{ id: 'f1', key: UNVERIFIED_SPOTS_FLAG_KEY, is_enabled: true, kill_switch_enabled: false }]));
    apiClient.post.mockResolvedValue({ data: { id: 'f1' } });
    render(<AdminUnverifiedSpotsToggle />);
    await waitFor(() => expect(control()).toHaveTextContent('Hidden'));
    expect(control()).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(control());
    await waitFor(() => expect(control()).toHaveTextContent('Shown'));
    expect(control()).toHaveAttribute('aria-checked', 'true');
    expect(apiClient.post).toHaveBeenCalledWith('/admin/feature-flags',
      expect.objectContaining({ key: UNVERIFIED_SPOTS_FLAG_KEY, is_enabled: true }));
  });

  it('flips an existing flag off', async () => {
    apiClient.get.mockResolvedValueOnce(flags([{ id: 'f1', key: UNVERIFIED_SPOTS_FLAG_KEY, is_enabled: true }]))
      .mockResolvedValue(flags([{ id: 'f1', key: UNVERIFIED_SPOTS_FLAG_KEY, is_enabled: false }]));
    apiClient.put.mockResolvedValue({ data: {} });
    render(<AdminUnverifiedSpotsToggle />);
    await waitFor(() => expect(control()).toHaveTextContent('Shown'));
    fireEvent.click(control());
    await waitFor(() => expect(control()).toHaveTextContent('Hidden'));
    expect(apiClient.put).toHaveBeenCalledWith('/admin/feature-flags/f1', null, { params: { is_enabled: false } });
  });

  it('says so when the flag is held off by its kill switch', async () => {
    apiClient.get.mockResolvedValue(flags([{ id: 'f1', key: UNVERIFIED_SPOTS_FLAG_KEY, is_enabled: true, kill_switch_enabled: true }]));
    render(<AdminUnverifiedSpotsToggle />);
    await waitFor(() => expect(control()).toHaveTextContent('Hidden'));
    expect(screen.getByText(/kill switch is on in Feature Flags/)).toBeInTheDocument();
  });

  it('a failed read is Unknown and an error, never Hidden', async () => {
    apiClient.get.mockRejectedValue(new Error('401'));
    render(<AdminUnverifiedSpotsToggle />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be read'));
    expect(control()).toHaveTextContent('Unknown');
    expect(control()).toBeDisabled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});
