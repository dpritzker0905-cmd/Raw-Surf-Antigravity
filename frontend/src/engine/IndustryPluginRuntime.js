/**
 * IndustryPluginRuntime.js — Surf Industry Plugin System
 *
 * Runtime execution engine for industry role plugins.
 * Each plugin defines capabilities, permissions, and lifecycle hooks
 * for surf industry roles (School, Coach, Brand, etc.).
 *
 * RULES:
 *   - NO import-time side effects (all var/function — TDZ-immune)
 *   - Plugins register at runtime, not import time
 *   - Capability-based access (not hardcoded role checks)
 *   - Immutable core — plugins EXTEND, never modify engine
 */

// ─── PLUGIN STORE ────────────────────────────────────────────────────────────
var _plugins = new Map();
var _capabilities = new Map();  // capability → Set<pluginId>
var _hooks = {};                // hookName → [{ pluginId, fn }]

/**
 * @typedef {Object} IndustryPlugin
 * @property {string} id - unique plugin identifier (e.g. 'surf-school')
 * @property {string} name - human-readable name
 * @property {string} version - semver string
 * @property {string[]} capabilities - what this plugin can do
 * @property {Object} [hooks] - lifecycle hooks { onActivate, onDeactivate, onSessionStart, etc. }
 * @property {Object} [config] - plugin-specific configuration
 * @property {function} [init] - called on registration
 * @property {function} [destroy] - cleanup
 */

/**
 * Register an industry plugin.
 * @param {IndustryPlugin} plugin
 */
export function registerPlugin(plugin) {
  if (!plugin?.id) {
    throw new Error('[PluginRuntime] Plugin must have an id');
  }
  if (_plugins.has(plugin.id)) {
    console.warn('[PluginRuntime] Plugin already registered: ' + plugin.id);
    return;
  }

  _plugins.set(plugin.id, plugin);

  // Index capabilities
  if (plugin.capabilities) {
    plugin.capabilities.forEach(function(cap) {
      if (!_capabilities.has(cap)) _capabilities.set(cap, new Set());
      _capabilities.get(cap).add(plugin.id);
    });
  }

  // Register hooks
  if (plugin.hooks) {
    Object.keys(plugin.hooks).forEach(function(hookName) {
      if (!_hooks[hookName]) _hooks[hookName] = [];
      _hooks[hookName].push({ pluginId: plugin.id, fn: plugin.hooks[hookName] });
    });
  }

  // Call init if present
  if (plugin.init) {
    try { plugin.init(); }
    catch (e) { console.error('[PluginRuntime] Init failed for ' + plugin.id + ':', e.message); }
  }

  console.log('[PluginRuntime] Registered: ' + plugin.id + ' (caps: ' +
    (plugin.capabilities || []).join(', ') + ')');
}

/**
 * Unregister a plugin.
 * @param {string} pluginId
 */
export function unregisterPlugin(pluginId) {
  var plugin = _plugins.get(pluginId);
  if (!plugin) return;

  // Cleanup
  if (plugin.destroy) {
    try { plugin.destroy(); }
    catch (e) { console.error('[PluginRuntime] Destroy failed for ' + pluginId); }
  }

  // Remove capability index
  if (plugin.capabilities) {
    plugin.capabilities.forEach(function(cap) {
      var set = _capabilities.get(cap);
      if (set) { set.delete(pluginId); if (set.size === 0) _capabilities.delete(cap); }
    });
  }

  // Remove hooks
  Object.keys(_hooks).forEach(function(hookName) {
    _hooks[hookName] = _hooks[hookName].filter(function(h) { return h.pluginId !== pluginId; });
  });

  _plugins.delete(pluginId);
}

// ─── CAPABILITY-BASED ACCESS ─────────────────────────────────────────────────

/**
 * Check if ANY registered plugin provides a capability.
 * Use this instead of hardcoded role checks.
 * @param {string} capability
 * @returns {boolean}
 */
export function hasCapability(capability) {
  return _capabilities.has(capability) && _capabilities.get(capability).size > 0;
}

/**
 * Get all plugin IDs that provide a capability.
 * @param {string} capability
 * @returns {string[]}
 */
export function getProvidersOf(capability) {
  var set = _capabilities.get(capability);
  return set ? Array.from(set) : [];
}

// ─── HOOK EXECUTION ──────────────────────────────────────────────────────────

/**
 * Execute all registered hooks for a given event.
 * Hooks run in registration order. Errors are caught and logged.
 *
 * @param {string} hookName
 * @param {*} payload
 * @returns {*[]} array of hook return values
 */
export function executeHook(hookName, payload) {
  var handlers = _hooks[hookName];
  if (!handlers || handlers.length === 0) return [];

  var results = [];
  handlers.forEach(function(handler) {
    try {
      results.push(handler.fn(payload));
    } catch (e) {
      console.error('[PluginRuntime] Hook ' + hookName + ' failed in ' +
        handler.pluginId + ':', e.message);
      results.push(null);
    }
  });
  return results;
}

// ─── QUERY API ───────────────────────────────────────────────────────────────

/** @returns {IndustryPlugin|undefined} */
export function getPlugin(id) { return _plugins.get(id); }

/** @returns {IndustryPlugin[]} */
export function getAllPlugins() { return Array.from(_plugins.values()); }

/** @returns {string[]} all registered capabilities */
export function getAllCapabilities() { return Array.from(_capabilities.keys()); }

/** @returns {number} */
export function getPluginCount() { return _plugins.size; }

// ─── BUILT-IN CAPABILITY CONSTANTS ───────────────────────────────────────────
// Use these as capability strings in plugin definitions.

export var CAPABILITIES = {
  // Surf School capabilities
  MANAGE_STUDENTS:     'manage:students',
  SCHEDULE_LESSONS:    'schedule:lessons',
  ISSUE_CERTIFICATES:  'issue:certificates',

  // Coach capabilities
  SESSION_ANALYSIS:    'session:analysis',
  VIDEO_REVIEW:        'video:review',
  ATHLETE_TRACKING:    'athlete:tracking',

  // Brand capabilities
  PRODUCT_SHOWCASE:    'product:showcase',
  SPONSORED_CONTENT:   'sponsored:content',
  AFFILIATE_LINKS:     'affiliate:links',

  // Photographer capabilities
  PHOTO_UPLOAD:        'photo:upload',
  LIVE_CAPTURE:        'live:capture',
  ON_DEMAND_DISPATCH:  'ondemand:dispatch',

  // Spot capabilities
  CONDITION_REPORTS:   'condition:reports',
  FORECAST_DISPLAY:    'forecast:display',
  CROWD_LEVEL:         'crowd:level',

  // Weather capabilities
  WIND_OVERLAY:        'weather:wind',
  WAVE_OVERLAY:        'weather:waves',
  RADAR_OVERLAY:       'weather:radar',
};
