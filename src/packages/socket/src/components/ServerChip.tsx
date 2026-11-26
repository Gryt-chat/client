import { Chip } from "@gryt/ui";
import { useState } from "react";

import { GeneratedServerIcon } from "@/common";

/* The rail's icon, from the same source, so a row or a header points back at it.
   A server with no icon answers 404 and gets the generated one. */
export function ServerMark({ src, seed }: { src: string; seed: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return <GeneratedServerIcon seed={seed} />;
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(src)}
      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}
    />
  );
}

/** The server a conversation is on, beside its name in the chat header. Clicking it opens that server. */
export function ServerChip({ name, icon, onOpen }: { name: string; icon: string; onOpen?: () => void }) {
  /* Gives way before the name does, down to the icon, its padding and its border. */
  const shrink = { flexShrink: 1000, minWidth: "calc(14px + 1rem + 2px)" };
  const chip = (
    <Chip
      tone="neutral"
      title={onOpen ? `Open ${name}` : name}
      className="overflow-hidden px-2 py-0.5 font-normal text-gryt-muted"
      style={onOpen ? { maxWidth: "100%" } : shrink}
      icon={
        <span className="block shrink-0 overflow-hidden" style={{ width: 14, height: 14, borderRadius: 4 }}>
          <ServerMark src={icon} seed={name} />
        </span>
      }
    >
      <span className="truncate">{name}</span>
    </Chip>
  );
  if (!onOpen) return chip;
  return (
    <button type="button" onClick={onOpen} className="flex cursor-pointer overflow-hidden border-0 bg-transparent p-0" style={shrink}>
      {chip}
    </button>
  );
}
