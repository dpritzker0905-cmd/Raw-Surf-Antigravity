/**
 * TideOverlayLayer - the map Tide overlay (marine add-on, owner-approved 2026-11-15). One small marker per tide cell
 * of the visible unclustered surf spots: trend arrow + WORD (Rising/Falling/Slack; never arrow or colour alone),
 * height in the ft/m setting, and the time from the SELECTED hour to the next high/low. Same payload, same tideAt,
 * same instant as the infobox (tideOverlayModel.js). Three themes; desktop and mobile share the marker.
 * Kill: window.__RAW_DISABLE_TIDE_OVERLAY__ = true.
 */
import React, { useMemo } from 'react';
import { ContentMarker as Marker } from './ContentMarker';
import { useTheme } from '../../contexts/ThemeContext';
import useHeightUnit from './useHeightUnit';
import { forecastSelectionMs } from './forecastReadout';
import { canUseAddOn } from './LayerAccessResolver';
import { selectTideCells, tideMarkerModel } from './tideOverlayModel';
import { useTideOverlayFlag, useTidePayloads } from './useTideOverlay';
import { tideCredit } from './tideReadoutFormat';

// Stable props: react-map-gl re-applies a Marker's offset/style when their identity changes, so new literals on every
// scrub step would cost a DOM update per marker per step.
const MARKER_OFFSET = [0, 18];
const MARKER_STYLE = { zIndex: 0, pointerEvents: 'none' };

export function tideMarkerClasses(theme) {
  if (theme === 'light') return { box: 'bg-white/95 border-gray-300 text-gray-900', muted: 'text-gray-600', accent: 'text-sky-700' };
  if (theme === 'beach') return { box: 'bg-black/85 border-cyan-900/60 text-white', muted: 'text-cyan-200/80', accent: 'text-amber-300' };
  return { box: 'bg-zinc-900/90 border-zinc-700 text-white', muted: 'text-gray-400', accent: 'text-cyan-400' };
}

/** PURE-ish view of one marker (exported for the parity test). */
export function TideMarkerBody({ model, theme }) {
  const k = tideMarkerClasses(theme);
  if (!model.available) {
    return (
      <div role="img" aria-label={model.ariaLabel} data-testid="tide-marker"
           className={`px-1.5 py-0.5 rounded-md border text-[9px] leading-tight shadow ${k.box} ${k.muted}`}>{model.text}</div>
    );
  }
  return (
    <div role="img" aria-label={model.ariaLabel} data-testid="tide-marker" data-trend={model.trend}
         className={`px-1.5 py-0.5 rounded-md border text-[10px] leading-tight shadow whitespace-nowrap pointer-events-none ${k.box}`}>
      <div aria-hidden="true">
        <span className={`font-semibold ${k.accent}`}>{model.glyph} {model.trendWord}</span>{' '}
        <span className="font-bold">{model.heightText}</span>
      </div>
      {model.nextText && <div aria-hidden="true" className={`text-[9px] ${k.muted}`}>{model.nextText}</div>}
    </div>
  );
}

/**
 * ONE credit line for the overlay's data, built by the infobox's own tideCredit() from the same /point-tide payload, so
 * the overlay credits exactly what the infobox credits (AVISO s.3.1; Copernicus): the provider in WORDS, a link to the
 * source, and the full attribution as its title and accessible name. One line for all markers (they ignore pointer
 * events, and a link on each would repeat the same credit up to 12 times). Distinct providers are each listed.
 */
export function TideOverlayCredit({ payloads, theme }) {
  const seen = new Map();
  for (const p of payloads) {
    const c = p ? tideCredit(p) : null;
    if (c && !seen.has(c.text)) seen.set(c.text, c);
  }
  if (!seen.size) return null;
  const k = tideMarkerClasses(theme);
  return (
    <div data-testid="tide-overlay-credit"
         className={`absolute top-40 md:top-auto md:bottom-8 left-2 z-10 max-w-[70vw] sm:max-w-sm px-1.5 py-0.5 rounded-md border text-[9px] leading-tight shadow whitespace-normal break-words ${k.box}`}>
      <span className={k.muted}>Tide data: </span>
      {[...seen.values()].map((c, i) => (
        <React.Fragment key={c.text}>
          {i > 0 && <span className={k.muted}>; </span>}
          {c.href
            ? <a href={c.href} target="_blank" rel="noopener noreferrer" aria-label={c.label} title={c.title || undefined}
                 className={`underline ${k.accent}`}>{c.text}</a>
            : <span title={c.title || undefined} aria-label={c.label}>{c.text}</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

function TideOverlayLayer({ spotClusters, timeOffsetHours = 0, mapInstance, userTier }) {
  const { theme } = useTheme();
  const [heightUnit] = useHeightUnit();
  const [flagOn] = useTideOverlayFlag();
  const enabled = flagOn && canUseAddOn(userTier, 'tide');
  const cells = useMemo(() => {
    if (!enabled) return [];
    let center = null;
    try { const c = mapInstance?.getCenter?.(); if (c) center = [c.lng, c.lat]; } catch (e) { center = null; }
    return selectTideCells(spotClusters, center);
  }, [enabled, spotClusters, mapInstance]);
  const payloads = useTidePayloads(cells, enabled);
  if (!enabled || !cells.length) return null;
  const atMs = forecastSelectionMs(timeOffsetHours);   // the infobox's TideReadout atTime, same function
  return (
    <>
      {cells.map((c) => {
        const payload = payloads[c.cell];
        if (payload === undefined) return null;          // still loading: draw nothing rather than a guess
        const model = tideMarkerModel(payload, atMs, heightUnit, c.name);
        return (
          <Marker key={`tide-${c.cell}`} longitude={c.lng} latitude={c.lat} anchor="top" offset={MARKER_OFFSET}
                  style={MARKER_STYLE}>
            <TideMarkerBody model={model} theme={theme} />
          </Marker>
        );
      })}
      <TideOverlayCredit payloads={cells.map((c) => payloads[c.cell])} theme={theme} />
    </>
  );
}

export default React.memo(TideOverlayLayer);
