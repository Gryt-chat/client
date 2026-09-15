/**
 * The update this run holds, downloading or downloaded, and which one an install lands on.
 * A newer release replaces it, in the background or at the press (GRYT-1213).
 */

import semver from "semver";

export type UpdateRelease = { tag: string; version: string };

/** What electron-updater's checkForUpdates resolves to, as far as its download goes. */
export type UpdateCheck = {
  downloadPromise?: Promise<unknown> | null;
  cancellationToken?: { cancel(): void };
} | null;

export type DownloadOptions = {
  bypassRollout?: boolean;
  /** Raise the toast once the download starts. */
  announce?: boolean;
  /** Install was pressed, so this installs as soon as it lands. */
  installWhenReady?: boolean;
};

export type PendingUpdateDeps = {
  /** Pins the feed to the release and runs the check that downloads it. */
  startDownload(release: UpdateRelease, options: DownloadOptions): Promise<UpdateCheck>;
  /** The newest installable release above `floor`, or null when there is none. */
  findNewer(floor: string): Promise<UpdateRelease | null>;
  /** Hands the downloaded update to the installer. */
  install(): void;
  /** Squirrel.Mac stages a download after electron-updater reports it, and installs what it staged. */
  waitForStaging: boolean;
  /** How long a press waits for the lookup before installing what is downloaded. */
  lookupTimeoutMs: number;
  log(message: string): void;
  setTimeout?(run: () => void, ms: number): unknown;
};

/** After a check ends without a download: the older one installs, is still there, or nothing is. */
export type CheckOutcome =
  | { kind: "installing" }
  | { kind: "kept"; version: string }
  | { kind: "none"; announced: boolean };

export type InstallRequest = "looking" | "downloading" | "installing" | "nothing";

type Downloading = { version: string; announce: boolean; installWhenReady: boolean };

const noop = () => {};

export function createPendingUpdate(deps: PendingUpdateDeps) {
  const later = deps.setTimeout ?? ((run: () => void, ms: number) => setTimeout(run, ms));

  let downloading: Downloading | null = null;
  let downloaded: string | null = null;
  /** A newer release waiting for the download slot, which electron-updater has one of. */
  let wanted: { release: UpdateRelease; options: DownloadOptions } | null = null;
  let slot: Promise<void> | null = null;
  let cancelSlot: (() => void) | null = null;
  let driving = false;
  let looking = false;
  /** Downloads handed to Squirrel that it has not finished staging. */
  let stagesRunning = 0;
  let installWhenStaged = false;
  let installing = false;

  const heldVersion = () => wanted?.release.version ?? downloading?.version ?? downloaded;

  function held() {
    const version = heldVersion();
    if (!version) return null;

    return {
      version,
      downloaded: !wanted && !downloading,
      installWhenReady: Boolean(wanted?.options.installWhenReady || downloading?.installWhenReady),
    };
  }

  /** The download that would install right now, if nothing newer is on its way. */
  const ready = () => (wanted || downloading ? null : downloaded);

  const installPending = () => looking || installWhenStaged || installing;

  /** Busy until the check and its download settle: a check started sooner gets the old download back. */
  function occupy(check: Promise<UpdateCheck>, record: Downloading | null): void {
    const settled: Promise<void> = check
      .then(
        (result) => {
          const download = result?.downloadPromise;
          if (!download) {
            if (record && downloading === record) notAvailable();
            return;
          }

          const token = result?.cancellationToken;
          if (slot === settled) cancelSlot = token ? () => token.cancel() : null;
          if (wanted) token?.cancel();

          return download.then(noop, noop);
        },
        () => {
          if (record && downloading === record) failed();
        },
      )
      .then(() => {
        if (slot !== settled) return;
        slot = null;
        cancelSlot = null;
      });

    slot = settled;
  }

  async function drive(): Promise<void> {
    driving = true;

    while (wanted) {
      if (slot) {
        cancelSlot?.();
        await slot;
        continue;
      }

      const { release, options } = wanted;
      wanted = null;

      const record: Downloading = {
        version: release.version,
        announce: Boolean(options.announce),
        installWhenReady: Boolean(options.installWhenReady),
      };
      downloading = record;

      deps.log(`Update: downloading ${release.version}`);
      occupy(Promise.resolve().then(() => deps.startDownload(release, options)), record);
    }

    driving = false;
  }

  /** Fetch `release` in place of whatever is held. Anything not newer than that is left alone. */
  function offer(release: UpdateRelease, options: DownloadOptions = {}): boolean {
    if (installing) return false;

    const floor = heldVersion();
    if (floor && !semver.gt(release.version, floor)) return false;

    const installWhenReady = Boolean(
      options.installWhenReady ||
        wanted?.options.installWhenReady ||
        downloading?.installWhenReady ||
        installWhenStaged,
    );
    installWhenStaged = false;

    if (downloading || downloaded) {
      deps.log(`Update: ${release.version} replaces ${floor}`);
    }

    wanted = { release, options: { ...options, installWhenReady } };
    if (!driving) void drive();
    return true;
  }

  function installNow(): void {
    if (installing) return;

    if (wanted) {
      wanted.options.installWhenReady = true;
      return;
    }
    if (downloading) {
      downloading.installWhenReady = true;
      return;
    }
    if (!downloaded) return;

    if (deps.waitForStaging && stagesRunning > 0) {
      installWhenStaged = true;
      return;
    }

    installWhenStaged = false;
    installing = true;
    deps.install();
  }

  /** A press: look once more, and install either the newer release or what is downloaded. */
  function requestInstall(): InstallRequest {
    if (installing || installWhenStaged) return "installing";
    if (looking) return "looking";

    if (wanted || downloading) {
      installNow();
      return "downloading";
    }
    if (!downloaded) return "nothing";

    looking = true;
    const floor = downloaded;
    let answered = false;

    const answer = (release: UpdateRelease | null) => {
      if (answered) return;
      answered = true;
      looking = false;

      const newer = release && semver.gt(release.version, floor) ? release : null;
      if (newer && offer(newer, { bypassRollout: true, announce: true, installWhenReady: true })) {
        return;
      }
      installNow();
    };

    later(() => {
      if (answered) return;
      deps.log(`Update: no answer in ${deps.lookupTimeoutMs}ms, installing ${floor}`);
      answer(null);
    }, deps.lookupTimeoutMs);

    deps.findNewer(floor).then(answer, (err: unknown) => {
      deps.log(`Update: lookup before installing failed: ${String(err)}`);
      answer(null);
    });

    return "looking";
  }

  /** A check nobody offered, like the pressed one in Settings: its download can be replaced too. */
  function track(result: UpdateCheck): UpdateCheck {
    if (!slot) occupy(Promise.resolve(result), downloading);
    return result;
  }

  function available(version: string) {
    if (!downloading) downloading = { version, announce: false, installWhenReady: false };
    downloading.version = version;

    /* electron-updater clears the older file as this download starts. */
    downloaded = null;

    return { announce: downloading.announce, installWhenReady: downloading.installWhenReady };
  }

  function downloadedEvent(version: string): "installing" | "ready" {
    const record = downloading;
    downloading = null;
    downloaded = version;
    if (deps.waitForStaging) stagesRunning += 1;

    if (!record?.installWhenReady || wanted) return "ready";

    installNow();
    return "installing";
  }

  /** Ended with no download: held back by the rollout, or the check failed before one began. */
  function settleWithoutDownload(): CheckOutcome {
    const record = downloading;
    downloading = null;

    if (record && downloaded) {
      if (!record.installWhenReady) return { kind: "kept", version: downloaded };
      installNow();
      return { kind: "installing" };
    }

    return { kind: "none", announced: Boolean(record?.announce) };
  }

  function notAvailable(): CheckOutcome {
    return settleWithoutDownload();
  }

  function failed(): CheckOutcome {
    if (installing || installWhenStaged) {
      installing = false;
      installWhenStaged = false;
      downloaded = null;
      return { kind: "none", announced: false };
    }

    return settleWithoutDownload();
  }

  /** Squirrel finished staging a download, or gave up on it. */
  function staged(ok: boolean): void {
    stagesRunning = Math.max(0, stagesRunning - 1);
    if (!installWhenStaged) return;

    if (!ok) {
      installWhenStaged = false;
      downloaded = null;
      return;
    }

    if (stagesRunning === 0) installNow();
  }

  return {
    held,
    ready,
    installPending,
    offer,
    requestInstall,
    track,
    available,
    downloaded: downloadedEvent,
    notAvailable,
    failed,
    staged,
  };
}

export type PendingUpdate = ReturnType<typeof createPendingUpdate>;
