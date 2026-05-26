import { useState, useEffect, useRef } from 'react';
import { fetchPressureData } from './marineController';
import { useGridWorker } from './useGridWorker';

export function usePressureEngine({ mapInstance, activeLayers, timeOffsetHours, activeModel }) {
  const [lowSystems, setLowSystems] = useState([]);
  const [highSystems, setHighSystems] = useState([]);
  const lastComputedVersionRef = useRef('');
  const { calculatePressureExtrema } = useGridWorker();

  useEffect(() => {
    if (!mapInstance || !activeLayers.includes('pressure')) {
      return;
    }

    let isSubscribed = true;

    const handleUpdate = async () => {
      if (!isSubscribed) return;

      const b = mapInstance.getBounds();
      const bounds = {
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth()
      };

      // Version tag to prevent redundant calculations
      const version = `${activeModel}-${timeOffsetHours}-${bounds.west.toFixed(3)}-${bounds.east.toFixed(3)}-${bounds.south.toFixed(3)}-${bounds.north.toFixed(3)}`;
      if (version === lastComputedVersionRef.current) {
        return;
      }

      try {
        const data = await fetchPressureData(bounds, null, timeOffsetHours, false, 3, activeModel);
        if (!data || !data.pressures || data.pressures.length === 0 || !isSubscribed) {
          return;
        }

        const coarseRows = data.rows;
        const coarseCols = data.cols;
        const pressures = data.pressures;

        // v3.14: Off-thread RAG offload via GridParserWorker to completely eliminate main-thread stutter
        const resExtrema = await calculatePressureExtrema(
          pressures,
          coarseRows,
          coarseCols,
          bounds,
          timeOffsetHours,
          activeModel
        );
        if (!resExtrema || !isSubscribed) return;

        const { lowSystems: finalLows, highSystems: finalHighs } = resExtrema;

        if (isSubscribed) {
          console.log(`[PressureEngine] Off-thread detection complete: ${finalLows.length}L + ${finalHighs.length}H systems`);
          setLowSystems(finalLows);
          setHighSystems(finalHighs);
          lastComputedVersionRef.current = version;
        }

      } catch (err) {
        console.error('[PressureEngine] Calculations error:', err);
      }
    };

    mapInstance.on('moveend', handleUpdate);
    handleUpdate();

    return () => {
      isSubscribed = false;
      mapInstance.off('moveend', handleUpdate);
    };
  }, [mapInstance, activeLayers, timeOffsetHours, activeModel]);

  return { lowSystems, highSystems };
}
