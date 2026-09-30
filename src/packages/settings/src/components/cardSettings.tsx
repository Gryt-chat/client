import { Button, CardIcon, CopyCardLink, createGrytTheme, Dialog, GrytProvider, grytTheme, grytThemeToOptions, MemberCardEditor, seedFromId, TextField, Toggle, ToggleGroup } from "@gryt/ui";
import { UserCircle } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { MemberCardView } from "../../../socket/src/components/memberCard/MemberCardView";
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
  cardText,
  PRONOUNS_MAX,
  STATUS_LINE_MAX,
} from "../../../socket/src/lib/memberCard/cardStyle";
import { SettingGroup, SettingsContainer } from "./settingsComponents";

/** A game for the preview when you are not playing one, so the band can be seen. */
const SAMPLE_GAME: RichActivity = {
  type: "playing",
  name: "Minecraft",
  appId: "1402418491272986635",
  details: "Harbourtown SMP",
  state: "Survival",
  party: { size: 2, max: 8 },
  startedAt: Date.now() - (23 * 60 + 41) * 1000,
};


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
  const [playing, setPlaying] = useState(true);
  const [stage, setStage] = useState<"light" | "dark">(resolvedAppearance);
  const [refusals, setRefusals] = useState<Record<string, string>>({});

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

  /*
   * The one setting with a Save button: every change was an update to each server, and a
   * few quick picks ran into the server's limit of ten card updates in ten seconds.
   */
  const commit = (next: CardProfile) => setDraft(next);
  const dirty = JSON.stringify(cardUpdatePayload(draft)) !== JSON.stringify(cardUpdatePayload(saved));

  const save = () => {
    setStoredCard(draft);
    setRefusals({});
    const payload = cardUpdatePayload(draft);
    for (const host of Object.keys(sockets)) {
      if (sockets[host]?.connected) sockets[host]?.emit("profile:update", payload);
    }
    toast.success("Card saved");
  };

  const style = draft.cardStyle;

  const text = (key: "bio" | "pronouns" | "statusLine", max: number) => ({
    value: draft[key] ?? "",
    maxLength: max,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [key]: e.target.value }),
    onBlur: () => setDraft({ ...draft, [key]: cardText(draft[key], max) }),
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

  const about = (
    <>
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
    </>
  );

  return (
    <SettingsContainer>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg">Edit my card</h2>
        <span className="text-xs text-gryt-muted">
          The card people see when they hover your name. It's the same on every server you're on.
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
          {/* Laid out like the owl designer: panes on the left, the card on the right, nothing long to scroll. */}
          <Dialog.Popup className="flex max-h-[min(46rem,calc(100dvh-2rem))] w-[64rem] max-w-[calc(100vw-2rem)] flex-col overflow-x-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gryt-border px-4 py-3">
              <Dialog.Title className="text-lg">Edit my card</Dialog.Title>
              <div className="flex flex-wrap items-center gap-2">
                {dirty && <span className="text-xs text-gryt-muted">Not saved yet</span>}
                <CopyCardLink style={style} link={(code) => `https://ui.gryt.chat/card${code ? `?${code}` : ""}`} />
                <Button size="small" tone="neutral" disabled={!dirty} onClick={() => setDraft(saved)}>
                  Undo changes
                </Button>
                <Button size="small" disabled={!dirty} onClick={save}>
                  Save
                </Button>
                <Dialog.Close render={<Button size="small" tone="neutral" />}>Close</Dialog.Close>
              </div>
            </div>
            <div className="@container flex min-h-0 flex-1 flex-col overflow-y-auto">
              <div className="flex min-h-0 flex-1 @max-3xl:flex-col">
                <MemberCardEditor
                  value={style}
                  onChange={(next) => commit({ ...draft, cardStyle: next })}
                  owlHex={owlHex}
                  nickname={nickname}
                  worn={worn}
                  seed={seed}
                  appearance={stage}
                  panes={[{ value: "about", label: "About you", icon: <UserCircle weight="fill" size={16} />, content: about }]}
                />
                <figure className="m-0 flex shrink-0 flex-col gap-3 border-gryt-border bg-gryt-surface p-4 @max-3xl:border-t @3xl:w-[24rem] @3xl:border-l">
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
                      {gameCard ? "Show your game" : "With a game"}
                    </label>
                  </figcaption>
                  <div className="overflow-hidden rounded-(--gryt-radius-lg) border border-gryt-border">{preview(stage)}</div>
                  {refused.length > 0 && (
                    <div className="flex flex-col gap-1 text-xs text-gryt-danger">
                      {refused.map(([host, message]) => (
                        <span key={host}>
                          {servers[host]?.name || host}: {message}
                        </span>
                      ))}
                    </div>
                  )}
                </figure>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </SettingsContainer>
  );
}
