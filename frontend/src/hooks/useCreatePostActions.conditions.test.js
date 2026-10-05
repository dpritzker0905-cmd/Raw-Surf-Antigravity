import { act, renderHook } from '@testing-library/react';
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import useCreatePostActions from './useCreatePostActions';

jest.mock('../lib/apiClient', () => ({ get: jest.fn() }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
const names = ['WaveHeightFt', 'WavePeriodSec', 'WaveDirection', 'WaveDirectionDegrees',
  'WindSpeedMph', 'WindDirection', 'TideStatus', 'TideHeightFt', 'ConditionsLoading', 'ConditionsSource', 'ShowSessionData'];
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const setup = (day = today()) => {
  const props = { sessionDate: day };
  names.forEach(name => { props[`set${name}`] = jest.fn(); });
  const { result } = renderHook(() => useCreatePostActions(props));
  return { props, result };
};
beforeEach(() => { jest.clearAllMocks(); process.env.REACT_APP_COMPOSER_CONDITIONS = 'true'; });
afterEach(() => { delete process.env.REACT_APP_COMPOSER_CONDITIONS; });

test('actual callback preserves measured zero and consistent direction', async () => {
  apiClient.get.mockResolvedValue({ data: { wave_height_ft: 0, wave_period_sec: 0,
    wave_direction_degrees: 0, wave_direction: 'S', wind_speed_mph: 0, tide_height_ft: 0 } });
  const { props, result } = setup();
  await act(async () => result.current.fetchConditions(0, 0, 'Fixture'));
  ['WaveHeightFt', 'WavePeriodSec', 'WindSpeedMph', 'TideHeightFt'].forEach(n => expect(props[`set${n}`]).toHaveBeenCalledWith('0'));
  expect(props.setWaveDirection).toHaveBeenCalledWith('N');
  expect(props.setWaveDirectionDegrees).toHaveBeenCalledWith(0);
  expect(props.setConditionsSource).toHaveBeenCalledWith('auto_current');
});

test('actual callback clears stale numeric state when response has no measurements', async () => {
  apiClient.get.mockResolvedValue({ data: { wave_height_ft: null, wave_period_sec: 'unknown', wind_speed_mph: Infinity } });
  const { props, result } = setup();
  await act(async () => result.current.fetchConditions(1, 2, 'Fixture'));
  ['WaveHeightFt', 'WavePeriodSec', 'WindSpeedMph', 'TideHeightFt'].forEach(n => expect(props[`set${n}`]).toHaveBeenCalledWith(''));
  expect(props.setWaveDirectionDegrees).toHaveBeenCalledWith(null);
  expect(props.setConditionsSource).toHaveBeenCalledWith('unavailable');
  expect(toast.success).not.toHaveBeenCalled();
});

test('historical session refuses present forecast before network or state replacement', async () => {
  const { props, result } = setup('2000-01-01');
  await act(async () => result.current.fetchConditions(1, 2, 'Fixture'));
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(props.setWaveHeightFt).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
});

test('default off retains the existing historical callback', async () => {
  delete process.env.REACT_APP_COMPOSER_CONDITIONS;
  apiClient.get.mockResolvedValue({ data: {} });
  const { result } = setup('2000-01-01');
  await act(async () => result.current.fetchConditions(1, 2, 'Fixture'));
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});
