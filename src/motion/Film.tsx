import { Avatar, Button, IconButton, Tabs, TextField } from "@gryt/ui";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { GeneratedServerIcon } from "@/common";
import type { Channel, SidebarItem } from "@/settings/src/types/server";
import type { Clients } from "@/socket/src/types/clients";

import { PiChatsTeardropFill, PiChatTeardropTextFill, PiGearFill, PiLinkFill, PiPlus, PiShieldCheckFill, PiUsersThreeFill } from "../lib/icons";
import { AddNewServer } from "../packages/settings/src/components/addServer";
import { ChannelList } from "../packages/socket/src/components/ChannelList";
import { ChatEditor } from "../packages/socket/src/components/ChatEditor";
import { CreateChannelDialog, type NewChannelOptions } from "../packages/socket/src/components/CreateChannelDialog";
import { ServerHeader } from "../packages/socket/src/components/ServerHeader";
import { getCustomEmojis, setCustomEmojis } from "../packages/socket/src/utils/emojiData";
import { Caret } from "./caret";
import { click, Cursor, moveTo, touch } from "./cursor";
import { AUTOMATED, Forum, type Line, Messages, PEOPLE } from "./examples";
import { Guide, meditate, owlPosition, place, placeOn, point, pointAt, relax, say, setMood, stagePoint, watchActivity, wave } from "./guide";
import { LiveCard, LiveMembers } from "./liveOwl";
import { Card, FRIENDS, ME, Members, Typing } from "./people";
import { FolderPermissions, RoleEditor } from "./roles";
import { VoiceGrid } from "./voice";
import { dressUp, Wardrobe } from "./wardrobe";

/** Marks a storyboard beat: its time and where the owl is, for the boards Sivert positions the owl on. */
// Owl spots per beat from Sivert's storyboard (owl centre, and the bubble's offset from the owl's top-left).
const SPOTS: Record<string, [number, number, { dx: number; dy: number }?]> = {
  "01-hello": [734, 540, { dx: 0, dy: -70 }],
  "02-add-server": [377, 454],
  "03-channels": [492, 675, { dx: 148, dy: 10 }],
  "04-folders": [481, 662],
  "05-chat": [203, 515],
  "06-roles": [156, 540, { dx: 0, dy: -70 }],
  "07-invite": [698, 275, { dx: 17, dy: -50 }],
  "08-friends": [1274, 346],
  "10-lounge": [301, 595, { dx: -145, dy: -75 }],
};

/** Left of the rail, level with the channel list, so new channels never land under the owl. */
function besideRail() {
  const rail = flat(() => $("#s-rail")!.getBoundingClientRect());
  const list = stagePoint($("#s-channels")!);
  const left = stagePoint($("#s-rail")!).x - (rail.width / 2) * (W / flat(() => $("#stage")!.getBoundingClientRect()).width);
  place(left - 95, list.y, { dx: 0, dy: -70 });
}

function beat(id: string) {
  const at = SPOTS[id];
  if (id === "03-channels" || id === "04-folders" || id === "10-lounge") besideRail();
  else if (at) place(at[0], at[1], at[2]);
  const o = owlPosition();
  console.error(`motion: beat ${id} t=${(performance.now() / 1000).toFixed(2)} owl=${o.x},${o.y}`);
}
import "./animatedImages";

import { sfx } from "./sfx";
import { $, byText, ease, flat, get, H, hold, set, to, until, useFrame, W, wait } from "./stage";
import { key, type, typeInput } from "./typing";

const PERSPECTIVE = 1600;

function World({ children }: { children: ReactNode }) {
  useFrame();
  // A 2D camera: perspective made getBoundingClientRect disagree with what Chrome painted, and the cursor aims by it.
  const sc = PERSPECTIVE / (PERSPECTIVE - get("c.z"));
  const t = `scale(${sc}) translate(${-get("c.x")}px, ${-get("c.y")}px)`;
  // The tilt goes on body, one flat layer with dialogs, cursor and owl on it, so nothing inside it disagrees.
  document.documentElement.style.perspective = "1700px";
  document.documentElement.style.background = "#0b0c10";
  document.body.style.background = "radial-gradient(circle, rgba(180,175,255,.15) 1.6px, transparent 2.2px) 0 0 / 34px 34px, var(--gryt-bg)";
  document.body.style.minHeight = "100vh";
  document.body.style.transformOrigin = "50% 50%";
  document.body.style.transform = `rotateX(${get("c.rx")}deg) rotateY(${get("c.ry")}deg) scale(1.12)`;
  return <div style={{ position: "absolute", left: W / 2, top: H / 2, transform: t, transformOrigin: "0 0" }}>{children}</div>;
}

function Panel({ k, x, y, z = 0, ry = 0, rx = 0, zoom = 1, style, children }: {
  k: string; x: number; y: number; z?: number; ry?: number; rx?: number; zoom?: number; style?: CSSProperties; children?: ReactNode;
}) {
  useFrame();
  const o = get(`${k}.o`, 0);
  const s = get(`${k}.s`, 0.94);
  const lift = get(`${k}.y`, 36);
  const dx = get(`${k}.x`, 0);
  const blur = get(`${k}.blur`, 0);
  return (
    <div
      style={{
        position: "absolute", left: x + dx, top: y + lift, transform: `translate(-50%, -50%) translateZ(${z}px) rotateY(${ry}deg) rotateX(${rx}deg) scale(${s})`,
        opacity: o, visibility: o <= 0.001 ? "hidden" : "visible", filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
      }}
    >
      {/* A scale, not CSS zoom: zoom inside a 3D transform throws off getBoundingClientRect, and the cursor aims by it. */}
      <div style={{ transform: `scale(${zoom})`, position: "relative", ...style }}>{children}</div>
    </div>
  );
}


/** Gryt flying across the world: leans into it, tucks his feet, and flaps over a long whoosh. dir is 1 for right. */
function flight(dir: 1 | -1, dur: number) {
  sfx("fly", { dur });
  for (let k = 0; k * 330 < dur - 300; k++) setTimeout(() => sfx("flap"), 120 + k * 330);
  to("owl.tilt", 18 * dir, 350, ease.out);
  to("owl.paws", 0, 250, ease.out);
  setTimeout(() => { to("owl.tilt", 0, 450, ease.inOut); to("owl.paws", 1, 400, ease.inOut); }, dur - 450);
}

/** Moves the camera. Anything quick enough to read as a cut gets a whoosh. */
function camera(target: Record<string, number>, dur: number, e = ease.inOut) {
  if (dur <= 700) sfx("whoosh", { dur });
  for (const [k, v] of Object.entries(target)) to(`c.${k}`, v, dur, e);
}
function cut(target: Record<string, number>) {
  for (const [k, v] of Object.entries(target)) set(`c.${k}`, v);
}

type Target = string | { getBoundingClientRect(): DOMRect };

/**
 * Points the camera at whatever `targets` cover and sizes them to `fill` of the frame,
 * measured on screen, so a shot never depends on hand-tuned numbers.
 */
async function frame(targets: Target[], o: { fill?: number; dur?: number; cut?: boolean; dy?: number; dx?: number; at?: { x: number; y: number }; rx?: number; ry?: number } = {}) {
  const { fill = 0.84, dur = 650, dy = 0, dx = 0 } = o;
  const stage = flat(() => document.getElementById("stage")!.getBoundingClientRect());
  const sc = stage.width / W;
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const target of targets) {
    const el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) continue;
    const rect = flat(() => el.getBoundingClientRect());
    if (!rect.width) continue;
    l = Math.min(l, (rect.left - stage.left) / sc); r = Math.max(r, (rect.right - stage.left) / sc);
    t = Math.min(t, (rect.top - stage.top) / sc); b = Math.max(b, (rect.bottom - stage.top) / sc);
  }
  if (!Number.isFinite(l)) return;
  const s = PERSPECTIVE / (PERSPECTIVE - get("c.z"));
  const x = get("c.x") + ((l + r) / 2 - W / 2) / s + dx;
  const y = get("c.y") + ((t + b) / 2 - H / 2) / s + dy;
  const want = s * Math.min((W * fill) / (r - l), (H * fill) / (b - t));
  const z = PERSPECTIVE - PERSPECTIVE / want;
  // `at` puts the targets' centre at that fraction of the frame instead of the middle.
  const ax = o.at ? (o.at.x - 0.5) * W / want : 0;
  const ay = o.at ? (o.at.y - 0.5) * H / want : 0;
  const tilt = { rx: o.rx ?? get("c.rx"), ry: o.ry ?? get("c.ry") };
  if (o.cut) cut({ x: x - ax, y: y - ay, z, ...tilt });
  else camera({ x: x - ax, y: y - ay, z, ...tilt }, dur);
  if (!o.cut) await wait(dur);
}

/** Keeps the app's dialogs 28px right of the channel list (or of the rail, before the list is there), every frame. */
function DialogPlacer() {
  useFrame();
  const rail = flat(() => document.getElementById("s-rail")?.getBoundingClientRect());
  const list = flat(() => document.getElementById("s-channels")?.getBoundingClientRect());
  if (rail && list) {
    const right = get("slot.s-channels", 0) > 0.5 ? list.right : rail.right;
    document.documentElement.style.setProperty("--motion-dialog-x", `${right + 28}px`);
  }
  return null;
}

/** Pans so the rail, the list (once it is there) and the open dialog sit centred as one group. */
async function centerGroup(dur = 900) {
  const stage = flat(() => document.getElementById("stage")!.getBoundingClientRect());
  const k = stage.width / W;
  const rail = flat(() => document.getElementById("s-rail")!.getBoundingClientRect());
  const list = flat(() => document.getElementById("s-channels")!.getBoundingClientRect());
  const dlg = document.querySelector(".gryt-dialog");
  const dw = dlg ? flat(() => dlg.getBoundingClientRect()).width : 0;
  const right = (get("slot.s-channels", 0) > 0.5 ? list.right : rail.right) + 28 + dw;
  const mid = ((rail.left + right) / 2 - stage.left) / k;
  const s = PERSPECTIVE / (PERSPECTIVE - get("c.z"));
  camera({ x: get("c.x") + (mid - W / 2) / s }, dur);
  await wait(dur);
}

function RailExtra({ children }: { children: ReactNode }) {
  useFrame();
  return <div style={{ opacity: get("rail.extra", 1) }}>{children}</div>;
}

function Plus({ children }: { children: ReactNode }) {
  useFrame();
  const o = get("plus.o", 1);
  return <div style={{ opacity: o, transform: `scale(${0.5 + 0.5 * o})` }}>{children}</div>;
}

/** The server rail, with the same markup and pieces as components/sidebar.tsx. */
function Rail({ servers }: { servers: string[] }) {
  return (
    <div className="flex flex-col h-full gap-4 items-center justify-between" data-gryt="sidebar">
      <div className="flex flex-col gap-4 pt-2 items-center">
        <RailExtra><IconButton aria-label="Direct messages" tone="ghost"><PiChatsTeardropFill size={20} /></IconButton></RailExtra>
        <RailExtra><div style={{ width: 26, height: 1, background: "var(--gryt-neutral-6)" }} /></RailExtra>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {servers.map((name) => (
            <div key={name} style={{ animation: "motion-pop .5s cubic-bezier(.16,1,.3,1)" }}>
              <Avatar size="small" className="rounded-(--gryt-radius-md) p-0" fallback={<GeneratedServerIcon seed={name} />} />
            </div>
          ))}
        </div>
        <Plus><IconButton tone="neutral" size="xsmall" aria-label="Add new server" id="addserver"><PiPlus size={16} /></IconButton></Plus>
      </div>
    </div>
  );
}



// Real emoji from the community server, so the autocomplete shows an animated one.
// The page itself as the server: message images only load from their own server's host.
const EMOJI_HOST = location.host;
export const EMOJIS = ["catJAM", "KEKW", "vibecat", "kitty_blush", "kitty_dance", "gryt", "InLove", "Approve", "Peace", "upvote", "goofy_ah_cat", "cat_sus"];
setCustomEmojis([{ name: "wiggle", file_id: "" }, ...EMOJIS.map((name) => ({ name, file_id: "" }))], EMOJI_HOST);
// The community server sends no CORS header, so the render reads local copies (render-motion.mjs fetches them).
for (const e of getCustomEmojis(EMOJI_HOST)) e.url = location.origin + (e.name === "wiggle" ? "/motion-assets/wiggle.webp" : `/motion-assets/emoji/${e.name}.webp`);

const ch = (id: string, name: string, extra: Partial<Channel> = {}): Channel => ({ id, name, type: "text", layout: "chat", ...extra });


/** Cursor and owl, portalled over the app's own dialogs and scaled like the stage. */
/** The end card under Gryt: the app dimmed out, his ring, and the name with the tagline below it. */
function EndCard() {
  useFrame();
  const dim = get("end.dim", 0), ring = get("end.ring", 0), title = get("end.title", 0), tag = get("end.tag", 0);
  if (dim <= 0.001) return null;
  const r = 128, len = 2 * Math.PI * r;
  return (
    <>
      <div style={{ position: "absolute", inset: 0, background: "#0b0c10", opacity: dim, zIndex: 40 }} />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, zIndex: 44 }} aria-hidden>
        <circle cx={960} cy={430} r={r} fill="none" stroke="var(--gryt-accent-9)" strokeWidth={5} strokeLinecap="round"
          strokeDasharray={len} strokeDashoffset={len * (1 - ring)} transform="rotate(-90 960 430)" opacity={Math.min(1, ring * 3)} />
      </svg>
      <div style={{ position: "absolute", left: 0, right: 0, top: 610, zIndex: 46, textAlign: "center", fontFamily: "var(--gryt-font-sans, inherit)", color: "#e0e0e6" }}>
        <div style={{ fontSize: 92, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1, opacity: Math.min(1, title * 1.4), transform: `translateY(${(1 - title) * 26}px) scale(${0.94 + 0.06 * title})` }}>Gryt Chat</div>
        <div style={{ marginTop: 22, fontSize: 30, color: "#a8a8b2", opacity: tag, transform: `translateY(${(1 - tag) * 12}px)` }}>A place to talk that belongs to you.</div>
        <div style={{ marginTop: 26, fontSize: 24, fontFamily: "var(--font-mono, monospace)", color: "#b4afff", opacity: tag }}>gryt.chat</div>
      </div>
    </>
  );
}

function Overhead({ children }: { children: ReactNode }) {
  useFrame();
  const stage = flat(() => document.getElementById("stage")?.getBoundingClientRect());
  const s = stage ? stage.width / W : 1;
  return createPortal(
    <div id="overhead" style={{ position: "fixed", left: stage?.left ?? 0, top: stage?.top ?? 0, width: W, height: H, transform: `scale(${s})`, transformOrigin: "0 0", zIndex: 1000, pointerEvents: "none", overflow: "hidden" }}>{children}</div>,
    document.body,
  );
}

const SURFACE: CSSProperties = { borderRadius: 20, background: "var(--gryt-neutral-2)", overflow: "hidden" };

/** One slot of the client layout. It holds its place from the start and only shows up when its act reveals it. */
function Slot({ id, width, from = "up", children, style }: { id: string; width?: number; from?: "left" | "right" | "up"; children?: ReactNode; style?: CSSProperties }) {
  useFrame();
  const p = get(`slot.${id}`, 0);
  const off = (1 - p) * 70;
  const move = from === "left" ? `translateX(${-off}px)` : from === "right" ? `translateX(${off}px)` : `translateY(${off}px)`;
  return (
    <div id={id} style={{ width, flex: width ? "none" : 1, minWidth: 0, opacity: Math.min(1, p * 1.6), transform: `${move} scale(${0.96 + 0.04 * p})`, visibility: p <= 0.001 ? "hidden" : "visible", ...SURFACE, ...style }}>
      {children}
    </div>
  );
}
function reveal(id: string, dur = 800) {
  sfx("open");
  to(`slot.${id}`, 1, dur, ease.expo);
}

/** Something shown over the layout, the way the app opens settings: the client dims behind it. */
function Overlay({ id, children, width }: { id: string; children?: ReactNode; width: number }) {
  useFrame();
  const p = get(`ov.${id}`, 0);
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", visibility: p <= 0.001 ? "hidden" : "visible" }}>
      <div id={id} style={{ width, opacity: p, transform: `translateY(${(1 - p) * 30}px) scale(${0.96 + 0.04 * p})`, padding: 24, ...SURFACE, borderRadius: "var(--gryt-radius-lg)", pointerEvents: "auto" }}>{children}</div>
    </div>
  );
}
function Dim() {
  useFrame();
  const p = get("dim", 0);
  return <div style={{ position: "absolute", inset: -20, borderRadius: 28, background: "rgba(8,9,12,.62)", opacity: p, pointerEvents: "none" }} />;
}

type ChatView = "empty" | "chat" | "forum" | "bot" | "live" | "voice";

export function Film() {
  const [channels, setChannels] = useState<Channel[]>([ch("general", "general")]);
  const [items, setItems] = useState<SidebarItem[]>([{ id: "i-general", kind: "channel", channelId: "general", position: 10 }]);
  const [selected, setSelected] = useState<string | null>("general");
  const [createOpen, setCreateOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [servers, setServers] = useState<string[]>([]);
  const [members, setMembers] = useState([ME]);
  const [feed, setFeed] = useState<Line[]>([]);
  const react = (src: string, msg: { message_id: string }, who = "u-me") => setFeed((l) => l.map((x) => {
    if (x.id !== msg.message_id) return x;
    const rs = [...(x.reactions ?? [])];
    const at = rs.findIndex((r) => r.src === src);
    if (at < 0) rs.push({ src, amount: 1, users: [who] });
    else if (!rs[at].users.includes(who)) rs[at] = { ...rs[at], amount: rs[at].amount + 1, users: [...rs[at].users, who] };
    return { ...x, reactions: rs };
  }));
  const [typing, setTyping] = useState<typeof FRIENDS>([]);
  const [shownCard, setCard] = useState<(typeof FRIENDS)[number] | null>(null);
  const [view, setView] = useState<ChatView>("empty");
  const [clients, setClients] = useState<Clients>({});
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [cams, setCams] = useState<string[]>([]);
  const [settingsTab, setSettingsTab] = useState("overview");
  useEffect(() => {
    const made = (e: Event) => { setServers((s) => [...s, (e as CustomEvent<string>).detail]); sfx("create"); };
    window.addEventListener("motion:server-created", made);
    return () => window.removeEventListener("motion:server-created", made);
  }, []);
  // Dialogs stay where the app portals them, over the screen, so they report the same place they paint.
  const dialogHost = { current: document.body };


  const createChannel = (o: NewChannelOptions) => {
    const id = o.name;
    setChannels((cs) => [...cs, ch(id, o.name, { type: o.type, layout: o.layout, automated: o.automated })]);
    setItems((is) => [...is, { id: `i-${id}`, kind: "channel", channelId: id, position: ({ lounge: 20, clips: 12 } as Record<string, number>)[id] ?? 50 }]);
    if (o.type !== "voice") setSelected(id);
    sfx("create");
  };

  useEffect(() => {
    (async () => {
      await document.fonts.ready;
      watchActivity();
      set("layout.o", 1); set("layout.s", 1); set("layout.y", 0);
      const DIALOG = '[role="dialog"]';

      // Act 1: the rail on its own, and a server made from its +.
      await wait(60);
      set("cur.x", 1180); set("cur.y", 760);
      // Only the +, alone in the middle of the frame.
      set("rail.extra", 0);
      // Measured where the rail ends up, not where its entrance starts.
      set("slot.s-rail", 1);
      await wait(40);
      await frame(["#addserver"], { fill: 0.16, cut: true, rx: 0, ry: 0 });
      // Gryt spawns where the + is; the + appears behind him as he moves aside.
      set("plus.o", 0);
      await wait(80);
      placeOn($("#addserver")!);
      set("guide.o", 1); set("owl.scale", 0); set("owl.rise", -1); set("owl.paws", 0);
      to("owl.scale", 1, 700, ease.spring);
      sfx("appear");
      await hold(600);
      to("owl.rise", -0.55, 600, ease.out);
      await hold(600);
      to("owl.rise", 0, 420, ease.spring);
      to("owl.paws", 1, 420, ease.out);
      await hold(300);
      // Hello first, from where the + will be: a wave and a smile.
      const hi = wave(2800);
      const hello = say("Hey! I'm Gryt! Let's make a server together.", undefined, undefined, "happy");
      await hold(1600);
      to("plus.o", 1, 600, ease.spring);
      await hi;
      setMood("open");
      beat("01-hello");
      await hello;
      await click(await until(() => $("#addserver")), 700);
      setAddOpen(true);
      beat("02-add-server");
      // Out to true scale: the rail, and the dialog opening beside it.
      to("rail.extra", 1, 900, ease.out);
      await frame(["#s-rail [aria-label='Direct messages']", "#addserver", "#channels button"], { fill: 0.17, dur: 1100, at: { x: 0.34, y: 0.3 }, rx: 6, ry: 9 });
      await until(() => $(DIALOG));
      await centerGroup(700);
      await until(() => $(DIALOG));
      await hold(400);
      await click(await until(() => byText("Create my own", dialogHost.current).closest("button")!), 560);
      const nameField = (await until(() => $('input[placeholder="My Server"]', dialogHost.current))) as HTMLInputElement;
      void say("I'll host it right here in my client.");
      await hold(300);
      await click(nameField, 450);
      await typeInput(nameField, "Owl City", 125);
      await hold(500);
      await click(await until(() => byText("Create", dialogHost.current, "button")), 500);
      await wait(150);
      setAddOpen(false);
      // The dialog hands focus back to + when it closes; the ring would sit there for the rest of the film.
      setTimeout(() => (document.activeElement as HTMLElement | null)?.blur(), 400);

      // The channel list attaches beside the rail: the sidebar.
      await wait(150);
      reveal("s-channels", 800);
      await hold(600);
      await say("Owl City is live!", undefined, undefined, "happy");
      setMood("open");

      // Act 2: channels, three by hand and the rest after, then folders.
      beat("03-channels");
      void say("Now some channels.", "eyes-starry", "#s-rail");
      setCreateOpen(true);
      await until(() => $(DIALOG));
      await wait(250);
      await centerGroup(800);
      let opened = true;
      const make = async (name: string, kind: string, pace = 1) => {
        if (opened) opened = false;
        else { setCreateOpen(true); sfx("open"); await wait(420 * pace); }
        const input = (await until(() => $("input[placeholder]", dialogHost.current))) as HTMLInputElement;
        await click(input, 500 * pace);
        await typeInput(input, name, 100 * pace);
        await click(await until(() => byText(kind, dialogHost.current, "span").closest("button")!), 500 * pace);
        await wait(200 * pace);
        // An automated channel starts at Nothing, so deploys never pings anyone.
        if (kind === "Automated") { await moveTo(await until(() => byText("Nothing", dialogHost.current)), 500); await hold(900); }
        await click(await until(() => byText("Create channel", dialogHost.current, "button")), 460 * pace);
        await hold(350);
      };
      await make("lounge", "Voice");
      await hold(300);
      // The rest pour in while Gryt meditates them into being.
      meditate(true);
      // A friend group's server: hangout, the creative stuff, and games.
      const extra: [string, string, Partial<Channel>][] = [
        ["clips", "clips", {}], ["memes", "memes", {}], ["late-night", "fireflies", { type: "voice" }], ["art", "art", {}], ["music", "music", {}],
        ["photos", "photos", {}], ["lfg", "lfg", {}], ["deep-rock", "deep-rock", {}], ["minecraft", "minecraft", {}],
        ["game-night", "game night", { type: "voice" }],
      ];
      const pos: Record<string, number> = { clips: 12, memes: 13, "late-night": 22, art: 30, music: 31, photos: 32, lfg: 40, "deep-rock": 41, minecraft: 42, "game-night": 43 };
      for (const [id, name, fields] of extra) {
        setChannels((cs) => [...cs, ch(id, name, fields)]);
        setItems((is) => [...is, { id: `i-${id}`, kind: "channel", channelId: id, position: pos[id] }]);
        sfx("create");
        await wait(40);
      }
      await hold(400);
      meditate(false);
      beat("04-folders");
      void say("Hmm, I need to organize these.");
      await hold(1200);
      meditate(true);
      // Gaps open where the folders go, then the folders drop into them and the channels tuck in.
      const folders: [string, string, number, string[]][] = [
        ["f-hang", "Hangout", 5, ["general", "clips", "memes", "lounge", "late-night"]],
        ["f-make", "Creative", 25, ["art", "music", "photos"]],
        ["f-games", "Games", 35, ["lfg", "deep-rock", "minecraft", "game-night"]],
      ];
      setItems((is) => [...is, ...folders.map(([id, , position]) => ({ id: `gap-${id}`, kind: "spacer" as const, spacerHeight: 34, position }))]);
      sfx("whoosh", { dur: 600 });
      await wait(650);
      // Each folder drops into its gap, then the channels hop in one at a time, each tick a semitone up.
      for (const [id, label, position] of folders) {
        setItems((is) => [...is.filter((i) => i.id !== `gap-${id}`), { id, kind: "folder" as const, label, position }]);
        sfx("create");
        await wait(240);
      }
      let k = 0;
      for (const [fid, , , chans] of folders) {
        for (const c of chans) {
          setItems((is) => is.map((i) => (i.id === `i-${c}` ? { ...i, parentItemId: fid } : i)));
          sfx("sort", { rate: 2 ** (k++ / 12) });
          await wait(95);
        }
        await wait(120);
      }
      sfx("resolve");
      await hold(700);
      meditate(false);

      // The chat area attaches, and each kind of channel shows what it is for in it.
      void frame(["#layout"], { fill: 0.8, dur: 1100, rx: 5, ry: -7 });
      await wait(150);
      reveal("s-chat", 800);
      await hold(700);
      beat("05-chat");

      // Act 4: back to general, the member list attaches, and you invite your friends.
      beat("07-invite");
      void say("Time to bring in some friends!", "eyes-happy", "#s-rail", "happy");
      await hold(500);
      await click(await until(() => byText("general", $("#s-channels"))), 520);
      setView("live");
      await wait(150);
      reveal("s-members", 800);
      await hold(450);
      await click(await until(() => $("#channels button")), 520);
      await wait(250);
      await click(await until(() => byText("Invite people", $('[role="menu"]'))), 520);
      // A synthetic click on a Base UI menu item runs it but leaves the menu open.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      (document.activeElement as HTMLElement | null)?.blur();
      await wait(100);
      await hold(250);
      await click(await until(() => byText("Copy link", $("#invite"), "button")), 480);
      setCopied(true);
      sfx("react");
      await hold(300);
      // The invite folds into a paper plane and Gryt sends it off the screen with the force.
      {
        const field = $("#invite input")!;
        pointAt(field);
        setMood("focus");
        plane = { from: stagePoint(field), born: performance.now() };
        sfx("send");
        await wait(500);
        sfx("fly", { dur: 1200 });
        await wait(1300);
        plane = null;
        relax();
        setMood("happy");
        await hold(400);
        setMood("open");
      }
      to("ov.invite", 0, 300);
      to("dim", 0, 400);
      beat("08-friends");
      await hold(500);
      void wave(3000);
      for (const [i, f] of FRIENDS.entries()) {
        setMembers((m) => [...m, f]);
        setFeed((l) => [...l, { id: `j-${i}`, who: f.nickname, text: `${f.nickname} joined the server.`, min: 1 + i, system: true }]);
        // Hellos from whoever is already in, so the server is alive from the first minute.
        sfx("join");
        await hold(130);
      }
      // Then the hellos, one after another, once everyone is in.
      await hold(400);
      for (const [n, [who, text]] of Object.values(HELLOS).entries()) {
        setFeed((l) => [...l, text === "hello-cat"
          ? { id: `h-${n}`, who, text: null, min: 20 + n, attachments: ["hello-cat.png"], enriched_attachments: [{ file_id: "hello-cat.png", mime: "image/png", size: 95_000, original_name: "hello.png", width: 368, height: 324, has_thumbnail: false, local_url: `${location.origin}/motion-assets/people/hello-cat.png` }] }
          : { id: `h-${n}`, who, text, min: 20 + n }]);
        sfx("message");
        await hold(380);
      }
      await hold(200);
      await say("My friends are here!", undefined, undefined, "happy");
      setMood("open");
      for (const nick of ["Sivert", "Pingy", "Carlo", "Al-JackEson"]) {
        const f = FRIENDS.find((x) => x.nickname === nick)!;
        const row = await until(() => [...$("#s-members")!.querySelectorAll<HTMLElement>(".member-row")].find((r) => r.querySelector(".text-sm")?.textContent?.trim() === nick));
        await touch(row);
        // The row's own open-card look, without the real popover; the card opens level with the row.
        row.setAttribute("data-card-open", "");
        { const host = flat(() => $("#card")!.parentElement!.getBoundingClientRect()); const rr = flat(() => row.getBoundingClientRect()); const k = host.width / $("#card")!.parentElement!.offsetWidth;
          cardTop = Math.max(16, Math.min((rr.top - host.top) / k - 24, $("#card")!.parentElement!.offsetHeight - 560)); }
        setCard(f);
        await wait(60);
        to("ov.card", 1, 600, ease.expo);
        // Beside the card, not over it.
        { const c = flat(() => $("#card")!.getBoundingClientRect()); const st = flat(() => $("#stage")!.getBoundingClientRect()); const k = st.width / W;
          place((c.left - st.left) / k - 110, (c.top - st.top) / k + 120, { dx: -60, dy: -80 }); }
        sfx("open");
        await hold(900);
        to("ov.card", 0, 260);
        row.removeAttribute("data-card-open");
        await wait(300);
      }
      setCard(null);
      setTyping([FRIENDS[0]]);
      await hold(500);
      setTyping([]);
      setFeed((l) => [...l, { id: "m-0", who: "Carlo", text: "Anyone wanna hop on some games? 🎮", min: 9 }]);
      sfx("message");
      await hold(900);
      setTyping([FRIENDS[1]]);
      await hold(450);
      setTyping([]);
      setFeed((l) => [...l, { id: "m-1", who: "Sivert", text: "yes!! give me **five** minutes", min: 9 }]);
      await hold(700);
      react(":catJAM:", { message_id: "m-0" }, "u-sivert"); sfx("react");
      await hold(500);
      react(":catJAM:", { message_id: "m-0" }, "u-justin"); sfx("react");
      await hold(600);
      setFeed((l) => [...l, { id: "m-2", who: "Justin", text: ":kitty_dance: :kitty_dance: :kitty_dance:", min: 9 }]);
      sfx("message");
      await hold(900);
      react(":KEKW:", { message_id: "m-1" }, "u-carlo"); sfx("react");
      await hold(900);
      // Gryt reacts too: over Carlo's message, the picker, one of the server's own emoji.
      const mira = await until(() => [...$("#s-chat")!.querySelectorAll<HTMLElement>("*")].reverse().find((e) => e.textContent?.includes("Anyone wanna hop")));
      // Gryt moves just past the right end of the hover bar first, so the bar that comes up is not under him.
      { const st = flat(() => $("#stage")!.getBoundingClientRect()), sk = st.width / W; const c = flat(() => $("#s-chat")!.getBoundingClientRect()); const m = stagePoint(mira);
        place((c.right - st.left) / sk + 55, m.y - 20, { dx: -40, dy: -90 }); await hold(600); }
      await touch(mira);
      await hold(300);
      // Hidden from the frame it is inserted, so it never shows at its default spot before it is moved.
      const hide = new MutationObserver(() => { for (const d of document.querySelectorAll<HTMLElement>("div")) if (d.style.position === "fixed" && d.style.width === "440px" && !d.dataset.placed) d.style.opacity = "0"; });
      hide.observe(document.body, { childList: true, subtree: true });
      await click(await until(() => $('#s-chat button[aria-label="React with another emoji"]')), 520);
      // The picker is position: fixed inside the tilted, scaled film, so it lands off; pin it inside the chat, right-aligned.
      const pk = await until(() => [...document.querySelectorAll<HTMLElement>("div")].find((d) => d.style.position === "fixed" && d.style.width === "440px"));
      await wait(60);
      {
        const r = flat(() => pk.getBoundingClientRect());
        const k = r.width / 440;
        const chat = flat(() => $("#s-chat")!.getBoundingClientRect());
                const dx = (chat.right - 24 * k - r.right) / k, dy = (chat.top + 48 * k - r.top) / k;
        pk.style.left = `${parseFloat(pk.style.left || "0") + dx}px`;
        const top = pk.style.bottom ? parseFloat(getComputedStyle(pk).top) : parseFloat(pk.style.top || "0");
        pk.style.bottom = "";
        pk.style.top = `${top + dy}px`;
        // Gryt steps aside to the picker's left, so its own server row stays in view.
        const st = flat(() => $("#stage")!.getBoundingClientRect()), sk = st.width / W;
        const p2 = flat(() => pk.getBoundingClientRect());
        place((p2.left - st.left) / sk - 90, (p2.top - st.top) / sk + 110, { dx: -60, dy: -80 });
        hide.disconnect();
        pk.dataset.placed = "1";
        pk.style.transition = "opacity 180ms ease-out";
        pk.style.opacity = "1";
      }
      await hold(500);
      await click(await until(() => $('img[src*="/motion-assets/emoji/gryt"]')?.closest<HTMLElement>("button, [role=option], [role=gridcell]")), 600);
      // The pointer "leaves" the message, so its hover bar goes away after the reaction.
      mira.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
      await hold(800);
      sfx("react");
      await hold(400);

      beat("09-reply");
      const editable = await until(() => $("#composer [contenteditable]"));
      await click(editable, 450);
      await type("I'm in! ", 95);
      await type(":w", 120);
      await wait(260);
      await type("ig", 180);
      await wait(520);
      key(editable, "Enter");
      sfx("react");
      await hold(500);
      await click(await until(() => $('#composer button[aria-label="Send message"]')), 450);
      await hold(500);

      // Your friends head into the lounge; it fills up in the channel list.
      for (const [i, f] of FRIENDS.slice(0, 3).entries()) {
        setClients((c) => ({ ...c, [`c-${i}`]: { serverUserId: f.serverUserId, nickname: f.nickname, isMuted: false, isDeafened: false, color: "#968ff8", streamID: `s-${i}`, hasJoinedChannel: true, voiceChannelId: "lounge", isConnectedToVoice: true, isAFK: false } }));
        sfx("voice");
        await hold(400);
      }
      // Straight off to get dressed from where he is; the lounge line comes once he is back.
      const home = get("c.x");
      await dressUp(
        async () => { flight(-1, 1400); camera({ x: home }, 1400); beat("10-lounge"); await hold(700); await point("Let's go!", () => byText("lounge", document.getElementById("s-channels"))); },
        () => { flight(1, 1400); camera({ x: home + 2600 }, 1400); place(960, 540, { dx: 0, dy: -80 }); },
      );
      await click(await until(() => byText("lounge", $("#s-channels"))), 560);
      // Act 5: the call. Everyone on camera as their own owl, Gryt in his outfit.
      setClients((c) => ({ ...c, me: { serverUserId: ME.serverUserId, nickname: ME.nickname, isMuted: false, isDeafened: false, color: "#968ff8", streamID: "s-me", hasJoinedChannel: true, voiceChannelId: "lounge", isConnectedToVoice: true, isAFK: false } }));
      setView("voice");
      sfx("voice");
      await hold(600);
      void frame(["#s-chat"], { fill: 0.62, dur: 1200, rx: 4, ry: -5 });
      place(1500, 300, { dx: -60, dy: -80 });
      // Cameras come on one at a time; Sivert stays on his picture.
      const clientOf: Record<string, string> = { Gryt: "me", ...Object.fromEntries(FRIENDS.slice(0, 3).map((f, i) => [f.nickname, `c-${i}`])) };
      const flag = (n: string, f: Record<string, unknown>) => setClients((c) => ({ ...c, [clientOf[n]]: { ...c[clientOf[n]], ...f } }));
      const cam = async (n: string, ms: number) => { await hold(ms); setCams((c) => [...c, n]); flag(n, { cameraEnabled: true }); sfx("cam"); };
      await cam("Carlo", 500);
      void say("We're all here!", undefined, undefined, "happy");
      await cam("Justin", 700);
      await cam("Gryt", 800);
      await hold(900);
      // Sivert shares his game, and it takes the top of the call.
      setSharing(true);
      flag("Sivert", { screenShareEnabled: true });
      sfx("share");
      await hold(600);
      // Gryt flies over beside the quality pill, points at it smiling, then touches it for the details.
      const pill = await until(() => $("#share-pill"));
      { const r = flat(() => pill.getBoundingClientRect()); const st = flat(() => $("#stage")!.getBoundingClientRect()); const k = st.width / W;
        place((r.right - st.left) / k + 80, (r.top - st.top) / k + 50, { dx: -60, dy: -80 }); }
      await hold(700);
      pointAt(pill);
      await say("Sivert is streaming at 240 fps!", undefined, undefined, "happy");
      await touch(pill, 520);
      to("pill.tip", 1, 180, ease.out);
      sfx("open");
      await hold(2400);
      to("pill.tip", 0, 160, ease.in);
      relax();
      await hold(500);

      // The sign-off: the app dims away, Gryt flies to the middle, his ring draws round him and the name lands.
      place(960, 330, { dx: 0, dy: -80 });
      void say("That's Gryt. See you in there!", undefined, undefined, "happy");
      void wave(1800);
      await hold(900);
      to("end.dim", 1, 1100, ease.inOut);
      sfx("fly", { dur: 1100 });
      to("owl.scale", 1.7, 1100, ease.inOut);
      place(960, 430);
      await hold(1300);
      to("end.ring", 1, 700, ease.out);
      sfx("appear");
      await hold(450);
      to("end.title", 1, 650, ease.spring);
      sfx("resolve");
      await hold(250);
      to("end.tag", 1, 600, ease.out);
      // Held still, so the name is what's left on screen while the music fades.
      await hold(2600);
      (window as unknown as { __done: boolean }).__done = true;
    })().catch((e) => console.error("motion:", e));
  }, []);

  const chatTitle = { empty: "general", chat: "general", forum: "support", bot: "deploys", live: "general", voice: "lounge" }[view];
  return (
    <div id="stage" style={{ position: "relative", width: W, height: H, overflow: "hidden", background: "transparent", fontFamily: "var(--gryt-font-sans, inherit)" }}>
      <style>{".gryt-dialog{left:var(--motion-dialog-x,50%)!important;translate:0 -50%!important} .gryt-dialog-backdrop{display:none} #addserver{outline:none!important} #settings-body [role=tabpanel] > div > div:first-child > span.text-sm{display:none} @keyframes motion-pop{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:none}}"}</style>
      <World>
        <Panel k="layout" x={0} y={0} zoom={1.6}>
          <div id="layout" style={{ position: "relative", display: "flex", gap: 16, padding: 16, boxSizing: "border-box", width: 1200, height: 760 }}>
            <Slot id="s-rail" from="up" style={{ flex: "none", background: "transparent", borderRadius: 0, overflow: "visible" }}><Rail servers={servers} /></Slot>
            <Slot id="s-channels" width={200} from="left" style={{ background: "transparent", borderRadius: 0, overflow: "visible" }}>
              <div id="channels" className="flex flex-col h-full w-full items-center gap-4">
                <ServerHeader serverName={servers[0] ?? "Owl City"} serverHost="motion.gryt" onLeave={() => {}} role="owner" canManageChannels onOpenSettings={() => { to("dim", 1, 400); to("ov.settings", 1, 700, ease.expo); sfx("open"); }} onOpenInvites={() => { to("dim", 1, 400); to("ov.invite", 1, 600, ease.expo); sfx("open"); }} />
                {/* ServerSidebar's own wrapper: the list scrolls inside the panel rather than running past it. */}
                <div style={{ flex: 1, width: "100%", minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto", padding: "2px 6px" }}>
                <ChannelList
                  channels={channels} items={items} serverHost={location.host} clients={clients} members={members as never} currentChannelId={view === "voice" ? "lounge" : ""} currentServerConnected={view === "voice" ? location.host : null}
                  showVoiceView={view === "voice"} isConnecting={false} selectedChannelId={selected} onChannelClick={(c) => setSelected(c.id)} clientsSpeaking={{}}
                />
                </div>
              </div>
            </Slot>
            <Slot id="s-chat" from="right" style={{ background: "var(--gryt-neutral-3)", borderRadius: "var(--gryt-radius-lg)" }}>
              <div className="flex min-w-0 grow flex-col p-3" style={{ height: "100%", boxSizing: "border-box" }}>
                <div className="flex min-w-0 items-center gap-2" data-gryt="chat-header" style={{ marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid var(--gryt-neutral-6)" }}>
                  <PiChatTeardropTextFill size={18} style={{ color: "var(--gryt-neutral-11)" }} />
                  <span className="min-w-0 truncate text-lg font-bold" style={{ color: "var(--gryt-neutral-12)" }}>{chatTitle}</span>
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: view === "forum" ? "flex-start" : "flex-end" }}>
                  {view === "chat" && <Messages lines={PEOPLE} />}
                  {view === "forum" && <Forum />}
                  {view === "bot" && <Messages lines={AUTOMATED} />}
                  {view === "voice" && <VoiceGrid people={["Gryt", ...FRIENDS.slice(0, 3).map((f) => f.nickname)]} cams={cams} share={sharing ? { src: "/motion-assets/cs2-120.mp4", title: "Sivert · Counter-Strike 2" } : null} />}
                  {view === "live" && <><Messages lines={feed} serverHost={EMOJI_HOST} onReaction={react} /><div style={{ height: 22 }}><Typing who={typing} /></div></>}
                </div>
                <div id="composer" style={{ flex: "none", paddingTop: 8 }}>
                  <ChatEditor placeholder={`Message #${chatTitle}`} onSend={(text) => { setFeed((l) => [...l, { id: `me-${l.length}`, who: "Gryt", text, min: 10 }]); sfx("send"); }} serverHost={EMOJI_HOST} allowFiles />
                </div>
              </div>
            </Slot>
            <Slot id="s-members" width={260} from="right" style={{ background: "transparent", borderRadius: 0 }}><Members members={members} /></Slot>
            <Dim />
            <Overlay id="settings" width={1000}><Settings tab={settingsTab} setTab={setSettingsTab} /></Overlay>
            <Overlay id="invite" width={480}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontWeight: 800, fontSize: 17 }}>Invite people</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}><TextField readOnly value="gryt.chat/invite/owl-city-7Kq2" /></div>
                  <Button size="small">{copied ? "Copied" : "Copy link"}</Button>
                </div>
              </div>
            </Overlay>
            <CardOverlay card={shownCard} />
          </div>
        </Panel>
      </World>
      <DialogPlacer />
      <Overhead><EndCard /><Wardrobe /><PaperPlane /><Caret /><Cursor /><Guide /></Overhead><LiveMembers />
      <AddNewServer showAddServer={addOpen} setShowAddServer={setAddOpen} />
      <CreateChannelDialog open={createOpen} onOpenChange={setCreateOpen} editor={{ createChannel, effectiveSidebarItems: items }} />
    </div>
  );
}

const SETTINGS_TABS = [
  { group: "General", tabs: [{ value: "overview", label: "Overview", Icon: PiGearFill }, { value: "invites", label: "Invites", Icon: PiLinkFill }] },
  { group: "People", tabs: [{ value: "roles", label: "Members", Icon: PiUsersThreeFill }, { value: "role-editor", label: "Role editor", Icon: PiShieldCheckFill }] },
  { group: "Channels", tabs: [{ value: "permission-templates", label: "Channel permissions", Icon: PiShieldCheckFill }] },
];

/** Server settings, drawn with the same Tabs and tab list as ServerSettingsModal. */
function Settings({ tab, setTab }: { tab: string; setTab: (t: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: 600 }}>
      <div style={{ fontWeight: 800, fontSize: 18 }}>Server settings</div>
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))} orientation="vertical" style={{ flex: 1, minHeight: 0 }}>
        <div className="flex gap-4 h-full min-w-0 flex-1">
          <div style={{ width: 200, flexShrink: 0 }}>
            <Tabs.List aria-label="Server settings" className="gap-1">
              {SETTINGS_TABS.map((g, i) => (
                <div key={g.group} style={{ display: "contents" }}>
                  <span className="text-xs font-bold text-gryt-muted" style={{ padding: "0 12px", marginTop: i ? 12 : 0 }}>{g.group}</span>
                  {g.tabs.map(({ value, label, Icon }) => <Tabs.Tab key={value} value={value}><Icon size={16} />{label}</Tabs.Tab>)}
                </div>
              ))}
              <Tabs.Indicator />
            </Tabs.List>
          </div>
          <div id="settings-body" style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
            <Tabs.Panel value="overview"><span className="text-sm text-gryt-muted">Owl City · running on this computer</span></Tabs.Panel>
            <Tabs.Panel value="role-editor"><RoleEditor /></Tabs.Panel>
            <Tabs.Panel value="permission-templates"><div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Team</div><FolderPermissions /></Tabs.Panel>
          </div>
        </div>
      </Tabs>
    </div>
  );
}

/** After the nth join, who says what. */
const HELLOS: Record<number, [string, string]> = {
  1: ["Carlo", "Yoooo"],
  2: ["Sivert", "Hey! :kitty_dance:"],
  3: ["Justin", "hello-cat"],
  4: ["Pingy", "owl city?? love it"],
  6: ["Justin", ":catJAM:"],
  9: ["Leo", "someone put Fireflies on in the lounge 🎶"],
  11: ["Sable", "🦉✨✨✨"],
};

let cardTop = 90;

let plane: { from: { x: number; y: number }; born: number } | null = null;

/** The invite as a paper plane: it folds up where the link was, then sails off the right edge. */
function PaperPlane() {
  useFrame();
  if (!plane) return null;
  const t = performance.now() - plane.born;
  const fold = Math.min(1, ease.spring(Math.min(1, t / 450)));
  const p = Math.max(0, Math.min(1, (t - 500) / 1200));
  const e = ease.in(p);
  const x = plane.from.x + e * (W + 300 - plane.from.x) - Math.sin(p * Math.PI) * 40;
  const y = plane.from.y - Math.sin(p * Math.PI * 0.9) * 260 + p * 40;
  const dx = W + 300 - plane.from.x, dy = -Math.cos(p * Math.PI * 0.9) * 260 * Math.PI * 0.9 + 40;
  const angle = p > 0 ? (Math.atan2(dy, dx) * 180) / Math.PI : -8;
  return (
    <svg width="84" height="84" viewBox="0 0 24 24" style={{ position: "absolute", left: x - 42, top: y - 42, zIndex: 48, transform: `rotate(${angle}deg) scale(${fold})`, filter: "drop-shadow(0 10px 16px rgba(0,0,0,.45))" }}>
      <path d="M2 11.5 22 3l-6.5 18-4-7.2z" fill="#f4f2ff" />
      <path d="M11.5 13.8 22 3 9.2 15.6l1 4.6z" fill="#cfc9f5" />
    </svg>
  );
}

/** A member card opened from the list, the way it pops out beside it in the app. */
function CardOverlay({ card }: { card: (typeof FRIENDS)[number] | null }) {
  useFrame();
  const p = get("ov.card", 0);
  return (
    <div id="card" style={{ position: "absolute", right: 262, top: cardTop, width: 320, opacity: p, transform: `translateX(${(1 - p) * 24}px) scale(${0.96 + 0.04 * p})`, visibility: p <= 0.001 ? "hidden" : "visible" }}>
      {card && <Card member={card} />}
      <LiveCard name={p > 0.01 ? card?.nickname ?? null : null} />
    </div>
  );
}
