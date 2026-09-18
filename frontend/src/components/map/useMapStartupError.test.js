import React, { useEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import MapErrorBoundary from './MapErrorBoundary';
import { useMapStartupError } from './useMapStartupError';

describe('asynchronous map startup failures', () => {
  let report, cleanup, consoleError;
  function MapHarness() {
    report = useMapStartupError();
    useEffect(() => cleanup, []);
    return <div>Map running</div>;
  }
  beforeEach(() => {
    cleanup = jest.fn();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  it('shows a recovery screen and cleans up map effects after constructor rejection', async () => {
    render(<MapErrorBoundary><MapHarness /></MapErrorBoundary>);
    await act(async () => {
      await Promise.resolve();
      report({ target: null, error: new Error('Failed to initialize WebGL') });
    });
    expect(screen.getByText('Map unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to feed' })).toHaveAttribute('href', '/feed');
    expect(screen.queryByText('Map running')).not.toBeInTheDocument();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('keeps the map mounted for recoverable tile errors', () => {
    render(<MapErrorBoundary><MapHarness /></MapErrorBoundary>);
    act(() => report({ target: {}, error: new Error('Tile request failed') }));
    expect(screen.getByText('Map running')).toBeInTheDocument();
    expect(cleanup).not.toHaveBeenCalled();
  });
});
