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
  /**
   * Plugin-only: what it says it needs to do. Agreed to per addon before
   * `window.gryt` will answer; unknown names are dropped, not refused (GRYT-928).
   */
  capabilities?: string[];
  /**
   * Where the addon is published, as `owner/repo` on GitHub. Optional, and not
   * free-form: anything but two plain path segments is rejected when it is read.
   */
  repository?: string;
}

/** What an addon's repository says, against what is installed. */
export interface AddonUpdate {
  addonId: string;
  /** The version in the installed manifest. */
  installed: string;
  /** The newest release tag, with any leading `v` removed. */
  latest: string;
  /** The release page, for reading before updating. */
  releaseUrl: string;
}
