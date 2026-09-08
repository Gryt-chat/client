#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../../build/native"
mkdir -p "$OUT_DIR"

case "$(uname -s)" in
  Darwin)
    echo "Building macOS audio-capture binary (universal)..."

    # Universal, because one helper is shipped to both the arm64 and the x64
    # app. Built without -target it takes the host arch, which put an arm64
    # binary inside an Intel build the moment mac started building both.
    # 102KB per slice, so a fat one costs nothing worth measuring.
    for arch in arm64 x86_64; do
      swiftc -O -target "${arch}-apple-macos12.0" \
        -o "$OUT_DIR/audio-capture.${arch}" \
        "$SCRIPT_DIR/macos/main.swift" \
        -framework ScreenCaptureKit \
        -framework CoreMedia \
        -framework AVFoundation
    done

    lipo -create -output "$OUT_DIR/audio-capture" \
      "$OUT_DIR/audio-capture.arm64" "$OUT_DIR/audio-capture.x86_64"
    rm -f "$OUT_DIR/audio-capture.arm64" "$OUT_DIR/audio-capture.x86_64"

    echo "Built: $OUT_DIR/audio-capture ($(lipo -archs "$OUT_DIR/audio-capture"))"
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
