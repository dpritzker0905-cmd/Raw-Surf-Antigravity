import React, { useState } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import SpotSetupPanel from '../components/spot-drawer/SpotSetupPanel';
import SessionSettingsModal from '../components/sessions/SessionSettingsModal';
import { PricingProvider, usePricing } from '../contexts/PricingContext';
import apiClient from '../lib/apiClient';
import useGoLiveFlow from './useGoLiveFlow';
import useSessionActions from './useSessionActions';

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'pro', role: 'Photographer' } }),
}));
jest.mock('../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const originalGeo = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
beforeAll(() => Object.defineProperty(navigator, 'geolocation', {
  configurable: true,
  value: { getCurrentPosition: success => success({ coords: { latitude: 0, longitude: 0 } }) },
}));
afterAll(() => {
  if (originalGeo) Object.defineProperty(navigator, 'geolocation', originalGeo);
  else delete navigator.geolocation;
});
beforeEach(() => jest.clearAllMocks());

it.each([SpotSetupPanel, SessionSettingsModal])('keeps cents and zero when editing the buy-in', Form => {
  function Settings() {
    const [sessionSettings, setSessionSettings] = useState({ price_per_join: 40 });
    return <Form spot={{ name: 'Fixture' }} isOpen expandedSections={{ buyin: true }}
      sessionSettings={sessionSettings} setSessionSettings={setSessionSettings} commissionRate={0} />;
  }
  render(<Settings />);
  const input = screen.getByRole('spinbutton', { name: 'Session buy-in price' });
  for (const value of ['17.50', '0']) {
    fireEvent.change(input, { target: { value } });
    expect(input).toHaveValue(Number(value));
    expect(input.validity.stepMismatch).toBe(false);
  }
});

it.each([[0, 0], [17.5, 17.5], [null, 25]])(
  'loads gallery buy-in %s and sends %s through map go-live', async (price, expected) => {
    apiClient.get.mockImplementation(async path => ({
      data: path.endsWith('/gallery-pricing') ? { session_pricing: { live_buyin_price: price } } : null,
    }));
    apiClient.post.mockResolvedValue({ data: { message: 'Started' } });
    const { result } = renderHook(() => ({
      pricing: usePricing(), goLive: useGoLiveFlow({ userId: 'pro' }),
    }), { wrapper: PricingProvider });
    await waitFor(() => expect(result.current.pricing.generalSettings?.live_buyin_price).toBe(expected));
    await act(() => result.current.goLive.startGoLiveFlow('spot', { price_per_join: price }));
    await act(() => result.current.goLive.handleConditionsConfirm({}));
    expect(apiClient.post).toHaveBeenCalledWith('/photographers/pro/go-live', expect.objectContaining({
      spot_id: 'spot', price_per_join: expected,
    }));
  },
);

it.each([[0, 0], [17.5, 17.5], [null, 40]])(
  'restores the active-session buy-in %s with a saved default of 40', async (price, expected) => {
    apiClient.get.mockImplementation(async path => {
      if (path.endsWith('/pricing')) return { data: { live_buyin_price: 40 } };
      if (path.endsWith('/active-session')) return { data: { price_per_join: price } };
      return { data: {} };
    });
    const done = jest.fn();
    const noop = () => {};
    const { result } = renderHook(() => {
      const [sessionSettings, setSessionSettings] = useState({});
      useSessionActions({
        user: { id: 'pro' }, getCommissionRate: () => 0, sessionSettings, setSessionSettings,
        setLoading: done, setPricing: noop, setGalleries: noop, setSurfSpots: noop,
        setIsLive: noop, setCurrentSession: noop, setIsOnDemandActive: noop, setSessionHistory: noop,
      });
      return sessionSettings;
    });
    await waitFor(() => expect(done).toHaveBeenCalledWith(false));
    expect(result.current.price_per_join).toBe(expected);
  },
);
