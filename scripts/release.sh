#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PKG_JSON="$CLIENT_DIR/package.json"

CURRENT_VERSION=$(node -p "require('$PKG_JSON').version")

OWNER="Gryt-chat"
REPO="gryt"

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

# ── Semver helpers ────────────────────────────────────────────────────────
bump_version() {
  local version="$1" part="$2"
  IFS='.' read -r major minor patch <<< "${version%%-*}"
  case "$part" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
  esac
}

# ── Snapcraft credentials ─────────────────────────────────────────────────
REPO_ROOT_DIR="$(cd "$CLIENT_DIR/../.." && pwd)"
SNAP_CREDS_FILE="$REPO_ROOT_DIR/snapcraft-creds"
if [ -z "${SNAPCRAFT_STORE_CREDENTIALS:-}" ] && [ -f "$SNAP_CREDS_FILE" ]; then
  export SNAPCRAFT_STORE_CREDENTIALS="$(cat "$SNAP_CREDS_FILE")"
  ok "Loaded Snap Store credentials from snapcraft-creds"
fi

# ── GH_TOKEN ─────────────────────────────────────────────────────────────
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

DOCKER_IMAGE="ghcr.io/gryt-chat/client"
echo "$GH_TOKEN" | docker login ghcr.io -u "$(gh api user -q .login 2>/dev/null || echo gryt)" --password-stdin
ok "Logged in to ghcr.io"

echo ""
echo -e "${BOLD}┌─────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}│         Gryt Desktop — Release           │${RESET}"
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

# ── Channel ───────────────────────────────────────────────────────────────
if [ -n "${CHANNEL:-}" ]; then
  info "Channel inherited: ${BOLD}${CHANNEL}${RESET}"
elif [ "$RERELEASE" = false ]; then
  CHANNEL="beta"
  echo ""
  info "Release channel:"
  echo "   1) Beta    — prerelease, deploys to beta  (default)"
  echo "   2) Latest  — stable, deploys to beta + production"
  echo ""
  read -rp "$(echo -e "${CYAN}?${RESET}  Channel ${YELLOW}[1]${RESET}: ")" CHANNEL_CHOICE
  CHANNEL_CHOICE="${CHANNEL_CHOICE:-1}"
  case "$CHANNEL_CHOICE" in
    1) CHANNEL="beta" ;;
    2) CHANNEL="latest" ;;
    *) err "Invalid choice"; exit 1 ;;
  esac
else
  CHANNEL="beta"
fi

cd "$CLIENT_DIR"
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
echo ""
echo -e "${BOLD}── Summary ──────────────────────────────${RESET}"
if [ "$RERELEASE" = true ]; then
  echo -e "  Version:   ${YELLOW}v${NEW_VERSION} (re-release)${RESET}"
elif [ "$CHANNEL" = "latest" ]; then
  echo -e "  Version:   ${GREEN}v${NEW_VERSION}${RESET}"
else
  echo -e "  Version:   ${YELLOW}v${NEW_VERSION} (beta)${RESET}"
fi
echo -e "  Channel:   ${GREEN}${CHANNEL}${RESET}"
echo -e "  Repo:      ${GREEN}${OWNER}/${REPO}${RESET}"
echo -e "  Platforms: ${GREEN}Linux + macOS + Windows${RESET}"
echo -e "${BOLD}─────────────────────────────────────────${RESET}"
echo ""
read -rp "$(echo -e "${CYAN}?${RESET}  Proceed with build & publish? ${YELLOW}[Y/n]${RESET}: ")" CONFIRM
CONFIRM="${CONFIRM:-Y}"
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  warn "Aborted."
  exit 0
fi

# ── Clean existing release (re-release only) ─────────────────────────────
if [ "$RERELEASE" = true ]; then
  echo ""
  info "Removing existing release ${BOLD}v${NEW_VERSION}${RESET} from ${OWNER}/${REPO}…"
  if gh release view "v${NEW_VERSION}" --repo "${OWNER}/${REPO}" &>/dev/null; then
    gh release delete "v${NEW_VERSION}" --repo "${OWNER}/${REPO}" --yes --cleanup-tag
    ok "Deleted remote release and tag v${NEW_VERSION}"
  else
    warn "No existing release v${NEW_VERSION} found — will create a fresh one"
  fi
  if git tag -l "v${NEW_VERSION}" | grep -q .; then
    git tag -d "v${NEW_VERSION}"
    ok "Deleted local tag v${NEW_VERSION}"
  fi
fi

# ── Pre-flight checks ────────────────────────────────────────────────────
echo ""
info "Running pre-flight checks…"

cd "$CLIENT_DIR"

info "Type-checking…"
npx tsc -b
ok "Type-check passed"

info "Linting…"
if npx eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0 2>/dev/null; then
  ok "Lint passed"
else
  warn "Lint has warnings/errors (non-blocking). Run ${BOLD}npm run lint${RESET} to see details."
fi

# ── Build ────────────────────────────────────────────────────────────────
echo ""
info "Building native audio capture binaries…"

cd "$CLIENT_DIR"
bash native/audio-capture/build.sh
ok "Native audio build done (may have been skipped for this platform)"

info "Building Electron app…"

ELECTRON=1 npx vite build

ok "Vite build complete"

# ── Git commit & tag (before publish so the tag is authoritative) ────────
if [ "$RERELEASE" = false ]; then
  echo ""
  info "Committing version bump…"

  cd "$CLIENT_DIR"
  git add package.json
  git commit -m "release: v${NEW_VERSION} (${CHANNEL})"
  git push

  REPO_ROOT="$(cd "$CLIENT_DIR/.." && git rev-parse --show-toplevel 2>/dev/null || echo "")"
  if [ -n "$REPO_ROOT" ] && [ -f "$REPO_ROOT/.gitmodules" ]; then
    cd "$REPO_ROOT"
    git add packages/client
    git commit -m "release: client v${NEW_VERSION} (${CHANNEL})"
    git tag "v${NEW_VERSION}"
    git push
    git push origin "v${NEW_VERSION}"
    ok "Committed submodule + monorepo, tagged and pushed ${BOLD}v${NEW_VERSION}${RESET}"
  else
    cd "$CLIENT_DIR"
    git tag "v${NEW_VERSION}"
    git push origin "v${NEW_VERSION}"
    ok "Committed, tagged, and pushed ${BOLD}v${NEW_VERSION}${RESET}"
  fi
fi

# ── Docker image (web client) ────────────────────────────────────────
# Built before Electron publish so prod deploys even if electron-builder fails.
echo ""
IFS='.' read -r V_MAJOR V_MINOR V_PATCH <<< "${NEW_VERSION%%-*}"
cd "$CLIENT_DIR"

info "Syncing dependencies…"
yarn install --frozen-lockfile --ignore-engines
ok "Lockfile up to date"

PLATFORMS="linux/amd64,linux/arm64"
info "Building & pushing multi-arch Docker image (${PLATFORMS})…"

DOCKER_TAGS=(
  -t "${DOCKER_IMAGE}:${NEW_VERSION}"
  -t "${DOCKER_IMAGE}:${V_MAJOR}.${V_MINOR}"
  -t "${DOCKER_IMAGE}:${V_MAJOR}"
  -t "${DOCKER_IMAGE}:latest-beta"
)
if [ "$CHANNEL" = "latest" ]; then
  DOCKER_TAGS+=(-t "${DOCKER_IMAGE}:latest")
fi

docker buildx build \
  --platform "$PLATFORMS" \
  --cache-from type=registry,ref=${DOCKER_IMAGE}:buildcache \
  --cache-to type=registry,ref=${DOCKER_IMAGE}:buildcache,mode=max \
  "${DOCKER_TAGS[@]}" \
  --push .
ok "Pushed ${DOCKER_IMAGE}:${NEW_VERSION} (${PLATFORMS})"

# ── Deploy client ─────────────────────────────────────────────────
echo ""
REPO_ROOT="$(cd "$CLIENT_DIR/../.." && pwd)"
COMPOSE_DIR="$REPO_ROOT/ops/deploy/compose"

read -rp "$(echo -e "${CYAN}?${RESET}  Deploy client to beta? ${YELLOW}[Y/n]${RESET}: ")" DEPLOY_BETA
DEPLOY_BETA="${DEPLOY_BETA:-Y}"
if [[ "$DEPLOY_BETA" =~ ^[Yy]$ ]]; then
  BETA_COMPOSE="$COMPOSE_DIR/beta.yml"
  BETA_ENV="$COMPOSE_DIR/.env.beta"
  BETA_LOCAL="$COMPOSE_DIR/beta.local.yml"
  if [ -f "$BETA_COMPOSE" ] && [ -f "$BETA_ENV" ]; then
    COMPOSE_ARGS=(-f "$BETA_COMPOSE")
    [[ -f "$BETA_LOCAL" ]] && COMPOSE_ARGS+=(-f "$BETA_LOCAL")
    COMPOSE_ARGS+=(--env-file "$BETA_ENV" --profile web)
    info "Pulling & restarting beta client…"
    docker compose "${COMPOSE_ARGS[@]}" pull client
    docker compose "${COMPOSE_ARGS[@]}" up -d client
    ok "Beta client deployed"
  else
    warn "Beta compose files not found"
  fi
fi

if [ "$CHANNEL" = "latest" ]; then
  read -rp "$(echo -e "${CYAN}?${RESET}  Deploy client to production? ${YELLOW}[Y/n]${RESET}: ")" DEPLOY_PROD
  DEPLOY_PROD="${DEPLOY_PROD:-Y}"
  if [[ "$DEPLOY_PROD" =~ ^[Yy]$ ]]; then
    PROD_COMPOSE="$COMPOSE_DIR/prod.yml"
    PROD_ENV="$COMPOSE_DIR/.env.prod"
    PROD_LOCAL="$COMPOSE_DIR/prod.local.yml"
    if [ -f "$PROD_COMPOSE" ] && [ -f "$PROD_ENV" ]; then
      COMPOSE_ARGS=(-f "$PROD_COMPOSE")
      [[ -f "$PROD_LOCAL" ]] && COMPOSE_ARGS+=(-f "$PROD_LOCAL")
      COMPOSE_ARGS+=(--env-file "$PROD_ENV" --profile web)
      info "Pulling & restarting production client…"
      docker compose "${COMPOSE_ARGS[@]}" pull client
      docker compose "${COMPOSE_ARGS[@]}" up -d client
      ok "Production client deployed"
    else
      warn "Production compose files not found"
    fi
  fi
fi

# ── Electron publish ────────────────────────────────────────────────────
cd "$CLIENT_DIR"
info "Packaging & publishing to ${BOLD}${OWNER}/${REPO}${RESET}…"

MAX_ATTEMPTS=3
ATTEMPT=0
until [ $ATTEMPT -ge $MAX_ATTEMPTS ]; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ $ATTEMPT -gt 1 ]; then
    WAIT=$((ATTEMPT * 15))
    warn "Attempt ${ATTEMPT}/${MAX_ATTEMPTS} — retrying in ${WAIT}s…"
    sleep "$WAIT"
  fi
  TARGETS="--linux --win"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    TARGETS="--linux --mac --win"
  fi

  RELEASE_TYPE="prerelease"
  if [ "$CHANNEL" = "latest" ]; then
    RELEASE_TYPE="release"
  fi

  npx electron-builder \
    $TARGETS \
    --publish always \
    -c.publish.provider=github \
    -c.publish.owner="$OWNER" \
    -c.publish.repo="$REPO" \
    -c.publish.releaseType="$RELEASE_TYPE" \
    && break
done

if [ $ATTEMPT -ge $MAX_ATTEMPTS ]; then
  err "electron-builder failed after ${MAX_ATTEMPTS} attempts"
  exit 1
fi

echo ""
ok "Release ${BOLD}v${NEW_VERSION}${RESET} published to ${GREEN}https://github.com/${OWNER}/${REPO}/releases${RESET}"

# ── Snap Store upload ────────────────────────────────────────────────
SNAP_FILE=$(find "$CLIENT_DIR/release" -name '*.snap' -print -quit 2>/dev/null)
if [ -n "$SNAP_FILE" ] && command -v snapcraft &>/dev/null; then
  echo ""
  read -rp "$(echo -e "${CYAN}?${RESET}  Upload to Snap Store? ${YELLOW}[Y/n]${RESET}: ")" SNAP_UPLOAD
  SNAP_UPLOAD="${SNAP_UPLOAD:-Y}"
  if [[ "$SNAP_UPLOAD" =~ ^[Yy]$ ]]; then
    SNAP_CHANNEL="edge"
    if [ "$CHANNEL" = "latest" ]; then
      SNAP_CHANNEL="stable"
    fi
    info "Uploading ${BOLD}$(basename "$SNAP_FILE")${RESET} to Snap Store (${SNAP_CHANNEL})…"
    if snapcraft upload "$SNAP_FILE" --release="$SNAP_CHANNEL"; then
      ok "Snap published to ${SNAP_CHANNEL} channel"
    else
      warn "Snap upload failed — you can retry manually: snapcraft upload \"$SNAP_FILE\" --release=${SNAP_CHANNEL}"
    fi
  fi
elif [ -n "$SNAP_FILE" ]; then
  warn "Snap built but ${BOLD}snapcraft${RESET} not found — install it to publish to the Snap Store"
  info "  sudo snap install snapcraft --classic"
  info "  snapcraft login"
  info "  snapcraft upload \"$SNAP_FILE\" --release=stable"
fi

# ── Verify update manifests ──────────────────────────────────────────
info "Verifying auto-update manifests…"

VERIFY_FAILED=false
for YML in latest.yml latest-linux.yml latest-mac.yml; do
  YML_VERSION=$(gh release download "v${NEW_VERSION}" --repo "${OWNER}/${REPO}" -p "$YML" -O - 2>/dev/null \
    | head -n1 | sed 's/^version: *//')
  if [ "$YML_VERSION" != "$NEW_VERSION" ]; then
    err "${YML} has version ${BOLD}${YML_VERSION}${RESET} — expected ${BOLD}${NEW_VERSION}${RESET}"
    VERIFY_FAILED=true
  else
    ok "${YML} → v${YML_VERSION}"
  fi
done

if [ "$VERIFY_FAILED" = true ]; then
  echo ""
  err "Auto-update manifests are stale! Clients will NOT see this update."
  err "Re-run with option 5 (re-release) or manually fix the yml assets."
  echo ""
  read -rp "$(echo -e "${CYAN}?${RESET}  Continue anyway? ${YELLOW}[y/N]${RESET}: ")" CONTINUE_ANYWAY
  if [[ ! "$CONTINUE_ANYWAY" =~ ^[Yy]$ ]]; then
    warn "Aborted. Fix the release manifests before proceeding."
    exit 1
  fi
fi

echo ""
