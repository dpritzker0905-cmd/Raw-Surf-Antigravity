/** Shared application Back and URL-cleanup behavior. */
export const AUTHENTICATED_HISTORY_MARKER = '__rawSurfHistoryBoundary';

export function canNavigateBack() {
  const state = window.history.state;
  const marker = state?.[AUTHENTICATED_HISTORY_MARKER];
  if (marker?.version === 1) {
    // The visible arrival copy and its hidden boundary are one logical entry.
    // New boundaries retain the router's exact starting index; older markers
    // predate that field and use the router's original zero-based index.
    const start = Number.isInteger(marker.startIndex) ? marker.startIndex : 0;
    return marker.kind === 'route' && Number.isInteger(state.idx) && state.idx > start;
  }
  return window.history.length > 1;
}

export function goBackOr(navigate, fallback = '/feed') {
  if (canNavigateBack()) navigate(-1);
  else navigate(fallback, {replace: true});
}

export function replaceHistoryUrl(url, options = {}) {
  const current = window.history.state;
  // A one-shot notification can clear caller state without erasing router and
  // boundary metadata. URL-only OAuth/import cleanup retains all caller state.
  const state = options.clearCallerState ? {...current, usr: null} : current;
  window.history.replaceState(state, document.title, url ?? window.location.href);
}
