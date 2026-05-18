/*
====================================================
 Raw Surf OS Industry Plugin SDK
 SURF ECOSYSTEM OPERATING SYSTEM LAYER
====================================================

NO engine coupling
NO UI coupling
PURE contract system
var/function only (TDZ-immune)
====================================================
*/

// ROLE DEFINITIONS 

var INDUSTRY_ROLES = {
  SURFER:             'surfer',
  PHOTOGRAPHER:       'photographer',
  GROM:               'grom',
  ADMIN:              'admin',
  SURF_SCHOOL:        'surf-school',
  SURF_COACH:         'surf-coach',
  SURF_BRAND:         'surf-brand',
  SURF_SHAPER:        'surf-shaper',
  WAVE_POOL_OPERATOR: 'wave-pool-operator',
  EVENT_ORGANIZER:    'event-organizer',
  SURF_TRIP_OPERATOR: 'surf-trip-operator',
  COMPETITION_JUDGE:  'competition-judge',
};

// SERVICE FLAGS 

var SERVICE_FLAGS = {
  BOOKINGS: 'bookings',
  MEDIA:    'media',
  MAP:      'map',
  SOCIAL:   'social',
};

// PLUGIN STORE 

var _sdkPlugins = new Map();

/**
 * Register an industry plugin.
 *
 * @param {{
 *   id: string,
 *   role: string,
 *   identity: { name: string, description?: string },
 *   permissions: string[],
 *   capabilities: string[],
 *   services: Object,
 *   hooks?: { onRegister?: function, onBooking?: function, onMediaAccess?: function, onMapRender?: function }
 * }} plugin
 */
function registerIndustryPlugin(plugin) {
  if (!plugin?.id) {
    console.error('[PluginSDK] Plugin must have an id');
    return;
  }
  if (_sdkPlugins.has(plugin.id)) {
    console.warn('[PluginSDK] Already registered: ' + plugin.id);
    return;
  }
  _sdkPlugins.set(plugin.id, plugin);
  if (plugin.hooks?.onRegister) {
    try { plugin.hooks.onRegister(); }
    catch (e) { console.error('[PluginSDK] onRegister failed for ' + plugin.id + ':', e.message); }
  }
  console.log('[PluginSDK] Registered: ' + plugin.id + ' (role: ' + plugin.role + ')');
}

/**
 * @param {string} id
 * @returns {Object|undefined}
 */
function getIndustryPlugin(id) {
  return _sdkPlugins.get(id);
}

/** @returns {Array} all registered plugins */
function getAllIndustryPlugins() {
  return Array.from(_sdkPlugins.values());
}

/**
 * Get all plugins for a specific role.
 * @param {string} role
 * @returns {Array}
 */
function getPluginsByRole(role) {
  var result = [];
  _sdkPlugins.forEach(function(plugin) {
    if (plugin.role === role) result.push(plugin);
  });
  return result;
}

/**
 * Check if a plugin has a specific service enabled.
 * @param {string} pluginId
 * @param {string} service
 * @returns {boolean}
 */
function hasService(pluginId, service) {
  var plugin = _sdkPlugins.get(pluginId);
  return plugin?.services?.[service] === true;
}

/**
 * Execute a hook on a specific plugin.
 * @param {string} pluginId
 * @param {string} hookName
 * @param {*} data
 */
function executePluginHook(pluginId, hookName, data) {
  var plugin = _sdkPlugins.get(pluginId);
  if (!plugin?.hooks?.[hookName]) return;
  try { plugin.hooks[hookName](data); }
  catch (e) { console.error('[PluginSDK] Hook ' + hookName + ' failed for ' + pluginId); }
}

/**
 * Broadcast a hook to ALL registered plugins.
 * @param {string} hookName
 * @param {*} data
 */
function broadcastHook(hookName, data) {
  _sdkPlugins.forEach(function(plugin) {
    if (plugin.hooks?.[hookName]) {
      try { plugin.hooks[hookName](data); }
      catch (e) { /* swallow per-plugin errors */ }
    }
  });
}

/** @param {string} id */
function unregisterIndustryPlugin(id) {
  _sdkPlugins.delete(id);
}

/** @returns {number} */
function getIndustryPluginCount() {
  return _sdkPlugins.size;
}

export {
  INDUSTRY_ROLES,
  SERVICE_FLAGS,
  registerIndustryPlugin,
  getIndustryPlugin,
  getAllIndustryPlugins,
  getPluginsByRole,
  hasService,
  executePluginHook,
  broadcastHook,
  unregisterIndustryPlugin,
  getIndustryPluginCount,
};
