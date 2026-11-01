import { useThemeName } from '../../contexts/ThemeContext';

/**
 * Status colours for the security screens, per theme (light, dark, beach). Every state is ALSO written in words and
 * carries an icon wherever these classes are used, so colour is never the only signal. Pairs are chosen for
 * >= 4.5:1 text contrast on their own tint: dark text on a pale tint in light; pale text on a deep tint in dark/beach.
 */
const TONES = {
  light: {
    ok: 'text-green-900 bg-green-50 border-green-400',
    bad: 'text-red-900 bg-red-50 border-red-400',
    warn: 'text-amber-900 bg-amber-50 border-amber-500',
    code: 'bg-slate-100 text-slate-900 border-slate-400',
  },
  dark: {
    ok: 'text-green-200 bg-green-950 border-green-700',
    bad: 'text-red-200 bg-red-950 border-red-700',
    warn: 'text-amber-100 bg-amber-950 border-amber-600',
    code: 'bg-zinc-900 text-zinc-50 border-zinc-600',
  },
  beach: {
    ok: 'text-green-200 bg-black border-green-500',
    bad: 'text-red-200 bg-black border-red-500',
    warn: 'text-amber-100 bg-black border-amber-400',
    code: 'bg-black text-white border-zinc-400',
  },
};

export const useSecurityTone = () => {
  const theme = useThemeName();
  return { theme, ...(TONES[theme] || TONES.dark), isLight: theme === 'light' };
};

// Shared QR tile colours: a QR needs a light quiet zone and dark modules in EVERY theme to scan.
export const QR_FG = '#000000';
export const QR_BG = '#ffffff';
