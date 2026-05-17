/**
 * CookieConsentBanner — EU-compliant cookie consent banner.
 *
 * Shows on first visit, persists choice in localStorage.
 * Follows the project's glassmorphism design pattern with slide-up animation.
 */
import React, { useState, useEffect } from 'react';

var CONSENT_KEY = 'raw-surf-cookie-consent';

export var CookieConsentBanner = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show if consent hasn't been given
    const consent = localStorage.getItem(CONSENT_KEY);
    if (!consent) {
      // Delay appearance so it doesn't compete with page load
      const timer = setTimeout(() => setVisible(true), 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ accepted: true, timestamp: Date.now() }));
    setVisible(false);
  };

  const handleDecline = () => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ accepted: false, timestamp: Date.now() }));
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      id="cookie-consent-banner"
      role="dialog"
      aria-label="Cookie consent"
      style={{
        position: 'fixed',
        bottom: 'env(safe-area-inset-bottom, 0px)',
        left: 0,
        right: 0,
        zIndex: 9999,
        padding: '0 16px 16px',
        animation: 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        pointerEvents: 'auto'
      }}
    >
      <div
        style={{
          maxWidth: 480,
          margin: '0 auto',
          background: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 16,
          padding: '20px 20px 16px',
          boxShadow: '0 -4px 32px rgba(0, 0, 0, 0.3)'
        }}
      >
        {/* Icon + text */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 24, lineHeight: 1 }}>🍪</span>
          <div>
            <p style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: '#f1f5f9',
              lineHeight: 1.5
            }}>
              We use cookies
            </p>
            <p style={{
              margin: '4px 0 0',
              fontSize: 12,
              color: '#94a3b8',
              lineHeight: 1.5
            }}>
              We use cookies for analytics, session management, and to improve your experience. 
              You can manage your preferences at any time in Settings.
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleDecline}
            style={{
              flex: 1,
              padding: '10px 16px',
              background: 'transparent',
              color: '#94a3b8',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 10,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              transition: 'all 0.2s'
            }}
          >
            Decline
          </button>
          <button
            onClick={handleAccept}
            style={{
              flex: 1,
              padding: '10px 16px',
              background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              transition: 'all 0.2s'
            }}
          >
            Accept All
          </button>
        </div>
      </div>

      {/* Animation keyframe injected inline for portability */}
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default CookieConsentBanner;
