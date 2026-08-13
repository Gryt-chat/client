import { Alert, Avatar, Dialog, Surface, TextField } from "@gryt/ui";
import {
  Badge,
  Button,
  Flex,
  IconButton,
  Text,
  Theme,
  useThemeContext,
} from "@radix-ui/themes";
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
const INPUT_EXAMPLES = [
  "gryt.chat/invite?host=…",
  "gryt.chat",
  "192.168.1.42:5001",
];

export function AddNewServer({
  showAddServer,
  setShowAddServer,
}: AddNewServerProps) {
  const { servers, switchToServer, setShowDiscovery, addServer } =
    useServerManagement();
  /**
   * The app's own theme values, to be re-applied inside the dialog.
   *
   * @gryt/ui's Dialog portals to document.body, which is outside the <Theme>
   * wrapper in main.tsx — and that wrapper is the only thing defining the Radix
   * variables. Portaled Radix components rendered with none of them: cards lost
   * their borders and backgrounds, avatars ignored their size and blew the
   * layout apart. Reading the values here and setting them again inside the
   * popup restores the context the portal escaped.
   */
  const theme = useThemeContext();
  const { isElectron } = useLanDiscovery();
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

    if (!serverHost) {
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
  }, [serverHost]);

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
    if (!serverHost) return;
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
          <Theme
            appearance={theme.appearance}
            accentColor={theme.accentColor}
            grayColor={theme.grayColor}
            radius={theme.radius}
            scaling={theme.scaling}
            panelBackground={theme.panelBackground}
            hasBackground={false}
          >
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
            <Flex direction="column" gap="1" align="center">
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
                    ? "Paste the invite a friend sent you, or the address of a server you already know."
                    : "Start one of your own, or join somebody else's."}
              </Dialog.Description>
            </Flex>

            {/* Step one. A single row, because there is one thing to create and
                Gryt has no templates to offer under it. */}
            {step === null && (
              <Flex direction="column" gap="5" mt="2">
                {/* Surface is a plain div with no asChild, and a box that only
                    looks clickable wrapping a button is worse than the button
                    wearing the surface itself. */}
                <button
                  type="button"
                  data-tour="choose-host"
                  className="rounded-(--gryt-radius-lg) border border-gryt-border bg-gryt-surface text-gryt-text w-full cursor-pointer p-4 text-left"
                  onClick={() => setMode("host")}
                >
                    <Flex align="center" gap="3">
                      <Flex
                        align="center"
                        justify="center"
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: "var(--radius-3)",
                          background: "var(--accent-a3)",
                          color: "var(--accent-11)",
                          flexShrink: 0,
                        }}
                      >
                        <PiHouseFill size={18} />
                      </Flex>

                      <Flex direction="column" gap="0" style={{ minWidth: 0 }}>
                        <Text size="3" weight="bold">
                          {hasOwnServer ? "Create another" : "Create my own"}
                        </Text>
                        <Text size="2">
                          Runs on this machine. Best for a few friends.
                        </Text>
                      </Flex>

                      <Flex ml="auto" style={{ color: "var(--gray-9)" }}>
                        <PiCaretRightBold size={14} />
                      </Flex>
                    </Flex>
                </button>

                {/* Only once there is something to manage. Creating and
                    managing are different jobs and this dialog is for the
                    first, but somebody who already hosts one and came here
                    looking for the other should not have to guess. */}
                {hasOwnServer && (
                  <Text size="1" align="center" mt="-3">
                    Already running{" "}
                    {hostedServers.length === 1
                      ? "one"
                      : `${hostedServers.length}`}
                    .{" "}
                    <Text
                      asChild
                      style={{ textDecoration: "underline", cursor: "pointer" }}
                    >
                      <button
                        type="button"
                        onClick={openMyServers}
                        className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-inherit underline"
                      >
                        Manage in settings
                      </button>
                    </Text>
                  </Text>
                )}

                {/* The other half of the dialog, and deliberately not a second
                    card of equal weight. Most people arriving here have an
                    invite in their clipboard, but "create" is the thing this
                    step is named after — so joining gets its own line rather
                    than competing for the same row. */}
                <Flex direction="column" gap="2" align="center">
                  <Text size="2" weight="bold">
                    Have an invite already?
                  </Text>
                  <Button
                    data-tour="choose-join"
                    size="3"
                    style={{ width: "100%" }}
                    onClick={() => setMode("join")}
                  >
                    Join a server
                  </Button>
                </Flex>
              </Flex>
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
              <Flex direction="column" gap="4">
                <Flex direction="column" gap="2" data-tour="join-address">
                  <Text size="2" weight="bold">
                    Invite link{" "}
                    <Text as="span">
                      *
                    </Text>
                  </Text>

                  <TextField
                    autoFocus
                    disabled={isJoining}
                    placeholder="https://gryt.chat/invite?host=…&code=…"
                    value={inviteInput}
                    onChange={(e) => setInviteInput(e.target.value)}
                  />

                  <Flex direction="column" gap="1">
                    <Text size="1">
                      Invites look like
                    </Text>
                    <Flex gap="1" wrap="wrap">
                      {INPUT_EXAMPLES.map((example) => (
                        <Badge key={example} size="1">
                          {example}
                        </Badge>
                      ))}
                    </Flex>
                  </Flex>
                </Flex>

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
                        error={lookupError}
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
                      <Flex direction="column" gap="2">
                        <Text size="2" weight="bold">
                          Invite code
                        </Text>
                        <TextField
                          disabled={isJoining}
                          placeholder="Paste invite code"
                          value={inviteCode}
                          onChange={(e) =>
                            setManualCode(normalizeCode(e.target.value))
                          }
                        />
                      </Flex>
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
                      <Flex direction="column" gap="2">
                        <Text size="2" weight="bold">
                          Anything to say?
                        </Text>
                        <Text size="1">
                          This server lets people in by hand. A line about who
                          you are gives them something to go on — a nickname on
                          its own does not.
                        </Text>
                        <TextField
                          disabled={isJoining}
                          placeholder="Optional"
                          maxLength={300}
                          value={joinNote}
                          onChange={(e) => setJoinNote(e.target.value)}
                        />
                      </Flex>
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
                      <Flex align="center" gap="3">
                        <Flex
                          align="center"
                          justify="center"
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            background: "var(--green-a3)",
                            color: "var(--green-11)",
                            flexShrink: 0,
                          }}
                        >
                          <PiBroadcastFill size={14} />
                        </Flex>

                        <Flex direction="column" style={{ minWidth: 0 }}>
                          <Text size="2" weight="bold">
                            Don&rsquo;t have an invite?
                          </Text>
                          <Text size="1">
                            Look for servers running on your network.
                          </Text>
                        </Flex>

                        <Flex ml="auto" style={{ color: "var(--gray-9)" }}>
                          <PiCaretRightBold size={14} />
                        </Flex>
                    </Flex>
                  </button>
                )}

                <Dialog.Footer className="justify-between">
                  {/* Only offered when there is a step behind this one. In a
                      browser Join *is* the first step, and a Back that lands on
                      a choice between one real option and a dead end is worse
                      than no Back. */}
                  {embeddedServerAvailable ? (
                    <Button
                      variant="ghost"
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
              </Flex>
            )}
          </Theme>
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
      <Flex align="center" gap="3">
        {/* Seeded on the address until /info answers, and on the name from then
            on — so the planet in the preview is the one the rail will draw once
            you have joined, rather than a different one you never see again. */}
        <Avatar
          size="small"
          className="rounded-(--gryt-radius-md)"
          src={info ? `${getServerHttpBase(host)}/icon` : undefined}
          fallback={<GeneratedServerIcon seed={info?.name || host} />}
        />

        <Flex direction="column" style={{ minWidth: 0 }}>
          {loading ? (
            <SkeletonBase width="8rem" height="1rem" />
          ) : (
            <Text size="2" weight="bold" truncate>
              {info?.name || host}
            </Text>
          )}

          {loading ? (
            <SkeletonBase width="5rem" height="0.75rem" />
          ) : error ? (
            <Text size="1">
              {error}
            </Text>
          ) : privateInfo ? (
            <Text size="1">
              Public info is off. An invite code can still get you in.
            </Text>
          ) : (
            <Text size="1" truncate>
              {info
                ? `${info.members} ${info.members === "1" ? "member" : "members"} · ${host}`
                : host}
            </Text>
          )}
        </Flex>

        <Flex ml="auto" gap="2" align="center">
          {alreadyMember && (
            <Badge size="1" color="blue">
              <PiInfoFill size={12} />
              Joined
            </Badge>
          )}
          {/*
            The thing people actually want to know before joining: whether this
            costs them an account. Only claimed when the server said so — an
            older one sends no tiers, and silence is better than a guess that
            turns into a refusal.
          */}
          {info?.identityTiers && !alreadyMember && (
            <Badge
              size="1"
              color={info.identityTiers.includes("local") ? "green" : "gray"}
            >
              {info.identityTiers.includes("local")
                ? "No account needed"
                : "Account required"}
            </Badge>
          )}
        </Flex>
      </Flex>
    </Surface>
  );
}
