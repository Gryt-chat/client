import { createContext } from "react";

import type { ChannelName } from "@/lib/mentionTokens";

/** Who is reading, so a mention can say whether it hit them. Absent outside a chat. */
export interface MentionViewer {
  host: string | null;
  meId?: string;
  roleIds: readonly string[];
  suppressEveryone: boolean;
  /** False in a DM, where @everyone, @here and roles never ping. */
  massAllowed: boolean;
  roles: ReadonlyMap<string, { name: string; color: string | null }>;
  /** From the live channel lists, so a rename or a newly visible channel redraws. */
  channelName: ChannelName;
}

export const MentionViewerContext = createContext<MentionViewer | null>(null);
