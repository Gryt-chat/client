import { useEffect, useState } from "react";

import { useSockets } from "@/socket";

/** Per device, like gryt.hasSeenWelcome: signing in on this device doesn't show it again. */
const SEEN = "gryt.hasSeenOwnerTour";

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN) === "true";
  } catch {
    return false;
  }
}

/** The server an owner tour is running for: the first one this person owns, or one asked for from its settings. */
export function useOwnerTour(host: string | null, firstTourShowing: boolean) {
  const { serverDetailsList } = useSockets();
  const isOwner = Boolean(host && serverDetailsList[host]?.server_info?.is_owner);
  const [tourHost, setTourHost] = useState<string | null>(null);

  useEffect(() => {
    if (!host || !isOwner || firstTourShowing || tourHost) return;
    if (seen()) return;
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
    try {
      localStorage.setItem(SEEN, "true");
    } catch {
      // Unwritable storage only means it may show once more.
    }
    setTourHost(null);
  };
  return { ownerTourHost: tourHost, finishOwnerTour: finish };
}
