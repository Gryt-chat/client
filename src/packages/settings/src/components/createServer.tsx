import { Alert, Avatar, Button, Checkbox, Dialog, Spinner, TextField } from "@gryt/ui";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { GeneratedServerIcon } from "@/common";

import { PiCameraFill, PiCheckCircleFill, PiWarningFill, PiX } from "../../../../lib/icons";
import { useEmbeddedServer } from "../hooks/useEmbeddedServer";
import { SERVER_ICON_SHAPE } from "./pictureCrop";
import { PictureCropDialog } from "./PictureCropDialog";

interface CreateServerPanelProps {
  /** Called once the new server is up and reachable. */
  onServerReady: (serverUrl: string, serverName: string, icon: File | null) => void;
}

/**
 * Making a server, and nothing else — the manager lives in Settings → My servers.
 * Create writes the config, starts the process and hands the address back.
 */
export function CreateServerPanel({ onServerReady }: CreateServerPanelProps) {
  const { isAvailable, creating, progress, createServer, suggestPort, checkPort } =
    useEmbeddedServer();

  const [serverName, setServerName] = useState("My Server");
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!creating) return setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), 5000);
    return () => window.clearTimeout(timer);
  }, [creating]);
  const [lanDiscoverable, setLanDiscoverable] = useState(true);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState<File | null>(null);
  const [icon, setIcon] = useState<File | null>(null);
  const [iconSrc, setIconSrc] = useState<string | undefined>();
  const iconInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!icon) return setIconSrc(undefined);
    const url = URL.createObjectURL(icon);
    setIconSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [icon]);

  /**
   * The port, offered rather than demanded. Prefilled with one that is free, so
   * anybody who cares about a forwarded port can say so before creating.
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
   * Create, and hand back the server that was created. Keyed off the returned
   * state: watching for "a server went running" joins you to somebody else's.
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

    onServerReady(created.serverUrl, created.config.serverName, icon);
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
      {/* One grid, so the port field starts where the name field does. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
        <button
          type="button"
          aria-label="Choose a server picture"
          className="relative shrink-0 cursor-pointer rounded-(--gryt-radius-md)"
          onClick={() => iconInput.current?.click()}
          disabled={creating}
        >
          <Avatar
            size="medium"
            className="rounded-(--gryt-radius-md)"
            src={iconSrc}
            fallback={<GeneratedServerIcon seed={serverName || "My Server"} />}
          />
          <span
            className="absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full"
            style={{ background: "var(--gryt-accent-9)", color: "var(--color-gryt-on-accent)", boxShadow: "0 1px 4px var(--gryt-neutral-a5)" }}
          >
            <PiCameraFill size={11} />
          </span>
        </button>
        <input
          ref={iconInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          hidden
          onChange={(e) => {
            setPicking(e.target.files?.[0] ?? null);
            e.currentTarget.value = "";
          }}
        />
        <TextField
          autoFocus
          aria-label="Server name"
          placeholder="My Server"
          value={serverName}
          onChange={(e) => setServerName(e.target.value)}
          disabled={creating}
          maxLength={64}
        />
        <span className="text-sm font-bold text-right">Port</span>
        <div className="flex items-center gap-3">
          <div className="w-28 shrink-0">
            <TextField
              inputMode="numeric"
              aria-label="Port"
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

      {slow && /Windows/.test(navigator.userAgent) && (
        <p className="m-0 text-sm" style={{ color: "var(--gryt-neutral-11)" }}>
          If Windows asks whether Gryt can use the network, allow it. Otherwise nobody else can join.
        </p>
      )}

      <PictureCropDialog
        file={picking}
        shape={SERVER_ICON_SHAPE}
        onDone={(cropped) => {
          setPicking(null);
          if (cropped) setIcon(cropped);
        }}      />

      <Dialog.Footer className="justify-end">
        <Button size="small"
          onClick={() => {
            void handleCreate();
          }}
          disabled={
            creating || !serverName.trim() || portState !== "free"
          }
        >
          {creating ? <Spinner size={16} /> : null}
          {creating ? (progress ?? "Creating…") : "Create"}
        </Button>
      </Dialog.Footer>
    </div>
  );
}
