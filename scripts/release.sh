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

# ── Beta / prerelease ────────────────────────────────────────────────────
BETA_RELEASE=false
RELEASE_TYPE="release"

if [ "$RERELEASE" = false ]; then
  if [[ "$CURRENT_VERSION" =~ ^([0-9]+\.[0-9]+\.[0-9]+)-beta\.([0-9]+)$ ]]; then
    CUR_BASE="${BASH_REMATCH[1]}"
    CUR_BETA="${BASH_REMATCH[2]}"
    NEXT_BETA="${CUR_BASE}-beta.$((CUR_BETA + 1))"
    echo ""
    info "Current version is beta (${BOLD}v${CURRENT_VERSION}${RESET}). Quick options:"
    echo "   a) Next beta iteration → v${NEXT_BETA}  (default)"
    echo "   b) Promote to stable   → v${CUR_BASE}"
    echo "   c) Keep selected       → v${NEW_VERSION}"
    echo ""
    read -rp "$(echo -e "${CYAN}?${RESET}  Choice ${YELLOW}[a]${RESET}: ")" BETA_CHOICE
    BETA_CHOICE="${BETA_CHOICE:-a}"
    case "$BETA_CHOICE" in
      a|A) NEW_VERSION="$NEXT_BETA"; BETA_RELEASE=true ;;
      b|B) NEW_VERSION="$CUR_BASE" ;;
      c|C) ;;
      *) err "Invalid choice"; exit 1 ;;
    esac
  fi

  # Custom version with beta suffix already set
  if [[ "$NEW_VERSION" =~ -beta\. ]]; then
    BETA_RELEASE=true
  fi

  # For stable versions, offer to make it a beta
  if [ "$BETA_RELEASE" = false ] && [[ ! "$NEW_VERSION" =~ -beta\. ]]; then
    read -rp "$(echo -e "${CYAN}?${RESET}  Release as beta? ${YELLOW}[y/N]${RESET}: ")" BETA_ASK
    if [[ "$BETA_ASK" =~ ^[Yy]$ ]]; then
      BETA_RELEASE=true
      NEW_VERSION="${NEW_VERSION}-beta.1"
    fi
  fi

  if [ "$BETA_RELEASE" = true ]; then
    RELEASE_TYPE="prerelease"
  fi
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
elif [ "$BETA_RELEASE" = true ]; then
  echo -e "  Version:   ${YELLOW}v${NEW_VERSION} (beta)${RESET}"
else
  echo -e "  Version:   ${GREEN}v${NEW_VERSION}${RESET}"
fi
echo -e "  Release:   ${GREEN}${RELEASE_TYPE}${RESET}"
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
info "Building Electron app…"

cd "$CLIENT_DIR"
ELECTRON=1 npx vite build

ok "Vite build complete"

# ── Git commit & tag (before publish so the tag is authoritative) ────────
if [ "$RERELEASE" = false ]; then
  echo ""
  info "Committing version bump…"

  COMMIT_SUFFIX=""
  if [ "$BETA_RELEASE" = true ]; then
    COMMIT_SUFFIX=" (beta)"
  fi

  cd "$CLIENT_DIR"
  git add package.json
  git commit -m "release: v${NEW_VERSION}${COMMIT_SUFFIX}"
  git push

  REPO_ROOT="$(cd "$CLIENT_DIR/.." && git rev-parse --show-toplevel 2>/dev/null || echo "")"
  if [ -n "$REPO_ROOT" ] && [ -f "$REPO_ROOT/.gitmodules" ]; then
    cd "$REPO_ROOT"
    git add packages/client
    git commit -m "release: client v${NEW_VERSION}${COMMIT_SUFFIX}"
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

info "Building Docker image…"
docker build -t "${DOCKER_IMAGE}:${NEW_VERSION}" .
ok "Built ${DOCKER_IMAGE}:${NEW_VERSION}"

info "Tagging…"
docker tag "${DOCKER_IMAGE}:${NEW_VERSION}" "${DOCKER_IMAGE}:${V_MAJOR}.${V_MINOR}"
docker tag "${DOCKER_IMAGE}:${NEW_VERSION}" "${DOCKER_IMAGE}:${V_MAJOR}"
docker tag "${DOCKER_IMAGE}:${NEW_VERSION}" "${DOCKER_IMAGE}:latest"

info "Pushing to ghcr.io…"
docker push "${DOCKER_IMAGE}:${NEW_VERSION}"
docker push "${DOCKER_IMAGE}:${V_MAJOR}.${V_MINOR}"
docker push "${DOCKER_IMAGE}:${V_MAJOR}"
docker push "${DOCKER_IMAGE}:latest"
ok "Docker image pushed: ${BOLD}${DOCKER_IMAGE}:${NEW_VERSION}${RESET}"

# ── Deploy to production ──────────────────────────────────────────
echo ""
read -rp "$(echo -e "${CYAN}?${RESET}  Deploy to production (pull & restart prod containers)? ${YELLOW}[Y/n]${RESET}: ")" DEPLOY_PROD
DEPLOY_PROD="${DEPLOY_PROD:-Y}"
if [[ "$DEPLOY_PROD" =~ ^[Yy]$ ]]; then
  REPO_ROOT="$(cd "$CLIENT_DIR/../.." && pwd)"
  if [ -f "$REPO_ROOT/scripts/update-prod.sh" ]; then
    info "Running production deployment…"
    bash "$REPO_ROOT/scripts/update-prod.sh"
    ok "Production deployment complete"
  else
    warn "update-prod.sh not found at $REPO_ROOT/scripts/update-prod.sh"
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
