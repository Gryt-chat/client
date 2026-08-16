import { Alert, Avatar, Button, Chip, Dialog, IconButton, Surface, TextField } from "@gryt/ui";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import {
  PiBroadcastFill,
  PiCaretRightBold,
  PiHouseFill,
  PiInfoFill,
  PiWarningFill,
  PiX,
} from "react-icons/pi";

import {
  GeneratedServerIcon,
  getServerHttpBase,
  normalizeCode,
  parseServerInput,
} from "@/common";

import { SkeletonBase } from "../../../socket/src/components/skeletons";
import { useServerManagement } from "../../../socket/src/hooks/useServerManagement";
import { useEmbeddedServer } from "../hooks/useEmbeddedServer";
import { useLanDiscovery } from "../hooks/useLanDiscovery";
import {
  type FetchInfo,
  fetchServerInfo,
  useServerJoin,
} from "../hooks/useServerJoin";
import { useSettings } from "../hooks/useSettings";
import { CreateServerPanel } from "./createServer";

export type { FetchInfo };

interface AddNewServerProps {
  showAddServer: boolean;
  setShowAddServer: (show: boolean) => void;
}

/**
 * How long to wait after the last keystroke before asking the server about
 * itself.
 *
 * The preview fetches on paste rather than on a button, which means it also
 * fetches on every character somebody types by hand. Long enough that typing an
 * address does not fire a request per letter, short enough that a paste — the
 * case this is built for — feels immediate.
 */
const LOOKUP_DEBOUNCE_MS = 450;

/**
 * What an invite looks like, for the three chips under the field.
 *
 * Kept as literal examples rather than a description of the format. "An invite
 * link or a server address" tells somebody nothing about whether the thing on
 * their clipboard is one.
 */
const WEB_INPUT_EXAMPLES = [
  "gryt.chat/invite?host=…",
  "chat.example.com",
  "localhost:5001",
];

const DESKTOP_INPUT_EXAMPLES = [
  ...WEB_INPUT_EXAMPLES,
  "192.168.1.42:5001",
];

function isIpv4Host(host: string): boolean {
  const hostname = host.replace(/:\d+$/, "");

  const parts = hostname.split(".");
  if (parts.length !== 4) return false;

  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;

    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}

function isLocalhostHost(host: string): boolean {
  const hostname = host.replace(/:\d+$/, "").toLowerCase();

  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

export function AddNewServer({
  showAddServer,
  setShowAddServer,
}: AddNewServerProps) {
  const { servers, switchToServer, setShowDiscovery, addServer } =
    useServerManagement();
  const { isElectron } = useLanDiscovery();

  const inputExamples = isElectron
    ? DESKTOP_INPUT_EXAMPLES
    : WEB_INPUT_EXAMPLES;

  const { openSettings } = useSettings();
  const { isAvailable: embeddedServerAvailable, servers: hostedServers } =
    useEmbeddedServer();
  /**
   * Whether this machine already hosts anything.
   *
   * Only decides how the first row is worded now. It used to decide whether the
   * create step was reachable at all, because there could be one server and no
   * more — so having one meant there was nothing left to create. There is now.
   */
  const hasOwnServer = hostedServers.length > 0;
  const { join, joiningHost } = useServerJoin();

  /**
   * Which errand this dialog is on. Null means the choice has not been made.
   *
   * In a browser there is no embedded server to host with, so offering the
   * choice would be offering one real option and one dead end — `step` sends
   * those straight to Join.
   */
  const [mode, setMode] = useState<"host" | "join" | null>(null);
  const step = embeddedServerAvailable ? mode : "join";

  /** Exactly what was pasted, before anything is read out of it. */
  const [inviteInput, setInviteInput] = useState("");
  const parsed = useMemo(() => parseServerInput(inviteInput), [inviteInput]);
  const serverHost = parsed.host;

  const webAddressError = useMemo(() => {
    if (isElectron || !serverHost) return "";

    // localhost is the browser's one useful exception: browsers allow local
    // development/access without a publicly trusted HTTPS domain.
    if (isLocalhostHost(serverHost)) return "";

    if (isIpv4Host(serverHost)) {
      return "The web client can only connect to servers over HTTPS. Use a domain with TLS, or use localhost on this machine.";
    }

    return "";
  }, [isElectron, serverHost]);

  const [serverInfo, setServerInfo] = useState<FetchInfo | null>(null);
  /** Public info is switched off. A code can still get you in. */
  const [serverPrivate, setServerPrivate] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  /** A code typed by hand, when the link carried none or carried a bad one. */
  const [manualCode, setManualCode] = useState("");
  const [inviteRequired, setInviteRequired] = useState(false);
  const [joinNote, setJoinNote] = useState("");
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [joinError, setJoinError] = useState("");

  const isJoining = joiningHost !== null;
  const inviteCode = manualCode || parsed.code;

  const existingServer = servers[serverHost];
  const existingById = useMemo(() => {
    if (!serverInfo?.serverId) return null;
    return (
      Object.entries(servers).find(
        ([, server]) =>
          !!server.serverId && server.serverId === serverInfo.serverId,
      ) ?? null
    );
  }, [serverInfo?.serverId, servers]);
  const alreadyMember = !!existingServer || !!existingById;

  function resetJoinState() {
    setInviteInput("");
    setServerInfo(null);
    setServerPrivate(false);
    setLookupError("");
    setIsSearching(false);
    setManualCode("");
    setInviteRequired(false);
    setJoinNote("");
    setAwaitingApproval(false);
    setJoinError("");
  }

  function closeDialog() {
    if (isJoining) return;

    setMode(null);
    resetJoinState();
    setShowAddServer(false);
  }

  /**
   * Look the server up whenever the address changes, on a timer.
   *
   * The lookup owns everything downstream of it, so this is also where all of
   * it is cleared — a preview left over from the last address is worse than an
   * empty one, because it looks like an answer.
   */
  useEffect(() => {
    setServerInfo(null);
    setServerPrivate(false);
    setLookupError("");
    setManualCode("");
    setInviteRequired(false);
    setAwaitingApproval(false);
    setJoinError("");

    if (!serverHost || webAddressError) {
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    setIsSearching(true);

    const timer = window.setTimeout(() => {
      void (async () => {
        const result = await fetchServerInfo(serverHost, controller.signal);
        if (controller.signal.aborted) return;

        if (result.kind === "info") setServerInfo(result.info);
        else if (result.kind === "private") setServerPrivate(true);
        else if (result.kind === "error") setLookupError(result.message);

        setIsSearching(false);
      })();
    }, LOOKUP_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [serverHost, webAddressError]);

  // Reopening starts from the top rather than from wherever the last visit
  // left off. Somebody who closed this halfway through joining one server is
  // not usually coming back to finish that.
  useEffect(() => {
    if (showAddServer) return;
    setMode(null);
    resetJoinState();
  }, [showAddServer]);

  useEffect(() => {
    setJoinError("");
  }, [manualCode]);

  async function handleJoin() {
    if (!serverHost || webAddressError) return;
    if (!serverInfo && !serverPrivate) return;

    setJoinError("");

    const outcome = await join({
      host: serverHost,
      info: serverInfo,
      inviteCode,
      note: joinNote,
    });

    if (outcome.ok) {
      closeDialog();
      return;
    }

    if (outcome.kind === "approval_pending") {
      // Not a failure and not something to retry — the answer comes from a
      // person, so the dialog says so and stops offering the button that would
      // just ask again.
      setAwaitingApproval(true);
      return;
    }

    if (outcome.kind === "invite_required") setInviteRequired(true);
    setJoinError(outcome.message);
  }

  function openDiscovery() {
    setShowDiscovery(true);
    closeDialog();
  }

  function openMyServers() {
    closeDialog();
    openSettings("my-servers");
  }

  const canJoin =
    !!serverHost &&
    !alreadyMember &&
    !isSearching &&
    !isJoining &&
    !awaitingApproval &&
    !webAddressError &&
    (!!serverInfo || serverPrivate) &&
    (!inviteRequired || normalizeCode(inviteCode).length > 0);

  return (
    <Dialog.Root
      open={showAddServer}
      /* Same as the settings dialog: a coach mark is not "outside" in any
         sense the user cares about, and dismissing this on a Next click made
         the tour's last step close the thing it had just opened.

         Radix expressed this as onInteractOutside + preventDefault; Base UI
         hands the reason and the event to onOpenChange and cancels there. */
      onOpenChange={(open, details) => {
        if (open) return;

        const target = details.event?.target as HTMLElement | null;
        if (target?.closest?.('[data-gryt="tour"]')) {
          details.cancel();
          return;
        }

        closeDialog();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[30rem] max-w-[calc(100vw-2rem)] overflow-hidden">
            {/* Positioned by a wrapper rather than by a class on either the
                Close or the IconButton. Close renders *as* the IconButton, and
                the className does not survive that clone in either position —
                the button was dropping into normal flow at the top left of the
                content. */}
            <div className="absolute top-2 right-2 z-10">
              <Dialog.Close
                render={
                  <IconButton aria-label="Close" />
                }
              >
                <PiX size={16} />
              </Dialog.Close>
            </div>

            {/* m-0 on both, and it is not tidying. Tailwind's preflight is off
                in this app — Radix Themes ships its own reset and two resets
                fight — and that reset only covers elements Radix renders. A
                raw <h2>/<p> keeps the browser's 1em margins, which is where
                the gap under the title came from. */}
            <div className="flex flex-col gap-1 items-center">
              <Dialog.Title className="m-0 text-xl font-bold">
                {step === "host"
                  ? "Create your server"
                  : step === "join"
                    ? "Join a server"
                    : "Add a server"}
              </Dialog.Title>

              <Dialog.Description className="m-0 text-center text-sm">
                {step === "host"
                  ? "It runs on this machine, and your friends connect to you."
                  : step === "join"
                    ? isElectron
                      ? "Paste the invite a friend sent you, or the address of a server you already know."
                      : "Paste an invite, or enter the HTTPS address of a server you already know."
                    : "Start one of your own, or join somebody else's."}
              </Dialog.Description>
            </div>

            {/* Step one. A single row, because there is one thing to create and
                Gryt has no templates to offer under it. */}
            {step === null && (
              <div className="flex flex-col gap-6 mt-2">
                {/* Surface is a plain div with no asChild, and a box that only
                    looks clickable wrapping a button is worse than the button
                    wearing the surface itself. */}
                <button
                  type="button"
                  data-tour="choose-host"
                  className="rounded-(--gryt-radius-lg) border border-gryt-border bg-gryt-surface text-gryt-text w-full cursor-pointer p-4 text-left"
                  onClick={() => setMode("host")}
                >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center" style={{
                          width: 36,
                          height: 36,
                          borderRadius: "var(--gryt-radius-md)",
                          background: "var(--gryt-accent-a3)",
                          color: "var(--gryt-accent-11)",
                          flexShrink: 0,
                        }}>
                        <PiHouseFill size={18} />
                      </div>

                      <div className="flex flex-col gap-0" style={{ minWidth: 0 }}>
                        <span className="text-base font-bold">
                          {hasOwnServer ? "Create another" : "Create my own"}
                        </span>
                        <span className="text-sm">
                          Runs on this machine. Best for a few friends.
                        </span>
                      </div>

                      <div className="flex ml-auto" style={{ color: "var(--gryt-neutral-9)" }}>
                        <PiCaretRightBold size={14} />
                      </div>
                    </div>
                </button>

                {/* Only once there is something to manage. Creating and
                    managing are different jobs and this dialog is for the
                    first, but somebody who already hosts one and came here
                    looking for the other should not have to guess. */}
                {hasOwnServer && (
                  <span className="text-xs text-center -mt-3">
                    Already running{" "}
                    {hostedServers.length === 1
                      ? "one"
                      : `${hostedServers.length}`}
                    .{" "}
                    <button
                      type="button"
                      onClick={openMyServers}
                      className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-inherit underline"
                    >
                      Manage in settings
                    </button>
                  </span>
                )}

                {/* The other half of the dialog, and deliberately not a second
                    card of equal weight. Most people arriving here have an
                    invite in their clipboard, but "create" is the thing this
                    step is named after — so joining gets its own line rather
                    than competing for the same row. */}
                <div className="flex flex-col gap-2 items-center">
                  <span className="text-sm font-bold">
                    Have an invite already?
                  </span>
                  <Button
                    data-tour="choose-join"
                    size="medium"
                    style={{ width: "100%" }}
                    onClick={() => setMode("join")}
                  >
                    Join a server
                  </Button>
                </div>
              </div>
            )}

            {step === "host" && embeddedServerAvailable && (
              <CreateServerPanel
                onBack={() => setMode(null)}
                onServerReady={(serverUrl, serverName) => {
                  const { host } = parseServerInput(serverUrl);

                  if (servers[host]) {
                    switchToServer(host);
                    closeDialog();
                    return;
                  }

                  addServer({ name: serverName, host }, true);
                  closeDialog();
                }}
              />
            )}

            {step === "join" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2" data-tour="join-address">
                  <span className="text-sm font-bold">
                    Invite or server address{" "}
                    <span>
                      *
                    </span>
                  </span>

                  <TextField
                    autoFocus
                    disabled={isJoining}
                    placeholder="https://gryt.chat/invite?host=…&code=…"
                    value={inviteInput}
                    onChange={(e) => setInviteInput(e.target.value)}
                  />

                  <div className="flex flex-col gap-1">
                    <span className="text-xs">
                      Examples
                    </span>
                    <div className="flex gap-1 flex-wrap">
                      {inputExamples.map((example) => (
                        <Chip key={example}>
                          {example}
                        </Chip>
                      ))}
                    </div>
                  </div>
                </div>

                {/* The preview, and it stays a preview. There used to be a
                    details card between pasting and joining, which is a whole
                    screen spent confirming something the name alone settles. */}
                <AnimatePresence>
                  {serverHost.length > 0 && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      style={{ overflow: "hidden" }}
                    >
                      <ServerPreview
                        host={serverHost}
                        info={serverInfo}
                        loading={isSearching}
                        error={webAddressError || lookupError}
                        privateInfo={serverPrivate}
                        alreadyMember={alreadyMember}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {inviteRequired && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      style={{ overflow: "hidden" }}
                    >
                      <div className="flex flex-col gap-2">
                        <span className="text-sm font-bold">
                          Invite code
                        </span>
                        <TextField
                          disabled={isJoining}
                          placeholder="Paste invite code"
                          value={inviteCode}
                          onChange={(e) =>
                            setManualCode(normalizeCode(e.target.value))
                          }
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {serverInfo?.joinPolicy === "request" && !awaitingApproval && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      style={{ overflow: "hidden" }}
                    >
                      <div className="flex flex-col gap-2">
                        <span className="text-sm font-bold">
                          Anything to say?
                        </span>
                        <span className="text-xs">
                          This server lets people in by hand. A line about who
                          you are gives them something to go on — a nickname on
                          its own does not.
                        </span>
                        <TextField
                          disabled={isJoining}
                          placeholder="Optional"
                          maxLength={300}
                          value={joinNote}
                          onChange={(e) => setJoinNote(e.target.value)}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {awaitingApproval && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      style={{ overflow: "hidden" }}
                    >
                      <Alert severity="info">
                        Asked. Somebody who runs this server has to let you in
                        — once they do, adding it again will work.
                      </Alert>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {joinError.length > 0 && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      style={{ overflow: "hidden" }}
                    >
                      <Alert severity="error" role="alert">
                        <span className="inline-flex items-center gap-2">
                          <PiWarningFill size={16} />
                          {joinError}
                        </span>
                      </Alert>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Discovery lives in the rail now (GRYT-223), not stacked in
                    this column fighting the field for the same space. This row
                    is the way back to it for somebody who came here looking for
                    a server on their own network. */}
                {isElectron && (
                  <button
                    type="button"
                    className="rounded-(--gryt-radius-lg) border border-gryt-border bg-gryt-surface text-gryt-text w-full cursor-pointer p-3 text-left"
                    onClick={openDiscovery}
                  >
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center" style={{
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            background: "color-mix(in oklab, var(--gryt-success-9) 7%, transparent)",
                            color: "var(--gryt-success-11)",
                            flexShrink: 0,
                          }}>
                          <PiBroadcastFill size={14} />
                        </div>

                        <div className="flex flex-col" style={{ minWidth: 0 }}>
                          <span className="text-sm font-bold">
                            Don&rsquo;t have an invite?
                          </span>
                          <span className="text-xs">
                            Look for servers running on your network.
                          </span>
                        </div>

                        <div className="flex ml-auto" style={{ color: "var(--gryt-neutral-9)" }}>
                          <PiCaretRightBold size={14} />
                        </div>
                    </div>
                  </button>
                )}

                <Dialog.Footer className="justify-between">
                  {/* Only offered when there is a step behind this one. In a
                      browser Join *is* the first step, and a Back that lands on
                      a choice between one real option and a dead end is worse
                      than no Back. */}
                  {embeddedServerAvailable ? (
                    <Button
                      tone="ghost"
                      disabled={isJoining}
                      onClick={() => setMode(null)}
                    >
                      Back
                    </Button>
                  ) : (
                    <span />
                  )}

                  <Button
                    disabled={!canJoin}
                    onClick={() => {
                      void handleJoin();
                    }}
                  >
                    {alreadyMember ? (
                      "Already joined"
                    ) : isJoining ? (
                      <>
                        <SkeletonBase
                          width="16px"
                          height="16px"
                          borderRadius="50%"
                        />{" "}
                        Joining…
                      </>
                    ) : (
                      "Join server"
                    )}
                  </Button>
                </Dialog.Footer>
              </div>
            )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ServerPreviewProps {
  host: string;
  info: FetchInfo | null;
  loading: boolean;
  error: string;
  privateInfo: boolean;
  alreadyMember: boolean;
}

/**
 * The flat one-line preview that replaced the details card.
 *
 * Its height is the point of it: enough to tell you the address resolved to
 * the server you were expecting, and not enough to feel like a screen you have
 * to get through. Everything the old card carried that this drops — the
 * description, the join policy — is on the other side of the join anyway.
 */
function ServerPreview({
  host,
  info,
  loading,
  error,
  privateInfo,
  alreadyMember,
}: ServerPreviewProps) {
  return (
    <Surface className="p-3">
      <div className="flex items-center gap-3">
        {/* Seeded on the address until /info answers, and on the name from then
            on — so the planet in the preview is the one the rail will draw once
            you have joined, rather than a different one you never see again. */}
        <Avatar
          size="small"
          className="rounded-(--gryt-radius-md)"
          src={info ? `${getServerHttpBase(host)}/icon` : undefined}
          fallback={<GeneratedServerIcon seed={info?.name || host} />}
        />

        <div className="flex flex-col" style={{ minWidth: 0 }}>
          {loading ? (
            <SkeletonBase width="8rem" height="1rem" />
          ) : (
            <span className="text-sm font-bold truncate">
              {info?.name || host}
            </span>
          )}

          {loading ? (
            <SkeletonBase width="5rem" height="0.75rem" />
          ) : error ? (
            <span className="text-xs">
              {error}
            </span>
          ) : privateInfo ? (
            <span className="text-xs">
              Public info is off. An invite code can still get you in.
            </span>
          ) : (
            <span className="text-xs truncate">
              {info
                ? `${info.members} ${info.members === "1" ? "member" : "members"} · ${host}`
                : host}
            </span>
          )}
        </div>

        <div className="flex gap-2 items-center ml-auto">
          {alreadyMember && (
            <Chip>
              <PiInfoFill size={12} />
              Joined
            </Chip>
          )}
          {/*
            The thing people actually want to know before joining: whether this
            costs them an account. Only claimed when the server said so — an
            older one sends no tiers, and silence is better than a guess that
            turns into a refusal.
          */}
          {info?.identityTiers && !alreadyMember && (
            <Chip
              color={info.identityTiers.includes("local") ? "green" : "gray"}
            >
              {info.identityTiers.includes("local")
                ? "No account needed"
                : "Account required"}
            </Chip>
          )}
        </div>
      </div>
    </Surface>
  );
}
