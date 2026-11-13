import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import MapExploreRail from './MapExploreRail';
import MapFilterTabs from './MapFilterTabs';
let mockTheme = 'dark';
jest.mock('../../contexts/ThemeContext', () => ({ useThemeName: () => mockTheme }));
afterEach(() => { delete window.__RAW_DISABLE_RESPONSIVE_WEATHER__; });

test.each(['dark', 'light', 'beach'])('%s keeps map identity before the search disclosure and restores focus on Escape', theme => {
  mockTheme = theme;
  function Harness() {
    const [open, setOpen] = useState(false);
    return <MapExploreRail open={open} onToggle={() => setOpen(value => !value)} onClose={() => setOpen(false)} livePhotographerCount={2} status={<button>End my live session</button>} notice={<button>Use precise location</button>}>
      <MapFilterTabs filter="all" onFilterChange={() => {}} surfSpots={Array.from({ length: 8 }, (_, id) => ({ id, name: `Example surf spot ${id}` }))} />
    </MapExploreRail>;
  }
  const { container } = render(<Harness />);
  const title = screen.getByRole('heading', { name: 'LIVE MAP' });
  const button = screen.getByRole('button', { name: 'Map Search & Filters' });
  expect(title.closest('.weather-explore-content')).toBeNull();
  expect(screen.getByRole('button', { name: 'End my live session' }).closest('.weather-explore-content')).toBeNull();
  expect(screen.getByRole('button', { name: 'Use precise location' }).closest('.weather-explore-content')).toBeNull();
  expect(title.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(button).toHaveAttribute('aria-controls', 'map-explore-content');
  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  const status = screen.getByRole('button', { name: 'End my live session' });
  status.focus(); fireEvent.keyDown(status, { key: 'Escape' });
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(status).toHaveFocus();
  const search = screen.getByRole('textbox', { name: 'Search surf spots...' });
  fireEvent.change(search, { target: { value: 'Example' } });
  expect(screen.getByTestId('search-result-7')).toBeInTheDocument();
  search.focus(); fireEvent.keyDown(search, { key: 'Escape' });
  expect(screen.queryByTestId('search-result-7')).not.toBeInTheDocument();
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(search).toHaveFocus();
  search.focus(); fireEvent.keyDown(search, { key: 'Escape' });
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(button).toHaveFocus();
  expect(title).toBeInTheDocument();
  expect(container.querySelector('.weather-map-heading')).toContainElement(title);
});

test('rollout disabled restores legacy rail spacing and immersive fade without hiding its content behind disclosure', () => {
  window.__RAW_DISABLE_RESPONSIVE_WEATHER__ = true;
  const { container } = render(<MapExploreRail open={false} isImmersiveMode onToggle={() => {}} onClose={() => {}}><input aria-label="Legacy spot search" /></MapExploreRail>);
  expect(container.querySelector('.top-rail-container')).toHaveClass('pt-4', 'opacity-0');
  expect(container.querySelector('.top-rail-container')).toHaveAttribute('inert');
  expect(container.querySelector('.weather-map-heading')).toHaveClass('px-4');
  expect(container.querySelector('.weather-explore-content')).not.toHaveAttribute('hidden');
  expect(screen.getByTestId('map-title')).toHaveTextContent('Live Map');
});
