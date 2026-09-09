#!/usr/bin/env bash
# ============================================================
# Assemble the public bundle: exactly what a visitor needs, and
# nothing else.
#
#   bash tools/build-dist.sh
#
# The result in dist/ is pure static files. Upload it to any static
# host; no server runs in production. The publishing backend stays on
# your machine and is never exposed.
#
# DELIBERATELY EXCLUDED:
#   admin.html, editor.html - admin surfaces; their API is not in prod
#   qr.html      - lists every placard; keep it local
#   server/      - password hash and session-signing secret live here
#   map.reference.js, tools/, qr-png/, placards.html
# ============================================================
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"

PUBLIC=(index.html map.js engine.js scanpoints.js sw.js manifest.webmanifest icon-192.png icon-512.png icon-maskable.png)

# Empty the folder rather than removing it. On Windows - and especially under
# OneDrive - the directory handle is often held open by the sync client, so
# `rm -rf $DIST` fails with "Device or resource busy" AFTER deleting the
# contents, leaving a half-built bundle behind set -e.
mkdir -p "$DIST"
find "$DIST" -mindepth 1 -delete 2>/dev/null || true

# Turn photographs - ONLY the ones the published map actually points at. A
# photograph is part of the directions, so a bundle without them goes blank at
# the one junction that needed one; a bundle with ALL of them makes the visitor
# download every draft on whatever signal they have at the gate.
# The floor plan the map view draws is listed by used-plans.js too, so it
# ships alongside the photographs.
if [ -d "$ROOT/photos" ]; then
  mkdir -p "$DIST/photos"
  node "$ROOT/tools/used-plans.js" | while read -r img; do
    [ -n "$img" ] || continue
    if [ -f "$ROOT/$img" ]; then
      mkdir -p "$(dirname "$DIST/$img")"
      cp "$ROOT/$img" "$DIST/$img"
      echo "  photo: $img"
    else
      echo "  WARNING: the map points at a missing $img" >&2
    fi
  done
fi

for f in "${PUBLIC[@]}"; do
  [ -f "$ROOT/$f" ] || { echo "missing required file: $f" >&2; exit 1; }
  cp "$ROOT/$f" "$DIST/$f"
done

# GitHub Pages runs Jekyll by default, which SKIPS files beginning with an
# underscore - _headers and _redirects among them - and can rewrite what it
# does serve. This file turns all of that off.
touch "$DIST/.nojekyll"

# Netlify/Cloudflare-style headers. The app stores nothing and calls
# nobody, so the policy can be strict.
cat > "$DIST/_headers" <<'EOF'
/sw.js
  Cache-Control: no-cache

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'
EOF

# map.js changes on every publish; the rest is versioned by content anyway.
cat > "$DIST/_redirects" <<'EOF'
/*    /index.html   200
EOF

# Stamp the cache name with a hash of the bundle. Without this the service
# worker keeps serving an old shell after a deploy, and the only person who
# notices is the visitor holding a stale map.
STAMP="$(find "$DIST" -type f -name '*.js' -o -type f -name '*.html' | sort | xargs cat | cksum | cut -d' ' -f1)"
if command -v sed >/dev/null; then
  sed -i "s/const VERSION    = \"school-[^\"]*\"/const VERSION    = \"school-$STAMP\"/" "$DIST/sw.js"
fi
echo "  cache version: school-$STAMP"

echo "dist/ built:"
find "$DIST" -type f | sort | while read -r f; do
  printf "  %-26s %8s bytes
" "${f#$DIST/}" "$(wc -c < "$f" | tr -d ' ')"
done

TOTAL=$(find "$DIST" -type f -exec cat {} + | wc -c | tr -d ' ')
echo "  ----"
printf "  %-18s %6s bytes total\n" "" "$TOTAL"

# A public bundle must never contain the secret or the admin page.
for bad in admin.html editor.html qr.html config.json server; do
  if [ -e "$DIST/$bad" ]; then echo "REFUSING: $bad leaked into dist/" >&2; exit 1; fi
done
echo "  checked: no admin page, no server config in the bundle"
