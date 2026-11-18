import { useEffect, useState } from "react";

import { getUserValue, setUserValue } from "@/settings";
import { useSockets } from "@/socket";

const SEEN = "hasSeenOwnerTour";

/** The server an owner tour is running for: the first one this person owns, or one asked for from its settings. */
export function useOwnerTour(host: string | null, firstTourShowing: boolean) {
  const { serverDetailsList } = useSockets();
  const isOwner = Boolean(host && serverDetailsList[host]?.server_info?.is_owner);
  const [tourHost, setTourHost] = useState<string | null>(null);

  useEffect(() => {
    if (!host || !isOwner || firstTourShowing || tourHost) return;
    if (getUserValue(SEEN, false)) return;
    setTourHost(host);
  }, [host, isOwner, firstTourShowing, tourHost]);

  useEffect(() => {
    const start = (event: Event) => {
      const h = (event as CustomEvent<{ host?: string }>).detail?.host;
      if (h) setTourHost(h);
    };
    window.addEventListener("owner_tour_start", start);
    return () => window.removeEventListener("owner_tour_start", start);
  }, []);

  const finish = () => {
    setUserValue(SEEN, true);
    setTourHost(null);
  };
  return { ownerTourHost: tourHost, finishOwnerTour: finish };
}
