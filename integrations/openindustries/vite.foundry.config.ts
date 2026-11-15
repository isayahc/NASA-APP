/**
 * Thin Vite extension for the existing OpenIndustries workbench.
 *
 * Run the pinned OI checkout with this config. All original React/Three
 * renderers, scene editing, system inspection and local scene proxy remain
 * OI-owned. The plugin adds only a read-only runtime transport and diagnostic.
 */
import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import baseConfig from "../../vendor/openindustries/vite.config.ts";
import { FoundryDatabase } from "./foundry-runtime.ts";
import { FoundrySseBridge, isLocal } from "./foundry-sse.ts";
import { buildKinematicsMap } from "./foundry-kinematics-map.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLIENT_FILE = fileURLToPath(new URL("./foundry-browser-stream.mjs", import.meta.url));
const ADAPTER_URL = '/@fs/' + fileURLToPath(new URL('./foundry-kinematics-browser.mjs', import.meta.url)).replaceAll('\\', '/');

function requiredEnv(name: string): string {
  /** Fail closed rather than starting a stream for an unknown runtime. */
  const value = process.env[name];
  if (!value) throw Error("Missing " + name + " for foundry stream");
  return value;
}

function makePlugin() {
  /** Return Vite's opt-in, local-only authoritative SSE integration plugin. */
  return {
    name: "nasa-foundry-authoritative-stream",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (!id.replaceAll('\\', '/').endsWith('/src/components/workspace-viewer.tsx')) return;
      // Pinned source seam: preserve OI's renderer and applyWorldPoses, replacing
      // only its evaluated view pose. Fail explicitly if upstream changes it.
      const replacements = [
        ['applyWorldPoses(world.groups, evaluateWorkspace(workspace.items, workspace.animation, time));',
          'applyWorldPoses(world.groups, foundryRuntimePoses(workspace.items, evaluateWorkspace(workspace.items, workspace.animation, time)));\n      reportFoundryWorld(world.groups, workspace.items);'],
        ["controls.addEventListener('change',wake);", "controls.addEventListener('change',wake);\n    window.addEventListener('nasa-foundry:pose', wake);"],
        ['controls.dispose();', "window.removeEventListener('nasa-foundry:pose', wake);\n      controls.dispose();"],
      ];
      for (const [before, after] of replacements) {
        if (code.split(before).length !== 2) throw Error('UNSUPPORTED_OI_VIEWER_POSE_BOUNDARY: ' + before);
        code = code.replace(before, after);
      }
      return { code: `import { foundryRuntimePoses, reportFoundryWorld } from '${ADAPTER_URL}';\n` + code, map: null };
    },
    async configureServer(vite: {
      middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void };
      httpServer: { once: (name: string, fn: () => void) => void } | null;
    }) {
      const dbPath = resolve(requiredEnv("NASA_FOUNDRY_DB"));
      const dbRelative = relative(resolve(ROOT, '.generated'), dbPath);
      if (!dbRelative || dbRelative.startsWith('..') || isAbsolute(dbRelative)) {
        throw Error("Foundry stream database must reside inside NASA-APP .generated");
      }
      const operatorPassword = requiredEnv("NASA_FOUNDRY_PASSWORD");
      if (operatorPassword.length < 12) throw Error("Invalid foundry operator secret");
      const instanceId = requiredEnv("NASA_FOUNDRY_INSTANCE_ID");
      const sceneId = requiredEnv("NASA_FOUNDRY_OI_SCENE_ID");
      const db = new FoundryDatabase(dbPath);
      let bridge: FoundrySseBridge | null = null;
      try {
        const session = await db.authenticate({
          username: "local-founder", password: operatorPassword,
        });
        bridge = new FoundrySseBridge(
          { read: () => db.read(session.token, instanceId) },
          { instanceId, oiSceneId: sceneId, pollMs: 200 },
        );
        await bridge.start();
        const manifest = JSON.parse(await readFile(resolve(ROOT, '.generated/lunar-foundry.oi.json'), 'utf8'));
        const mapping = await buildKinematicsMap(ROOT, manifest);
        vite.middlewares.use((request, response, next) => {
          const url = request.url ?? "";
          if (url.split("?")[0] === "/api/foundry/kinematics") {
            if (request.method !== 'GET' || !isLocal(request)) {
              response.writeHead(403, { 'Content-Type': 'application/json' });
              response.end('{"error":"LOCAL_READ_ONLY"}');
              return;
            }
            response.writeHead(200, {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
              "Cross-Origin-Resource-Policy": "same-origin",
            });
            response.end(JSON.stringify(mapping));
            return;
          }
          void bridge!.handle(request, response).then((handled) => {
            if (!handled) next();
          }).catch((error) => {
            console.error("Read-only foundry transport error:", error);
            if (!response.headersSent) {
              response.writeHead(503, { "Content-Type": "application/json" });
              response.end('{"error":"AUTHORITY_UNAVAILABLE"}');
            } else response.destroy();
          });
        });
        vite.httpServer?.once("close", () => {
          bridge?.close();
          db.close();
        });
      } catch (error) {
        bridge?.close();
        db.close();
        throw error;
      }
    },
    transformIndexHtml() {
      return [{
        tag: "script",
        attrs: { type: "module", src: '/@fs/' + CLIENT_FILE.replaceAll('\\', '/') },
        injectTo: "body" as const,
      }];
    },
  };
}

export default {
  ...baseConfig,
  plugins: [makePlugin(), ...(baseConfig.plugins ?? [])],
  server: {
    ...baseConfig.server,
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { allow: [ROOT] },
  },
};
