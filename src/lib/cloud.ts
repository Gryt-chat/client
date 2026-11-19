/** The Gryt Cloud console. Shared by Add a server, the first-visit welcome and the plan banners. */
export const CLOUD_CONSOLE_URL = "https://cloud.gryt.chat";

/** Buying a server from the app stays off until Gryt Cloud opens: build with `VITE_GRYT_CLOUD=1`. */
export const cloudEnabled = import.meta.env.VITE_GRYT_CLOUD === "1";
