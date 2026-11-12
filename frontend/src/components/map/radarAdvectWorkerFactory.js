// The radar advection worker's constructor, kept in its OWN module (the isobarWorkerFactory pattern): CRA's Jest runs CommonJS and
// cannot parse `import.meta`, so radarAdvectClient.js loads this with a dynamic import() only when a Worker exists (browsers).
export function createRadarAdvectWorker() {
  return new Worker(new URL('./radarAdvectWorker.js', import.meta.url));
}
