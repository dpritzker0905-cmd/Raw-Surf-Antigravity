import React from 'react';

export var RequestProButton = ({
  userLocation,
  requestProLocationLoading,
  setPendingRequestPro,
  setRequestProLocationLoading,
  setLocationDenied,
  getUserLocation,
  setShowRequestProModal
}) => {
  return (
    <div className="mt-2 pointer-events-auto">
      <button
        onClick={() => {
          if (!userLocation) {
            setPendingRequestPro(true);
            setRequestProLocationLoading(true);
            setLocationDenied(false);
            getUserLocation();
          } else {
            setShowRequestProModal(true);
          }
        }}
        disabled={requestProLocationLoading}
        className={`px-4 py-2 rounded-full text-sm font-medium transition-all backdrop-blur-sm border border-cyan-500/50 ${
          requestProLocationLoading 
            ? 'bg-cyan-600/50 text-white cursor-wait' 
            : 'bg-zinc-800/90 text-gray-300 hover:bg-zinc-700'
        }`}
        data-testid="request-pro-btn"
      >
        {requestProLocationLoading ? (
          <span className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Finding location...
          </span>
        ) : (
 'Request a '
        )}
      </button>
    </div>
  );
};
