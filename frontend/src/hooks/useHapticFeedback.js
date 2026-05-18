/**
 * useHapticFeedback G Trigger device vibration for premium mobile feel.
 *
 * Uses the Vibration API (navigator.vibrate) which is supported on
 * Android Chrome, Samsung Internet, and Firefox. iOS Safari does NOT
 * support it, but the call is silently ignored.
 *
 * Patterns:
 * - 'light' G 10ms (subtle tap)
 * - 'medium' G 30ms (button press)
 * - 'heavy' G 50ms (confirm action)
 * - 'success' G [30, 50, 30] (double-tap success)
 * - 'error' G [50, 30, 50, 30, 50] (triple warning)
 *
 * Usage:
 *   const haptic = useHapticFeedback();
 *   haptic('success'); // on booking confirmed
 */
import { useCallback } from 'react';

const PATTERNS = {
  light: [10],
  medium: [30],
  heavy: [50],
  success: [30, 50, 30],
  error: [50, 30, 50, 30, 50],
};

const useHapticFeedback = () => {
  return useCallback((type = 'medium') => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      const pattern = PATTERNS[type] || PATTERNS.medium;
      navigator.vibrate(pattern);
    }
  }, []);
};

export default useHapticFeedback;
