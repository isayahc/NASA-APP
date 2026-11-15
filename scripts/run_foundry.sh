#!/usr/bin/env bash
# One-command local spatial preview (WSL2/Linux/macOS). No LLM calls.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OI_ROOT="${OI_ROOT:-$ROOT/vendor/openindustries}"
STORE="${NASA_OI_SCENE_STORE:-$ROOT/.generated/oi-scene-store}"
OUTPUT="$ROOT/.generated/lunar-foundry.oi.json"
PIN="838ea330296148621f7a23f7cb647b11e73b5184"
MODE="${1:-serve}"

if [[ "$MODE" != "serve" && "$MODE" != "--build-only" ]]; then
  echo "Usage: bash scripts/run_foundry.sh [--build-only]" >&2
  exit 2
fi
for tool in git node npm; do
  command -v "$tool" >/dev/null || { echo "Install $tool first." >&2; exit 1; }
done
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<16)){console.error("OpenIndustries needs Node >=22.16");process.exit(1)}'
if [[ ! -d "$OI_ROOT/.git" ]]; then
  mkdir -p "$(dirname "$OI_ROOT")"
  git clone https://github.com/Mapped-Assembly/OpenIndustries.git "$OI_ROOT"
  git -C "$OI_ROOT" checkout --detach "$PIN"
fi
HEAD="$(git -C "$OI_ROOT" rev-parse HEAD)"
if [[ "$HEAD" != "$PIN" ]]; then
  echo "OI checkout at $HEAD; pinned tested version is $PIN." >&2
  echo "Set OI_ROOT to a dedicated pinned checkout; this script will not overwrite existing work." >&2
  exit 1
fi
if [[ ! -f "$OI_ROOT/node_modules/occt-import-js/dist/occt-import-js.wasm" ]]; then
  npm ci --prefix "$OI_ROOT"
fi
mkdir -p "$(dirname "$OUTPUT")"
(
  cd "$OI_ROOT"
  node --max-old-space-size=6144 --import tsx "$ROOT/scripts/build_lunar_scene.mjs" \
    --oi-root "$OI_ROOT" --app-root "$ROOT" --output "$OUTPUT" --store "$STORE"
)
SESSION="$ROOT/.generated/lunar-foundry.session.json"
URL="$(node -e 'const s=require(process.argv[1]);if(!s.local_browser_url)process.exit(1);console.log(s.local_browser_url)' "$SESSION")"
printf '\nOpenIndustries factory layout: %s\n' "$URL"
printf 'Portable STEP-backed scene: %s\n' "$OUTPUT"
printf 'Declared machine/port graph: %s\n\n' "$ROOT/.generated/lunar-foundry.connections.json"
if [[ "$MODE" == "--build-only" ]]; then exit 0; fi
echo "Starting OpenIndustries; open the URL above. Ctrl+C stops the server."
(
  cd "$OI_ROOT"
  OI_ROOT="$OI_ROOT" OI_SCENE_BACKEND=local OI_SCENE_TOOLS_ENABLED=true \
    OI_SCENE_DATA_DIR="$STORE" npm run dev
)
