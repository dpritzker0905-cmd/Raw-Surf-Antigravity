// PF04: qualified non-marine work sharing. Marine callbacks remain per request.
export const rasterWorkEnabled = () => process.env.REACT_APP_RASTER_WORK_BOUNDS === 'true'
  && !globalThis.__RAW_DISABLE_RASTER_WORK_BOUNDS__;

const aborted = () => new DOMException('The user aborted a request.', 'AbortError');
export function copyTile(result) {
  if (!result || !result.data) return result;
  const data = result.data;
  // MapLibre may transfer and detach buffers. Each subscriber owns its delivery.
  return { ...result, data: data instanceof DataView
    ? new DataView(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
    : data instanceof ArrayBuffer || ArrayBuffer.isView(data) ? data.slice(0) : data };
}

export class RasterDecodeWork {
  constructor(limit = 150) {
    this.limit = limit;
    this.cache = new Map();
    this.flights = new Map();
    this.epoch = 0;
    this.settingsIds = new WeakMap();
    this.nextSettings = 0;
  }
  key(url, type, settings) {
    if (!rasterWorkEnabled()) return url;
    if (!this.settingsIds.has(settings)) this.settingsIds.set(settings, ++this.nextSettings);
    return `${this.settingsIds.get(settings)}|${type}|${url}`;
  }
  clear() {
    this.epoch++;
    this.cache.clear();
    this.flights.clear(); // old consumers still own their operation
  }
  get(key) {
    const value = this.cache.get(key);
    if (value && rasterWorkEnabled()) { this.cache.delete(key); this.cache.set(key, value); }
    return rasterWorkEnabled() ? copyTile(value) : value;
  }
  set(key, value, epoch = this.epoch) {
    if (epoch !== this.epoch) return;
    if (rasterWorkEnabled()) this.cache.delete(key);
    if (this.cache.size >= this.limit) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, rasterWorkEnabled() ? copyTile(value) : value);
  }
  run(key, settings, controller, marine, operation) {
    if (!rasterWorkEnabled() || marine) return operation(controller, this.epoch);
    if (controller.signal.aborted) return Promise.reject(aborted());
    let flight = this.flights.get(key);
    if (!flight || flight.settings !== settings || flight.controller.signal.aborted) {
      const owner = new AbortController();
      flight = { settings, controller: owner, consumers: 0, finished: false };
      const epoch = this.epoch;
      flight.promise = Promise.resolve().then(() => operation(owner, epoch)).finally(() => {
        flight.finished = true;
        if (this.flights.get(key) === flight) this.flights.delete(key);
      });
      this.flights.set(key, flight);
    }
    flight.consumers++;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, value) => {
        if (done) return;
        done = true;
        controller.signal.removeEventListener('abort', cancel);
        flight.consumers--;
        if (!flight.finished && flight.consumers === 0) flight.controller.abort();
        fn(value);
      };
      const cancel = () => finish(reject, aborted());
      controller.signal.addEventListener('abort', cancel, { once: true });
      flight.promise.then(value => finish(resolve, copyTile(value)), error => finish(reject, error));
    });
  }
}
