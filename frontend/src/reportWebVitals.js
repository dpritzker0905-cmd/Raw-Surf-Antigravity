/**
 * Web Vitals -- Core performance metric reporting.
 * Measures LCP, CLS, FCP, TTFB and INP. FID is gone (skills audit #3, 2026-10-23): INP replaced it as a Core Web Vital, and
 * the field record (with attribution) is components/map/instantTelemetry.js.
 * Reports to console in dev, can be extended to analytics endpoint.
 *
 * Wired into index.js via: reportWebVitals(sendToAnalytics)
 */
const reportWebVitals = (onPerfEntry) => {
  if (onPerfEntry && onPerfEntry instanceof Function) {
    import('web-vitals').then(({ onCLS, onFCP, onLCP, onTTFB, onINP }) => {
      onCLS(onPerfEntry);
      onFCP(onPerfEntry);
      onLCP(onPerfEntry);
      onTTFB(onPerfEntry);
      if (onINP) onINP(onPerfEntry);
    }).catch(() => {
 // web-vitals not installed -- silent fallback
    });
  }
};

/**
 * Log vitals to console in development mode.
 * Can be replaced with an analytics endpoint in production.
 */
export const logWebVitals = (metric) => {
  const { name, value, rating } = metric;
  const color = rating === 'good' ? '#0cce6b' : rating === 'needs-improvement' ? '#ffa400' : '#ff4e42';
  
  if (process.env.NODE_ENV === 'development') {
    console.log(
      `%c[Web Vital] ${name}: ${value.toFixed(1)}ms (${rating})`,
      `color: ${color}; font-weight: bold;`
    );
  }
};

export default reportWebVitals;
