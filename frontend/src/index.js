import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";

// Initialize i18n before rendering
import './i18n';
import reportWebVitals, { logWebVitals } from './reportWebVitals';

// Aggressively suppress ResizeObserver errors - these are benign browser warnings
// that React's dev overlay incorrectly shows as errors
if (typeof window !== 'undefined') {
  // Override error handler
  const originalError = window.onerror;
  window.onerror = function(message, source, lineno, colno, error) {
    if (message && message.toString().includes('ResizeObserver')) {
      return true;
    }
    if (originalError) {
      return originalError(message, source, lineno, colno, error);
    }
    return false;
  };

  // Suppress in event listener
  window.addEventListener('error', function(e) {
    if (e.message && e.message.includes('ResizeObserver')) {
      e.stopImmediatePropagation();
      e.stopPropagation();
      e.preventDefault();
      return true;
    }
  }, true);

  // Also patch ResizeObserver to not throw
  const RO = window.ResizeObserver;
  window.ResizeObserver = class extends RO {
    constructor(callback) {
      super((entries, observer) => {
        requestAnimationFrame(() => {
          try {
            callback(entries, observer);
          } catch (e) {
            // Suppress
          }
        });
      });
    }
  };

  // Global broken-image fallback handler
  // Catches ALL failed <img> loads and prevents the broken-image icon.
  // For avatar images (with class "rounded-full"), replaces with an initial letter.
  // For other images, hides them gracefully.
  document.addEventListener('error', function(e) {
    if (e.target.tagName === 'IMG') {
      const img = e.target;
      // Prevent infinite re-trigger
      if (img.dataset.fallbackApplied) return;
      img.dataset.fallbackApplied = 'true';

      const isAvatar = img.className?.includes('rounded-full');
      if (isAvatar) {
        // Replace with initial-letter div
        const initial = (img.alt || '?').charAt(0).toUpperCase();
        const fallback = document.createElement('div');
        fallback.className = img.className;
        fallback.style.cssText = `
          display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, #8b5cf6, #06b6d4);
          color: white; font-weight: 700; user-select: none;
        `;
        fallback.textContent = initial;
        fallback.setAttribute('role', 'img');
        fallback.setAttribute('aria-label', img.alt || 'Avatar');
        if (img.parentNode) img.parentNode.replaceChild(fallback, img);
      } else {
        // Hide non-avatar broken images
        img.style.display = 'none';
      }
    }
  }, true); // capture phase to catch before React
}

// Loading fallback for translations
var LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen bg-black">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
  </div>
);

var root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
    <Suspense fallback={<LoadingFallback />}>
      <App />
    </Suspense>
);

// ── Service Worker Registration ─────────────────────────────────────────────
// Enables offline caching, push notifications, and PWA installability.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then((registration) => {
        // Check for updates every 60 minutes
        setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000);
      })
      .catch((error) => {
        console.warn('[SW] Registration failed:', error);
      });
  });
}

// ── Core Web Vitals Monitoring ──────────────────────────────────────────────
// Reports LCP, FID, CLS, TTFB, INP metrics. Logs in dev, ready for analytics.
reportWebVitals(logWebVitals);
