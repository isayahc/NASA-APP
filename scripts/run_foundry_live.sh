#!/usr/bin/env bash
# Launch the EXISTING OpenIndustries workbench with NASA-APP read-only SSE.
# No fictitious production, no model calls, and no custom 3D renderer.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OI_ROOT="${OI_ROOT:-$ROOT/vendor/openindustries}"
export NASA_FOUNDRY_DB="${NASA_FOUNDRY_DB:-$ROOT/.generated/foundry-live.sqlite}"
export NASA_FOUNDRY_INSTANCE_ID="${NASA_FOUNDRY_INSTANCE_ID:-foundry-live-01}"
PASSWORD_FILE="$ROOT/.generated/foundry-local-password"
mkdir -p "$ROOT/.generated"
if [[ -z "${NASA_FOUNDRY_PASSWORD:-}" ]]; then
  if [[ ! -f "$PASSWORD_FILE" ]]; then
    umask 077
    node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))' > "$PASSWORD_FILE"
    chmod 600 "$PASSWORD_FILE"
  fi
  export NASA_FOUNDRY_PASSWORD="$(cat "$PASSWORD_FILE")"
fi
if (( ${#NASA_FOUNDRY_PASSWORD} < 12 )); then
  echo "NASA_FOUNDRY_PASSWORD must contain at least 12 characters." >&2
  exit 1
fi

# Native STEP scene and original OI storage, as already implemented in #4.
bash "$ROOT/scripts/run_foundry.sh" --build-only
SESSION="$ROOT/.generated/lunar-foundry.session.json"
export NASA_FOUNDRY_OI_SCENE_ID="$(node -e '
const s=require(process.argv[1]);
if(!s.scene_id){process.stderr.write("Missing local scene_id\n");process.exit(1)}
process.stdout.write(s.scene_id)
' "$SESSION")"

(
  cd "$OI_ROOT"
  node --import tsx "$ROOT/scripts/init_foundry_live.ts"
)

# Existing OI API server is needed by the same OI React/Three workbench.
# F1 does not modify the upstream renderer or backend API source.
(
  cd "$OI_ROOT"
  OI_ROOT="$OI_ROOT" OI_SCENE_BACKEND=local \
  OI_SCENE_TOOLS_ENABLED=true OI_SCENE_DATA_DIR="$ROOT/.generated/oi-scene-store" \
  node server/index.mjs
) &
API_PID=$!
cleanup() {
  kill "$API_PID" >/dev/null 2>&1 || true
  wait "$API_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo
echo "F1 read-only runtime stream: http://127.0.0.1:5173/api/foundry/events"
echo "Foundry scene: http://127.0.0.1:5173/?localSceneId=$NASA_FOUNDRY_OI_SCENE_ID"
echo "No simulation clocks are started by F1. To advance real tasks, use:"
echo '  (cd vendor/openindustries && node --import tsx ../../scripts/advance_foundry_live.ts --ticks 1)'
echo
(
  cd "$OI_ROOT"
  OI_ROOT="$OI_ROOT" OI_SCENE_BACKEND=local \
  OI_SCENE_TOOLS_ENABLED=true OI_SCENE_DATA_DIR="$ROOT/.generated/oi-scene-store" \
  node --import tsx node_modules/vite/bin/vite.js \
    --config "$ROOT/integrations/openindustries/vite.foundry.config.ts" \
    --host 127.0.0.1
)
