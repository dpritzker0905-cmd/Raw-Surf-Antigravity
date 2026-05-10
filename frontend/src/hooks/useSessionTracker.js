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
  
  const lastPosRef = useRef(null);
  const watchIdRef = useRef(null);
  
  // Haversine formula to calculate distance
  const getDistanceFromLatLonInMeters = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Radius of the earth in m
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return R * c;
  };

  const processPosition = useCallback((position) => {
    const { latitude, longitude, speed } = position.coords;
    
    setMetrics(prev => {
      let newDistance = prev.distance;
      let newTopSpeed = prev.topSpeed;
      let newWaveCount = prev.waveCount;
      
      const currentSpeed = speed || 0;
      if (currentSpeed > newTopSpeed) newTopSpeed = currentSpeed;
      
      // Simple wave count heuristic: speed jumps above 4 m/s (approx 9 mph)
      // In a real app we'd use moving averages and accelerometer data
      if (currentSpeed > 4.0 && (!lastPosRef.current || (lastPosRef.current.speed || 0) <= 4.0)) {
        newWaveCount += 1;
      }
      
      if (lastPosRef.current) {
        const dist = getDistanceFromLatLonInMeters(
          lastPosRef.current.lat, lastPosRef.current.lon,
          latitude, longitude
        );
        newDistance += dist;
      }
      
      lastPosRef.current = { lat: latitude, lon: longitude, speed: currentSpeed, timestamp: position.timestamp };
      
      return {
        ...prev,
        distance: newDistance,
        topSpeed: newTopSpeed,
        waveCount: newWaveCount
      };
    });
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
        lastPosRef.current = null;
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
      
      toast.success(`Session logged! Earned ${earnedXp} XP 🌊`);
      return data;
    } catch (err) {
      console.error(err);
      toast.error('Failed to save session log');
    }
  };

  return { metrics, saveSessionLog };
};
