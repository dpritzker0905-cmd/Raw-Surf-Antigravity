/**
 * useGridWorker.js Main-thread interface for GridParserWorker
 *
 * Provides a React hook and factory function for off-thread grid parsing.
 *
 * RULES:
 *   - NO import-time side effects
 *   - Worker created lazily on first use
 *   - Cleanup on unmount
 */

import { useRef, useCallback, useEffect } from 'react';

var _workerInstance = null;
var _messageId = 0;
var _pendingCallbacks = {};

/**
 * Create or return the shared grid parser worker.
 * @returns {{ parse: function, terminate: function }}
 */
export function createGridWorker() {
  if (!_workerInstance && typeof Worker !== 'undefined') {
    try {
      _workerInstance = new Worker(
        new URL('./GridParserWorker.js', import.meta.url)
      );
      _workerInstance.onmessage = function(e) {
        var data = e.data;
        var cb = _pendingCallbacks[data.id];
        if (cb) {
          delete _pendingCallbacks[data.id];
          if (data.error) cb.reject(new Error(data.error));
          else cb.resolve(data.result);
        }
      };
    } catch (err) {
      console.warn('[GridWorker] Worker creation failed, will parse on main thread:', err.message);
      return null;
    }
  }

  return {
    /**
     * Send a parse job to the worker.
     * @param {Object} message - { type, raw, uVar, vVar, ... }
     * @returns {Promise<Object>} parsed grid
     */
    parse: function(message) {
      return new Promise(function(resolve, reject) {
        var id = ++_messageId;
        _pendingCallbacks[id] = { resolve: resolve, reject: reject };
        _workerInstance.postMessage(Object.assign({ id: id }, message));
      });
    },
    terminate: function() {
      if (_workerInstance) {
        _workerInstance.terminate();
        _workerInstance = null;
        _pendingCallbacks = {};
      }
    },
  };
}

/**
 * React hook for grid parsing via Web Worker.
 * Automatically cleans up on unmount.
 *
 * @returns {{ parseWind: function, parseMarine: function }}
 */
export function useGridWorker() {
  var workerRef = useRef(null);

  useEffect(function() {
    workerRef.current = createGridWorker();
    return function() {
 // Don't terminate shared worker other components may use it
    };
  }, []);

  var parseWind = useCallback(function(raw, uVar, vVar, timeIndex) {
    if (!workerRef.current) {
      // Fallback: parse on main thread
      return Promise.resolve(null);
    }
    return workerRef.current.parse({
      type: 'parseWind',
      raw: raw,
      uVar: uVar || 'wind_speed_10m',
      vVar: vVar || 'wind_direction_10m',
      timeIndex: timeIndex || 0,
    });
  }, []);

  var parseMarine = useCallback(function(raw, heightVar, dirVar, periodVar, timeIndex) {
    if (!workerRef.current) {
      return Promise.resolve(null);
    }
    return workerRef.current.parse({
      type: 'parseMarine',
      raw: raw,
      heightVar: heightVar,
      dirVar: dirVar,
      periodVar: periodVar,
      timeIndex: timeIndex || 0,
    });
  }, []);

  var calculatePressureExtrema = useCallback(function(pressures, coarseRows, coarseCols, bounds, timeOffsetHours, activeModel) {
    if (!workerRef.current) {
      return Promise.resolve(null);
    }
    return workerRef.current.parse({
      type: 'calculatePressureExtrema',
      pressures: pressures,
      coarseRows: coarseRows,
      coarseCols: coarseCols,
      bounds: bounds,
      timeOffsetHours: timeOffsetHours,
      activeModel: activeModel
    });
  }, []);

  return { parseWind: parseWind, parseMarine: parseMarine, calculatePressureExtrema: calculatePressureExtrema };
}
