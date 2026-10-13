/**
 * mapChromeTheme — the class strings for the map's FLOATING chrome (header, search, filter chips, the Request
 * button, the right-hand buttons) in each of the three themes (CLAUDE.md: light, dark AND beach, every device).
 *
 * W-10 R4 (2026-09-30, a production build in 3 themes x desktop/mobile) found these four controls single-theme:
 * `text-white` / `bg-zinc-800` in every mode, so the "Live Map" title vanished on the light and beach basemaps
 * and dark pills sat on a light map. The weather controls already follow the pattern (MapWeatherControls'
 * isLight / isBeach); this is the same palette, named once for the chrome that floats over the map.
 *
 * ⛔ DARK IS BYTE-IDENTICAL to the classes these controls carried before, so dark mode cannot regress; light
 * and beach are the new branches. Beach is the sunlight mode: black surfaces, cyan edges, as the weather panel.
 * PURE: a theme name in, class strings out.
 */
export const mapChromeTheme = (theme) => {
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  return {
    // Over the basemap. Light and beach basemaps are bright, so the title is dark there, with a white halo.
    title: isLight || isBeach ? 'text-gray-900 [text-shadow:0_0_6px_rgba(255,255,255,0.9)]' : 'text-white drop-shadow-lg',
    // A pill or panel floating over the map (the live-count pill, the search input, the dropdown).
    surface: isLight
      ? 'bg-white/90 border-gray-200'
      : isBeach ? 'bg-black/90 border-cyan-900/50' : 'bg-zinc-800/90 border-zinc-700',
    surfaceText: isLight ? 'text-gray-900' : 'text-white',
    mutedText: isLight ? 'text-gray-600' : 'text-gray-300',
    subtleText: isLight ? 'text-gray-600' : 'text-gray-400',
    rowHover: isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-700/50',
    rowBorder: isLight ? 'border-gray-200' : 'border-zinc-700/50',
    // An idle chip or round button (filter chips, Request, the right-hand buttons).
    chipIdle: isLight
      ? 'bg-white/90 text-gray-700 border border-gray-200 hover:bg-gray-100'
      : isBeach
        ? 'bg-black/90 text-gray-200 border border-cyan-900/50 hover:bg-zinc-900'
        : 'bg-zinc-800/90 text-gray-300 hover:bg-zinc-700',
    fab: isLight
      ? 'bg-white/90 text-gray-800 border border-gray-200 hover:bg-gray-100'
      : isBeach
        ? 'bg-black/90 text-white border border-cyan-900/50 hover:bg-zinc-900'
        : 'bg-zinc-800/90 text-white hover:bg-zinc-700',
    // The Request chip keeps its cyan border in every theme (the brand accent), so its idle fill carries none.
    requestIdle: isLight
      ? 'bg-white/90 text-gray-700 hover:bg-gray-100'
      : isBeach ? 'bg-black/90 text-gray-200 hover:bg-zinc-900' : 'bg-zinc-800/90 text-gray-300 hover:bg-zinc-700',
    dropdown: isLight
      ? 'bg-white/95 border-gray-200'
      : isBeach ? 'bg-black/95 border-cyan-900/50' : 'bg-zinc-800/95 border-zinc-700',
    iconButton: isLight ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400 hover:text-white',
    danger: isLight ? 'text-red-700' : 'text-red-300',
    dangerIcon: isLight ? 'text-red-600' : 'text-red-400',
    link: isLight ? 'text-cyan-700 hover:text-cyan-800' : 'text-cyan-400 hover:text-cyan-300',
    // Active-state icon tints: the -400 shades vanish on a white button, so light uses -600.
    activeYellow: isLight ? 'text-yellow-600' : 'text-yellow-400',
    activeCyan: isLight ? 'text-cyan-600' : 'text-cyan-400',
    activeBlue: isLight ? 'text-blue-600' : 'text-blue-400',
  };
};

export default mapChromeTheme;
