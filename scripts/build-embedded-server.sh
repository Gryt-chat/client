#!/usr/bin/env bash
set -euo pipefail

# Build the embedded server resources for the Electron client.
#
# Assembles build/server/ (Node.js bundle + deps) and build/sfu/ (Go binary)
# so that electron-builder can include them via extraResources.
#
# Usage:
#   bash scripts/build-embedded-server.sh [--skip-sfu] [--skip-server]
#
# Prerequisites:
#   - Server: packages/server must have been built (npm run build && npm run bundle)
#   - SFU: Go toolchain on PATH

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$(cd "$CLIENT_DIR/../server" && pwd)"
SFU_DIR="$(cd "$CLIENT_DIR/../sfu" && pwd)"

[[ -d /usr/local/go/bin ]] && export PATH="/usr/local/go/bin:$PATH"

SKIP_SFU=false
SKIP_SERVER=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-sfu)    SKIP_SFU=true; shift ;;
    --skip-server) SKIP_SERVER=true; shift ;;
    *)             echo "Unknown arg: $1"; exit 1 ;;
  esac
done

OUTDIR="$CLIENT_DIR/build/embedded-server"
echo "=== Building Embedded Server Resources ==="

# ── 1. Server bundle ──────────────────────────────────────────────────
if [ "$SKIP_SERVER" = true ]; then
  echo "[1/2] Skipping server bundle (--skip-server)"
else
  echo "[1/2] Bundling server..."
  if [ ! -f "$SERVER_DIR/dist/bundle.js" ]; then
    echo "  Server bundle not found. Building..."
    (cd "$SERVER_DIR" && npm run build && npm run bundle)
  fi

  rm -rf "$OUTDIR/server"
  mkdir -p "$OUTDIR/server"

  cp "$SERVER_DIR/dist/bundle.js" "$OUTDIR/server/"

  # Copy better-sqlite3 native addon (required, not bundleable)
  if [ -d "$SERVER_DIR/node_modules/better-sqlite3" ]; then
    mkdir -p "$OUTDIR/server/node_modules"
    cp -r "$SERVER_DIR/node_modules/better-sqlite3" "$OUTDIR/server/node_modules/"
  fi

  # Minimal package.json so Node.js can resolve the native module
  cat > "$OUTDIR/server/package.json" <<'PKGJSON'
{ "name": "gryt-embedded-server", "private": true, "main": "bundle.js" }
PKGJSON

  echo "  Server bundle ready: $OUTDIR/server/"
fi

# ── 2. SFU binary (per-platform) ─────────────────────────────────────
if [ "$SKIP_SFU" = true ]; then
  echo "[2/2] Skipping SFU build (--skip-sfu)"
else
  echo "[2/2] Cross-compiling SFU..."
  if [ ! -d "$SFU_DIR" ]; then
    echo "  Warning: SFU directory not found at $SFU_DIR, skipping"
  else
    build_sfu() {
      local goos=$1 goarch=$2 ext=$3 ebos=$4 ebarch=$5
      local dirname="${ebos}-${ebarch}"
      local outdir="$OUTDIR/sfu/$dirname"
      mkdir -p "$outdir"
      echo "  Building $dirname (GOOS=$goos GOARCH=$goarch)..."
      GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 go build -C "$SFU_DIR" \
        -o "$outdir/gryt_sfu${ext}" ./cmd/sfu/
    }

    # Args: GOOS GOARCH ext electron-builder-os electron-builder-arch
    build_sfu windows amd64 .exe win   x64
    build_sfu linux   amd64 ""   linux x64
    build_sfu darwin  amd64 ""   mac   x64
    build_sfu darwin  arm64 ""   mac   arm64

    chmod +x "$OUTDIR/sfu/"*/gryt_sfu 2>/dev/null || true
    echo "  SFU binaries ready: $OUTDIR/sfu/"
  fi
fi

echo ""
echo "=== Embedded server resources ready ==="
echo "  Output: $OUTDIR/"
du -sh "$OUTDIR" 2>/dev/null || true
