/**
 * Theme Tokens — Single source of truth for all theme-aware CSS classes.
 *
 * Usage:
 *   import { getThemeTokens } from '../utils/themeTokens';
 *   const { theme } = useTheme();
 *   const t = getThemeTokens(theme);
 *
 *   <div className={`${t.pageBg} ${t.textPrimary}`}>
 *     <div className={`${t.cardBg} border ${t.border}`}>
 *       <h2 className={t.textPrimary}>Title</h2>
 *       <p className={t.textSecondary}>Subtitle</p>
 *     </div>
 *   </div>
 */

export const getThemeTokens = (theme) => {
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';

  return {
    // ── Backgrounds ────────────────────────────────────
    /** Full page / modal / drawer background */
    pageBg:    isLight ? 'bg-white'    : isBeach ? 'bg-amber-50'      : 'bg-zinc-900',
    /** Cards, panels, sections */
    cardBg:    isLight ? 'bg-gray-50'  : isBeach ? 'bg-amber-100/60'  : 'bg-zinc-800',
    /** Card with border combo (for bordered cards) */
    cardBgBorder: isLight ? 'bg-gray-50 border-gray-200' : isBeach ? 'bg-amber-100/60 border-amber-200' : 'bg-zinc-800/50 border-zinc-800',
    /** Cells, data tiles, inner containers */
    cellBg:    isLight ? 'bg-gray-100' : isBeach ? 'bg-amber-100/60'  : 'bg-zinc-800',
    /** Faded/past cells */
    cellBgFaded: isLight ? 'bg-gray-100/50 opacity-60' : isBeach ? 'bg-amber-100/30 opacity-60' : 'bg-zinc-800/50 opacity-60',
    /** Row / list-item background */
    rowBg:     isLight ? 'bg-gray-100/80' : isBeach ? 'bg-amber-100/40' : 'bg-zinc-800/50',
    /** Input fields */
    inputBg:   isLight ? 'bg-white border-gray-300' : isBeach ? 'bg-amber-50 border-amber-200' : 'bg-zinc-900 border-zinc-700',
    /** Glassmorphism card (translucent with border + shadow) */
    glassBg:   isLight ? 'bg-white/80 border-gray-200 shadow-sm' : isBeach ? 'bg-amber-50/80 border-amber-200' : 'bg-zinc-900/80 border-zinc-800',

    // ── Text ───────────────────────────────────────────
    /** Headings, names, primary content */
    textPrimary:   isLight ? 'text-gray-900' : isBeach ? 'text-amber-900' : 'text-white',
    /** Descriptions, subtitles, secondary info */
    textSecondary: isLight ? 'text-gray-500' : isBeach ? 'text-amber-700' : 'text-gray-400',
    /** Timestamps, attributions, fine print */
    textMuted:     isLight ? 'text-gray-400' : isBeach ? 'text-amber-600' : 'text-gray-500',

    // ── Borders ────────────────────────────────────────
    /** Standard border (cards, sections) */
    border:       isLight ? 'border-gray-200' : isBeach ? 'border-amber-200' : 'border-zinc-800',
    /** Lighter border (headers, dividers) */
    borderLight:  isLight ? 'border-gray-200' : isBeach ? 'border-amber-200' : 'border-zinc-700',

    // ── Interactive ────────────────────────────────────
    /** Hover background for buttons/rows */
    hoverBg: isLight ? 'hover:bg-gray-100' : isBeach ? 'hover:bg-amber-100/50' : 'hover:bg-zinc-800/50',
    /** Avatar fallback bg */
    avatarBg: isLight ? 'bg-gray-200' : isBeach ? 'bg-amber-200' : 'bg-zinc-700',
    /** Badge bg for non-premium */
    badgeBg: isLight ? 'bg-gray-200 text-gray-500' : isBeach ? 'bg-amber-200 text-amber-700' : 'bg-zinc-700 text-gray-400',

    // ── Raw booleans (for edge cases) ──────────────────
    isLight,
    isBeach,
    isDark: !isLight && !isBeach,
  };
};

export default getThemeTokens;
