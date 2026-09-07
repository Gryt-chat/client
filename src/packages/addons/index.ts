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
export {
  deliverPluginMessage,
  runningPlugins,
  setPluginApiActivitySetter,
  setPluginApiMessageSender,
  setPluginHostTheme,
  setPluginHostVersion,
  startPlugin,
  stopAllPlugins,
  stopPlugin,
} from "./src/pluginHost";
export type { AnnouncedPlugin, PluginMessage } from "./src/pluginMessages";
export {
  dropListeners as dropPluginApiListeners,
  forgetAnnouncedPlugins,
  pluginsOn,
  setAnnouncedPlugins,
} from "./src/pluginMessages";
export type { ShownPanel } from "./src/pluginPanels";
export { shownPanels, subscribePanels } from "./src/pluginPanels";
export type { AddonManifest, AddonUpdate } from "./src/types";
export { useAddonLoader } from "./src/useAddonLoader";
export type { AddonsState } from "./src/useAddons";
export { useAddons } from "./src/useAddons";
export type { PluginPanel, PluginPanelRow, ThemeInfo } from "./src/workerProtocol";
