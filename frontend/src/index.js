import React from 'react';
import { createRoot } from 'react-dom/client';
import MapWebGL from './components/map/MapWebGL';

const container = document.getElementById('root');
const root = createRoot(container);
root.render(
  <div style={{width: '100vw', height: '100vh'}}>
    <MapWebGL 
      isLight={false} 
      userLocation={null} 
      effectiveLocation={null} 
      surfSpots={[]} 
      livePhotographers={[]} 
      filter='all' 
      pulsingMarkers={new Set()} 
      onSpotClick={() => {}} 
      onPhotographerClick={() => {}} 
      mapInstanceRef={{current: null}} 
      activeDispatch={null} 
      friendsOnMap={[]} 
      activeModel='GFS' 
      activeLayers={['precipitation']} 
      radarFrames={[]} 
      radarFrameIndex={0} 
      timeOffsetHours={0} 
    />
  </div>
);
