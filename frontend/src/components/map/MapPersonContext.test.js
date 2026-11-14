import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MapMarkerLayers from './MapMarkerLayers';
jest.mock('react-router-dom', () => jest.requireActual('react-router'), { virtual: true });

jest.mock('../../contexts/ThemeContext', () => ({ useThemeName: () => 'light' }));
const photographer = { id: 'p1', full_name: 'Kai', latitude: 28, longitude: -80, is_live: true };
const friend = { id: 'f1', full_name: 'River', latitude: 29, longitude: -81 };
function props(enabled, click = jest.fn()) { return { exploreContextEnabled: enabled, spotClusters: [], livePhotographers: [photographer], friendsOnMap: [friend], filter: 'all', mapRef: { current: {} }, onPhotographerClick: click }; }

test('context actions are Explore-only while people remain visible and normal photographer actions work', () => {
  const click = jest.fn();
  const { rerender } = render(<MemoryRouter><MapMarkerLayers {...props(false, click)} /></MemoryRouter>);
  const photo = screen.getByRole('button', { name: 'Kai — shooting live' });
  const buddy = screen.getByRole('button', { name: 'River — friend on map' });
  fireEvent.contextMenu(photo); fireEvent.contextMenu(buddy);
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
  fireEvent.click(photo); expect(click).toHaveBeenCalledWith(photographer);
  rerender(<MemoryRouter><MapMarkerLayers {...props(true, click)} /></MemoryRouter>);
  fireEvent.contextMenu(photo);
  expect(screen.getByRole('region', { name: 'Photographer details' })).toHaveTextContent('Kai');
  fireEvent.click(screen.getByRole('button', { name: 'View session' }));
  expect(click).toHaveBeenCalledTimes(2);
  fireEvent.contextMenu(buddy);
  expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute('href', '/profile/f1');
  expect(screen.getByRole('button', { name: 'Close person details' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Close person details' }), { key: 'Escape' });
  expect(buddy).toHaveFocus();
  fireEvent.keyDown(buddy, { key: 'F10', shiftKey: true });
  expect(screen.getByRole('region', { name: 'Friend details' })).toBeInTheDocument();
  rerender(<MemoryRouter><MapMarkerLayers {...props(false, click)} /></MemoryRouter>);
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
  expect(photo).toBeInTheDocument(); expect(buddy).toBeInTheDocument();
});

test('Explore touch hold is cancelled by changing mode before it opens person details', () => {
  jest.useFakeTimers();
  try {
    const { rerender } = render(<MemoryRouter><MapMarkerLayers {...props(true)} /></MemoryRouter>);
    const buddy = screen.getByRole('button', { name: 'River — friend on map' });
    const hold = () => { const event = new Event('pointerdown', { bubbles: true }); Object.defineProperties(event, { pointerType: { value: 'touch' }, clientX: { value: 10 }, clientY: { value: 10 } }); buddy.dispatchEvent(event); };
    act(hold);
    rerender(<MemoryRouter><MapMarkerLayers {...props(false)} /></MemoryRouter>);
    act(() => jest.advanceTimersByTime(600));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    rerender(<MemoryRouter><MapMarkerLayers {...props(true)} /></MemoryRouter>);
    act(hold); act(() => jest.advanceTimersByTime(500));
    expect(screen.getByRole('region', { name: 'Friend details' })).toBeInTheDocument();
  } finally { jest.useRealTimers(); }
});


test('a person card refreshes from current pins and closes when that pin disappears', () => {
  const { rerender } = render(<MemoryRouter><MapMarkerLayers {...props(true)} /></MemoryRouter>);
  fireEvent.contextMenu(screen.getByRole('button', { name: /River/ }));
  rerender(<MemoryRouter><MapMarkerLayers {...props(true)} friendsOnMap={[{ ...friend, full_name: 'River Updated' }]} /></MemoryRouter>);
  expect(screen.getByRole('region', { name: 'Friend details' })).toHaveTextContent('River Updated');
  rerender(<MemoryRouter><MapMarkerLayers {...props(true)} friendsOnMap={[]} /></MemoryRouter>);
  expect(screen.queryByRole('region', { name: 'Friend details' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Kai/ })).toBeInTheDocument();
});

test('legacy pins leave context gestures alone while ordinary photographer actions remain', () => {
  const click = jest.fn();
  render(<MemoryRouter><MapMarkerLayers {...props(null, click)} /></MemoryRouter>);
  const photo = screen.getByRole('button', { name: /Kai/ });
  expect(fireEvent.contextMenu(photo)).toBe(true);
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
  fireEvent.click(photo); expect(click).toHaveBeenCalledWith(photographer);
  expect(screen.queryByRole('button', { name: /River/ })).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: /River/ })).toBeInTheDocument();
});

test.each([true, false])('a disappearing person restores focus only when the card owned it: %s', cardFocused => {
  const view = present => <MemoryRouter><button className="weather-explorer-toggle">Map mode</button><input aria-label="Spot search" /><MapMarkerLayers {...props(true)} friendsOnMap={present ? [friend] : []} /></MemoryRouter>;
  const { rerender } = render(view(true));
  fireEvent.contextMenu(screen.getByRole('button', { name: /River/ }));
  const search = screen.getByRole('textbox', { name: 'Spot search' });
  if (!cardFocused) search.focus();
  rerender(view(false));
  expect(screen.queryByRole('region', { name: 'Friend details' })).not.toBeInTheDocument();
  expect(cardFocused ? screen.getByRole('button', { name: 'Map mode' }) : search).toHaveFocus();
});

test('a disappearing person does not restore stale card focus after an outside pointer', () => {
  const view = present => <MemoryRouter><button className="weather-explorer-toggle">Map mode</button><MapMarkerLayers {...props(true)} friendsOnMap={present ? [friend] : []} /></MemoryRouter>;
  const { rerender } = render(view(true));
  fireEvent.contextMenu(screen.getByRole('button', { name: /River/ }));
  fireEvent.pointerDown(document.body);
  screen.getByRole('button', { name: 'Close person details' }).blur();
  rerender(view(false));
  expect(screen.getByRole('button', { name: 'Map mode' })).not.toHaveFocus();
});

test('a delayed synthetic click after touch hold does not activate the normal pin action', () => {
  jest.useFakeTimers();
  try {
    const click = jest.fn();
    render(<MemoryRouter><MapMarkerLayers {...props(true, click)} /></MemoryRouter>);
    const pin = screen.getByRole('button', { name: /Kai/ });
    const down = new Event('pointerdown', { bubbles: true });
    Object.defineProperties(down, { pointerType: { value: 'touch' }, clientX: { value: 10 }, clientY: { value: 10 } });
    fireEvent(pin, down);
    act(() => jest.advanceTimersByTime(500));
    fireEvent.pointerUp(pin);
    act(() => jest.advanceTimersByTime(100));
    fireEvent.click(pin, { detail: 1 });
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Photographer details' })).toBeInTheDocument();
  } finally { jest.useRealTimers(); }
});


test.each([true, false])('surf spot click and context selection work with Explore=%s', enabled => {
  const select = jest.fn();
  const flyTo = jest.fn();
  const spot = { id: 'spot1', name: 'Public surf spot' };
  render(<MemoryRouter><MapMarkerLayers {...props(enabled)} onSpotClick={select} mapRef={{ current: { flyTo } }} spotClusters={[{ id: 'spot1', latitude: 28, longitude: -80, name: spot.name, spot }]} /></MemoryRouter>);
  const pin = screen.getByRole('button', { name: 'Public surf spot' });
  fireEvent.click(pin); expect(select).toHaveBeenLastCalledWith(spot);
  expect(fireEvent.contextMenu(pin)).toBe(false);
  expect(select).toHaveBeenCalledTimes(2);
  expect(flyTo).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
});
