import { Button } from "@gryt/ui";
import toast from "react-hot-toast";

import { sendOurCopy } from "../mls/serverMls";

/** Answered this session, so an ask sent again while they wait doesn't bring the card back. */
const answered = new Set<string>();

/** Somebody you trust is missing messages from your DM: one card, and sending is one click. */
export function showHistoryAsk(host: string, conversationId: string, from: string, name: string): void {
  const id = `history-ask-${host}-${conversationId}-${from}`;
  if (answered.has(id)) return;
  const send = async () => {
    answered.add(id);
    toast.dismiss(id);
    try {
      const sent = await sendOurCopy(host, conversationId, from);
      toast.success(`Sent ${name} your copy: ${sent} message${sent === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t send your copy");
    }
  };
  toast(
    () => (
      <div className="flex flex-col gap-2" style={{ minWidth: 0 }}>
        <span className="text-sm font-semibold">{name} is missing messages from your chat</span>
        <span className="text-xs" style={{ lineHeight: 1.5, color: "var(--gryt-neutral-11)" }}>
          Their device can&rsquo;t open what was sent before it joined. You can send them your copy. It&rsquo;s encrypted to them, like any message.
        </span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button tone="neutral" size="xsmall" onClick={() => { answered.add(id); toast.dismiss(id); }}>Not now</Button>
          <Button size="xsmall" onClick={() => void send()}>Send my copy</Button>
        </div>
      </div>
    ),
    { id, duration: Infinity },
  );
}
