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

/** The server a conversation is on, beside its name in the chat header. */
export function ServerChip({ name, icon }: { name: string; icon: string }) {
  return (
    <Chip
      tone="neutral"
      title={name}
      className="overflow-hidden px-2 py-0.5 font-normal text-gryt-muted"
      /* Gives way before the name does, down to the icon, its padding and its border. */
      style={{ flexShrink: 1000, minWidth: "calc(14px + 1rem + 2px)" }}
      icon={
        <span className="block shrink-0 overflow-hidden" style={{ width: 14, height: 14, borderRadius: 4 }}>
          <ServerMark src={icon} seed={name} />
        </span>
      }
    >
      <span className="truncate">{name}</span>
    </Chip>
  );
}
