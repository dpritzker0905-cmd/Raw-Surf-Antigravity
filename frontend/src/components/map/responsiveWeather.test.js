import React, { useRef, useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useMapChromeLayout, showPointTide } from './useMapChromeLayout';
import WeatherLayerSheet from './WeatherLayerSheet';
import { getHeightUnit, setHeightUnit } from './heightUnits';
let mockTheme = 'dark';
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));

const originalResizeObserver = global.ResizeObserver;
const originalFetch = global.fetch;

// beforeEach runs after imports. Isolate the real resolver's startup request too,
// while retaining its real tier/window rules and every component under test.
const importRequests = [];
const { MapWeatherControls } = (() => {
  const original = global.fetch;
  global.fetch = url => {
    importRequests.push(String(url));
    return Promise.reject(new Error('Offline UI test: capabilities not acquired'));
  };
  try { return require('./MapWeatherControls'); }
  finally { global.fetch = original; }
})();
beforeAll(() => {
  expect(importRequests).toEqual([expect.stringMatching(/\/api\/weather\/capabilities$/)]);
});
let resize;
let observer;
let scheduled;
let timelineTop;
function Chrome({ immersive = false, ready = true, children, timelineKey = 'initial' }) {
  const ref = useRef(null);
  useMapChromeLayout(ref);
  if (!ready) return null;
  return <div ref={ref} data-testid="chrome" className={immersive ? 'immersive' : ''}>
    <div className="top-rail-container" />
    <div data-weather-timeline="desktop" key={timelineKey} />
    <div data-weather-timeline="mobile" />
    {children}
  </div>;
}
beforeEach(() => {
  timelineTop = 600;
  global.fetch = jest.fn(() => Promise.reject(new Error('Live backend forbidden in responsive fixture')));
  global.ResizeObserver = jest.fn(callback => {
    resize = callback;
    observer = { observe: jest.fn(), disconnect: jest.fn() };
    return observer;
  });
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { scheduled = callback; return 7; });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.dataset.testid === 'chrome') return { width: 800, height: 800, top: 0, bottom: 800 };
    if (this.classList.contains('top-rail-container')) return { width: 800, height: 100, top: 0, bottom: 100 };
    if (this.dataset.weatherTimeline === 'desktop' && timelineTop != null) return { width: 560, height: 150, top: timelineTop, bottom: timelineTop + 150 };
    return { width: 0, height: 0, top: 0, bottom: 0 };
  });
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(Object.fromEntries(
    ['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillText'].map(k => [k, jest.fn()])));
});
afterEach(() => {
  jest.restoreAllMocks();
  global.ResizeObserver = originalResizeObserver;
  global.fetch = originalFetch;
  delete window.__RAW_DISABLE_RESPONSIVE_WEATHER__;
});
test('chrome measures only visible timelines, responds to resize and disconnects', () => {
  const { unmount } = render(<Chrome><div className="weather-point-card" data-point-details-expanded="true">
    <button>Read tide chart</button>
  </div><div className="weather-layer-sheet"><button>Layer control</button></div></Chrome>);
  const root = screen.getByTestId('chrome');
  const chart = screen.getByRole('button', { name: 'Read tide chart' });
  chart.scrollIntoView = jest.fn();
  chart.focus();
  expect(root.style.getPropertyValue('--weather-top')).toBe('108px');
  expect(root.style.getPropertyValue('--weather-height')).toBe('800px');
  expect(root.style.getPropertyValue('--weather-bottom')).toBe('208px');
  expect(observer.observe).toHaveBeenCalledTimes(4);
  timelineTop = 500;
  act(() => { resize(); resize(); });
  expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
  act(() => scheduled());
  expect(root.style.getPropertyValue('--weather-bottom')).toBe('308px');
  expect(chart.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  expect(chart).toHaveFocus();
  expect(chart.scrollIntoView).toHaveBeenCalledTimes(1);
  act(() => { resize(); });
  act(() => scheduled());
  expect(chart.scrollIntoView).toHaveBeenCalledTimes(1);
  expect(root).toHaveAttribute('data-point-details-compact', 'false');
  const oldFont = document.documentElement.style.fontSize;
  document.documentElement.style.fontSize = '32px';
  timelineTop = 180;
  act(() => { resize(); });
  act(() => scheduled());
  expect(root).toHaveAttribute('data-point-details-compact', 'true');
  document.documentElement.style.fontSize = '16px';
  act(() => { resize(); });
  act(() => scheduled());
  // A normal-text header and its focus ring also exceed this 56px budget.
  expect(root).toHaveAttribute('data-point-details-compact', 'true');
  timelineTop = 260;
  act(() => { resize(); });
  act(() => scheduled());
  expect(root).toHaveAttribute('data-point-details-compact', 'false');
  document.documentElement.style.fontSize = oldFont;
  const layerControl = screen.getByRole('button', { name: 'Layer control' });
  layerControl.scrollIntoView = jest.fn();
  layerControl.focus();
  timelineTop = 550;
  act(() => { resize(); });
  act(() => scheduled());
  expect(layerControl.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  expect(layerControl).toHaveFocus();
  unmount();
  expect(observer.disconnect).toHaveBeenCalledTimes(1);
  expect(global.fetch).not.toHaveBeenCalled();
});
test('late-mounted chrome, immersive mode and rollout kill switch retain geometry behavior', () => {
  const { unmount, rerender } = render(<Chrome ready={false} />);
  expect(global.ResizeObserver).not.toHaveBeenCalled();
  rerender(<Chrome immersive />);
  expect(observer.observe).toHaveBeenCalledTimes(4);
  expect(screen.getByTestId('chrome').style.getPropertyValue('--weather-top')).toBe('108px');
  unmount();
  window.__RAW_DISABLE_RESPONSIVE_WEATHER__ = true;
  render(<Chrome />);
  expect(screen.getByTestId('chrome').style.getPropertyValue('--weather-top')).toBe('');
});
test('tides are limited to the four wave layers', () => {
  ['waves', 'swell_1', 'swell_2', 'wind_waves'].forEach(layer => expect(showPointTide(layer)).toBe(true));
  ['wind', 'pressure', 'rain', 'temperature', 'radar', null, undefined].forEach(layer => expect(showPointTide(layer)).toBe(false));
});
test.each(['light', 'dark', 'beach'].flatMap(theme => [[theme, true], [theme, false]]))('%s desktop=%s retains symmetric steps and a dated readout', (theme, isDesktop) => {
  mockTheme = theme;
  const { container } = render(<MapWeatherControls activeModel="GFS" activeLayers={['waves']} isDesktop={isDesktop} isCompactTimelineOpen
    onTogglePlay={() => {}} onTimeChange={() => {}} onModelChange={() => {}} onLayerToggle={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Time shortcuts' }));
  const steps = container.querySelector('.weather-time-steps');
  expect(steps).not.toBeNull();
  const buttons = within(steps).getAllByRole('button').slice(0, 7);
  expect(buttons.map(button => button.textContent)).toEqual(['−1d', '−3h', '−1h', 'Now', '+1h', '+3h', '+1d']);
  expect(container.querySelector('.weather-time-readout')).toHaveTextContent(/\d{4}/);
  expect(container.querySelector('[data-weather-timeline]')).toHaveAttribute('data-weather-timeline', isDesktop ? 'desktop' : 'mobile');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('collapsed mobile timeline hides controls from accessibility and disables interaction', () => {
  const props = { activeModel: 'GFS', activeLayers: ['waves'], isDesktop: false, isCompactTimelineOpen: true,
    onTimeChange: () => {}, onModelChange: () => {}, onLayerToggle: () => {}, onTimelineCollapseToggle: () => {} };
  const { container, rerender } = render(<MapWeatherControls {...props} isTimelineCollapsed />);
  const body = container.querySelector('.weather-mobile-timeline-body');
  expect(body).toHaveAttribute('aria-hidden', 'true');
  expect(body).toHaveAttribute('inert');
  expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
  rerender(<MapWeatherControls {...props} isTimelineCollapsed={false} />);
  expect(body).not.toHaveAttribute('aria-hidden');
  expect(body).not.toHaveAttribute('inert');
  expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
});

test('document safe-bottom style changes remeasure position-only movement and clean up', () => {
  const originalMutationObserver = global.MutationObserver;
  const originalWidth = window.innerWidth;
  const originalSafe = document.documentElement.style.getPropertyValue('--safe-bottom');
  let mutate;
  const mutation = { observe: jest.fn(), disconnect: jest.fn() };
  global.MutationObserver = jest.fn(callback => { if (!mutate) { mutate = callback; return mutation; } return { observe: jest.fn(), disconnect: jest.fn() }; });
  try {
    const { unmount } = render(<Chrome />);
    const root = screen.getByTestId('chrome');
    expect(mutation.observe).toHaveBeenCalledWith(document.documentElement,
      { attributes: true, attributeFilter: ['style'] });
    expect(root.style.getPropertyValue('--weather-bottom')).toBe('208px');
    timelineTop = 550;
    act(() => { mutate(); mutate(); });
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    act(() => scheduled());
    expect(root.style.getPropertyValue('--weather-bottom')).toBe('258px');
    timelineTop = null; // Expanded layer sheet replaces the mobile timeline.
    window.innerWidth = 360;
    document.documentElement.style.setProperty('--safe-bottom', '148px');
    act(() => { mutate(); });
    act(() => scheduled());
    expect(root.style.getPropertyValue('--weather-bottom')).toBe('156px');
    unmount();
    expect(mutation.disconnect).toHaveBeenCalledTimes(1);
  } finally {
    global.MutationObserver = originalMutationObserver;
    window.innerWidth = originalWidth;
    if (originalSafe) document.documentElement.style.setProperty('--safe-bottom', originalSafe);
    else document.documentElement.style.removeProperty('--safe-bottom');
  }
});

test.each(['light', 'dark', 'beach'])('%s compact timeline preserves selection and legend across disclosure cycles', theme => {
  mockTheme = theme;
  const changeTime = jest.fn();
  function CompactHarness() {
    const [open, setOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(true);
    const [hour, setHour] = useState(48);
    return <MapWeatherControls activeModel="GFS" activeLayers={['waves']} isDesktop={false}
      currentTimeOffset={hour} onTimeChange={next => { changeTime(next); setHour(next); }}
      isCompactTimelineOpen={open} onCompactTimelineToggle={() => setOpen(value => !value)}
      isTimelineCollapsed={collapsed} onTimelineCollapseToggle={setCollapsed}
      onTogglePlay={() => {}} onModelChange={() => {}} onLayerToggle={() => {}} />;
  }
  const { container } = render(<CompactHarness />);
  const header = container.querySelector('.weather-compact-timeline-header');
  const disclosure = within(header).getByRole('button', { name: /^Timeline/ });
  const body = container.querySelector('#weather-mobile-timeline-body');
  const legend = container.querySelector('.weather-mobile-legend');
  const dateBefore = disclosure.textContent;
  expect(dateBefore).toMatch(/\d{4}/);
  expect(disclosure).toHaveAttribute('aria-controls', body.id);
  expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  expect(body).toHaveAttribute('inert');
  fireEvent.click(disclosure);
  expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  expect(disclosure).toHaveTextContent('Close timeline');
  expect(body).not.toHaveAttribute('inert');
  expect(body).not.toHaveAttribute('aria-hidden');
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '48');
  fireEvent.click(screen.getByRole('button', { name: 'Time shortcuts' }));
  expect(within(container.querySelector('.weather-time-steps')).getAllByRole('button').slice(0, 7)).toHaveLength(7);
  expect(changeTime).not.toHaveBeenCalled();
  fireEvent.click(within(container.querySelector('.weather-time-steps')).getByRole('button', { name: 'Legend' }));
  expect(legend).toHaveAttribute('data-legend-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Time shortcuts' }));
  expect(within(container.querySelector('.weather-time-steps')).getByRole('button', { name: 'Hide legend' })).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(disclosure);
  expect(disclosure).toHaveTextContent(dateBefore);
  fireEvent.click(disclosure);
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '48');
  expect(legend).toHaveAttribute('data-legend-expanded', 'true');
  expect(changeTime).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Time shortcuts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Step forward 1 hour' }));
  expect(changeTime).toHaveBeenLastCalledWith(49);
  fireEvent.click(disclosure);
  fireEvent.click(disclosure);
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '49');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('mobile layer sheet focuses its controls, preserves focus on theme updates and returns on dismissal', () => {
  let sheetVisible = true;
  const originalStyle = window.getComputedStyle;
  jest.spyOn(window, 'getComputedStyle').mockImplementation(element => element.classList.contains('test-layer-sheet')
    ? { display: sheetVisible ? 'block' : 'none', visibility: 'visible' } : originalStyle(element));
  function SheetHarness({ theme }) {
    const [open, setOpen] = useState(false);
    return <div data-responsive-weather="true">
      <button data-testid="weather-layers-btn" aria-expanded={open} onClick={() => setOpen(true)}>Weather layers</button>
      <div className="weather-desktop-panel"><button>Desktop weather</button></div>
      <div className="weather-desktop-timeline"><div role="slider" tabIndex={0} aria-label="Desktop time" aria-valuenow={0} /></div>
      {open && <WeatherLayerSheet className={`test-layer-sheet ${theme}`} onClose={() => setOpen(false)}>
        <button onClick={() => setOpen(false)}>Close layers</button><button>Layer option</button>
        <div role="slider" tabIndex={0} aria-label="Mobile time" aria-valuenow={0} />
      </WeatherLayerSheet>}
    </div>;
  }
  const { rerender } = render(<SheetHarness theme="light" />);
  const opener = screen.getByRole('button', { name: 'Weather layers' });
  fireEvent.click(opener);
  expect(screen.getByRole('button', { name: 'Close layers' })).toHaveFocus();
  const option = screen.getByRole('button', { name: 'Layer option' });
  option.focus();
  rerender(<SheetHarness theme="beach" />);
  expect(option).toHaveFocus();
  sheetVisible = false;
  fireEvent.resize(window);
  expect(screen.getByRole('button', { name: 'Desktop weather' })).toHaveFocus();
  screen.getByRole('slider', { name: 'Desktop time' }).focus();
  sheetVisible = true;
  fireEvent.resize(window);
  const mobileTime = screen.getByRole('slider', { name: 'Mobile time' });
  expect(mobileTime).toHaveFocus();
  // Real Chrome blurs a control when its CSS breakpoint hides its ancestor.
  sheetVisible = false;
  mobileTime.blur();
  fireEvent.resize(window);
  expect(screen.getByRole('slider', { name: 'Desktop time' })).toHaveFocus();
  sheetVisible = true;
  screen.getByRole('slider', { name: 'Desktop time' }).blur();
  fireEvent.resize(window);
  expect(mobileTime).toHaveFocus();
  jest.useFakeTimers();
  try { fireEvent.keyDown(mobileTime, { key: 'Escape' }); act(() => jest.advanceTimersByTime(180)); } finally { jest.useRealTimers(); }
  expect(screen.queryByRole('button', { name: 'Layer option' })).toBeNull();
  expect(opener).toHaveFocus();
  fireEvent.click(opener);
  fireEvent.click(screen.getByRole('button', { name: 'Close layers' }));
  expect(opener).toHaveFocus();
});

test('desktop and mobile weather controls share live unit preference and legend labels', () => {
  const originalUnit = getHeightUnit();
  setHeightUnit('ft');
  const props = { activeModel: 'GFS', activeLayers: ['waves'], onModelChange: () => {},
    onLayerToggle: () => {}, onTimeChange: () => {}, onTogglePlay: () => {} };
  const { unmount } = render(<>
    <MapWeatherControls {...props} isDesktop />
    <MapWeatherControls {...props} isDesktop={false} isMobileExpanded />
  </>);
  try {
    const feet = screen.getAllByRole('button', { name: /^Wave height unit: feet/ });
    expect(feet).toHaveLength(2);
    feet.forEach(button => expect(button).toHaveAccessibleName(/feet \(ft\)/));
    fireEvent.click(feet[0]);
    const meters = screen.getAllByRole('button', { name: /^Wave height unit: meters/ });
    expect(meters).toHaveLength(2);
    meters.forEach(button => expect(button).toHaveAccessibleName(/meters \(m\)/));
    expect(screen.getAllByText('Combined Waves (m)')).toHaveLength(2);
    fireEvent.click(meters[1]);
    expect(screen.getAllByRole('button', { name: /^Wave height unit: feet/ })).toHaveLength(2);
    expect(screen.getAllByText('Combined Waves (ft)')).toHaveLength(2);
  } finally {
    unmount();
    setHeightUnit(originalUnit);
  }
});

test('desktop weather disclosure retains replacement focus without stealing it on theme or immersive updates', () => {
  const props = { isDesktop: true, activeModel: 'GFS', activeLayers: ['waves'], onModelChange: () => {}, onLayerToggle: () => {}, onTimeChange: () => {}, onTogglePlay: () => {} };
  const view = immersive => <><button>Outside weather</button><MapWeatherControls {...props} isImmersiveMode={immersive} /></>;
  const { rerender } = render(view(false));
  const outside = screen.getByRole('button', { name: 'Outside weather' });
  expect(screen.getByRole('button', { name: 'Collapse weather controls' })).not.toHaveFocus();
  const collapse = screen.getByRole('button', { name: 'Collapse weather controls' });
  collapse.focus();
  fireEvent.click(collapse);
  expect(screen.getByRole('button', { name: 'Expand weather controls' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Expand weather controls' }));
  expect(screen.getByRole('button', { name: 'Collapse weather controls' })).toHaveFocus();
  outside.focus();
  mockTheme = 'light';
  rerender(view(false));
  expect(outside).toHaveFocus();
  rerender(view(true));
  expect(screen.getByRole('button', { name: 'Expand weather controls' })).toBeInTheDocument();
  expect(outside).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Expand weather controls' }));
  expect(screen.getByRole('button', { name: 'Collapse weather controls' })).toHaveFocus();
  outside.focus();
  rerender(view(false));
  expect(screen.getByRole('button', { name: 'Collapse weather controls' })).toBeInTheDocument();
  expect(outside).toHaveFocus();
  mockTheme = 'beach';
  rerender(view(false));
  fireEvent.click(screen.getByRole('button', { name: 'Collapse weather controls' }));
  expect(screen.getByRole('button', { name: 'Expand weather controls' })).toHaveFocus();
  outside.focus(); rerender(view(true)); rerender(view(false));
  expect(screen.getByRole('button', { name: 'Expand weather controls' })).toHaveTextContent(/Weather.*Waves.*GFS/);
  expect(screen.getByRole('button', { name: 'Expand weather controls' })).toHaveAccessibleDescription('Waves · GFS');
  expect(outside).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Expand weather controls' }));
  expect(screen.getByRole('button', { name: 'Collapse weather controls' })).toHaveFocus();
  window.__RAW_DISABLE_RESPONSIVE_WEATHER__ = true;
  fireEvent.click(screen.getByRole('button', { name: 'Collapse weather controls' }));
  const legacy = screen.getByRole('button', { name: 'Expand weather controls' });
  expect(legacy).toHaveClass('w-12', 'h-12', 'p-0', 'overflow-hidden');
  expect(legacy).not.toHaveTextContent('Weather');
  render(<MapWeatherControls {...props} isDesktop={false} />);
  expect(screen.getAllByRole('button', { name: 'Toggle timeline' })).toHaveLength(2);
  delete window.__RAW_DISABLE_RESPONSIVE_WEATHER__;
});

test('ordinary map rerenders keep observer subscriptions and do not force chrome measurements', () => {
  const originalMutationObserver = global.MutationObserver;
  const mutation = { observe: jest.fn(), disconnect: jest.fn() };
  global.MutationObserver = jest.fn(() => mutation);
  try {
    const view = render(<Chrome><span>Selection zero</span></Chrome>);
    const initialObserver = observer;
    HTMLElement.prototype.getBoundingClientRect.mockClear();
    view.rerender(<Chrome><span>Selection one</span></Chrome>);
    view.rerender(<Chrome><span>Selection two</span></Chrome>);
    expect(global.ResizeObserver).toHaveBeenCalledTimes(1);
    expect(global.MutationObserver).toHaveBeenCalledTimes(2);
    expect(HTMLElement.prototype.getBoundingClientRect).not.toHaveBeenCalled();
    expect(initialObserver.disconnect).not.toHaveBeenCalled();
    act(() => resize()); act(() => scheduled());
    expect(HTMLElement.prototype.getBoundingClientRect).toHaveBeenCalled();
    view.unmount();
    expect(initialObserver.disconnect).toHaveBeenCalledTimes(1);
    expect(mutation.disconnect).toHaveBeenCalledTimes(2);
  } finally { global.MutationObserver = originalMutationObserver; }
});

test('replacing a timeline rebinds observation and measures its new occupied space', () => {
  const view = render(<Chrome />);
  const initialObserver = observer;
  timelineTop = 550;
  view.rerender(<Chrome timelineKey="replacement" />);
  expect(initialObserver.disconnect).toHaveBeenCalledTimes(1);
  expect(global.ResizeObserver).toHaveBeenCalledTimes(2);
  const root = screen.getByTestId('chrome');
  expect(observer.observe).toHaveBeenCalledWith(root.querySelector('[data-weather-timeline="desktop"]'));
  expect(root.style.getPropertyValue('--weather-bottom')).toBe('258px');
  view.unmount(); expect(observer.disconnect).toHaveBeenCalledTimes(1);
});

test.each(['transitionend', 'transitioncancel'])('timeline %s refreshes position-only immersive movement and removes listeners', eventName => {
  const view = render(<Chrome />);
  view.rerender(<Chrome immersive />);
  const root = screen.getByTestId('chrome');
  const timeline = root.querySelector('[data-weather-timeline="desktop"]');
  const removed = jest.spyOn(timeline, 'removeEventListener');
  const subscriptions = global.ResizeObserver.mock.calls.length;
  expect(root.style.getPropertyValue('--weather-bottom')).toBe('208px');
  timelineTop = 656;
  window.requestAnimationFrame.mockClear();
  fireEvent(timeline, new Event(eventName));
  expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
  act(() => scheduled());
  expect(root.style.getPropertyValue('--weather-bottom')).toBe('152px');
  expect(global.ResizeObserver).toHaveBeenCalledTimes(subscriptions);
  view.unmount();
  expect(removed).toHaveBeenCalledWith('transitionend', expect.any(Function));
  expect(removed).toHaveBeenCalledWith('transitioncancel', expect.any(Function));
});


test('drawer docking measures the actual toolbar border and follows safe-area/text resizing', () => {
  const originalRect = HTMLElement.prototype.getBoundingClientRect.getMockImplementation();
  let navTop = 724;
  let shown = true;
  HTMLElement.prototype.getBoundingClientRect.mockImplementation(function () {
    if (this.dataset.testid === 'bottom-nav') return { top: navTop, bottom: 800, width: shown ? 800 : 0, height: shown ? 800 - navTop : 0 };
    if (this.dataset.testid === 'bottomnav-create') return { top: navTop - 20, bottom: 790, width: 56, height: 56 };
    return originalRect.call(this);
  });
  render(<><nav data-testid="bottom-nav"><button data-testid="bottomnav-create">Create</button></nav><Chrome /></>);
  const root = screen.getByTestId('chrome');
  expect(root).toHaveAttribute('data-weather-toolbar-visible', 'true');
  expect(root.style.getPropertyValue('--weather-toolbar-offset')).toBe('76px');
  expect(root.style.getPropertyValue('--weather-toolbar-protrude')).toBe('20px');
  navTop = 700;
  act(() => resize()); act(() => scheduled());
  expect(root.style.getPropertyValue('--weather-toolbar-offset')).toBe('100px');
  shown = false;
  act(() => resize()); act(() => scheduled());
  expect(root).toHaveAttribute('data-weather-toolbar-visible', 'false');
  expect(root.style.getPropertyValue('--weather-toolbar-offset')).toBe('0px');
});

test('a late or replaced toolbar is measured without a map render and after position transitions', async () => {
  const originalRect = HTMLElement.prototype.getBoundingClientRect.getMockImplementation();
  let navTop = 724;
  HTMLElement.prototype.getBoundingClientRect.mockImplementation(function () {
    if (this.dataset.testid === 'bottom-nav') return { top: navTop, bottom: 800, width: 800, height: 800 - navTop };
    return originalRect.call(this);
  });
  const { unmount } = render(<Chrome />);
  const root = screen.getByTestId('chrome');
  expect(root.style.getPropertyValue('--weather-toolbar-offset')).toBe('0px');
  let nav = document.createElement('nav'); nav.dataset.testid = 'bottom-nav';
  try {
    await act(async () => { document.body.appendChild(nav); await Promise.resolve(); });
    act(() => scheduled());
    expect(root.style.getPropertyValue('--weather-toolbar-offset')).toBe('76px');
    navTop = 700;
    fireEvent.transitionEnd(nav); act(() => scheduled());
    expect(root.style.getPropertyValue('--weather-toolbar-offset')).toBe('100px');
    const replacement = nav.cloneNode();
    navTop = 680;
    await act(async () => { nav.replaceWith(replacement); nav = replacement; await Promise.resolve(); });
    act(() => scheduled());
    expect(root.style.getPropertyValue('--weather-toolbar-offset')).toBe('120px');
    expect(observer.observe).toHaveBeenCalledWith(nav);
  } finally { unmount(); nav.remove(); }
});
