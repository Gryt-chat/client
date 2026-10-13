import { Tooltip } from "@gryt/ui";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { getServerAccessToken } from "@/common";

import { PiCheckCircleFill } from "../../../../lib/icons";
import { useServerPermissions } from "../hooks/usePermissions";
import { useSockets } from "../hooks/useSockets";
import { endsInText, nextPicks, pollPercent, type PublicPoll } from "../utils/polls";
import type { MemberInfo } from "./MemberSidebar";

interface PollCardProps {
  poll: PublicPoll;
  conversationId: string;
  messageId: string;
  serverHost: string | undefined;
  currentUserId: string | undefined;
  memberList?: Record<string, MemberInfo>;
}

/** A poll in a message (GRYT-1732): options to pick before you vote, bars after. */
export function PollCard({ poll, conversationId, messageId, serverHost, currentUserId, memberList }: PollCardProps) {
  const { sockets } = useSockets();
  const { roles, roleIds, canIn } = useServerPermissions(serverHost ?? "");
  // Ticks over so "ends in" counts down and an ended poll locks without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!poll.ends_at || poll.closed) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [poll.ends_at, poll.closed]);

  const mine = poll.mine ?? [];
  const ended = poll.closed || (!!poll.ends_at && new Date(poll.ends_at).getTime() <= now);
  const roleOk = !poll.allowed_roles || poll.allowed_roles.some((r) => roleIds.includes(r));
  const mayVote = !ended && roleOk && canIn(conversationId, "add_reactions") && !!currentUserId;
  const showResults = ended || mine.length > 0 || !mayVote;
  const top = Math.max(0, ...poll.options.map((o) => o.count));

  const send = (choices: number[]) => {
    const socket = serverHost ? sockets[serverHost] : undefined;
    const accessToken = getServerAccessToken(serverHost ?? "");
    if (!socket || !accessToken) {
      toast.error("Not connected to this server.");
      return;
    }
    socket.emit("poll:vote", { conversationId, messageId, choices, accessToken });
  };

  const nameOf = (id: string) => {
    if (id === currentUserId) return "You";
    return Object.values(memberList ?? {}).find((m) => m.serverUserId === id)?.nickname ?? "Someone";
  };

  const roleNames = (poll.allowed_roles ?? []).map((id) => roles.find((r) => r.id === id)?.name ?? id);
  const ends = ended ? null : endsInText(poll.ends_at, now);
  const votes = `${poll.voter_count} vote${poll.voter_count === 1 ? "" : "s"}`;

  return (
    <div className="poll-card" role="group" aria-label={`Poll: ${poll.question}`}>
      <div className="poll-question">{poll.question}</div>
      {!showResults && <div className="poll-sub">{poll.multi ? "Pick one or more" : "Pick one"}</div>}
      <div className="poll-options" role={poll.multi ? "group" : "radiogroup"}>
        {poll.options.map((o, i) => {
          const picked = mine.includes(i);
          const pct = pollPercent(o.count, poll.voter_count);
          const winner = ended && o.count > 0 && o.count === top;
          const row = (
            <button
              key={i}
              type="button"
              className="poll-option"
              role={poll.multi ? "checkbox" : "radio"}
              aria-checked={picked}
              aria-disabled={!mayVote || undefined}
              data-results={showResults || undefined}
              data-picked={picked || undefined}
              data-winner={winner || undefined}
              onClick={() => { if (mayVote) send(nextPicks(poll, mine, i)); }}
            >
              {showResults && <span className="poll-bar" style={{ width: `${pct}%` }} />}
              <span className="poll-option-row">
                {showResults
                  ? picked && <span className="poll-check"><PiCheckCircleFill size={18} /></span>
                  : <span className="poll-dot" data-multi={poll.multi || undefined} />}
                <span className="poll-option-text">{o.text}</span>
                {showResults && (
                  <>
                    <span className="poll-pct">{pct}%</span>
                    <span className="poll-count">{o.count} vote{o.count === 1 ? "" : "s"}</span>
                  </>
                )}
              </span>
            </button>
          );
          // Who picked it, unless the poll is anonymous or nobody has.
          if (!o.voters || o.voters.length === 0) return row;
          return (
            <Tooltip key={i} title={o.voters.map(nameOf).join(", ")}>
              {row}
            </Tooltip>
          );
        })}
      </div>
      <div className="poll-foot">
        {ended ? `Final results · ${votes}` : [votes, ends].filter(Boolean).join(" · ")}
        {poll.anonymous && " · anonymous"}
        {!ended && mine.length > 0 && mayVote && (
          <>
            {" · "}
            <button type="button" className="poll-link" onClick={() => send([])}>Take back vote</button>
          </>
        )}
        {roleNames.length > 0 && <div>Only {listOf(roleNames)} can answer</div>}
      </div>
    </div>
  );
}

function listOf(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
