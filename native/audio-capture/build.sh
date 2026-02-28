#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../../build/native"
mkdir -p "$OUT_DIR"

build_windows_msvc() {
  echo "Building Windows audio-capture binary (MSVC)..."
  cl.exe /EHsc /O2 /Fe:"$OUT_DIR/audio-capture.exe" \
    "$SCRIPT_DIR/windows/main.cpp" \
    ole32.lib
  echo "Built: $OUT_DIR/audio-capture.exe"
}

build_windows_mingw() {
  echo "Cross-compiling Windows audio-capture binary (MinGW)..."
  x86_64-w64-mingw32-g++ -O2 \
    -DUNICODE -D_UNICODE \
    -municode \
    -o "$OUT_DIR/audio-capture.exe" \
    "$SCRIPT_DIR/windows/main.cpp" \
    -lole32 -lksuser \
    -static-libgcc -static-libstdc++
  echo "Built: $OUT_DIR/audio-capture.exe"
}

build_macos() {
  echo "Building macOS audio-capture binary..."
  swiftc -O -o "$OUT_DIR/audio-capture" \
    "$SCRIPT_DIR/macos/main.swift" \
    -framework ScreenCaptureKit \
    -framework CoreMedia \
    -framework AVFoundation
  echo "Built: $OUT_DIR/audio-capture"
}

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    build_windows_msvc
    ;;
  Darwin)
    build_macos
    # Also cross-compile Windows binary if MinGW is available
    if command -v x86_64-w64-mingw32-g++ &>/dev/null; then
      build_windows_mingw
    fi
    ;;
  Linux)
    # Cross-compile Windows binary
    if command -v x86_64-w64-mingw32-g++ &>/dev/null; then
      build_windows_mingw
    else
      echo "WARNING: x86_64-w64-mingw32-g++ not found — cannot build Windows audio-capture binary."
      echo "  Install with:  sudo apt install g++-mingw-w64-x86-64"
      echo "  The Windows release will NOT include audio exclusion support."
    fi
    echo "No native audio capture binary for Linux. Skipping."
    ;;
  *)
    echo "No native audio capture binary for this platform ($(uname -s)). Skipping."
    ;;
esac
