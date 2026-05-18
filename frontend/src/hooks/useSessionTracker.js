import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';

/**
 * useSessionTracker.js - Hook for tracking surf sessions with GPS.
 * Calculates distance paddled, top speed, and wave counts via velocity spikes.
 */
export const useSessionTracker = (userId, spotId, isTracking) => {
  const [metrics, setMetrics] = useState({
    distance: 0, // in meters
    topSpeed: 0, // in m/s
    waveCount: 0,
    startTime: null,
  });
  
  const workerRef = useRef(null);
  const watchIdRef = useRef(null);

  useEffect(() => {
    // Initialize Web Worker for offloading calculation
    workerRef.current = new Worker(new URL('../workers/gpsWorker.js', import.meta.url));
    
    workerRef.current.onmessage = (e) => {
      if (e.data.type === 'METRICS_UPDATE') {
        setMetrics(prev => ({ ...prev, ...e.data.payload }));
      }
    };

    return () => {
      workerRef.current.terminate();
    };
  }, []);

  const processPosition = useCallback((position) => {
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'PROCESS_POSITION',
        payload: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          speed: position.coords.speed
        }
      });
    }
  }, []);

  useEffect(() => {
    if (isTracking && navigator.geolocation) {
      if (!metrics.startTime) {
        setMetrics(prev => ({ ...prev, startTime: new Date().toISOString() }));
      }
      watchIdRef.current = navigator.geolocation.watchPosition(
        processPosition,
        (error) => console.error("GPS Tracking Error:", error),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    } else {
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
        if (workerRef.current) {
          workerRef.current.postMessage({ type: 'RESET' });
        }
      }
    }
    
    return () => {
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [isTracking, processPosition, metrics.startTime]);

  const saveSessionLog = async (conditionNotes = "") => {
    if (!userId || !spotId) return;
    
    try {
      // 1. Calculate XP (e.g. 10 XP per 100m, 20 XP per wave)
      const earnedXp = Math.floor(metrics.distance / 100) * 10 + (metrics.waveCount * 20);
      
      // 2. Insert into surf_logs
      const { data, error } = await supabase.from('surf_logs').insert([{
        user_id: userId,
        spot_id: spotId,
        distance_paddled: metrics.distance,
        wave_count: metrics.waveCount,
        top_speed: metrics.topSpeed,
        duration_minutes: metrics.startTime ? Math.floor((Date.now() - new Date(metrics.startTime).getTime()) / 60000) : 0,
        notes: conditionNotes,
        xp_earned: earnedXp
      }]);
      
      if (error) throw error;
      
 toast.success(`Session logged! Earned ${earnedXp} XP =`);
      return data;
    } catch (err) {
      console.error(err);
      toast.error('Failed to save session log');
    }
  };

  return { metrics, saveSessionLog };
};
