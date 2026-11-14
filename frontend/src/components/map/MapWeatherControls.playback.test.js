import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
// Isolate the resolver's import-time acquisition before the component loads.
// Retain the real tier/window rules without acquiring live capabilities.
const { MapWeatherControls } = (() => {
  const previousFetch = global.fetch;
  global.fetch = () => Promise.reject(new Error('Offline playback test: capabilities not acquired'));
  try { return require('./MapWeatherControls'); }
  finally { global.fetch = previousFetch; }
})();
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
  const { rerender } = render(<MapWeatherControls activeModel="GFS" activeLayers={['waves']} isDesktop={isDesktop} isCompactTimelineOpen
    isPlaying isBuffering onTogglePlay={pause} onTimeChange={() => {}} onModelChange={() => {}} onLayerToggle={() => {}} />);
  const button = screen.getByRole('button', { name: 'Pause' });
  expect(button).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('status')).toHaveTextContent('Loading next forecast frame');
  fireEvent.click(button); expect(pause).toHaveBeenCalledTimes(1);
  rerender(<MapWeatherControls activeModel="GFS" activeLayers={['waves']} isDesktop={isDesktop} isCompactTimelineOpen isPlaying={false}
    onTogglePlay={pause} onTimeChange={() => {}} onModelChange={() => {}} onLayerToggle={() => {}} />);
  expect(screen.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-busy', 'false');
});


test('hiding weather controls preserves the requested desktop disclosure and playback', () => {
  const togglePlay = jest.fn();
  const view = visible => <MapWeatherControls visible={visible} activeModel="GFS" activeLayers={['waves']} isPlaying onTogglePlay={togglePlay} onTimeChange={() => {}} onModelChange={() => {}} onLayerToggle={() => {}} />;
  const { rerender } = render(view(true));
  fireEvent.click(screen.getByRole('button', { name: 'Collapse weather controls' }));
  rerender(view(false));
  expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Expand weather controls' })).not.toBeInTheDocument();
  rerender(view(true));
  expect(screen.getByRole('button', { name: 'Expand weather controls' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  expect(togglePlay).not.toHaveBeenCalled();
});

test.each(['radar', 'classic'])('%s retains mobile legend and collapse options', kind => {
  if (kind === 'classic') window.__RAW_CLASSIC_SCRUBBER__ = true;
  try {
    const collapse = jest.fn();
    const closeDrawer = jest.fn();
    render(<MapWeatherControls onCompactTimelineToggle={closeDrawer} isDesktop={false} isCompactTimelineOpen activeModel="GFS" activeLayers={[kind === 'radar' ? 'radar' : 'waves']} radarMode={kind === 'radar'} radarFrames={[{ time: 1800000000 }]} onRadarFrameChange={() => {}} onTimelineCollapseToggle={collapse} onTogglePlay={() => {}} onTimeChange={() => {}} onModelChange={() => {}} onLayerToggle={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Timeline options' }));
    expect(screen.getAllByRole('button', { name: 'Legend' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Jump to now' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse timeline' }));
    expect(closeDrawer).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Close timeline, left surfboard handle' })).toHaveFocus();
    expect(collapse).toHaveBeenCalledWith(false);
    expect(screen.getByRole('button', { name: 'Timeline options' })).toHaveAttribute('aria-expanded', 'false');
  } finally { delete window.__RAW_CLASSIC_SCRUBBER__; }
});


test('retracting the classic timeline finishes its open gesture without losing its final value', () => {
  window.__RAW_CLASSIC_SCRUBBER__ = true;
  try {
    const commit = jest.fn();
    const view = visible => <MapWeatherControls visible={visible} activeModel="GFS" activeLayers={['waves']} onTogglePlay={() => {}} onTimeChange={commit} onModelChange={() => {}} onLayerToggle={() => {}} />;
    const { rerender } = render(view(true));
    const scrubber = screen.getByRole('slider');
    fireEvent.mouseDown(scrubber);
    expect(window.isScrubbingTimeline).toBe(true);
    fireEvent.change(scrubber, { target: { value: '6' } });
    rerender(view(false));
    expect(window.isScrubbingTimeline).toBe(false);
    expect(commit).toHaveBeenLastCalledWith(6);
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    rerender(view(true));
    expect(screen.getByRole('slider')).toHaveValue('6');
  } finally { delete window.__RAW_CLASSIC_SCRUBBER__; }
});
