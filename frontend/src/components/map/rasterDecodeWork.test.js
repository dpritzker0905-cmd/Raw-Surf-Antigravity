import { RasterDecodeWork } from './rasterDecodeWork';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tile = () => ({ data: new Uint8Array([0, 11, 22]).buffer });
beforeEach(() => { process.env.REACT_APP_RASTER_WORK_BOUNDS = 'true'; delete globalThis.__RAW_DISABLE_RASTER_WORK_BOUNDS__; });
afterEach(() => { delete process.env.REACT_APP_RASTER_WORK_BOUNDS; });

test('identical consumers share one decode and receive independent transferable buffers', async () => {
  const work = new RasterDecodeWork(), settings = {}, ready = deferred(), op = jest.fn(() => ready.promise);
  const a = work.run('tile', settings, new AbortController(), false, op);
  const b = work.run('tile', settings, new AbortController(), false, op);
  await Promise.resolve(); expect(op).toHaveBeenCalledTimes(1);
  ready.resolve(tile()); const [one, two] = await Promise.all([a, b]);
  expect(one.data).not.toBe(two.data); expect(new Uint8Array(one.data)).toEqual(new Uint8Array(two.data));
  new Uint8Array(one.data)[1] = 99; expect(new Uint8Array(two.data)[1]).toBe(11);
  expect(work.flights.size).toBe(0);
});
test('one abort does not cancel the surviving consumer', async () => {
  const work = new RasterDecodeWork(), settings = {}, ready = deferred(), first = new AbortController(); let owner;
  const op = jest.fn(c => { owner = c; return ready.promise; });
  const a = work.run('tile', settings, first, false, op).catch(e => e.name);
  const b = work.run('tile', settings, new AbortController(), false, op);
  await Promise.resolve(); first.abort(); expect(owner.signal.aborted).toBe(false);
  ready.resolve(tile()); expect(await a).toBe('AbortError'); expect((await b).data.byteLength).toBe(3);
});
test('all abandoned consumers cancel owned work; a fresh retry has a new owner', async () => {
  const work = new RasterDecodeWork(), settings = {}, old = deferred(), fresh = deferred(); let owner;
  const op = jest.fn(c => { owner = c; return old.promise; }); const c = new AbortController();
  const a = work.run('tile', settings, c, false, op).catch(e => e.name);
  await Promise.resolve(); c.abort(); expect(owner.signal.aborted).toBe(true);
  const b = work.run('tile', settings, new AbortController(), false, () => fresh.promise);
  old.resolve(tile()); await a; await Promise.resolve(); expect(work.flights.size).toBe(1);
  fresh.resolve(tile()); await b; expect(work.flights.size).toBe(0);
});
test('settings, response type and URL are distinct identities', async () => {
  const w = new RasterDecodeWork(), a = {}, b = {};
  expect(w.key('a', 'arrayBuffer', a)).not.toBe(w.key('a', 'arrayBuffer', b));
  expect(w.key('a', 'json', a)).not.toBe(w.key('a', 'arrayBuffer', a));
  expect(w.key('b', 'arrayBuffer', a)).not.toBe(w.key('a', 'arrayBuffer', a));
  const op = jest.fn(async () => tile()); await Promise.all([w.run('x', a, new AbortController(), false, op), w.run('x', b, new AbortController(), false, op)]);
  expect(op).toHaveBeenCalledTimes(2);
});
test.each([false, true])('marine decode retains per-request broadcasts, fallback=%s', async () => {
  const w = new RasterDecodeWork(), settings = {}, op = jest.fn(async () => tile());
  await Promise.all([w.run('x', settings, new AbortController(), true, op), w.run('x', settings, new AbortController(), true, op)]);
  expect(op).toHaveBeenCalledTimes(2);
});
test('hot entries survive pressure, replacing an existing entry does not evict a neighbor', () => {
  const w = new RasterDecodeWork(2); w.set('hot', tile()); w.set('cold', tile()); w.get('hot'); w.set('new', tile());
  expect(w.cache.has('hot')).toBe(true); expect(w.cache.has('cold')).toBe(false);
  w.set('hot', tile()); expect(w.cache.size).toBe(2); expect(w.cache.has('new')).toBe(true);
});
test('flush cannot be repopulated by an old successful decode', async () => {
  const w = new RasterDecodeWork(), ready = deferred(), settings = {};
  const a = w.run('x', settings, new AbortController(), false, async (_, epoch) => { const t = await ready.promise; w.set('x', t, epoch); return t; });
  await Promise.resolve(); w.clear(); ready.resolve(tile()); await a; expect(w.cache.size).toBe(0);
});
test('failed decode is released and can be retried', async () => {
  const w = new RasterDecodeWork(), settings = {};
  await expect(w.run('x', settings, new AbortController(), false, async () => { throw Error('bad decode'); })).rejects.toThrow('bad decode');
  expect(w.flights.size).toBe(0); expect((await w.run('x', settings, new AbortController(), false, async () => tile())).data.byteLength).toBe(3);
});
test('already aborted consumer does not start work', async () => {
  const w = new RasterDecodeWork(), c = new AbortController(), op = jest.fn(); c.abort();
  await expect(w.run('x', {}, c, false, op)).rejects.toHaveProperty('name', 'AbortError'); expect(op).not.toHaveBeenCalled();
});
test.each(['unset', 'kill'])('legacy rollback preserves independent work and FIFO: %s', async mode => {
  if (mode === 'unset') delete process.env.REACT_APP_RASTER_WORK_BOUNDS; else globalThis.__RAW_DISABLE_RASTER_WORK_BOUNDS__ = true;
  const w = new RasterDecodeWork(2), settings = {}, op = jest.fn(async () => tile());
  await Promise.all([w.run('x', settings, new AbortController(), false, op), w.run('x', settings, new AbortController(), false, op)]);
  expect(op).toHaveBeenCalledTimes(2); w.set('hot', tile()); w.set('cold', tile()); w.get('hot'); w.set('new', tile());
  expect(w.cache.has('hot')).toBe(false);
});
