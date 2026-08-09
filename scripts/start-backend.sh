#!/usr/bin/env bash
# Compile and run the Java API on 127.0.0.1:8080 (file storage by default).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/backend/src/main/java"
OUT="$ROOT/backend/bin"
DATA="${DATA_DIR:-$ROOT/.data}"
PUBLIC="${STATIC_DIR:-$ROOT/backend/bin/public}"

mkdir -p "$OUT" "$DATA" "$PUBLIC"
find "$SRC" -name '*.java' > "$OUT/sources.txt"
javac -d "$OUT" @"$OUT/sources.txt"

# Rebuild the frontend and sync it into the backend's static folder every
# time this runs — otherwise the compiled backend keeps serving whichever
# frontend snapshot happened to land in $PUBLIC the first time this script
# ran, so UI changes silently never show up even after a clean recompile.
(cd "$ROOT" && npm run build)
rm -rf "$PUBLIC"
mkdir -p "$PUBLIC"
cp -R "$ROOT/dist/." "$PUBLIC/"

echo "Starting backend → http://127.0.0.1:${PORT:-8080}"
echo "Data dir: $DATA"
exec java -cp "$OUT" com.reportcard.Main "$DATA" "$PUBLIC"
