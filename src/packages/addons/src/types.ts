export interface AddonManifest {
  id: string;
  name: string;
  version: string;
  type: "plugin" | "theme";
  description?: string;
  author?: string;
  banner?: string;
  /** Theme-only: CSS files to inject */
  styles?: string[];
  /** Plugin-only: JS entry point */
  main?: string;
  /** Plugin-only: if true, disabling the addon reloads the client */
  requiresReloadOnDisable?: boolean;
}
