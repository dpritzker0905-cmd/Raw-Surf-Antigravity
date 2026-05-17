export var WindConfig = {
  domainSource: "FULL_MODEL_GRID_WORLDSPACE",
  useViewportBounds: false
};

export var GPUWindLayerConfig = {
  initOnce: true,
  allowReinit: false
};

export var MarineConfig = {
  allowRecreateSource: false,
  allowNullState: false
};

export var RasterConfig = {
  silentSkip: false
};

export var AccessConfig = {
  failFast: true,
  allowFallback: false
};

export var TruthEngineConfig = {
  mode: "POST_RENDER_ONLY",
  canBlockRender: false
};

export function HARD_RESET_GIS_ENGINE() {
  // 🌐 WIND RESET
  WindConfig.domainSource = "FULL_MODEL_GRID_WORLDSPACE";
  WindConfig.useViewportBounds = false;

  GPUWindLayerConfig.initOnce = true;
  GPUWindLayerConfig.allowReinit = false;

  // 🌊 MARINE RESET
  MarineConfig.allowRecreateSource = false;
  MarineConfig.allowNullState = false;

  // 🌧️ RASTER RESET
  RasterConfig.silentSkip = false;

  // 🔐 ACCESS RESET
  AccessConfig.failFast = true;
  AccessConfig.allowFallback = false;

  // 🧠 TRUTH RESET
  TruthEngineConfig.mode = "POST_RENDER_ONLY";
  TruthEngineConfig.canBlockRender = false;

  console.log("[LRCM] HARD RESET COMPLETE");
}
