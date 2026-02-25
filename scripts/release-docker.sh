#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PKG_JSON="$PKG_DIR/package.json"
PKG_NAME="client"
IMAGE="ghcr.io/gryt-chat/${PKG_NAME}"

CURRENT_VERSION=$(node -p "require('$PKG_JSON').version")

# ── Colors ───────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { echo -e "${CYAN}ℹ${RESET}  $*"; }
ok()    { echo -e "${GREEN}✔${RESET}  $*"; }
warn()  { echo -e "${YELLOW}⚠${RESET}  $*"; }
err()   { echo -e "${RED}✖${RESET}  $*" >&2; }

bump_version() {
  local version="$1" part="$2"
  IFS='.' read -r major minor patch <<< "${version%%-*}"
  case "$part" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
  esac
}

# ── GHCR auth ────────────────────────────────────────────────────────────
if [ -z "${GH_TOKEN:-}" ]; then
  if command -v gh &>/dev/null && gh auth status &>/dev/null 2>&1; then
    export GH_TOKEN=$(gh auth token)
    ok "Using GitHub token from gh CLI"
  else
    err "GH_TOKEN is not set and gh CLI is not authenticated."
    echo "   Set it with:  export GH_TOKEN=ghp_your_token_here"
    echo "   Or run:       gh auth login"
    exit 1
  fi
fi

echo "$GH_TOKEN" | docker login ghcr.io -u "$(gh api user -q .login 2>/dev/null || echo gryt)" --password-stdin 2>/dev/null
ok "Logged in to ghcr.io"

echo ""
echo -e "${BOLD}┌─────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}│     Gryt Web Client — Docker Release     │${RESET}"
echo -e "${BOLD}└─────────────────────────────────────────┘${RESET}"
echo ""

# ── Version ──────────────────────────────────────────────────────────────
NEXT_PATCH=$(bump_version "$CURRENT_VERSION" patch)

info "Current version: ${BOLD}v${CURRENT_VERSION}${RESET}"
echo ""
info "Version bump:"
echo "   1) Patch  → v${NEXT_PATCH}  (default)"
echo "   2) Minor  → v$(bump_version "$CURRENT_VERSION" minor)"
echo "   3) Major  → v$(bump_version "$CURRENT_VERSION" major)"
echo "   4) Custom"
echo "   5) Re-release v${CURRENT_VERSION}"
echo ""
read -rp "$(echo -e "${CYAN}?${RESET}  Choice ${YELLOW}[1]${RESET}: ")" VERSION_CHOICE
VERSION_CHOICE="${VERSION_CHOICE:-1}"

RERELEASE=false
case "$VERSION_CHOICE" in
  1) NEW_VERSION="$NEXT_PATCH" ;;
  2) NEW_VERSION="$(bump_version "$CURRENT_VERSION" minor)" ;;
  3) NEW_VERSION="$(bump_version "$CURRENT_VERSION" major)" ;;
  4)
    read -rp "$(echo -e "${CYAN}?${RESET}  Enter version: ")" NEW_VERSION
    if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
      err "Invalid version: $NEW_VERSION (expected semver, e.g. 1.2.3)"
      exit 1
    fi
    ;;
  5) NEW_VERSION="$CURRENT_VERSION"; RERELEASE=true ;;
  *) err "Invalid choice"; exit 1 ;;
esac

# ── Beta / prerelease ────────────────────────────────────────────────────
BETA_RELEASE=false

if [ "$RERELEASE" = false ]; then
  if [[ "$NEW_VERSION" =~ -beta\. ]]; then
    BETA_RELEASE=true
  fi

  if [ "$BETA_RELEASE" = false ]; then
    read -rp "$(echo -e "${CYAN}?${RESET}  Release as beta? ${YELLOW}[y/N]${RESET}: ")" BETA_ASK
    if [[ "$BETA_ASK" =~ ^[Yy]$ ]]; then
      BETA_RELEASE=true
      NEW_VERSION="${NEW_VERSION}-beta.1"
    fi
  fi
fi

cd "$PKG_DIR"

if [ "$RERELEASE" = true ]; then
  ok "Re-releasing ${BOLD}v${NEW_VERSION}${RESET}"
else
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.version = '$NEW_VERSION';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
  ok "Version bumped: ${BOLD}v${CURRENT_VERSION}${RESET} → ${BOLD}v${NEW_VERSION}${RESET}"
fi

# ── Confirm ──────────────────────────────────────────────────────────────
IFS='.' read -r V_MAJOR V_MINOR V_PATCH <<< "${NEW_VERSION%%-*}"

echo ""
echo -e "${BOLD}── Summary ──────────────────────────────${RESET}"
if [ "$RERELEASE" = true ]; then
  echo -e "  Version:   ${YELLOW}v${NEW_VERSION} (re-release)${RESET}"
else
  echo -e "  Version:   ${GREEN}v${NEW_VERSION}${RESET}"
fi
echo -e "  Image:     ${GREEN}${IMAGE}:${NEW_VERSION}${RESET}"
echo -e "  Tags:      ${GREEN}${NEW_VERSION}, ${V_MAJOR}.${V_MINOR}, ${V_MAJOR}, latest-beta${RESET}"
echo -e "${BOLD}─────────────────────────────────────────${RESET}"
echo ""
read -rp "$(echo -e "${CYAN}?${RESET}  Build, push, and tag? ${YELLOW}[Y/n]${RESET}: ")" CONFIRM
CONFIRM="${CONFIRM:-Y}"
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  warn "Aborted."
  exit 0
fi

# ── Clean existing release (re-release only) ─────────────────────────────
if [ "$RERELEASE" = true ]; then
  echo ""
  info "Removing existing release v${NEW_VERSION}…"
  gh release delete "docker-v${NEW_VERSION}" --repo "Gryt-chat/${PKG_NAME}" --yes --cleanup-tag 2>/dev/null || true
  git tag -d "docker-v${NEW_VERSION}" 2>/dev/null || true
fi

# ── Pre-flight checks ────────────────────────────────────────────────────
echo ""
info "Running pre-flight checks…"

info "Type-checking…"
npx tsc -b
ok "Type-check passed"

info "Linting…"
if npx eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0 2>/dev/null; then
  ok "Lint passed"
else
  warn "Lint has warnings/errors (non-blocking). Run ${BOLD}npm run lint${RESET} to see details."
fi

# ── Docker build & push ─────────────────────────────────────────────────
echo ""
info "Building Docker image…"

docker build -t "${IMAGE}:${NEW_VERSION}" .
ok "Built ${IMAGE}:${NEW_VERSION}"

info "Tagging…"
docker tag "${IMAGE}:${NEW_VERSION}" "${IMAGE}:${V_MAJOR}.${V_MINOR}"
docker tag "${IMAGE}:${NEW_VERSION}" "${IMAGE}:${V_MAJOR}"
docker tag "${IMAGE}:${NEW_VERSION}" "${IMAGE}:latest-beta"

info "Pushing to ghcr.io…"
docker push "${IMAGE}:${NEW_VERSION}"
docker push "${IMAGE}:${V_MAJOR}.${V_MINOR}"
docker push "${IMAGE}:${V_MAJOR}"
docker push "${IMAGE}:latest-beta"
ok "Pushed all tags"

# ── Git commit & tag ─────────────────────────────────────────────────────
if [ "$RERELEASE" = false ]; then
  echo ""
  info "Committing version bump…"
  git add package.json
  git commit -m "release(docker): v${NEW_VERSION}"
  git tag "docker-v${NEW_VERSION}"
  git push
  git push origin "docker-v${NEW_VERSION}"
  ok "Committed, tagged, and pushed"
fi

echo ""
ok "Release ${BOLD}v${NEW_VERSION}${RESET} complete"
echo ""
echo -e "  ${CYAN}Image:${RESET}   ${IMAGE}:${NEW_VERSION}"
echo ""
