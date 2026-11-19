import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import BlindHeightInput, {
  defaultScaleFor, emptyObservation, observationLabel, observationPayload, observationReady,
} from './BlindHeightInput';

// The consent toggle inside fetches its state; here the server never answers, so it renders nothing (its own tests
// are in TrainingConsent.test.js).
jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(() => new Promise(() => {})), put: jest.fn() } }));

function Harness({ defaultScale = 'face', onValue }) {
  const [obs, setObs] = useState(null);
  return (
    <BlindHeightInput idPrefix="t" value={obs} defaultScale={defaultScale}
      onChange={(next) => { setObs(next); onValue?.(next); }} />
  );
}

describe('BlindHeightInput (T1 blind observation)', () => {
  test('asks height, scale and typical-vs-sets with labelled controls, and shows no forecast number', () => {
    render(<Harness />);
    expect(screen.getByRole('region', { name: /how big is it right now/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/wave height/i)).toHaveAttribute('type', 'number');
    expect(screen.getByRole('group', { name: /scale you mean/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /typical wave or the sets/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /face/i })).toBeChecked();
    // Nothing that reads like a forecast: no "forecast" value, no model output, only the instruction text.
    expect(screen.queryByText(/\d+(\.\d+)?\s*ft\b.*forecast/i)).toBeNull();
  });

  test('no number is shown before the answer: the height placeholder is a word, not an anchor', () => {
    render(<Harness />);
    expect(screen.getByLabelText(/wave height/i).getAttribute('placeholder')).not.toMatch(/\d/);
    // nor anywhere in the help text: the only digits on screen are the legacy range labels, shown only on request
    expect(screen.getByRole('region').textContent).not.toMatch(/\d/);
  });

  test('the region default preselects Hawaiian and names the scale in words', () => {
    render(<Harness defaultScale="hawaiian" />);
    expect(screen.getByRole('radio', { name: /hawaiian/i })).toBeChecked();
    expect(screen.getByText(/about half the full face height/i)).toBeInTheDocument();
    expect(screen.getByText(/usual here/i)).toBeInTheDocument();
  });

  test('entering a number, scale and sets produces a sendable observation', () => {
    let last = null;
    render(<Harness onValue={(v) => { last = v; }} />);
    fireEvent.change(screen.getByLabelText(/wave height/i), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('radio', { name: /the sets/i }));
    expect(observationReady(last)).toBe(true);
    expect(observationPayload(last)).toEqual({ height_scale: 'face', set_or_avg: 'sets', height_value: 4,
      height_unit: 'ft' });
    expect(observationLabel(last)).toBe('4ft face, sets');
  });

  test('the legacy ranges remain as a fallback', () => {
    let last = null;
    render(<Harness onValue={(v) => { last = v; }} />);
    fireEvent.click(screen.getByRole('button', { name: /pick a range/i }));
    fireEvent.click(screen.getByRole('radio', { name: '2-3ft' }));
    fireEvent.click(screen.getByRole('radio', { name: /typical wave/i }));
    expect(observationPayload(last)).toEqual({ height_scale: 'face', set_or_avg: 'typical', height_bucket: '2-3ft' });
  });
});

describe('observation helpers', () => {
  test('incomplete or implausible entries are not sent', () => {
    expect(observationReady(emptyObservation())).toBe(false);
    expect(observationReady({ ...emptyObservation(), height_value: '3' })).toBe(false); // no typical/sets
    expect(observationReady({ ...emptyObservation(), height_value: '101', set_or_avg: 'sets' })).toBe(false);
    expect(observationReady({ ...emptyObservation(), height_unit: 'm', height_value: '31', set_or_avg: 'sets' }))
      .toBe(false);
  });

  test('the payload never carries a server-owned field', () => {
    const p = observationPayload({ ...emptyObservation('hawaiian'), height_value: '6', set_or_avg: 'sets' });
    ['source', 'forecast_shown_before', 'face_m', 'surface', 'scale_default'].forEach((k) => expect(p).not.toHaveProperty(k));
  });

  test('client default scale mirrors the server: Hawaiian only in Hawaii', () => {
    expect(defaultScaleFor({ latitude: 21.665, longitude: -158.05 })).toBe('hawaiian');
    expect(defaultScaleFor({ state_province: 'Hawaii' })).toBe('hawaiian');
    expect(defaultScaleFor({ latitude: 29.03, longitude: -80.93, state_province: 'Florida' })).toBe('face');
    expect(defaultScaleFor(null)).toBe('face');
  });
});
