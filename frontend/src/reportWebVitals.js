/**
 * Web Vitals GÇö Core performance metric reporting.
 * Measures LCP, FID, CLS, TTFB, and INP.
 * Reports to console in dev, can be extended to analytics endpoint.
 *
 * Wired into index.js via: reportWebVitals(sendToAnalytics)
 */
const reportWebVitals = (onPerfEntry) => {
  if (onPerfEntry && onPerfEntry instanceof Function) {
    import('web-vitals').then(({ onCLS, onFID, onFCP, onLCP, onTTFB, onINP }) => {
      onCLS(onPerfEntry);
      onFID(onPerfEntry);
      onFCP(onPerfEntry);
      onLCP(onPerfEntry);
      onTTFB(onPerfEntry);
      // INP (Interaction to Next Paint) GÇö newer metric replacing FID
      if (onINP) onINP(onPerfEntry);
    }).catch(() => {
      // web-vitals not installed GÇö silent fallback
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
