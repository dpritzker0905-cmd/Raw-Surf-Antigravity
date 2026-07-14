/**
 * Jest stub for `react-map-gl/maplibre` (wired via moduleNameMapper in craco.config.js).
 * v8 exposes that path through package `exports`, which CRA's jest resolver cannot walk, so map
 * components could never render in jsdom tests. Minimal passthroughs: children render, nothing
 * touches WebGL/maplibre. Extend with more named exports as component tests need them.
 */
const React = require('react');

function Marker(props) {
  return React.createElement('div', { 'data-testid': 'marker' }, props.children);
}

function MapStub(props) {
  return React.createElement('div', { 'data-testid': 'map' }, props.children);
}

function Source(props) {
  return React.createElement('div', null, props.children);
}

function Layer() {
  return null;
}

function Popup(props) {
  return React.createElement('div', { 'data-testid': 'popup' }, props.children);
}

module.exports = {
  __esModule: true,
  default: MapStub,
  Map: MapStub,
  Marker,
  Source,
  Layer,
  Popup,
};
