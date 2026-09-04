import { Alert, Avatar, Button, Checkbox, Dialog, Spinner, TextField } from "@gryt/ui";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { GeneratedServerIcon } from "@/common";

import { PiCheckCircleFill, PiWarningFill, PiX } from "../../../../lib/icons";
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
 * a server". The manager lives in Settings → My servers now.
 *
 * Create finishes the job: it writes the config, starts the process and hands
 * the address back so the caller can join it. It used to stop after writing the
 * config and leave a second button, Connect, as the thing that got you there.
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
      {/* The icon sits beside the name it is drawn from rather than centred
          above it. It is a preview, so watching it change while you type is
          the point — and at 80px in the middle it pushed the rest of the form
          out of view to show something that is not the subject of the step.

          Seeded on the name rather than the address, because a server being
          created has no address yet and every new one drew the same planet
          until it started.

          No caption underneath: it changes as you type, which says it. */}
      <div className="flex flex-col gap-1">
        <span className="text-sm font-bold">Name</span>
        <div className="flex items-end gap-3">
          <Avatar
            size="medium"
            className="rounded-(--gryt-radius-md) shrink-0"
            fallback={<GeneratedServerIcon seed={serverName || "My Server"} />}
          />
          <TextField
            autoFocus
            className="flex-1"
            placeholder="My Server"
            value={serverName}
            onChange={(e) => setServerName(e.target.value)}
            disabled={creating}
            maxLength={64}
          />
        </div>
      </div>

      {/* A port is four characters, so the field is short and its status sits
          beside it on the same line — a status about a value belongs next to
          the value rather than up beside the label. Tabular digits so the
          number does not jiggle while it is typed.

          "Available" rather than "Free": on a product surface Free reads as a
          price, and nothing here costs money. */}
      <div className="flex flex-col gap-1">
        <span className="text-sm font-bold">Port</span>
        <div className="flex items-center gap-3">
          {/* The width goes on a wrapper, not on TextField: the class lands on
              the input and its wrapper stays full-width, which pushed the
              status a quarter of the dialog away from the value it is about. */}
          <div className="w-28 shrink-0">
          <TextField
            inputMode="numeric"
            className="tabular-nums"
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
          {portState === "free" && (
            <span
              className="inline-flex items-center gap-1 text-xs"
              style={{ color: "var(--gryt-success-11)" }}
            >
              <PiCheckCircleFill size={13} />
              Available
            </span>
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
            <span className="text-xs" style={{ color: "var(--gryt-neutral-11)" }}>
              Checking&hellip;
            </span>
          )}
        </div>
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
