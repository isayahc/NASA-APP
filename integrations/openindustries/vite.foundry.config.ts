/**
 * Thin Vite extension for the existing OpenIndustries workbench.
 *
 * Run the pinned OI checkout with this config. All original React/Three
 * renderers, scene editing, system inspection and local scene proxy remain
 * OI-owned. The plugin adds only a read-only runtime transport and diagnostic.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import baseConfig from "../../vendor/openindustries/vite.config.ts";
import { FoundryDatabase } from "./foundry-runtime.ts";
import { FoundrySseBridge } from "./foundry-sse.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLIENT_FILE = fileURLToPath(new URL("./foundry-browser-stream.mjs", import.meta.url));

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
    async configureServer(vite: {
      middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void };
      httpServer: { once: (name: string, fn: () => void) => void } | null;
    }) {
      const dbPath = resolve(requiredEnv("NASA_FOUNDRY_DB"));
      if (!dbPath.startsWith(resolve(ROOT, ".generated") + "/")) {
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
        const client = await readFile(CLIENT_FILE, "utf8");
        vite.middlewares.use((request, response, next) => {
          const url = request.url ?? "";
          if (url.split("?")[0] === "/__nasa_foundry_client.mjs") {
            response.writeHead(200, {
              "Content-Type": "text/javascript; charset=utf-8",
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
              "Cross-Origin-Resource-Policy": "same-origin",
            });
            response.end(client);
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
        attrs: { type: "module", src: "/__nasa_foundry_client.mjs" },
        injectTo: "body" as const,
      }];
    },
  };
}

export default {
  ...baseConfig,
  plugins: [...(baseConfig.plugins ?? []), makePlugin()],
  server: {
    ...baseConfig.server,
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
};
