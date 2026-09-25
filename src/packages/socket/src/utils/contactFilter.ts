import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import type { ContactPrefs, ContactRule } from "../../../common/src/hooks/contactPrefs.ts";

/**
 * The second check on your contact settings (GRYT-1470). A server can ignore them,
 * so each DM, new conversation and ring is judged here on this device's knowledge.
 */

/**
 * New conversations one server may open with you in a window. Five in ten minutes
 * is more than a busy day of real people and still cuts a scripted flood off early.
 */
export const FLOOD_LIMIT = 5;
export const FLOOD_WINDOW_MS = 10 * 60_000;

/** The server's own derivation (`directConversationId` in conversations.ts), so a
    one-to-one can be recognised without asking it. */
export function directConversationId(a: string, b: string): string {
  const pair = [a, b].sort();
  return `dm_${bytesToHex(sha256(utf8ToBytes(pair.join("\0")))).slice(0, 32)}`;
}

/** What this device has seen for itself on one server. */
export interface ContactKnowledge {
  /** Stands in for friends until GRYT-1471: people you wrote to one-to-one here. */
  friends: Set<string>;
  /** Conversations already let through, which the flood cap no longer counts. */
  known: Set<string>;
  /** Whether a first conversation list has been taken as the starting point. */
  baselined: boolean;
}

export function emptyKnowledge(): ContactKnowledge {
  return { friends: new Set(), known: new Set(), baselined: false };
}

export type FilteredKind = "message" | "call" | "conversation";
export type FilteredReason = "setting" | "flood" | "mismatch";

export interface FilteredEvent {
  host: string;
  conversationId: string;
  kind: FilteredKind;
  reason: FilteredReason;
  fromId: string | null;
  fromName: string | null;
  at: number;
}

/** A sliding window of admissions. */
export function createFloodLimiter(limit = FLOOD_LIMIT, windowMs = FLOOD_WINDOW_MS) {
  let admitted: number[] = [];
  return {
    admit(now: number): boolean {
      admitted = admitted.filter((t) => now - t < windowMs);
      if (admitted.length >= limit) return false;
      admitted.push(now);
      return true;
    },
  };
}

interface ConversationView {
  kind: "dm" | "group";
  members: string[];
}

export interface ContactGuardDeps {
  host: string;
  /** Your id on this server, from the token this device holds. */
  selfId: () => string | undefined;
  prefs: () => ContactPrefs;
  knowledge: ContactKnowledge;
  /** Called after knowledge changes, so it can be kept. */
  persist: () => void;
  onFiltered: (event: FilteredEvent) => void;
  now?: () => number;
  limiter?: { admit(now: number): boolean };
}

function passes(rule: ContactRule, sender: string | null, k: ContactKnowledge): boolean {
  if (rule === "everyone") return true;
  if (rule === "nobody" || !sender) return false;
  return k.friends.has(sender);
}

type Judgement = { pass: true } | { pass: false; reason: FilteredReason };

const PASS: Judgement = { pass: true };
const fail = (reason: FilteredReason): Judgement => ({ pass: false, reason });

interface SocketInternals {
  onevent: (packet: { data?: unknown[] }) => void;
  emit: (event: string, ...args: unknown[]) => unknown;
}

type Record_ = Record<string, unknown>;

const asRecord = (v: unknown): Record_ | null => (v && typeof v === "object" ? (v as Record_) : null);
const asString = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * Wraps one socket. Events that fail never reach a listener: no notification,
 * badge, unread mark or ring. Install before `guardSocket`, which restores emit.
 */
export function installContactGuard(socket: unknown, deps: ContactGuardDeps): void {
  const s = socket as SocketInternals;
  const k = deps.knowledge;
  const now = deps.now ?? (() => Date.now());
  const limiter = deps.limiter ?? createFloodLimiter();
  const views = new Map<string, ConversationView>();
  const expected = new Set<string>();
  let expectGroupUntil = 0;

  const pairWith = (other: string | null): string | null => {
    const self = deps.selfId();
    return self && other && other !== self ? directConversationId(self, other) : null;
  };

  function remember(view: unknown): void {
    const v = asRecord(view);
    const id = asString(v?.conversation_id);
    if (!v || !id) return;
    const members = Array.isArray(v.members)
      ? v.members.map((m) => asString(asRecord(m)?.server_user_id)).filter((m): m is string => !!m)
      : [];
    const other = asString(asRecord(v.other)?.server_user_id);
    if (other && !members.includes(other)) members.push(other);
    views.set(id, { kind: v.kind === "group" ? "group" : "dm", members });
  }

  /** Whether a conversation that isn't a verified one-to-one may come in. Groups are
      gated when they arrive, as on the server, and once in, stay in. */
  function admitGroup(id: string, sender: string | null): Judgement {
    if (k.known.has(id)) return PASS;
    const rule = deps.prefs().messages;
    const members = views.get(id)?.members ?? [];
    const byFriend = (sender !== null && k.friends.has(sender)) || members.some((m) => k.friends.has(m));
    if (rule === "nobody" || (rule === "friends" && !byFriend)) return fail("setting");
    return PASS;
  }

  function admitNew(id: string): Judgement {
    if (k.known.has(id)) return PASS;
    if (!limiter.admit(now())) return fail("flood");
    k.known.add(id);
    deps.persist();
    return PASS;
  }

  function judgeMessage(msg: Record_): Judgement {
    const id = asString(msg.conversation_id);
    // Channels are the server's own, and only a DM carries this prefix.
    if (!id || !id.startsWith("dm_")) return PASS;
    const sender = asString(msg.sender_server_id);
    if (sender && sender === deps.selfId()) return PASS;

    if (pairWith(sender) === id) {
      // Every message, so a stricter setting covers conversations already open.
      if (!passes(deps.prefs().messages, sender, k)) return fail("setting");
    } else {
      const group = admitGroup(id, sender);
      if (!group.pass) return group;
    }
    return admitNew(id);
  }

  function judgeOpened(view: Record_): Judgement {
    const id = asString(view.conversation_id);
    if (!id) return PASS;
    if (k.known.has(id)) return PASS;
    if (expected.delete(id) || (view.kind === "group" && now() < expectGroupUntil)) {
      k.known.add(id);
      deps.persist();
      return PASS;
    }
    if (view.kind !== "group") {
      const other = views.get(id)?.members[0] ?? null;
      if (pairWith(other) !== id) return fail("mismatch");
      if (!passes(deps.prefs().messages, other, k)) return fail("setting");
    } else {
      const group = admitGroup(id, null);
      if (!group.pass) return group;
    }
    return admitNew(id);
  }

  function judgeRing(call: Record_): Judgement {
    const id = asString(call.conversation_id);
    const sender = asString(asRecord(call.from)?.server_user_id);
    if (!id) return fail("mismatch");
    const prefs = deps.prefs();
    if (pairWith(sender) === id) {
      if (!passes(prefs.messages, sender, k) || !passes(prefs.calls, sender, k)) return fail("setting");
    } else {
      const group = admitGroup(id, sender);
      if (!group.pass) return group;
      if (!passes(prefs.calls, sender, k)) return fail("setting");
    }
    return admitNew(id);
  }

  function filtered(kind: FilteredKind, reason: FilteredReason, id: unknown, fromId: string | null, fromName: unknown): void {
    deps.onFiltered({
      host: deps.host,
      conversationId: asString(id) ?? "",
      kind,
      reason,
      fromId,
      fromName: asString(fromName),
      at: now(),
    });
  }

  /** True to deliver. */
  function inbound(event: string, payload: unknown): boolean {
    const p = asRecord(payload);
    switch (event) {
      case "dm:list": {
        const items = Array.isArray(p?.items) ? p.items : [];
        for (const item of items) remember(item);
        /* The first list this device sees is where it starts, one-to-ones counting
           as friends. Later lists name conversations but don't vouch for them. */
        if (!k.baselined) {
          for (const item of items) {
            const id = asString(asRecord(item)?.conversation_id);
            if (!id) continue;
            k.known.add(id);
            const view = views.get(id);
            const other = view?.kind === "dm" ? (view.members[0] ?? null) : null;
            if (other && pairWith(other) === id) k.friends.add(other);
          }
          k.baselined = true;
          deps.persist();
          return true;
        }
        // Later lists go through the same check, so a re-list can't bring one back.
        const kept = items.filter((item) => {
          const v = asRecord(item);
          const verdict = v ? judgeOpened(v) : PASS;
          if (verdict.pass || !v) return true;
          const other = views.get(asString(v.conversation_id) ?? "")?.members[0] ?? null;
          filtered("conversation", verdict.reason, v.conversation_id, v.kind === "group" ? null : other, asString(asRecord(v.other)?.nickname) ?? asString(v.name));
          return false;
        });
        if (p && kept.length !== items.length) p.items = kept;
        return true;
      }
      case "dm:opened": {
        if (!p) return true;
        remember(p);
        const verdict = judgeOpened(p);
        if (verdict.pass) return true;
        const other = views.get(asString(p.conversation_id) ?? "")?.members[0] ?? null;
        const name = asString(asRecord(p.other)?.nickname) ?? asString(p.name);
        filtered("conversation", verdict.reason, p.conversation_id, p.kind === "group" ? null : other, name);
        return false;
      }
      case "chat:new": {
        if (!p) return true;
        const verdict = judgeMessage(p);
        if (verdict.pass) return true;
        filtered("message", verdict.reason, p.conversation_id, asString(p.sender_server_id), p.sender_nickname);
        return false;
      }
      case "call:incoming": {
        if (!p) return false;
        const verdict = judgeRing(p);
        if (verdict.pass) return true;
        const from = asRecord(p.from);
        filtered("call", verdict.reason, p.conversation_id, asString(from?.server_user_id), from?.nickname);
        return false;
      }
      default:
        return true;
    }
  }

  function outbound(event: string, payload: unknown): void {
    const p = asRecord(payload);
    if (!p) return;
    if (event === "chat:send") {
      const id = asString(p.conversationId);
      if (!id || !id.startsWith("dm_")) return;
      const view = views.get(id);
      const other = view?.kind === "dm" ? (view.members[0] ?? null) : null;
      if (other && pairWith(other) === id) k.friends.add(other);
      k.known.add(id);
      deps.persist();
    } else if (event === "dm:open") {
      const pair = pairWith(asString(p.targetServerUserId));
      if (pair) expected.add(pair);
    } else if (event === "dm:group:create") {
      expectGroupUntil = now() + 15_000;
    }
  }

  const onevent = s.onevent.bind(socket);
  s.onevent = (packet) => {
    const args = packet?.data;
    if (Array.isArray(args) && typeof args[0] === "string" && !inbound(args[0], args[1])) return;
    onevent(packet);
  };

  const emit = s.emit.bind(socket);
  s.emit = (event: string, ...args: unknown[]) => {
    try {
      outbound(event, args[0]);
    } catch {
      // Knowledge is a convenience; the send itself must never fail on it.
    }
    return emit(event, ...args);
  };
}
