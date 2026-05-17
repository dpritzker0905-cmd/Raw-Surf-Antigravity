import { useState, useEffect } from 'react';

/**
 * Hook to detect device capabilities and decide if high-performance animations
 * (like the Fluid Aurora) should run, or if we should fall back to static.
 *
 * Checks:
 * - prefers-reduced-motion (OS-level accessibility)
 * - navigator.deviceMemory (RAM)
 * - navigator.hardwareConcurrency (CPU Cores)
 */
export var useAdaptivePerformance = () => {
  const [shouldAnimate, setShouldAnimate] = useState(true);

  useEffect(() => {
    // 1. Check OS preference for reduced motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      setShouldAnimate(false);
      return;
    }

    // 2. Check Device Memory (if available in browser)
    // Devices with < 4GB RAM should probably use static backgrounds to save resources
    if ('deviceMemory' in navigator) {
      if (navigator.deviceMemory < 4) {
        setShouldAnimate(false);
        return;
      }
    }

    // 3. Check CPU cores (if available)
    // Devices with < 4 cores might struggle with heavy CSS repaints
    if ('hardwareConcurrency' in navigator) {
      if (navigator.hardwareConcurrency < 4) {
        setShouldAnimate(false);
        return;
      }
    }

    // Default to animating if hardware seems capable or APIs are unavailable
    setShouldAnimate(true);
  }, []);

  return { shouldAnimate };
};
