import { attachMarineZoomOutListener } from './marineZoomOutListener';
function setup() {
  let z = 9, target = { active: true, model: 'GFS', hour: 0, layers: ['waves'] };
  const listeners = new Map(), prewarm = jest.fn();
  const map = { getZoom: () => z,
    getBounds: () => ({ getWest: () => -84, getSouth: () => 26, getEast: () => -76, getNorth: () => 32 }),
    on: (event, fn) => listeners.set(event, fn), off: (event, fn) => { if (listeners.get(event) === fn) listeners.delete(event); } };
  const detach = attachMarineZoomOutListener(map, () => target, prewarm);
  return { prewarm, detach, map, setZoom: v => { z = v; }, setTarget: v => { target = v; }, emit: e => listeners.get(e)?.() };
}
test('only a zoom-out beyond the gesture threshold fires; repeated events are coalesced', () => {
  const h = setup(); h.emit('zoom'); expect(h.prewarm).not.toHaveBeenCalled();
  h.emit('zoomstart'); h.setZoom(9.5); h.emit('zoom'); h.setZoom(8.61); h.emit('zoom');
  expect(h.prewarm).not.toHaveBeenCalled();
  h.setZoom(8.5); h.emit('zoom'); h.setZoom(8); h.emit('zoom');
  expect(h.prewarm).toHaveBeenCalledTimes(1);
  h.emit('zoomstart'); h.setZoom(7.5); h.emit('zoom'); expect(h.prewarm).toHaveBeenCalledTimes(2);
});
test('the actual current selection and bounds reach the prewarm callback', () => {
  const h = setup(); h.emit('zoomstart'); h.setZoom(8);
  h.setTarget({ active: true, model: 'ICON', hour: 24, layers: ['wind', 'swell_2'] }); h.emit('zoom');
  expect(h.prewarm).toHaveBeenCalledWith('ICON', 24, { west: -84, south: 26, east: -76, north: 32 }, 'swell_2');
});
test('deactivation suppresses warming and removal detaches both listeners', () => {
  const h = setup(); h.emit('zoomstart'); h.setZoom(8); h.setTarget({ active: false }); h.emit('zoom');
  expect(h.prewarm).not.toHaveBeenCalled(); h.detach();
  h.setTarget({ active: true }); h.emit('zoomstart'); h.setZoom(7); h.emit('zoom');
  expect(h.prewarm).not.toHaveBeenCalled();
});
test('a throwing prewarm cannot break the gesture or repeatedly fire', () => {
  const h = setup(); h.prewarm.mockImplementation(() => { throw Error('unavailable'); });
  h.emit('zoomstart'); h.setZoom(8); expect(() => h.emit('zoom')).not.toThrow();
  h.emit('zoom'); expect(h.prewarm).toHaveBeenCalledTimes(1);
});
