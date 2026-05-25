#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../../build/native"
mkdir -p "$OUT_DIR"

case "$(uname -s)" in
  Darwin)
    echo "Building macOS audio-capture binary..."
    swiftc -O -o "$OUT_DIR/audio-capture" \
      "$SCRIPT_DIR/macos/main.swift" \
      -framework ScreenCaptureKit \
      -framework CoreMedia \
      -framework AVFoundation
    echo "Built: $OUT_DIR/audio-capture"
    ;;
  Linux)
    echo "No native capture binaries for Linux yet."
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    echo "Use native\\build.bat to build on Windows!"
    exit 1
    ;;
  *)
    echo "No native binaries for this platform ($(uname -s)). Skipping."
    exit 0
    ;;
esac
