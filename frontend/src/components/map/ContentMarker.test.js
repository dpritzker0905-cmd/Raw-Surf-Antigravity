/**
 * ContentMarker (W-10 R5, 2026-09-30): MapLibre's marker wrapper is role="button" + aria-label "Map marker" around
 * our own labelled <button>s, which axe reports as nested-interactive (serious, every theme). The wrapper must end
 * up presentational AFTER MapLibre's addTo has run, and every map marker must go through ContentMarker.
 */
import fs from 'fs';
import path from 'path';
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { render, screen } from '@testing-library/react';

// A stand-in for react-map-gl's Marker that does what MapLibre 5.x Marker.addTo does in ITS effect: set the
// wrapper's role and label when absent. It renders its children inside that wrapper so the DOM can be inspected.
jest.mock('react-map-gl/maplibre', () => {
  const R = require('react');
  const FakeMarker = R.forwardRef((props, ref) => {
    const el = R.useRef(null);
    R.useImperativeHandle(ref, () => ({ getElement: () => el.current }), []);
    R.useEffect(() => {                                        // = marker.addTo(map)
      if (!el.current.hasAttribute('aria-label')) el.current.setAttribute('aria-label', 'Map marker');
      if (!el.current.hasAttribute('role')) el.current.setAttribute('role', 'button');
    }, []);
    return R.createElement('div', { ref: el, 'data-testid': 'marker-wrapper' }, props.children);
  });
  return { Marker: FakeMarker };
});

// eslint-disable-next-line import/first
import { ContentMarker, makeWrapperPresentational } from './ContentMarker';

test('after MapLibre sets role=button and "Map marker", the wrapper ends up presentational', () => {
  render(
    <ContentMarker longitude={-80.6} latitude={28.4} anchor="bottom">
      <button type="button" aria-label="Cocoa Beach, good, 3 ft">x</button>
    </ContentMarker>,
  );
  const wrapper = screen.getByTestId('marker-wrapper');
  expect(wrapper.getAttribute('role')).toBe('none');
  expect(wrapper.hasAttribute('aria-label')).toBe(false);
  // the content keeps its own semantics: the only button a screen reader meets is the labelled one
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Cocoa Beach, good, 3 ft');
});

test('the ref still reaches the MapLibre marker', () => {
  const ref = React.createRef();
  render(<ContentMarker ref={ref} longitude={0} latitude={0}><span>pin</span></ContentMarker>);
  expect(typeof ref.current.getElement).toBe('function');
});

test('the helper is safe on a missing element', () => {
  expect(() => makeWrapperPresentational(null)).not.toThrow();
  const d = document.createElement('div');
  d.setAttribute('role', 'button');
  d.setAttribute('aria-label', 'Map marker');
  makeWrapperPresentational(d);
  expect(d.getAttribute('role')).toBe('none');
  expect(d.hasAttribute('aria-label')).toBe(false);
});

test('every map marker goes through ContentMarker (no direct react-map-gl Marker import)', () => {
  const dir = __dirname;
  const offenders = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'ContentMarker.js')
    .filter((f) => /import\s*\{[^}]*\bMarker\b[^}]*\}\s*from\s*'react-map-gl\/maplibre'/.test(
      fs.readFileSync(path.join(dir, f), 'utf8')));
  expect(offenders).toEqual([]);
});
