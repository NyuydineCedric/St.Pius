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

# Copy built frontend if present so the API can serve it directly.
if [[ -d "$ROOT/dist" ]]; then
  rm -rf "$PUBLIC"
  mkdir -p "$PUBLIC"
  cp -R "$ROOT/dist/." "$PUBLIC/"
fi

echo "Starting backend → http://127.0.0.1:${PORT:-8080}"
echo "Data dir: $DATA"
exec java -cp "$OUT" com.reportcard.Main "$DATA" "$PUBLIC"
