/**
 * The placement helper (owner, 2026-11-18: "a helper tool that helps us place them at least in the nearest known
 * location first, before we confirm them").
 *
 * These run with no map library (jsdom has none), which is the keyboard path: the pin is moved by the buttons and
 * the typed coordinates. They pin where the pin starts, what a save sends, that the server's refusal is shown, and
 * that the candidates list opens the helper and re-reads after a save.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), put: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('../../utils/leafletLoader', () => ({}));

import apiClient from '../../lib/apiClient';
import { AdminCandidatePlacer, metresBetween } from './AdminCandidatePlacer';
import { AdminSpotCandidates } from './AdminSpotCandidates';

const CANDIDATE = { id: 'c1', name: 'Reef One', country: 'ID', latitude: 10.0, longitude: 20.0, tier: 'F', status: 'pending',
  suggested_latitude: 10.003, suggested_longitude: 20.002, suggested_method: 'nearest_shoreline',
  proposed_latitude: null, proposed_longitude: null, proposed_method: null, shoreline_km: 0.4 };
const status = () => screen.getByTestId('candidate-placer-status');
const open = (candidate = CANDIDATE) => {
  const onSaved = jest.fn();
  const onClose = jest.fn();
  render(<AdminCandidatePlacer candidate={candidate} onSaved={onSaved} onClose={onClose} />);
  return { onSaved, onClose };
};

beforeEach(() => jest.clearAllMocks());

describe('metresBetween', () => {
  it('measures a hundredth of a degree of latitude as about 1.1 km', () => {
    expect(metresBetween({ lat: 10, lng: 20 }, { lat: 10.01, lng: 20 })).toBeCloseTo(1111.9, 0);
    expect(metresBetween({ lat: 10, lng: 20 }, { lat: 10, lng: 20 })).toBe(0);
  });
});

describe('AdminCandidatePlacer', () => {
  it('starts the pin on the shoreline suggestion and says so in words', () => {
    open();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(status()).toHaveTextContent('On the shoreline suggestion. Pin at 10.003000, 20.002000');
    // 0.003 degrees north (334 m) and 0.002 degrees east at latitude 10 (219 m): 399 m
    expect(status()).toHaveTextContent('399 m from the source position, 0 m from the shoreline suggestion');
    expect(status()).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByLabelText('Latitude')).toHaveValue(10.003);
    expect(screen.getByLabelText('Longitude')).toHaveValue(20.002);
    expect(screen.getByRole('application', { name: 'Map for placing Reef One' })).toBeInTheDocument();
    expect(screen.getByText(/It does not create a surf spot/)).toBeInTheDocument();
  });

  it('taking the suggestion saves it as the shoreline suggestion', async () => {
    apiClient.put.mockResolvedValue({ data: { ...CANDIDATE, proposed_latitude: 10.003, proposed_longitude: 20.002 } });
    const { onSaved } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Save position' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(apiClient.put).toHaveBeenCalledWith('/admin/spots/candidates/c1/position',
      { latitude: 10.003, longitude: 20.002, method: 'shoreline_suggestion' });
  });

  it('a typed position moves the pin and saves as placed by hand', async () => {
    apiClient.put.mockResolvedValue({ data: CANDIDATE });
    open();
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '10.0041' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '20.0035' } });
    expect(status()).toHaveTextContent('Moved by hand. Pin at 10.004100, 20.003500');
    fireEvent.click(screen.getByRole('button', { name: 'Save position' }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/admin/spots/candidates/c1/position',
      { latitude: 10.0041, longitude: 20.0035, method: 'manual' }));
  });

  it('the buttons move the pin between the source and the suggestion', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Back to source position' }));
    expect(status()).toHaveTextContent('On the source position. Pin at 10.000000, 20.000000: 0 m from the source position');
    expect(screen.getByLabelText('Latitude')).toHaveValue(10);
    fireEvent.click(screen.getByRole('button', { name: 'Use shoreline suggestion' }));
    expect(status()).toHaveTextContent('On the shoreline suggestion');
  });

  it('a position that is not a coordinate does not move the pin and cannot be saved', () => {
    open();
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '120' } });
    expect(screen.getByText(/not a valid coordinate yet; the pin has not moved/)).toBeInTheDocument();
    expect(status()).toHaveTextContent('Pin at 10.003000, 20.002000');
    expect(screen.getByRole('button', { name: 'Save position' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '10.002' } });
    expect(screen.getByRole('button', { name: 'Save position' })).toBeEnabled();
  });

  it('with no suggestion it starts on the source position and says why', () => {
    open({ ...CANDIDATE, suggested_latitude: null, suggested_longitude: null, suggested_method: null });
    expect(screen.getByRole('button', { name: 'Use shoreline suggestion' })).toBeDisabled();
    expect(screen.getByText(/no ocean shoreline was found within 3 km/)).toBeInTheDocument();
    expect(status()).toHaveTextContent('On the source position');
    expect(status()).not.toHaveTextContent('shoreline suggestion');
  });

  it('reopens on a position a person saved earlier', () => {
    open({ ...CANDIDATE, proposed_latitude: 10.0061, proposed_longitude: 20.0007, proposed_method: 'manual' });
    expect(status()).toHaveTextContent('On the position saved earlier. Pin at 10.006100, 20.000700');
  });

  it("shows the server's refusal and stays open", async () => {
    apiClient.put.mockRejectedValue({ response: { data: { detail: 'That is 67 km from the source\'s position (limit 50 km).' } } });
    const { onSaved } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Save position' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('67 km from the source'));
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Cancel closes without saving', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(apiClient.put).not.toHaveBeenCalled();
  });
});

describe('AdminSpotCandidates with the placement helper', () => {
  const page = (rows) => ({ data: { candidates: rows, total: rows.length, page: 1, limit: 50,
    counts: { all: rows.length, by_status: { pending: rows.length }, by_tier: { F: rows.length } } } });

  it('opens the helper from a row, and re-reads the list after a save', async () => {
    const placed = { ...CANDIDATE, proposed_latitude: 10.003, proposed_longitude: 20.002, proposed_method: 'shoreline_suggestion' };
    apiClient.get.mockResolvedValueOnce(page([CANDIDATE, { ...CANDIDATE, id: 'c2', name: 'Closed One', status: 'rejected' }]))
      .mockResolvedValue(page([placed]));
    apiClient.put.mockResolvedValue({ data: placed });
    render(<AdminSpotCandidates />);
    await waitFor(() => expect(screen.getByText('Reef One')).toBeInTheDocument());
    expect(screen.getAllByText('Not placed: shoreline suggestion ready')).toHaveLength(2);
    // a decided candidate has no Place button
    expect(screen.queryByRole('button', { name: 'Place Closed One on the map' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Place Reef One on the map' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save position' }));
    await waitFor(() => expect(screen.getByText('Placed: shoreline suggestion taken')).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });
});
