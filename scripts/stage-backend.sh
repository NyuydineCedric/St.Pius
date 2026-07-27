#!/usr/bin/env bash
# Stage compiled backend + Vite dist for Electron packaging (extraResources).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/backend/src/main/java"
STAGE="$ROOT/staging/backend"

mkdir -p "$STAGE"
find "$SRC" -name '*.java' > "$STAGE/sources.txt"
javac -d "$STAGE" @"$STAGE/sources.txt"
rm -f "$STAGE/sources.txt"

if [[ ! -d "$ROOT/dist" ]]; then
  echo "Building frontend (dist/ missing)…"
  (cd "$ROOT" && npm run build)
fi

rm -rf "$STAGE/public"
mkdir -p "$STAGE/public"
cp -R "$ROOT/dist/." "$STAGE/public/"

echo "Staged backend at $STAGE"
echo "  classes + public/ ready for electron-builder extraResources"
