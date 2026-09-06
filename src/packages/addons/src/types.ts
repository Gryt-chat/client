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
   * Plugin-only: what it says it needs to do (GRYT-928).
   *
   * Declared here and agreed to per addon before `window.gryt` will answer.
   * **Not a sandbox** — see `capabilities.ts` for what this does and does not
   * buy. A plugin runs in the app's own page and could go around it.
   *
   * Unknown names are dropped rather than refused, so a manifest written
   * against a newer Gryt still loads on an older one.
   */
  capabilities?: string[];
  /**
   * Where the addon is published, as `owner/repo` on GitHub.
   *
   * Optional. An addon without it never reports an update, which is the right
   * default for one somebody wrote for themselves and dropped in the folder.
   *
   * Not free-form: this string decides what gets fetched, so a manifest whose
   * repository is anything other than two plain path segments is rejected when
   * it is read rather than when it is used.
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
