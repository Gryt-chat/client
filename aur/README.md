# AUR Package: gryt-chat-bin

Pre-built binary package for [Gryt Chat](https://gryt.chat) on Arch Linux.

## Publishing to AUR

1. Create an [AUR account](https://aur.archlinux.org/register) and add your SSH key.

2. Clone the AUR repo (first time only):
   ```bash
   git clone ssh://aur@aur.archlinux.org/gryt-chat-bin.git
   ```

3. Copy `PKGBUILD` and `.SRCINFO` into the cloned repo.

4. Update the sha256sum:
   ```bash
   updpkgsums   # or manually: sha256sum Gryt-Chat-*-linux-amd64.deb
   makepkg --printsrcinfo > .SRCINFO
   ```

5. Test the build:
   ```bash
   makepkg -si
   ```

6. Push:
   ```bash
   git add PKGBUILD .SRCINFO
   git commit -m "Update to v1.0.131"
   git push
   ```

## Updating for new releases

1. Bump `pkgver` in `PKGBUILD`.
2. Run `updpkgsums` to update the hash.
3. Regenerate `.SRCINFO`: `makepkg --printsrcinfo > .SRCINFO`
4. Commit and push to the AUR repo.

Users install with:
```bash
yay -S gryt-chat-bin
# or: paru -S gryt-chat-bin
```
