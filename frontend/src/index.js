import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

// Initialize i18n before rendering
import './i18n';

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
}

// Loading fallback for translations
const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen bg-black">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
  </div>
);

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <Suspense fallback={<LoadingFallback />}>
      <App />
    </Suspense>
  </React.StrictMode>,
);

console.log("Trigger build 4");
