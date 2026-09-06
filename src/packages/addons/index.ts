export type { AddonCapability } from "./src/capabilities";
export {
  ADDON_CAPABILITIES,
  addonMay,
  CAPABILITY_LABELS,
  declaredCapabilities,
  grantedCapabilities,
  pruneGrants,
  setGrantedCapabilities,
} from "./src/capabilities";
export type { GrytPluginAPI } from "./src/pluginApi";
export {
  initPluginApi,
  setPluginApiActivitySetter,
  updatePluginApiCapabilities,
  updatePluginApiTheme,
} from "./src/pluginApi";
export type { AddonManifest, AddonUpdate } from "./src/types";
export { useAddonLoader } from "./src/useAddonLoader";
export type { AddonsState } from "./src/useAddons";
export { useAddons } from "./src/useAddons";
