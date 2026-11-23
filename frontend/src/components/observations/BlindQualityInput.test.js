import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import apiClient from '../../lib/apiClient';
import BlindQualityInput from './BlindQualityInput';
import BlindHeightInput from './BlindHeightInput';
import { _resetBlindQualityForTests } from './blindQuality';
import { _resetForecastExposureForTests, forecastShownThisSession, noteForecastShown } from './forecastExposure';
import postObservation from './postObservation';

jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { warn: jest.fn() } }));

// The server's labels, in surf_rating.LEVELS order (services/blind_quality.LEVEL_WORDS).
const LEVELS = [
  { value: 'very_poor', label: 'Very poor' }, { value: 'poor', label: 'Poor' },
  { value: 'poor_fair', label: 'Poor to fair' }, { value: 'fair', label: 'Fair' },
  { value: 'fair_good', label: 'Fair to good' }, { value: 'good', label: 'Good' }, { value: 'epic', label: 'Epic' },
];
const ON = { blind_quality: true, quality_version: 'blind_q1', quality_levels: LEVELS };
const OFF = { blind_quality: false, quality_version: null, quality_levels: [] };

const CONSENT = (granted) => ({ granted, final: true, title: 'Use my wave reports to improve forecasts',
  text: 'Off unless you turn it on.', privacy_url: null, needs_reconsent: false });

function serve(features, { granted = true } = {}) {
  apiClient.get.mockImplementation((url) => {
    if (url === '/surf-observations/features') return Promise.resolve({ data: features });
    if (url === '/surf-observations/consent') return Promise.resolve({ data: CONSENT(granted) });
    return new Promise(() => {});
  });
  apiClient.put.mockImplementation((url, body) => Promise.resolve({ data: CONSENT(body.granted) }));
}

function Harness({ askQuality = true, onValue }) {
  const [obs, setObs] = useState(null);
  return (
    <BlindHeightInput idPrefix="t" value={obs} askQuality={askQuality}
      onChange={(next) => { setObs(next); onValue?.(next); }} />
  );
}

beforeEach(() => {
  apiClient.get.mockReset();
  apiClient.post.mockReset();
  apiClient.put.mockReset();
  _resetBlindQualityForTests();
  _resetForecastExposureForTests();
  delete window.__RAW_DISABLE_BLIND_QUALITY__;
});

describe('BlindQualityInput (blind surf quality, gate surf-tide-v1 section 0)', () => {
  test('is one labelled radio group of the seven levels in words, with no number, tide or forecast', () => {
    render(<BlindQualityInput idPrefix="t" levels={LEVELS} value="" onChange={() => {}} />);
    const group = screen.getByRole('group', { name: /how good is it right now/i });
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(7);
    LEVELS.forEach((l) => expect(screen.getByRole('radio', { name: l.label })).toBeInTheDocument());
    expect(new Set(radios.map((r) => r.getAttribute('name')))).toEqual(new Set(['t-quality']));   // ONE group
    expect(group.textContent).not.toMatch(/\d/);
    expect(group.textContent).not.toMatch(/tide|forecast rating|best/i);
  });

  test('a choice is marked by a check mark and bold text, not colour alone, and can be cleared', () => {
    const onChange = jest.fn();
    const { rerender } = render(<BlindQualityInput idPrefix="t" levels={LEVELS} value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Fair to good' }));
    expect(onChange).toHaveBeenCalledWith('fair_good');
    rerender(<BlindQualityInput idPrefix="t" levels={LEVELS} value="fair_good" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'Fair to good' })).toBeChecked();
    expect(screen.getByText('✓')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /clear my answer/i }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});

describe('when the quality question is asked', () => {
  test('on a blind screen with the flag on, consent on and nothing shown this session', async () => {
    serve(ON);
    const onValue = jest.fn();
    render(<Harness onValue={onValue} />);
    const fair = await screen.findByRole('radio', { name: 'Fair' });
    fireEvent.click(fair);
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ quality_level: 'fair' }));
  });

  test('never with the flag off (its kill switch)', async () => {
    serve(OFF);
    render(<Harness />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/surf-observations/features'));
    expect(screen.queryByTestId('blind-quality-input')).toBeNull();
  });

  test('never on a screen that did not ask (the spot page report form shows a forecast)', async () => {
    serve(ON);
    render(<Harness askQuality={false} />);
    await act(async () => {});
    expect(apiClient.get).not.toHaveBeenCalledWith('/surf-observations/features');
    expect(screen.queryByTestId('blind-quality-input')).toBeNull();
  });

  test('never without forecast-data consent; turning it on shows the question, turning it off clears the answer',
    async () => {
      serve(ON, { granted: false });
      const onValue = jest.fn();
      render(<Harness onValue={onValue} />);
      const toggle = await screen.findByRole('checkbox', { name: /improve forecasts/i });
      await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/surf-observations/features'));
      expect(screen.queryByTestId('blind-quality-input')).toBeNull();
      fireEvent.click(toggle);
      fireEvent.click(await screen.findByRole('radio', { name: 'Good' }));
      expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ quality_level: 'good' }));
      fireEvent.click(screen.getByRole('checkbox', { name: /improve forecasts/i }));
      await waitFor(() => expect(screen.queryByTestId('blind-quality-input')).toBeNull());
      expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ quality_level: '' }));
    });

  test('the question sits below the consent toggle', async () => {
    serve(ON);
    render(<Harness />);
    const question = await screen.findByTestId('blind-quality-input');
    const consent = screen.getByTestId('training-consent');
    expect(consent.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('never after any forecast surface was shown this session', async () => {
    serve(ON);
    noteForecastShown('map');
    render(<Harness />);
    await act(async () => {});
    expect(screen.queryByTestId('blind-quality-input')).toBeNull();
  });

  test('the client kill switch hides it at once (null control: same setup, no switch, it shows)', async () => {
    serve(ON);
    window.__RAW_DISABLE_BLIND_QUALITY__ = true;
    const { unmount } = render(<Harness />);
    await act(async () => {});
    expect(screen.queryByTestId('blind-quality-input')).toBeNull();
    unmount();
    delete window.__RAW_DISABLE_BLIND_QUALITY__;
    render(<Harness />);
    expect(await screen.findByTestId('blind-quality-input')).toBeInTheDocument();
  });
});

describe('postObservation sends the quality only with the app\'s word that nothing was shown', () => {
  const obs = { mode: 'value', height_value: '4', height_unit: 'ft', height_bucket: '', height_scale: 'face',
    set_or_avg: 'typical', quality_level: 'good' };

  test('blind screen, nothing shown: quality_level and forecast_seen_for_spot=false', async () => {
    apiClient.post.mockResolvedValue({ data: { id: 'o1', quality_recorded: true } });
    await postObservation({ obs, entryScreen: 'checkin_modal', spotId: 's1' });
    const body = apiClient.post.mock.calls[0][1];
    expect(body.quality_level).toBe('good');
    expect(body.forecast_seen_for_spot).toBe(false);
  });

  test('a forecast shown after the question appeared: the answer is not sent, and the app says so', async () => {
    apiClient.post.mockResolvedValue({ data: { id: 'o1' } });
    noteForecastShown('spot_hub');
    expect(forecastShownThisSession()).toBe(true);
    await postObservation({ obs, entryScreen: 'golive_conditions_modal', refId: 'r1' });
    const body = apiClient.post.mock.calls[0][1];
    expect(body.quality_level).toBeUndefined();
    expect(body.forecast_seen_for_spot).toBe(true);
  });

  test('the spot page form never sends a quality, and the kill switch stops it too', async () => {
    apiClient.post.mockResolvedValue({ data: { id: 'o1' } });
    await postObservation({ obs, entryScreen: 'spot_report_modal', refId: 'r1' });
    window.__RAW_DISABLE_BLIND_QUALITY__ = true;
    await postObservation({ obs, entryScreen: 'checkin_modal', spotId: 's1' });
    apiClient.post.mock.calls.forEach(([, body]) => {
      expect(body.quality_level).toBeUndefined();
      expect(body.forecast_seen_for_spot).toBeUndefined();
    });
  });
});
