# Flathub Submission

Files in this directory are used to publish Gryt Chat on [Flathub](https://flathub.org).

## Files

| File | Purpose |
|------|---------|
| `com.gryt.Chat.yml` | Flatpak manifest (build recipe) |
| `com.gryt.Chat.metainfo.xml` | AppStream metadata (store listing, description, releases) |
| `com.gryt.Chat.desktop` | Desktop entry (launcher, MIME handler) |
| `gryt-chat.sh` | Wrapper script (launches Electron via zypak with Wayland support) |
| `icon.png` | Application icon (512x512) |

## How to submit to Flathub

1. **Fork** [flathub/flathub](https://github.com/flathub/flathub) on GitHub.

2. **Create a new repository** request by opening a PR that adds `com.gryt.Chat.json` (or just reference this repo). Alternatively, follow the [Flathub submission guide](https://docs.flathub.org/docs/for-app-authors/submission/).

3. Once accepted, Flathub creates `flathub/com.gryt.Chat`. Copy these files into that repo.

4. **Fill in the SHA256 hash** in `com.gryt.Chat.yml`:
   ```bash
   sha256sum Gryt-Chat-*-linux-amd64.deb
   ```
   Replace `FILL_IN_SHA256_AFTER_RELEASE` with the actual hash.

5. Push, and Flathub's CI will build and publish the Flatpak.

## Updating for new releases

The manifest includes `x-checker-data` for [flatpak-external-data-checker](https://github.com/nickvdyck/flatpak-external-data-checker), which can automatically detect new GitHub releases and open PRs to update the version and hash.

To update manually:

1. Update the `url` and `sha256` in `com.gryt.Chat.yml` for the new `.deb`.
2. Add a new `<release>` entry in `com.gryt.Chat.metainfo.xml`.
3. Push to the Flathub repo.

## Local testing

```bash
# Install Flatpak builder
sudo apt install flatpak-builder

# Add Flathub remote (if not already added)
flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo

# Build and install locally
flatpak-builder --user --install --force-clean build-dir com.gryt.Chat.yml

# Run
flatpak run com.gryt.Chat
```
