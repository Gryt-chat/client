import { Button, createGrytTheme, Dialog, GrytProvider, grytTheme, grytThemeToOptions, Select, TextField, Toggle,ToggleGroup } from "@gryt/ui";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import {
  generatedAvatarColor,
  getOwnServerUserId,
  getServerAccessToken,
  getServerHttpBase,
  getStoredWorn,
  getUploadsFileUrl,
  resolveAvatarSrc,
  useCustomThemes,
  useTheme,
} from "@/common";
import { useSettings } from "@/settings";
import { useServerManagement, useSockets } from "@/socket";

import type { RichActivity } from "../../../../lib/richActivity";
import { CardIcon } from "../../../socket/src/components/memberCard/cardIcons";
import { MemberCardView } from "../../../socket/src/components/memberCard/MemberCardView";
import { BUILTIN_CARD_STYLES, randomCardStyle, styleSwatch } from "../../../socket/src/lib/memberCard/builtinStyles";
import {
  cardUpdatePayload,
  EMPTY_CARD,
  isDefaultCard,
  setStoredCard,
  useStoredCard,
} from "../../../socket/src/lib/memberCard/cardStore";
import {
  BIO_MAX,
  type CardProfile,
  type CardStyle,
  cardText,
  decodeCardStyle,
  encodeCardStyle,
  PRONOUNS_MAX,
  STATUS_LINE_MAX,
} from "../../../socket/src/lib/memberCard/cardStyle";
import { cardVars } from "../../../socket/src/lib/memberCard/cardVars";
import { isTunable } from "../../../socket/src/lib/memberCard/patterns";
import { seedFromId } from "../../../socket/src/lib/memberCard/scatter";
import { PatternPicker, PatternTuning } from "./cardPatternPicker";
import { SettingGroup, SettingsContainer } from "./settingsComponents";

/** A game for the preview when you are not playing one, so the band can be seen. */
const SAMPLE_GAME: RichActivity = {
  type: "playing",
  name: "Minecraft",
  details: "Harbourtown SMP",
  state: "Survival",
  party: { size: 2, max: 8 },
  startedAt: Date.now() - (23 * 60 + 41) * 1000,
};

/** Wait this long after the last change before telling the servers, which rate-limit it. */
const SEND_AFTER_MS = 700;

/** The colours a Solid or Gradient pick starts from, as in the mockup's playground. */
const START = { c1: "#7c5cff", c2: "#ff7a59", angle: 135 };

async function sendBanner(host: string, file: File | null): Promise<void> {
  const token = getServerAccessToken(host);
  if (!token) throw new Error("not signed in there");
  const form = new FormData();
  if (file) form.append("file", file, file.name || "banner");
  const r = await fetch(`${getServerHttpBase(host)}/api/uploads/banner`, {
    method: file ? "POST" : "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    body: file ? form : undefined,
  });
  if (r.status === 404) throw new Error("this server can't take a banner yet");
  if (!r.ok) throw new Error((await r.text().catch(() => "")) || `HTTP ${r.status}`);
}

export function CardSettings() {
  const stored = useStoredCard();
  const { sockets, serverProfiles, serverDetailsList, memberLists } = useSockets();
  const { servers } = useServerManagement();
  const { nickname, avatarDataUrl, gameCard } = useSettings();
  const { activeTheme } = useCustomThemes();
  const { resolvedAppearance } = useTheme();

  const hosts = Object.keys(servers);
  const connected = hosts.filter((h) => sockets[h]?.connected);

  /* What you have: this device's copy, or what a server holds for you on a new device. */
  const fromServer = hosts.map((h) => serverProfiles[h]?.card).find((c) => c && !isDefaultCard(c));
  const saved = stored ?? fromServer ?? EMPTY_CARD;
  const [draft, setDraft] = useState<CardProfile>(saved);
  const [picks, setPicks] = useState(() => ({
    c1: saved.cardStyle.c1 ?? START.c1,
    c2: saved.cardStyle.c2 ?? START.c2,
    angle: saved.cardStyle.fill === "gradient" ? saved.cardStyle.angle : START.angle,
  }));
  const [playing, setPlaying] = useState(true);
  const [stage, setStage] = useState<"light" | "dark">(resolvedAppearance);
  const [code, setCode] = useState(() => encodeCardStyle(saved.cardStyle));
  const [codeError, setCodeError] = useState<string | null>(null);
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<CardProfile | null>(null);

  /* Refusals come back per server, so they are shown per server rather than as a toast. */
  useEffect(() => {
    const off = connected.map((host) => {
      const socket = sockets[host];
      const onError = (message: unknown) => {
        if (typeof message === "string") setRefusals((prev) => ({ ...prev, [host]: message }));
      };
      socket?.on("profile:error", onError);
      return () => socket?.off("profile:error", onError);
    });
    return () => off.forEach((fn) => fn());
  }, [connected.join(" "), sockets]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = () => {
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = null;
    const card = pending.current;
    pending.current = null;
    if (!card) return;
    setRefusals({});
    const payload = cardUpdatePayload(card);
    for (const host of Object.keys(sockets)) {
      if (sockets[host]?.connected) sockets[host]?.emit("profile:update", payload);
    }
  };

  // Leaving the page must not drop the last change on the floor.
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Saves itself: stored at once, sent to every server once the changes settle. */
  const commit = (next: CardProfile) => {
    setDraft(next);
    setStoredCard(next);
    setCode(encodeCardStyle(next.cardStyle));
    pending.current = next;
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(flush, SEND_AFTER_MS);
  };

  const style = draft.cardStyle;
  const withStyle = (over: Partial<CardStyle>): CardProfile => ({ ...draft, cardStyle: { ...style, ...over } });
  const colourOf = (fill: CardStyle["fill"], p = picks): Partial<CardStyle> =>
    fill === "owl"
      ? { fill: "owl", c1: undefined, c2: undefined }
      : { fill, c1: p.c1, c2: fill === "gradient" ? p.c2 : p.c1, angle: p.angle };

  /* Every step of a drag saves; the send waits for the drag to stop. */
  const commitPick = (next: typeof picks) => {
    setPicks(next);
    commit(withStyle(colourOf(style.fill, next)));
  };

  const applyStyle = (next: CardStyle) => {
    if (next.fill !== "owl" && next.c1) {
      setPicks({ c1: next.c1, c2: next.c2 ?? next.c1, angle: next.angle });
    }
    commit({ ...draft, cardStyle: { ...next } });
  };

  const text = (key: "bio" | "pronouns" | "statusLine", max: number) => ({
    value: draft[key] ?? "",
    maxLength: max,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [key]: e.target.value }),
    onBlur: () => {
      const clean = cardText(draft[key], max);
      if (clean !== saved[key]) commit({ ...draft, [key]: clean });
      else setDraft({ ...draft, [key]: clean });
    },
  });

  /* Only where you hold `upload_avatar_image`; a server that doesn't say is left out. */
  const mayUpload = (host: string) => {
    const permissions = serverDetailsList[host]?.server_info?.permissions;
    return Array.isArray(permissions) && permissions.includes("upload_avatar_image");
  };
  const bannerHosts = connected.filter(mayUpload);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [bannerBusy, setBannerBusy] = useState(false);
  const bannerInput = useRef<HTMLInputElement>(null);
  const serverBanner = useMemo(() => {
    for (const host of connected) {
      const me = memberLists[host]?.find((m) => m.serverUserId === getOwnServerUserId(host));
      if (me?.bannerFileId) return getUploadsFileUrl(host, me.bannerFileId);
    }
    return null;
  }, [connected.join(" "), memberLists]); // eslint-disable-line react-hooks/exhaustive-deps
  const bannerUrl = bannerPreview ?? serverBanner;

  const changeBanner = async (file: File | null) => {
    setBannerBusy(true);
    const results = await Promise.allSettled(bannerHosts.map((h) => sendBanner(h, file)));
    setBannerBusy(false);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed.length === results.length) {
      toast.error(`Couldn't ${file ? "upload" : "remove"} the banner: ${failed[0]?.reason?.message ?? "no server took it"}`);
      return;
    }
    setBannerPreview(file ? URL.createObjectURL(file) : null);
    // The server rebroadcasts the member list on this, so everybody sees the new banner.
    for (const h of bannerHosts) sockets[h]?.emit("avatar:updated");
    toast.success(failed.length ? `Banner ${file ? "set" : "removed"}, but ${failed.length} server${failed.length > 1 ? "s" : ""} refused it` : file ? "Banner set" : "Banner removed");
  };

  const worn = getStoredWorn();
  const owlHex = generatedAvatarColor(nickname, worn) ?? "#7c5cff";
  // Your id on the first server you're on seeds a scatter pattern, as it does on your card there.
  const seedKey = (connected[0] && getOwnServerUserId(connected[0])) || nickname;
  const seed = seedFromId(seedKey);
  const drawn = useMemo(() => cardVars(style, owlHex, { appearance: stage, seed }), [style, owlHex, stage, seed]);
  const preview = (appearance: "light" | "dark") => (
    <GrytProvider
      className="flex flex-col gap-2 bg-gryt-bg p-4 text-gryt-muted"
      theme={createGrytTheme(grytThemeToOptions(activeTheme ?? grytTheme, appearance))}
    >
            <MemberCardView
        name={nickname}
        avatarSrc={resolveAvatarSrc(avatarDataUrl, nickname, worn)}
        status="online"
        profile={draft}
        owlHex={owlHex}
        bannerUrl={bannerUrl}
        game={playing ? gameCard ?? SAMPLE_GAME : null}
        appearance={appearance}
        seedKey={seedKey}
        worn={worn}
      >
        {/* What other people get, drawn but not pressable: this card is yours. */}
        <div className="gmc-acts" aria-hidden="true">
          <span className="gmc-ib"><CardIcon.chat /></span>
          <span className="gmc-ib"><CardIcon.friend /></span>
          <span className="gmc-ib quiet"><CardIcon.at /></span>
          {worn && <span className="gmc-ib quiet"><CardIcon.copy /></span>}
          <span className="sp" />
          <span className="gmc-ib danger"><CardIcon.flag /></span>
          <span className="gmc-ib quiet"><CardIcon.more /></span>
        </div>
        <details className="gmc-who" aria-hidden="true">
          <summary tabIndex={-1} onClick={(e) => e.preventDefault()}>
            Who they are <CardIcon.caret />
          </summary>
        </details>
      </MemberCardView>
    </GrytProvider>
  );

  const refused = Object.entries(refusals);

  return (
    <SettingsContainer>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg">Edit my card</h2>
        <span className="text-xs text-gryt-muted">
          The card people see when they hover your name. It's the same on every server you're on, and it saves as you go.
        </span>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div className="overflow-hidden rounded-(--gryt-radius-lg) border border-gryt-border" style={{ flex: "0 1 352px", maxWidth: "100%" }}>
          {preview(stage)}
        </div>
        <div className="flex flex-col gap-2" style={{ flex: "1 1 200px" }}>
          <span className="text-xs text-gryt-muted">
            Colours, patterns, banner, bio and styles, with your card beside you the whole time.
          </span>
          <div>
            <Button size="small" onClick={() => setEditing(true)}>Open the card editor</Button>
          </div>
        </div>
      </div>

      <Dialog.Root open={editing} onOpenChange={(open) => setEditing(open)}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup className="gcs-dialog w-[68rem] max-w-[calc(100vw-3rem)] overflow-y-auto" style={{ maxHeight: "calc(100vh - 4rem)" }}>
            <div className="flex items-center justify-between gap-4" style={{ marginBottom: 12 }}>
              <Dialog.Title className="text-lg">Edit my card</Dialog.Title>
              <Dialog.Close render={<Button size="small" tone="neutral" />}>Done</Dialog.Close>
            </div>
            <div className="gcs-row-wrap">
            <div className="gcs-row flex flex-wrap items-start gap-8">
              {/* One app at a time. Above the controls in a narrow pane, beside them and pinned in a wide one. */}
              <figure className="gcs-preview m-0 flex min-w-0 flex-col gap-2" style={{ flex: "0 1 352px", maxWidth: "100%" }}>
                <figcaption className="flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-gryt-muted">
                  <ToggleGroup
                    value={[stage]}
                    onValueChange={(v) => setStage(v[0] === "light" ? "light" : v[0] === "dark" ? "dark" : stage)}
                    aria-label="Preview on"
                  >
                    <Toggle value="light" size="small">Light app</Toggle>
                    <Toggle value="dark" size="small">Dark app</Toggle>
                  </ToggleGroup>
                  <label className="flex items-center gap-2 font-normal text-gryt-text">
                    <input type="checkbox" checked={playing} onChange={(e) => setPlaying(e.target.checked)} />
                    {gameCard ? "Show your game" : "Show it with a game"}
                  </label>
                </figcaption>
                <div className="overflow-hidden rounded-(--gryt-radius-lg) border border-gryt-border">{preview(stage)}</div>
              </figure>
              <div className="flex min-w-0 flex-col gap-6" style={{ flex: "1 1 300px", maxWidth: 380 }}>
                <SettingGroup title="Card colour" description="Your owl's colour to start with. Gryt works out the text and buttons from it, so small text stays readable.">
                  <ToggleGroup
                    value={[style.fill]}
                    onValueChange={(v) => {
                      const fill = (v[0] as CardStyle["fill"] | undefined) ?? style.fill;
                      commit(withStyle(colourOf(fill)));
                    }}
                    aria-label="Card colour"
                  >
                    <Toggle value="owl" size="small">Owl colour</Toggle>
                    <Toggle value="solid" size="small">Solid</Toggle>
                    <Toggle value="gradient" size="small">Gradient</Toggle>
                  </ToggleGroup>
                  {style.fill !== "owl" && (
                    <div className="flex flex-wrap items-center gap-2.5">
                      <input
                        type="color"
                        aria-label="First colour"
                        value={picks.c1}
                        onChange={(e) => commitPick({ ...picks, c1: e.target.value })}
                        className="h-8 w-11 cursor-pointer rounded-(--gryt-radius-sm) border border-gryt-border bg-gryt-surface p-0.5"
                      />
                      {style.fill === "gradient" && (
                        <>
                          <input
                            type="color"
                            aria-label="Second colour"
                            value={picks.c2}
                            onChange={(e) => commitPick({ ...picks, c2: e.target.value })}
                            className="h-8 w-11 cursor-pointer rounded-(--gryt-radius-sm) border border-gryt-border bg-gryt-surface p-0.5"
                          />
                          <label htmlFor="card-angle" className="text-xs font-bold text-gryt-muted">Angle</label>
                          <input
                            id="card-angle"
                            type="range"
                            min={0}
                            max={360}
                            step={15}
                            value={picks.angle}
                            onChange={(e) => commitPick({ ...picks, angle: Number(e.target.value) })}
                            style={{ flex: 1, minWidth: 120, accentColor: "var(--gryt-accent)" }}
                          />
                          <output className="min-w-[3.5em] font-mono text-xs text-gryt-muted">{picks.angle}°</output>
                        </>
                      )}
                    </div>
                  )}
                </SettingGroup>

                <SettingGroup title="Pattern" description="Drawn from your colour, so there's nothing to upload.">
                  <PatternPicker
                    style={style}
                    owlHex={owlHex}
                    nickname={nickname}
                    worn={worn}
                    seed={seed}
                    appearance={stage}
                    onPick={(over) => commit(withStyle(over))}
                  />
                </SettingGroup>

                {isTunable(style.pattern) && (
                  <SettingGroup title="Customise pattern" description="Size, turn, strength and colour. Gryt turns the strength down if it would make small text hard to read.">
                    <PatternTuning
                      style={style}
                      effectiveInk={drawn.patternInk}
                      effectiveAlpha={drawn.patternAlpha}
                      onChange={(over) => commit(withStyle(over))}
                    />
                  </SettingGroup>
                )}

                <SettingGroup title="Colour fills" description="The whole card, or only the banner and the band under it.">
                  <Select
                    value={style.colours}
                    onValueChange={(v) => commit(withStyle({ colours: v === "banner" ? "banner" : "card" }))}
                    options={[
                      { value: "card", label: "The whole card" },
                      { value: "banner", label: "The banner and band" },
                    ]}
                  />
                </SettingGroup>

                {style.colours === "card" && (
                  <>
                    <SettingGroup title="Pattern covers" description="Just the banner, or the whole card behind everything.">
                      <Select
                        value={style.cover}
                        onValueChange={(v) => commit(withStyle({ cover: v === "card" ? "card" : "banner" }))}
                        options={[
                          { value: "banner", label: "The banner" },
                          { value: "card", label: "The whole card" },
                        ]}
                      />
                    </SettingGroup>
                    <SettingGroup title="Banner fade" description="Fade only the bottom of the banner into the card, or all of it so there's no edge.">
                      <Select
                        value={style.fade}
                        onValueChange={(v) => commit(withStyle({ fade: v === "banner" ? "banner" : "bottom" }))}
                        options={[
                          { value: "bottom", label: "Bottom" },
                          { value: "banner", label: "Whole banner" },
                        ]}
                      />
                    </SettingGroup>
                  </>
                )}

                <SettingGroup title="Pronouns" description="Shown under your name.">
                  <TextField placeholder="she/her, they/them…" {...text("pronouns", PRONOUNS_MAX)} />
                </SettingGroup>

                <SettingGroup title="Bio" description={`A line or two about you. Up to ${BIO_MAX} characters.`}>
                  <TextField multiline minRows={2} placeholder="Mostly on after nine." {...text("bio", BIO_MAX)} />
                </SettingGroup>

                <SettingGroup title="Status line" description="Shown in the band on your card when you aren't playing anything.">
                  <TextField placeholder="Around tonight for co-op." {...text("statusLine", STATUS_LINE_MAX)} />
                </SettingGroup>

                {bannerHosts.length > 0 && (
                  <SettingGroup
                    title="Banner"
                    description={
                      bannerHosts.length === connected.length
                        ? "A picture across the top of your card. Everywhere else your pattern shows instead."
                        : `A picture across the top of your card, on the ${bannerHosts.length} of your servers that let you upload. The others show your pattern.`
                    }
                  >
                    <div className="flex flex-wrap gap-2">
                      <Button size="small" disabled={bannerBusy} onClick={() => bannerInput.current?.click()}>
                        {bannerUrl ? "Change banner" : "Upload a banner"}
                      </Button>
                      {bannerUrl && (
                        <Button size="small" tone="neutral" disabled={bannerBusy} onClick={() => void changeBanner(null)}>
                          Remove banner
                        </Button>
                      )}
                    </div>
                    <input
                      ref={bannerInput}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void changeBanner(file);
                      }}
                    />
                  </SettingGroup>
                )}

                <SettingGroup title="Card styles" description="A style is your card's colours and pattern. It never carries your banner, bio or pronouns.">
                  <div className="flex flex-wrap gap-1.5">
                    {BUILTIN_CARD_STYLES.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => applyStyle(b.style)}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-gryt-border bg-gryt-surface-raised py-1 pr-2.5 pl-1 text-[12.5px] font-bold text-gryt-text hover:bg-gryt-surface-hover"
                      >
                        <i
                          className="h-[18px] w-[18px] rounded-full border border-gryt-border"
                          style={{ background: styleSwatch(b.style) } as CSSProperties}
                        />
                        {b.name}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => applyStyle(randomCardStyle())}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-gryt-border bg-gryt-surface-raised py-1 px-2.5 text-[12.5px] font-bold text-gryt-text hover:bg-gryt-surface-hover"
                    >
                      Surprise me
                    </button>
                  </div>
                  <TextField
                    aria-label="Style code"
                    spellCheck={false}
                    autoComplete="off"
                    value={code}
                    placeholder="card=b4b&colour=solid&c1=ffd400"
                    onChange={(e) => {
                      setCode(e.target.value);
                      setCodeError(null);
                    }}
                    className="font-mono"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="small"
                      tone="neutral"
                      onClick={() =>
                        void navigator.clipboard.writeText(encodeCardStyle(style)).then(
                          () => toast.success("Card style copied"),
                          () => toast.error("Couldn't copy. The code is in the box above."),
                        )
                      }
                    >
                      Copy style
                    </Button>
                    <Button
                      size="small"
                      tone="neutral"
                      onClick={() => {
                        const next = decodeCardStyle(code);
                        if (!next) {
                          setCodeError("There's no card style in that. Copy one with Copy style, or Copy card style on somebody's card.");
                          return;
                        }
                        applyStyle(next);
                        toast.success("Card style applied");
                      }}
                    >
                      Use this style
                    </Button>
                  </div>
                  {codeError && <span className="text-xs text-gryt-danger">{codeError}</span>}
                </SettingGroup>

                {refused.length > 0 && (
                  <div className="flex flex-col gap-1 text-xs text-gryt-danger">
                    {refused.map(([host, message]) => (
                      <span key={host}>
                        {servers[host]?.name || host}: {message}
                      </span>
                    ))}
                  </div>
                )}
              </div>

            </div>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </SettingsContainer>
  );
}
