import { createElement, useCallback } from "react";
import toast from "react-hot-toast";

import {
  ADD_PUBLIC_ADDRESS,
  hostedAdvertisement,
  isLoopbackHost,
  NO_PUBLIC_ADDRESS,
  openServerLink,
} from "@/common";

import { getElectronAPI } from "../../../../lib/electron";
import { PiInfoFill } from "../../../../lib/icons";
import { useLocale } from "../../../../lib/localeContext";
import { useServerJoinPolicy } from "./useServerJoinPolicy";

/** "Copy invite link", offered only where the server has said anyone can join. */
export function useOpenInviteLink(host: string | undefined) {
  const { t } = useLocale();
  const policy = useServerJoinPolicy(host);

  const copy = useCallback(async () => {
    if (!host) return;
    // Read at the press: every rail entry holding its own IPC listener costs more than one call.
    const embedded = isLoopbackHost(host)
      ? ((await getElectronAPI()?.getEmbeddedServerInfo().catch(() => null))?.servers ?? [])
      : [];
    const link = openServerLink(host, hostedAdvertisement(host, embedded));

    if (link.kind === "no-public-address") {
      toast.error(t(NO_PUBLIC_ADDRESS), { duration: 7000 });
      if (link.hosted) {
        toast(`${t(ADD_PUBLIC_ADDRESS).replace(/\.$/, "")}, ${t("chat.thenCopyTheLinkAgain")}`, {
          duration: 10000,
          icon: createElement(PiInfoFill, { size: 18 }),
        });
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(link.url);
      toast.success(t("chat.copiedInviteLink"));
    } catch {
      toast.error(t("chat.couldNotCopyTheLink"));
    }
  }, [host, t]);

  return { available: !!host && policy === "open", copy };
}
