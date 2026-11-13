/**
 * useSessionExpiredPrompt: open the sign-in-again prompt when a forecast read (or a frame-URL request) sent with this
 * user's token is refused (#782 / #783). The signal comes from lib/weatherSession.js; the prompt itself is
 * components/SessionExpiredPrompt.js, mounted once in App.js (not in AppLayout or routing/*, which are Codex-reserved).
 *
 * The prompt is a CLICK, never an automatic navigation, so it cannot loop the way a 401 redirect once did
 * (lib/sessionRejection.js). "Not now" closes it; it re-opens on the next refused read, at most once per
 * REOPEN_AFTER_MS, so a map firing many reads does not keep stealing focus.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { WEATHER_SESSION_EXPIRED } from '../lib/weatherSession';

export const REOPEN_AFTER_MS = 60000;

export function useSessionExpiredPrompt({ win = typeof window !== 'undefined' ? window : undefined, now = Date.now } = {}) {
  const [open, setOpen] = useState(false);
  const dismissedAt = useRef(0);

  useEffect(() => {
    if (!win || typeof win.addEventListener !== 'function') return undefined;
    const onExpired = () => {
      if (dismissedAt.current && now() - dismissedAt.current < REOPEN_AFTER_MS) return;
      setOpen(true);
    };
    win.addEventListener(WEATHER_SESSION_EXPIRED, onExpired);
    return () => win.removeEventListener(WEATHER_SESSION_EXPIRED, onExpired);
  }, [win, now]);

  const dismiss = useCallback(() => {
    dismissedAt.current = now();
    setOpen(false);
  }, [now]);

  return { open, dismiss };
}

export default useSessionExpiredPrompt;
