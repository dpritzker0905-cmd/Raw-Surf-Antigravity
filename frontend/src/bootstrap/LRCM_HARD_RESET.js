export const WindConfig = {
  domainSource: "FULL_MODEL_GRID_WORLDSPACE",
  useViewportBounds: false
};

export const GPUWindLayerConfig = {
  initOnce: true,
  allowReinit: false
};

export const MarineConfig = {
  allowRecreateSource: false,
  allowNullState: false
};

export const RasterConfig = {
  silentSkip: false
};

export const AccessConfig = {
  failFast: true,
  allowFallback: false
};

export const TruthEngineConfig = {
  mode: "POST_RENDER_ONLY",
  canBlockRender: false
};

export function HARD_RESET_GIS_ENGINE() {
 // = WIND RESET
  WindConfig.domainSource = "FULL_MODEL_GRID_WORLDSPACE";
  WindConfig.useViewportBounds = false;

  GPUWindLayerConfig.initOnce = true;
  GPUWindLayerConfig.allowReinit = false;

 // = MARINE RESET
  MarineConfig.allowRecreateSource = false;
  MarineConfig.allowNullState = false;

 // =n+ RASTER RESET
  RasterConfig.silentSkip = false;

 // = ACCESS RESET
  AccessConfig.failFast = true;
  AccessConfig.allowFallback = false;

 // = TRUTH RESET
  TruthEngineConfig.mode = "POST_RENDER_ONLY";
  TruthEngineConfig.canBlockRender = false;

  console.log("[LRCM] HARD RESET COMPLETE");
}
