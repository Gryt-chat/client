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
