import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MapWeatherControls } from './MapWeatherControls';
let mockTheme = 'dark';
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
beforeEach(() => {
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(Object.fromEntries(
    ['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillText'].map(k => [k, jest.fn()])));
});
afterEach(() => jest.restoreAllMocks());
test.each(['light', 'dark', 'beach'].flatMap(theme => [[theme, true], [theme, false]]))('%s desktop=%s buffering remains visible and pausable', (theme, isDesktop) => {
  mockTheme = theme;
  const pause = jest.fn();
  const { rerender } = render(<MapWeatherControls activeModel="GFS" activeLayers={['waves']} isDesktop={isDesktop}
    isPlaying isBuffering onTogglePlay={pause} onTimeChange={() => {}} onModelChange={() => {}} onLayerToggle={() => {}} />);
  const button = screen.getByRole('button', { name: 'Pause' });
  expect(button).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('status')).toHaveTextContent('Loading next forecast frame');
  fireEvent.click(button); expect(pause).toHaveBeenCalledTimes(1);
  rerender(<MapWeatherControls activeModel="GFS" activeLayers={['waves']} isDesktop={isDesktop} isPlaying={false}
    onTogglePlay={pause} onTimeChange={() => {}} onModelChange={() => {}} onLayerToggle={() => {}} />);
  expect(screen.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-busy', 'false');
});
