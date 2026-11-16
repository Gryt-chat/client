/** Opens the person's own settings from outside React, like `server_settings_open` does. */
export function openUserSettings(tab: string): void {
  window.dispatchEvent(new CustomEvent("user_settings_open", { detail: { tab } }));
}
