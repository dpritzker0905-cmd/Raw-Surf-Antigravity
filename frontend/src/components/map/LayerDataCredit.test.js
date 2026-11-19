import React from 'react';
import { render, screen, act } from '@testing-library/react';
import LayerDataCredit, { creditFor, LAYER_CREDITS } from './LayerDataCredit';

afterEach(() => { delete window.__RAW_DISABLE_LAYER_DATA_CREDIT__; });

test('every Open-Meteo raster layer credits Open-Meteo with its licence link', () => {
  for (const layer of ['rain', 'satellite', 'pressure', 'temperature', 'water_temp', 'fog']) {
    const c = creditFor(layer);
    expect(c.href).toBe('https://open-meteo.com/en/licence#maps');
    expect(c.text).toContain('CC BY 4.0');
  }
});

test('radar credits RainViewer; marine and wind layers carry no credit here', () => {
  expect(creditFor('radar').href).toBe('https://www.rainviewer.com/');
  for (const layer of ['waves', 'swell_1', 'swell_2', 'wind_waves', 'wind']) expect(creditFor(layer)).toBeNull();
  expect(Object.keys(LAYER_CREDITS).sort()).toEqual(['currents', 'fog', 'gusts', 'pressure', 'radar', 'rain', 'satellite', 'temperature', 'water_temp']);
});

test('renders a real link with an accessible name, opening safely in a new tab', () => {
  render(<LayerDataCredit layer="rain" />);
  const a = screen.getByRole('link', { name: /Open-Meteo, licence CC BY 4.0/ });
  expect(a.getAttribute('target')).toBe('_blank');
  expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  expect(a.textContent).toBe('© Open-Meteo · CC BY 4.0');
});

test('nothing for an uncredited layer; the kill removes it', () => {
  const { container } = render(<LayerDataCredit layer="waves" />);
  expect(container.firstChild).toBeNull();
  window.__RAW_DISABLE_LAYER_DATA_CREDIT__ = true;
  const r = render(<LayerDataCredit layer="rain" />);
  expect(r.container.firstChild).toBeNull();
});

test('a layer drawn from our own frames credits NOAA GFS, and only while it is', () => {
  const { setEngaged } = require('./ownRasterFrames');
  setEngaged('pressure', true);
  expect(creditFor('pressure').text).toBe('NOAA GFS');
  expect(creditFor('rain').text).toBe('© Open-Meteo · CC BY 4.0');
  const { getByTestId } = render(<LayerDataCredit layer="pressure" />);
  expect(getByTestId('layer-data-credit').textContent).toBe('NOAA GFS');
  act(() => setEngaged('pressure', false));
  expect(getByTestId('layer-data-credit').textContent).toBe('© Open-Meteo · CC BY 4.0');
});


test('credit follows provenance for every default-on own layer: own set -> its agency, .om -> Open-Meteo', () => {
  // The research lead's row-16 check (2026-11-18): satellite (cloud) and pressure draw from OUR frames by default
  // (DEFAULT_ON_LAYERS), so their credit must name the agency of the set on screen, and Open-Meteo only on the .om path.
  const { DEFAULT_ON_LAYERS } = require('./ownRasterFrames');
  expect(DEFAULT_ON_LAYERS).toEqual(expect.arrayContaining(['satellite', 'pressure']));
  const agency = { GFS: /^NOAA GFS/, EURO: /^EURO · © ECMWF · CC BY 4\.0/, ICON: /^ICON · Datenbasis: Deutscher Wetterdienst/ };
  for (const layer of ['satellite', 'pressure']) {
    for (const [model, re] of Object.entries(agency)) {
      const c = creditFor(layer, { [layer]: model }, {});
      expect(c.text).toMatch(re);
      expect(c.href).not.toMatch(/open-meteo/);
    }
    const om = creditFor(layer, {}, {});                    // not engaged = the .om path is what is drawn
    expect(om.text).toBe('© Open-Meteo · CC BY 4.0');
    expect(om.href).toBe('https://open-meteo.com/en/licence#maps');
  }
});

test('per-model pressure: the credit names the model of the frame on screen', () => {
  const { setEngaged } = require('./ownRasterFrames');
  setEngaged('pressure', 'EURO');
  expect(creditFor('pressure').text).toBe('EURO · © ECMWF · CC BY 4.0');
  setEngaged('pressure', 'ICON');
  expect(creditFor('pressure').text).toBe('ICON · Datenbasis: Deutscher Wetterdienst');
  setEngaged('pressure', 'GFS');
  expect(creditFor('pressure').text).toBe('NOAA GFS');
  setEngaged('pressure', false);
  expect(creditFor('pressure').text).toBe('© Open-Meteo · CC BY 4.0');
});

test('our cloud cover says it is the instant at the valid time (Open-Meteo\'s is an hourly mean), only while it is drawn', () => {
  const { setEngaged } = require('./ownRasterFrames');
  setEngaged('satellite', 'GFS');
  const c = creditFor('satellite');
  expect(c.text).toBe('NOAA GFS · instantaneous');
  expect(c.title).toBe('Cloud cover at the valid time, instantaneous (not an hourly mean).');
  expect(c.label).toMatch(/^Cloud cover at the valid time, instantaneous \(not an hourly mean\)\. Data source: NOAA/);
  const { getByTestId } = render(<LayerDataCredit layer="satellite" />);
  const a = getByTestId('layer-data-credit');
  expect(a.textContent).toBe('NOAA GFS · instantaneous');
  expect(a.getAttribute('title')).toBe(c.title);
  expect(a.getAttribute('aria-label')).toBe(c.label);
  setEngaged('pressure', 'GFS');
  expect(creditFor('pressure').text).toBe('NOAA GFS');        // other own layers carry no note
  expect(creditFor('pressure').title).toBeUndefined();
  act(() => { setEngaged('satellite', false); setEngaged('pressure', false); });
  expect(creditFor('satellite').text).toBe('© Open-Meteo · CC BY 4.0');   // the .om path: its own credit, unchanged
  expect(getByTestId('layer-data-credit').getAttribute('title')).toBeNull();
});

test('air temperature drawn terrain-adjusted credits the elevation source, only while it is', () => {
  const { setEngaged } = require('./ownRasterFrames');
  const { setDownscaled, _resetDownscaleForTest } = require('./ownRasterDownscale');
  setEngaged('temperature', 'GFS');
  expect(creditFor('temperature').text).toBe('NOAA GFS');                 // the frames, not yet adjusted
  const { getByTestId } = render(<LayerDataCredit layer="temperature" />);
  act(() => setDownscaled('temperature', true));
  const a = getByTestId('layer-data-credit');
  expect(a.textContent).toBe('NOAA GFS · terrain-adjusted');
  expect(a.getAttribute('title')).toMatch(/NOAA ETOPO 2022 elevation \(public domain\), 6\.5 C per km/);
  expect(a.getAttribute('aria-label')).toMatch(/^Adjusted to the real terrain height .* Data source: NOAA/);
  act(() => { setDownscaled('temperature', false); setEngaged('temperature', false); });
  expect(getByTestId('layer-data-credit').textContent).toBe('© Open-Meteo · CC BY 4.0');
  _resetDownscaleForTest();
});

test('water temp drawn from the Copernicus ocean model (G4) credits Copernicus and says what the field is; skin-temp models do not', () => {
  const c = creditFor('water_temp', { water_temp: 'CMEMS' }, {});
  expect(c.href).toBe('https://doi.org/10.48670/moi-00016');
  expect(c.text).toBe('© Copernicus Marine · ocean model, top 0.5 m');
  expect(c.label).toMatch(/top half metre, hourly mean, 1\/6 degree cells \(not a skin temperature\)\. DWD ICON has no sea temperature/);
  for (const m of ['GFS', 'EURO']) expect(creditFor('water_temp', { water_temp: m }, {}).text).not.toMatch(/ocean model/);
});
