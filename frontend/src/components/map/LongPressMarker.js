import React from 'react';
import { Marker } from 'react-map-gl/maplibre';

export const LongPressMarker = ({ location }) => {
  if (!location) return null;
  return (
    <Marker
      longitude={location.lng}
      latitude={location.lat}
      anchor="bottom"
    >
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.5))',
        animation: 'markerDrop 0.3s ease-out',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50% 50% 50% 0',
          background: 'linear-gradient(135deg, #06b6d4, #0891b2)',
          transform: 'rotate(-45deg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '2px solid white',
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: 'white', transform: 'rotate(45deg)',
          }} />
        </div>
        <div style={{
          width: 2, height: 6, background: 'rgba(6,182,212,0.6)',
          borderRadius: 1, marginTop: -2,
        }} />
        <style>{`@keyframes markerDrop {
          from { transform: translateY(-20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }`}</style>
      </div>
    </Marker>
  );
};

export default LongPressMarker;
