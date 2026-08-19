/**
 * What is left of the client's audio package.
 *
 * Everything else moved to `@gryt/voice` and call sites now import it from
 * there directly. This is keyboard handling that writes mute and deafen, which
 * has no audio graph in it and no equivalent on a phone, so it stayed.
 */
export { useGlobalHotkeys } from "./src/hooks/useGlobalHotkeys";
