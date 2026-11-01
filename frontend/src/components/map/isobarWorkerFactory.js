// The isobar worker's constructor, kept in its OWN module (2026-10-24): CRA's Jest runs CommonJS and cannot parse `import.meta`,
// so isobarStore.js loads this with a dynamic import() only when a Worker exists (browsers). Jest never requires it.
export function createIsobarWorker() {
  return new Worker(new URL('./isobarWorker.js', import.meta.url));
}
