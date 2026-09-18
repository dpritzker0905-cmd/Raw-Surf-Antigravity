import { useCallback, useState } from 'react';

// react-map-gl reports constructor rejection asynchronously with target:null.
// Re-throw during render so the map page's boundary can unmount its effects.
export function useMapStartupError() {
  const [failure, setFailure] = useState(null);
  const onError = useCallback((event) => {
    if (event?.target !== null) return; // Ordinary tile errors must not remove the map.
    const error = new Error('The map could not start.');
    error.name = 'MapStartupError';
    error.cause = event.error;
    setFailure(error);
  }, []);
  if (failure) throw failure;
  return onError;
}
