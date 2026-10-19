// Every place in electron/main.ts that finds a release, and what it hands to `updates.offer`.
// check-update-supersede.ts runs these with Automatic updates on and off; check-updater-bridge.ts holds main.ts to them.

/** Where main.ts finds a release, the call it makes there, and the options that call passes. */
export type EntryPoint = {
  from: string;
  to: string;
  call: string;
  options: { announce?: boolean; bypassRollout?: boolean; asked?: boolean };
};

export const CHECKS: Record<string, EntryPoint> = {
  "the launch check, the periodic check and the tray": {
    from: "function checkForUpdatesInBackground(",
    to: "\n}\n",
    call: "offerRelease(release, { announce: true })",
    options: { announce: true },
  },
  "Gryt started at login": {
    from: "initBackgroundUpdater(true);",
    to: "} else {",
    call: "offerRelease(pin.release)",
    options: {},
  },
  "Check for Updates in Settings": {
    from: '"check-for-updates",',
    to: '"download-update"',
    call: "offerRelease(pin.release, { bypassRollout: true, asked: updatesAreManagedByWindows })",
    options: { bypassRollout: true },
  },
};

// Download now in the toast, an install button with nothing downloaded yet, and the
// Built-in server switch, which is asking for the other build.
export const PRESSES: Record<string, EntryPoint> = {
  "download now, or install with nothing downloaded": {
    from: "function downloadAnnouncedRelease(",
    to: "\n}\n",
    call: "offerRelease(release, { bypassRollout: true, asked: true, installWhenReady })",
    options: { bypassRollout: true, asked: true },
  },
  "the Built-in server switch": {
    from: '"set-slim-variant",',
    to: '"get-beta-channel"',
    call: "offerRelease(pin.release, { bypassRollout: true, asked: true })",
    options: { bypassRollout: true, asked: true },
  },
};
