/**
 * Search index for the settings modal.
 *
 * Every entry points at a control that exists in the UI. The `id` is the anchor
 * SettingGroup renders, derived from the title by the same `settingAnchorId`
 * below, so a search hit can always scroll to its control.
 *
 * Titles here are the stable part only. Several settings render their value in
 * the title ("Microphone Volume: 50%"), so the anchor uses the text before the
 * colon and stays put as the value changes.
 *
 * Entries flagged `panel: true` are whole panels with bespoke UI rather than
 * setting rows, so they match by name and land you on the panel.
 *
 * Generated from the title/description props in the settings components. If a
 * title changes and this is not updated, SettingGroup logs a warning in dev
 * rather than letting the entry silently stop matching.
 */

export interface SettingsIndexEntry {
  id: string;
  title: string;
  description: string;
  destination: string;
  section: string;
  /** A whole panel rather than an individual control. */
  panel?: boolean;
}

/** Stable anchor id for a setting title, ignoring any ": value" suffix. */
export function settingAnchorId(title: string): string {
  return title
    .split(":")[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const SETTINGS_INDEX: SettingsIndexEntry[] = [
  { id: "updates", title: "Updates", description: "Check for updates and see your current version.", destination: "updates", section: "About", panel: true },
  { id: "profile", title: "Profile", description: "Your display name, avatar and identity.", destination: "you", section: "Profile", panel: true },
  { id: "security", title: "Security", description: "Your keypair, sessions and account security.", destination: "you", section: "Security", panel: true },
  { id: "server-identities", title: "Server identities", description: "Servers Gryt recognises by their identity key, and any it has blocked for answering with a different one. Unblock a server you rebuilt yourself.", destination: "you", section: "Server identities", panel: true },
  { id: "microphone-volume", title: "Microphone volume", description: "Your microphone input level (100% = unchanged, 200% = 2x boost)", destination: "sound-video", section: "Microphone" },
  { id: "test-microphone-playback", title: "Test microphone", description: "Hear yourself through your speakers or headphones, to check what the processing is doing.", destination: "sound-video", section: "Microphone" },
  { id: "noise-reduction-rnnoise", title: "Noise reduction", description: "Removes background noise before your voice is sent. Runs in an AudioWorklet off the main thread, and adds about 20 ms.", destination: "sound-video", section: "Microphone" },
  { id: "auto-gain", title: "Auto gain", description: "Brings your microphone to a target volume. Quiet speech is boosted, loud speech is reduced.", destination: "sound-video", section: "Microphone" },
  { id: "target-level", title: "Target level", description: "The volume your voice is brought to. Lower is quieter, higher is louder.", destination: "sound-video", section: "Microphone" },
  { id: "compressor", title: "Compressor", description: "Narrows the gap between your quietest and loudest, so your level stays steadier. Runs after auto gain.", destination: "sound-video", section: "Microphone" },
  { id: "compression-amount", title: "Compression amount", description: "How aggressively to compress. Low = subtle leveling, high = heavy squash.", destination: "sound-video", section: "Microphone" },
  { id: "output-volume", title: "Output volume", description: "Volume of all incoming audio (100% = unchanged, 200% = 2x boost)", destination: "sound-video", section: "Playback" },
  { id: "input-mode", title: "Input mode", description: "Voice activity transmits whenever you speak above the noise gate. Push to talk only transmits while you hold a key.", destination: "sound-video", section: "Voice" },
  { id: "afk-timeout", title: "AFK timeout", description: "You are marked AFK after this many minutes of silence, and only while you are connected to voice.", destination: "behaviour", section: "Voice" },
  { id: "flip-camera", title: "Flip camera", description: "Flips the video everyone else sees. This changes the stream itself, not just your preview.", destination: "sound-video", section: "Camera" },
  { id: "keep-my-face-centred", title: "Keep my face centred", description: "Detects where your face is and tells the others, so their crop of your camera follows you instead of cutting you off. Detection runs on your machine; only two numbers are sent.", destination: "sound-video", section: "Camera" },
  { id: "mirror-preview", title: "Mirror preview", description: "Mirrors your own preview. Nobody else sees any difference.", destination: "sound-video", section: "Camera" },
  { id: "appearance", title: "Appearance", description: "Theme, accent colour, radius and UI scale.", destination: "looks", section: "Theme", panel: true },
  { id: "tile-layout", title: "Tile layout", description: "How the voice grid arranges people once it is maximised or fullscreen. Match Google Meet allows tall narrow tiles and more columns; Biggest tiles picks whichever arrangement makes them largest.", destination: "looks", section: "Theme" },
  { id: "smiley-conversion", title: "Smiley conversion", description: "Turns typed smileys into emoji as you write them.", destination: "looks", section: "Chat" },
  { id: "blur-profanity", title: "Blur profanity", description: "Blurs profane words when the server has profanity filtering set to flag. Click a blurred word to reveal it.", destination: "looks", section: "Chat" },
  { id: "hotkeys", title: "Hotkeys", description: "Keyboard shortcuts, including your push-to-talk key.", destination: "behaviour", section: "Hotkeys", panel: true },
  { id: "unread-message-badge", title: "Unread message badge", description: "Show an unread message count on the taskbar icon when the app is not focused.", destination: "behaviour", section: "Notifications" },
  { id: "start-with-windows", title: "Start with Windows", description: "Launches Gryt when you sign in to Windows.", destination: "behaviour", section: "Desktop" },
  { id: "start-minimized-on-login", title: "Start minimized on login", description: "Only applies when Gryt is launched automatically on sign-in. Manual launches will still show the window.", destination: "behaviour", section: "Desktop" },
  { id: "minimize-to-tray-on-close", title: "Minimize to tray on close", description: "Closing the window hides Gryt in the system tray instead of quitting it.", destination: "behaviour", section: "Desktop" },
  { id: "hardware-acceleration", title: "Hardware acceleration", description: "Uses your GPU for rendering. Turn it off if you see visual glitches or high GPU usage. Changing this restarts Gryt.", destination: "behaviour", section: "Desktop" },
  { id: "esports-mode", title: "eSports mode", description: "Lowest possible latency. Disables all audio processing, enables push-to-talk, caps bitrate at 128kbps (studio quality), and optimizes Opus packetization (10ms frames).", destination: "sound-video", section: "Voice" },
  { id: "experimental-screen-share", title: "Experimental screen share", description: "Unlock high frame rate options (144, 165, 240 FPS) for screen sharing. These require significant bandwidth and may not work on all hardware.", destination: "sound-video", section: "Screen share" },
  { id: "addons", title: "Addons", description: "Extensions that add features to Gryt.", destination: "extensions", section: "Addons", panel: true },
  { id: "support-gryt", title: "Support Gryt", description: "Ways to support the project.", destination: "support", section: "Support", panel: true }
];

/**
 * Case-insensitive match across titles, descriptions and section names.
 *
 * Results come back in the order the settings appear on screen — destinations
 * in sidebar order, then controls in the order their panel renders them —
 * rather than by how well each one matched. Scanning results then feels like
 * scanning the panel, and two results that sit next to each other in the list
 * sit next to each other in the UI.
 *
 * The trade-off is that a description-only match can appear above an exact
 * title match. SETTINGS_INDEX is stored in render order, so position in that
 * array is the sort key.
 */
export function searchSettings(query: string): SettingsIndexEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  return SETTINGS_INDEX.filter((entry) =>
    entry.title.toLowerCase().includes(q) ||
    entry.section.toLowerCase().includes(q) ||
    entry.description.toLowerCase().includes(q),
  );
}
