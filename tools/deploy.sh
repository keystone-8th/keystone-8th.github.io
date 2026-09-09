#!/usr/bin/env bash
# ============================================================
# Publish the app to GitHub Pages.
#
#   bash tools/deploy.sh              # build, push, verify it is live
#   bash tools/deploy.sh --offline    # ...and prove it works with no network
#   bash tools/deploy.sh --dry-run    # build and diff, push nothing
#
# WHERE THE APP ACTUALLY LIVES
# Nowhere near this machine. GitHub serves the files; your computer is not
# in the path at all once the deploy finishes. Nothing in the bundle knows
# this machine's address - no API calls, no analytics, no phone-home - so a
# visitor's phone talks to github.io and to nothing else. `tools/deploy.sh
# --audit` re-checks that claim against the built bundle rather than
# trusting this comment.
#
# WHY THE CHECKOUT IS OUTSIDE OneDrive
# The project lives under OneDrive, which syncs in the background and has
# already been observed reverting a file mid-edit and holding directory
# handles open ("Device or resource busy" on rm -rf dist). A .git directory
# under a live syncing folder is a corrupted repository waiting to happen,
# so the deploy checkout sits at $DEPLOY below, outside it.
# ============================================================
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="${ATHENA_DEPLOY:-$HOME/athena-park-deploy}"
# The site address comes from site.json - the same file the placards use.
SITE="$(node -e 'console.log(require(process.argv[1]).url)' "$ROOT/site.json")"
REPO="${GITHUB_REPO:-$(printf '%s' "$SITE" | sed -E 's#https://([^.]+)\.github\.io/([^/]+).*#\1/\2#')}"
NOREPLY="${GIT_NOREPLY:-$(git config user.email || echo "you@example.com")}"

MODE="push"
for a in "$@"; do
  case "$a" in
    --dry-run) MODE="dry" ;;
    --offline) MODE="offline" ;;
    --audit)   MODE="audit" ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

say() { printf "\n== %s\n" "$1"; }

# ---------------------------------------------------------------- build ----
say "building the bundle"
bash "$ROOT/tools/build-dist.sh" | tail -3

# --------------------------------------------------------------- audit -----
# A static bundle that quietly calls home would turn every visitor's phone
# into a client of this machine. Check, do not assume: if a hostname, an IP
# or a dev port ever gets baked into the app, the deploy stops here.
say "checking the bundle talks to nobody but its own origin"
LEAK=0
if grep -rnoE "https?://[A-Za-z0-9._:/-]+" "$ROOT/dist" \
     --include=*.html --include=*.js --include=*.webmanifest 2>/dev/null \
     | grep -v "w3\.org" | grep -q .; then
  echo "  REFUSING: an absolute URL is baked into the bundle:"
  grep -rnoE "https?://[A-Za-z0-9._:/-]+" "$ROOT/dist" \
    --include=*.html --include=*.js --include=*.webmanifest 2>/dev/null | grep -v "w3\.org" | sed 's/^/    /'
  LEAK=1
fi
if grep -rn "8138\|localhost\|127\.0\.0\.1\|10\.0\.2\.2" "$ROOT/dist" \
     --include=*.html --include=*.js --include=*.webmanifest 2>/dev/null | grep -q .; then
  echo "  REFUSING: the bundle references this machine:"
  grep -rn "8138\|localhost\|127\.0\.0\.1\|10\.0\.2\.2" "$ROOT/dist" \
    --include=*.html --include=*.js --include=*.webmanifest 2>/dev/null | sed 's/^/    /'
  LEAK=1
fi
if grep -rnE "\b(1[0-9]{1,2}|[0-9]{1,2}|2[0-5][0-9])(\.[0-9]{1,3}){3}\b" "$ROOT/dist" \
     --include=*.html --include=*.js --include=*.webmanifest 2>/dev/null | grep -q .; then
  echo "  REFUSING: an IP address is baked into the bundle:"
  grep -rnE "\b([0-9]{1,3}\.){3}[0-9]{1,3}\b" "$ROOT/dist" \
    --include=*.html --include=*.js --include=*.webmanifest 2>/dev/null | sed 's/^/    /'
  LEAK=1
fi
[ "$LEAK" -eq 0 ] && echo "  clean: no hosts, no IPs, no dev ports. Same-origin only."
[ "$LEAK" -eq 0 ] || exit 1
[ "$MODE" = "audit" ] && exit 0

# ----------------------------------------------------------- checkout ------
if [ ! -d "$DEPLOY/.git" ]; then
  say "cloning the deploy checkout to $DEPLOY"
  git clone "https://github.com/$REPO.git" "$DEPLOY"
fi
cd "$DEPLOY"
git config user.email "$NOREPLY"      # never the personal address
git config user.name  "rihansh2509"
git fetch -q origin && git reset -q --hard origin/main

# Mirror dist/ exactly: a file deleted from the build must disappear from the
# site too, which a plain copy would never do.
say "syncing dist/ into the checkout"
find . -mindepth 1 -not -path "./.git*" -delete
cp -r "$ROOT/dist/." .

if [ -z "$(git status --porcelain)" ]; then
  echo "  no change since the last deploy - nothing to push"
  [ "$MODE" = "offline" ] || exit 0
else
  git status --short | sed 's/^/  /'
  if [ "$MODE" = "dry" ]; then
    say "dry run - stopping before the push"
    git reset -q --hard origin/main
    exit 0
  fi
  say "pushing"
  git add -A
  git commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%MZ)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  git push -q origin main
  echo "  pushed $(git rev-parse --short HEAD)"
fi

# -------------------------------------------------------------- verify -----
# GitHub Pages builds asynchronously, so the URL keeps serving the PREVIOUS
# deploy for a minute or so. Wait for the new bytes rather than for a 200,
# or this reports success on the old build.
say "waiting for Pages to serve the new build"
WANT=$(grep -o 'school-[0-9]*' "$ROOT/dist/sw.js" | head -1)
for i in $(seq 1 40); do
  GOT=$(curl -s --max-time 8 "$SITE/sw.js" | grep -o 'school-[0-9]*' | head -1 || true)
  if [ "$GOT" = "$WANT" ]; then echo "  live after ~$((i*10))s (cache version $GOT)"; break; fi
  [ "$i" = "40" ] && { echo "  TIMED OUT: still serving '$GOT', wanted '$WANT'"; exit 1; }
  sleep 10
done

say "checking every file is reachable over https"
FAILED=0
for f in $(cd "$ROOT/dist" && find . -type f -not -name ".nojekyll" | sed 's|^\./||'); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$SITE/$f")
  [ "$code" = "200" ] || { echo "  $code  $f"; FAILED=1; }
done
[ "$FAILED" -eq 0 ] && echo "  all files 200"
[ "$FAILED" -eq 0 ] || exit 1

cert=$(curl -s -o /dev/null -w "%{ssl_verify_result}" "$SITE/index.html")
[ "$cert" = "0" ] && echo "  certificate valid" || { echo "  BAD CERTIFICATE ($cert)"; exit 1; }

if [ "$MODE" = "offline" ]; then
  say "proving it works with the network switched off"
  bash "$ROOT/tools/verify-offline.sh" "$SITE"
else
  echo
  echo "  live: $SITE/"
  echo "  offline is NOT verified by this run. To prove it:"
  echo "    bash tools/emulator.sh start && bash tools/deploy.sh --offline"
fi
