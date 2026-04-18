/**
 * ErrorBoundary.js — Production-ready React error boundary.
 *
 * - Shows a branded crash screen (not raw dev output)  
 * - In development: shows full stack trace
 * - In production: shows friendly message + reload button
 * - Reports the error to console for Render logs
 */
import React from 'react';

const IS_DEV = process.env.NODE_ENV === 'development';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Uncaught render error:', error.message);
    if (IS_DEV) {
      console.error('Stack:', error.stack);
      console.error('Component stack:', errorInfo.componentStack);
    }
    this.setState({ errorInfo });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0a0a0a 0%, #0d1a2a 100%)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: '#fff',
        padding: '24px',
        textAlign: 'center'
      }}>
        {/* Wave icon */}
        <div style={{ fontSize: 64, marginBottom: 16 }}>🌊</div>

        <h1 style={{
          fontSize: IS_DEV ? 24 : 28,
          fontWeight: 700,
          margin: '0 0 12px',
          background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent'
        }}>
          {IS_DEV ? 'Render Error' : 'Something wiped out'}
        </h1>

        <p style={{ color: '#94a3b8', marginBottom: 32, maxWidth: 400, lineHeight: 1.6 }}>
          {IS_DEV
            ? 'A component threw during render. See details below.'
            : "We hit a snag in the wave. Try refreshing — most issues clear up quickly."}
        </p>

        {/* Dev-only stack trace */}
        {IS_DEV && this.state.error && (
          <div style={{
            background: '#1e1e1e',
            border: '1px solid #ef4444',
            borderRadius: 8,
            padding: '16px',
            maxWidth: 600,
            width: '100%',
            textAlign: 'left',
            marginBottom: 24,
            overflow: 'auto',
            maxHeight: 300
          }}>
            <pre style={{ color: '#f87171', fontSize: 12, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {this.state.error?.toString()}
            </pre>
            {this.state.errorInfo?.componentStack && (
              <pre style={{ color: '#94a3b8', fontSize: 11, marginTop: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {this.state.errorInfo.componentStack}
              </pre>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            onClick={this.handleRetry}
            style={{
              padding: '10px 24px',
              background: 'rgba(6,182,212,0.15)',
              color: '#06b6d4',
              border: '1px solid rgba(6,182,212,0.4)',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              transition: 'all 0.2s'
            }}
          >
            Try Again
          </button>
          <button
            onClick={this.handleReload}
            style={{
              padding: '10px 24px',
              background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600
            }}
          >
            Reload Page
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
