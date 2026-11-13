// Layout-only deduplication: never hide a distinct map-frame or quality notice.
export function syncForecastStatusDuplicates(root) {
  const card = root.querySelector('.weather-point-card');
  const body = card?.querySelector('.weather-point-body');
  const words = body?.querySelector('[data-testid="forecast-overlay-frame-words"]');
  const compactClosed = root.dataset.pointDetailsCompact === 'true' && card?.dataset.pointDetailsExpanded !== 'true';
  const open = card && body && words && root.dataset.mapControlMode !== 'explore' && !compactClosed
    && card.getAttribute('aria-hidden') !== 'true' && body.getAttribute('aria-hidden') !== 'true'
    && !card.hidden && getComputedStyle(card).display !== 'none' && getComputedStyle(card).visibility !== 'hidden';
  const normalize = text => (text || '').replace(/\s+/g, ' ').trim();
  const pointText = open ? normalize(words.getAttribute('aria-label') || words.textContent) : '';
  root.querySelectorAll('[data-weather-timeline] [data-drawn-state]').forEach(line => {
    const duplicate = !!pointText && normalize(line.textContent) === pointText;
    if (line.hasAttribute('data-duplicate-point-time') !== duplicate) {
      line.toggleAttribute('data-duplicate-point-time', duplicate);
    }
  });
}
