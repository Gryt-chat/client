import { Alert, Avatar, Button, Checkbox, Dialog, Spinner, TextField } from "@gryt/ui";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { PiCheckCircleFill, PiWarningFill, PiX } from "react-icons/pi";

import { GeneratedServerIcon } from "@/common";

import { useEmbeddedServer } from "../hooks/useEmbeddedServer";

interface CreateServerPanelProps {
  /** Called once the new server is up and reachable. */
  onServerReady: (serverUrl: string, serverName: string) => void;
  /** Back out to the step that chose this. */
  onBack: () => void;
}

/**
 * Making a server, and nothing else.
 *
 * This used to be the whole embedded-server manager — create form, running
 * card, logs, autostart, start and stop — reached through a dialog called "Add
 * a server". Managing something you already run is not adding one, and the two
 * jobs were taking turns in the same space depending on state you had no way
 * to predict from the outside. The manager lives in Settings → My servers now.
 *
 * Create finishes the job: it writes the config, starts the process and hands
 * the address back so the caller can join it. Previously it stopped after
 * writing the config and left a second button, Connect, as the thing that
 * actually got you there.
 */
export function CreateServerPanel({ onServerReady, onBack }: CreateServerPanelProps) {
  const { isAvailable, creating, createServer, suggestPort, checkPort } =
    useEmbeddedServer();

  const [serverName, setServerName] = useState("My Server");
  const [lanDiscoverable, setLanDiscoverable] = useState(true);
  const [error, setError] = useState("");

  /**
   * The port, offered rather than demanded.
   *
   * Prefilled with one that is actually free, so the common case is to leave it
   * alone. Anybody who cares — a port already forwarded on their router, or one
   * their firewall rules already name — can say so here instead of creating a
   * server and then finding out it landed somewhere else.
   */
  const [port, setPort] = useState("");
  const [portState, setPortState] = useState<
    "loading" | "free" | "taken" | "invalid"
  >("loading");
  /** Distinguishes the offered port from one they typed, for the wording. */
  const touched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void suggestPort().then((p) => {
      if (cancelled || touched.current) return;
      if (p) {
        setPort(String(p));
        setPortState("free");
      } else {
        setPortState("invalid");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [suggestPort]);

  // Debounced, because this binds a socket to find out and they are still
  // typing. 1000 is a prefix of 10000.
  useEffect(() => {
    if (!touched.current) return;

    const n = Number(port);
    if (!port.trim() || !Number.isInteger(n) || n < 1 || n > 65535) {
      setPortState("invalid");
      return;
    }

    setPortState("loading");
    const timer = window.setTimeout(() => {
      void checkPort(n).then((free) => setPortState(free ? "free" : "taken"));
    }, 400);

    return () => window.clearTimeout(timer);
  }, [port, checkPort]);

  if (!isAvailable) return null;

  /**
   * Create, and hand back the server that was created.
   *
   * Deliberately keyed off the returned state rather than off a status effect.
   * When there was only ever one server, watching for "a server went running"
   * was good enough; with several, that fires for a server somebody else just
   * started and would join you to the wrong one.
   */
  async function handleCreate() {
    setError("");
    const created = await createServer(
      serverName.trim() || "My Server",
      lanDiscoverable,
      Number(port) || undefined,
    );

    if (!created?.serverUrl || !created.config) {
      setError("Could not create the server. The startup log has the details.");
      return;
    }

    onServerReady(created.serverUrl, created.config.serverName);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The icon leads, and it is already theirs before they have finished
          naming it. Seeded on the name rather than the address, because a
          server being created has no address yet and every new one drew the
          same planet until it started. */}
      <div className="flex flex-col items-center gap-1">
        {/* 80px, which is past the library's large — this is the preview of
            the icon you are about to make, so it is the subject of the step
            rather than a marker beside something else. */}
        <Avatar
          size="large"
          className="h-20 w-20 text-2xl"
          fallback={<GeneratedServerIcon seed={serverName || "My Server"} />}
        />
        <span className="text-xs">
          Generated from the name
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold">
          Server name{" "}
          <span>
            *
          </span>
        </span>
        <TextField
          autoFocus
          placeholder="My Server"
          value={serverName}
          onChange={(e) => setServerName(e.target.value)}
          disabled={creating}
          maxLength={64}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">
            Port
          </span>
          {portState === "free" && (
            <div className="flex items-center gap-1" style={{ color: "var(--gryt-success-11)" }}>
              <PiCheckCircleFill size={12} />
              <span className="text-xs">
                {touched.current ? "Available" : "Picked for you"}
              </span>
            </div>
          )}
          {portState === "taken" && (
            <span className="text-xs" style={{ color: "var(--gryt-danger-11)" }}>
              Something else is using this port
            </span>
          )}
          {portState === "invalid" && (
            <span className="text-xs" style={{ color: "var(--gryt-danger-11)" }}>
              Must be a number between 1 and 65535
            </span>
          )}
          {portState === "loading" && (
            <span className="text-xs">
              Checking&hellip;
            </span>
          )}
        </div>
        <TextField
          inputMode="numeric"
          placeholder="5000"
          value={port}
          onChange={(e) => {
            touched.current = true;
            setPort(e.target.value.replace(/[^0-9]/g, ""));
          }}
          disabled={creating}
          maxLength={5}
        />
      </div>

      {/* The one setting that survived the trim. It is not cosmetic: it decides
          whether anybody else on the network can find this server at all, and
          there is nowhere else to say so before it starts. */}
      <label className="flex gap-2 items-center">
          <Checkbox
            checked={lanDiscoverable}
            onCheckedChange={(c) => setLanDiscoverable(c === true)}
            disabled={creating}
          />
          <span className="text-sm">
            Let others on my network find it
          </span>
        </label>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: "hidden" }}
          >
            <Alert severity="info" role="alert"><span className="inline-flex items-start gap-2"><PiWarningFill size={16} />{error}</span></Alert>
            <div className="flex mt-2 justify-end">
              <Button tone="ghost" size="xsmall"
                onClick={() => setError("")}
              >
                <PiX size={14} />
                Dismiss
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog.Footer className="justify-between">
        <Button tone="ghost" size="small" onClick={onBack} disabled={creating}>
          Back
        </Button>

        <Button size="small"
          onClick={() => {
            void handleCreate();
          }}
          disabled={
            creating || !serverName.trim() || portState !== "free"
          }
        >
          {creating ? <Spinner size={16} /> : null}
          {creating ? "Creating…" : "Create"}
        </Button>
      </Dialog.Footer>
    </div>
  );
}
