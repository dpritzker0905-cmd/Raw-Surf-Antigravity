/**
 * Logger utility for consistent debug/error logging
 * In production, debug logs are suppressed
 */

const isDev = process.env.NODE_ENV === 'development';

export const logger = {
  debug: (...args) => {
    if (isDev) {
      console.log('[DEBUG]', ...args);
    }
  },
  
  info: (...args) => {
    console.log('[INFO]', ...args);
  },
  
  warn: (...args) => {
    console.warn('[WARN]', ...args);
  },
  
  error: (...args) => {
    console.error('[ERROR]', ...args);
  },
  
  // For feature-specific debugging
  map: (...args) => {
    if (isDev) {
      console.log('[MAP]', ...args);
    }
  },
  
  stream: (...args) => {
    if (isDev) {
      console.log('[STREAM]', ...args);
    }
  },
  
  api: (...args) => {
    if (isDev) {
      console.log('[API]', ...args);
    }
  }
};

export default logger;
