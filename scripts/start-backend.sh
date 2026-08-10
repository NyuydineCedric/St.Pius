#!/usr/bin/env bash
# Compile and run the Java API on 127.0.0.1:8080 (file storage by default).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Load .env if present. Java reads config only from the process environment,
# so without this the file would be dead weight for the backend. Variables
# already set in the shell win, so `PORT=9000 npm run backend` still works.
if [ -f "$ROOT/.env" ]; then
  while IFS='=' read -r key value; do
    [[ $key =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    [[ -n ${!key:-} ]] || export "$key=$value"
  done < "$ROOT/.env"
fi

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
# Postgres mode needs the JDBC driver on the classpath. It isn't in the repo,
# so fetch it on first use — same version the Dockerfile and stage-backend.mjs
# pin. Only needed when DATABASE_URL is set; file storage doesn't touch it.
CP="$OUT"
if [ -n "${DATABASE_URL:-}" ]; then
  LIB="$ROOT/backend/lib"
  JAR="$LIB/postgresql.jar"
  if [ ! -f "$JAR" ]; then
    echo "Downloading Postgres JDBC driver…"
    mkdir -p "$LIB"
    if ! curl -fsSL -o "$JAR" \
      https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.5/postgresql-42.7.5.jar; then
      rm -f "$JAR"
      echo "Could not download the Postgres driver. Unset DATABASE_URL to run on local file storage." >&2
      exit 1
    fi
  fi
  CP="$OUT:$JAR"
  echo "Storage: Postgres (DATABASE_URL is set)"
else
  echo "Storage: local file"
fi

exec java -cp "$CP" com.reportcard.Main "$DATA" "$PUBLIC"
