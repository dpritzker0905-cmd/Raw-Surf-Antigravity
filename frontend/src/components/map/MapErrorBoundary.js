import React from 'react';
import logger from '../../utils/logger';

/**
 * Error Boundary to catch any runtime errors in map rendering
 * Prevents white screen of death on Samsung/mobile devices
 */
class MapErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    logger.error('[MAP ERROR BOUNDARY]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-zinc-900 text-white p-4">
          <div className="text-6xl mb-4">🗺️</div>
          <h2 className="text-xl font-bold mb-2">Map Error</h2>
          <p className="text-gray-400 text-center mb-4">
            Something went wrong loading the map.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 rounded-lg"
          >
            Reload Page
          </button>
          {process.env.NODE_ENV === 'development' && (
            <pre className="mt-4 p-2 bg-zinc-800 rounded text-xs text-red-400 max-w-md overflow-auto">
              {this.state.error?.message}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default MapErrorBoundary;
