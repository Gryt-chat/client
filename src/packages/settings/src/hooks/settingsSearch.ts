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
  { id: "security", title: "Security", description: "Your recovery key and account passkeys.", destination: "account", section: "Security", panel: true },
  { id: "server-identities", title: "Server identities", description: "Servers Gryt recognises by their identity key, and any it has blocked for answering with a different one. Unblock a server you rebuilt yourself.", destination: "account", section: "Server identities", panel: true },
  { id: "my-servers", title: "My servers", description: "The server Gryt runs on this machine. Start it, stop it, read its logs, and choose whether it starts with the app.", destination: "my-servers", section: "My servers", panel: true },
  { id: "microphone-volume", title: "Microphone volume", description: "Your microphone input level (100% = unchanged, 200% = 2x boost)", destination: "sound-video", section: "Microphone" },
  { id: "test-microphone", title: "Test microphone", description: "Hear yourself through your speakers or headphones, to check what the processing is doing.", destination: "sound-video", section: "Microphone" },
  { id: "noise-reduction", title: "Noise reduction", description: "Removes background noise before your voice is sent. Runs in an AudioWorklet off the main thread, and adds about 20 ms.", destination: "sound-video", section: "Microphone" },
  { id: "auto-gain", title: "Auto gain", description: "Brings your microphone to a target volume. Quiet speech is boosted, loud speech is reduced.", destination: "sound-video", section: "Microphone" },
  { id: "target-level", title: "Target level", description: "The volume your voice is brought to. Lower is quieter, higher is louder.", destination: "sound-video", section: "Microphone" },
  { id: "compressor", title: "Compressor", description: "Narrows the gap between your quietest and loudest, so your level stays steadier. Runs after auto gain.", destination: "sound-video", section: "Microphone" },
  { id: "compression-amount", title: "Compression amount", description: "How aggressively to compress. Low = subtle leveling, high = heavy squash.", destination: "sound-video", section: "Microphone" },
  { id: "output-volume", title: "Output volume", description: "Volume of all incoming audio (100% = unchanged, 200% = 2x boost)", destination: "sound-video", section: "Playback" },
  { id: "input-mode", title: "Input mode", description: "Voice activity transmits whenever you speak above the noise gate. Push to talk only transmits while you hold a key, and hides the gate below.", destination: "sound-video", section: "Audio" },
  { id: "afk-timeout", title: "AFK timeout", description: "You are marked AFK after this many minutes of silence, and only while you are connected to voice.", destination: "behaviour", section: "Voice" },
  { id: "flip-camera", title: "Flip camera", description: "Flips the video everyone else sees. This changes the stream itself, not just your preview.", destination: "sound-video", section: "Camera" },
  { id: "center-my-face-automatically", title: "Center my face automatically", description: "Works out where your face is so everyone else's crop of your camera follows you instead of cutting you off. Detection runs on your machine; only two numbers are sent, never video.", destination: "sound-video", section: "Camera" },
  { id: "mirror-preview", title: "Mirror preview", description: "Mirrors your own preview. Nobody else sees any difference.", destination: "sound-video", section: "Camera" },
  { id: "appearance", title: "Appearance", description: "Mode, themes, UI scale and text size.", destination: "looks", section: "Theme", panel: true },
  { id: "theme", title: "Theme", description: "Build one on ui.gryt.chat, press Copy link, and paste it here. A theme is a couple of dozen hex values, so a link is the whole thing.", destination: "looks", section: "Appearance" },
  { id: "tile-layout", title: "Tile layout", description: "How the voice grid arranges people once it is maximised or fullscreen. Match Google Meet allows tall narrow tiles and more columns; Biggest tiles picks whichever arrangement makes them largest.", destination: "looks", section: "Appearance" },
  { id: "two-person-layout", title: "Two people", description: "What a channel with exactly two people in it looks like. One large and one small puts the other person in the panel and you in the corner; same size gives you both the same tile, stacked in the sidebar and side by side once there is room.", destination: "looks", section: "Appearance" },
  { id: "smiley-conversion", title: "Smiley conversion", description: "Turns typed smileys into emoji as you write them.", destination: "looks", section: "Chat" },
  { id: "blur-profanity", title: "Blur profanity", description: "Blurs profane words when the server has profanity filtering set to flag. Click a blurred word to reveal it.", destination: "looks", section: "Chat" },
  { id: "hotkeys", title: "Hotkeys", description: "Keyboard shortcuts, including your push-to-talk key.", destination: "behaviour", section: "Hotkeys", panel: true },
  { id: "push-to-talk-key", title: "Push to Talk Key", description: "Hold this key to transmit your microphone. Only shown while input mode is push to talk.", destination: "behaviour", section: "Hotkeys" },
  { id: "toggle-mute", title: "Toggle mute", description: "Toggle your microphone on or off.", destination: "behaviour", section: "Hotkeys" },
  { id: "toggle-deafen", title: "Toggle deafen", description: "Mute all incoming audio and your microphone.", destination: "behaviour", section: "Hotkeys" },
  { id: "disconnect", title: "Disconnect", description: "Disconnect from the current voice channel.", destination: "behaviour", section: "Hotkeys" },
  { id: "unread-message-badge", title: "Unread message badge", description: "Show an unread message count on the taskbar icon when the app is not focused.", destination: "behaviour", section: "Notifications" },
  { id: "start-with-windows", title: "Start with Windows", description: "Launches Gryt when you sign in to Windows.", destination: "behaviour", section: "Desktop" },
  { id: "start-minimized-on-login", title: "Start minimized on login", description: "Only applies when Gryt is launched automatically on sign-in. Manual launches will still show the window.", destination: "behaviour", section: "Desktop" },
  { id: "minimize-to-tray-on-close", title: "Minimize to tray on close", description: "Closing the window hides Gryt in the system tray instead of quitting it.", destination: "behaviour", section: "Desktop" },
  { id: "hardware-acceleration", title: "Hardware acceleration", description: "Uses your GPU for rendering. Turn it off if you see visual glitches or high GPU usage. Changing this restarts Gryt.", destination: "behaviour", section: "Desktop" },
  { id: "esports-mode", title: "eSports mode", description: "Lowest possible latency. Disables all audio processing, enables push-to-talk, caps bitrate at 128kbps (studio quality), and optimizes Opus packetization (10ms frames).", destination: "sound-video", section: "Voice" },
  { id: "experimental-screen-share", title: "Experimental screen share", description: "Unlock high frame rate options (144, 165, 240 FPS) for screen sharing. These require significant bandwidth and may not work on all hardware.", destination: "sound-video", section: "Screen share" },
  // Dev builds only, the same way the Developer destination itself is. Without
  // the gate a release would offer search results for a panel that is not in
  // the bundle.
  ...(import.meta.env.DEV
    ? ([
        { id: "fake-participants", title: "Fake participants", description: "Invents people in the voice channel you are in and in the member list around it, so both can be seen at counts a single account cannot reach. They render through the real voice view and the real member list, so this proves layout and nothing about the socket path.", destination: "developer", section: "Developer" },
        { id: "in-the-voice-channel-with-you", title: "In the voice channel with you", description: "How many invented people to put in the channel, on top of anyone actually there.", destination: "developer", section: "Developer" },
        { id: "in-the-server-not-in-voice", title: "In the server, not in voice", description: "How many more to put in the member list, spread across online, AFK and offline.", destination: "developer", section: "Developer" },
        { id: "how-many-are-muted", title: "How many are muted", description: "Of the people in voice. Muted and deafened ones stay silent — nothing talks that should not be able to.", destination: "developer", section: "Developer" },
        { id: "one-is-deafened", title: "One is deafened", description: "Deafens the last one, and mutes them with it, since that is what deafening does here. The deafened badge is a different icon from the muted one.", destination: "developer", section: "Developer" },
        { id: "they-talk", title: "They talk", description: "Everyone not muted takes turns talking, in bursts of a few seconds with longer gaps. Each one gets a real silent audio track, so the halo and the speaking ring are driven by a level the same way a real participant's are.", destination: "developer", section: "Developer" },
        { id: "fake-screen-share", title: "Fake screen share", description: "Gives the first fake participant a share, backed by an animated canvas rather than a placeholder, so the tile takes the same path a real share does.", destination: "developer", section: "Developer" },
        { id: "fake-chat", title: "Fake chat", description: "Posts messages from the invented people into the channel you are looking at — mentions, custom emoji, links with previews, code blocks, replies and a wall of text. Delivered through the same handler a real message arrives on. Nothing is sent to the server.", destination: "developer", section: "Developer" },
        { id: "a-message-every", title: "A message every", description: "How often a fake message arrives, in seconds, while it is running.", destination: "developer", section: "Developer" }
      ] satisfies SettingsIndexEntry[])
    : []),
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
