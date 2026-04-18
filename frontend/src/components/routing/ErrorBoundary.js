/**
 * ErrorBoundary.js — React class-based error boundary.
 *
 * Catches render crashes that would produce a blank screen.
 * Displays a developer-friendly error UI with the stack trace.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 */
import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, color: 'white', background: '#111', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h1 style={{ color: '#f44' }}>App Crashed</h1>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#faa', marginTop: 16 }}>
            {this.state.error?.toString()}
          </pre>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#aaa', marginTop: 8, fontSize: 12 }}>
            {this.state.errorInfo?.componentStack}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
            style={{ marginTop: 24, padding: '8px 20px', background: '#f44', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
