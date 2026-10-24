#!/usr/bin/env bash
set -euo pipefail

# The iCloud Keychain addon (GRYT-1881), universal like audio-capture. macOS only.
[ "$(uname -s)" = Darwin ] || { echo "No keychain addon for this platform. Skipping."; exit 0; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/../.."
OUT_DIR="$ROOT/build/native"
ELECTRON="$(node -p "require('$ROOT/node_modules/electron/package.json').version")"
mkdir -p "$OUT_DIR"

# A failed build ships the app without iCloud sync rather than stopping the release.
for arch in arm64 x64; do
  if ! (cd "$SCRIPT_DIR" && npx node-gyp rebuild --target="$ELECTRON" --arch="$arch" \
    --dist-url=https://electronjs.org/headers >/dev/null); then
    echo "::warning::The iCloud Keychain addon didn't build for $arch. This build won't sync the seed."
    rm -rf "$SCRIPT_DIR/build" "$OUT_DIR"/gryt_keychain.*.node
    exit 0
  fi
  cp "$SCRIPT_DIR/build/Release/gryt_keychain.node" "$OUT_DIR/gryt_keychain.$arch.node"
done
lipo -create -output "$OUT_DIR/gryt_keychain.node" "$OUT_DIR/gryt_keychain.arm64.node" "$OUT_DIR/gryt_keychain.x64.node"
rm -f "$OUT_DIR/gryt_keychain.arm64.node" "$OUT_DIR/gryt_keychain.x64.node"
rm -rf "$SCRIPT_DIR/build"
echo "Built: $OUT_DIR/gryt_keychain.node ($(lipo -archs "$OUT_DIR/gryt_keychain.node"))"
