/**
 * Thin Vite extension for the existing OpenIndustries workbench.
 *
 * Run the pinned OI checkout with this config. All original React/Three
 * renderers, scene editing, system inspection and local scene proxy remain
 * OI-owned. The plugin adds only a read-only runtime transport and diagnostic.
 */
import { readFile } from "node:fs/promises";
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import baseConfig from "../../vendor/openindustries/vite.config.ts";
import { FoundryDatabase } from "./foundry-runtime.ts";
import { FoundrySseBridge, isLocal } from "./foundry-sse.ts";
import { buildKinematicsMap } from "./foundry-kinematics-map.mjs";
import { buildMaterialMap } from './foundry-material-map.mjs';
import { buildInspectionMap } from './foundry-inspection-map.mjs';
import { FoundryControls } from './foundry-controls.ts';

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLIENT_FILE = fileURLToPath(new URL("./foundry-browser-stream.mjs", import.meta.url));
const ADAPTER_URL = '/@fs/' + fileURLToPath(new URL('./foundry-kinematics-browser.mjs', import.meta.url)).replaceAll('\\', '/');
const MATERIAL_URL = '/@fs/' + fileURLToPath(new URL('./foundry-material-browser.mjs', import.meta.url)).replaceAll('\\', '/');
const INSPECTION_URL = '/@fs/' + fileURLToPath(new URL('./foundry-inspection-browser.mjs', import.meta.url)).replaceAll('\\', '/');
const CONTROLS_URL = '/@fs/' + fileURLToPath(new URL('./foundry-controls-browser.mjs', import.meta.url)).replaceAll('\\', '/');

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
      if (id.replaceAll('\\', '/').endsWith('/src/main.tsx')) {
        const seam = '<SystemInspector selectionVersion=';
        if (code.split(seam).length !== 2) throw Error('UNSUPPORTED_OI_CONTROLS_BOUNDARY');
        return { code: `import { FoundryControlsPanel } from '${CONTROLS_URL}';\n` +
          code.replace(seam, '<FoundryControlsPanel />' + seam), map: null };
      }
      if (id.replaceAll('\\', '/').endsWith('/src/components/system-inspector.tsx')) {
        const seam = '<h4>{current.binding.semantic.label ?? current.binding.semantic.entity_id}</h4>';
        if (code.split(seam).length !== 2) throw Error('UNSUPPORTED_OI_INSPECTOR_BOUNDARY');
        return { code: `import { FoundryInspection } from '${INSPECTION_URL}';\n` + code.replace(seam,
          seam + '\n<FoundryInspection machineId={system.targets.find(t => t.bindingId === current.binding.binding_id)?.instanceId} assetId={workspace.items[current.targets[0]?.instance]?.asset.id} bindingStatus={current.status} stepHash={system.manifest.geometry.sha256} irHash={current.binding.semantic.sha256} />'), map: null };
      }
      if (!id.replaceAll('\\', '/').endsWith('/src/components/workspace-viewer.tsx')) return;
      // Pinned source seam: preserve OI's renderer and applyWorldPoses, replacing
      // only its evaluated view pose. Fail explicitly if upstream changes it.
      const replacements = [
        ['applyWorldPoses(world.groups, evaluateWorkspace(workspace.items, workspace.animation, time));',
          'applyWorldPoses(world.groups, foundryRuntimePoses(workspace.items, evaluateWorkspace(workspace.items, workspace.animation, time)));\n      reportFoundryWorld(world.groups, workspace.items);'],
        ["controls.addEventListener('change',wake);", "controls.addEventListener('change',wake);\n    window.addEventListener('nasa-foundry:pose', wake);"],
        ['controls.dispose();', "window.removeEventListener('nasa-foundry:pose', wake);\n      controls.dispose();"],
        ['if (cameraAvailable) renderer.render(world.scene, camera);',
          'if (cameraAvailable) { renderer.render(world.scene, camera); renderFoundryMaterial(world.groups, workspace.items, camera, canvas); }'],
        ['renderer.dispose();', 'removeFoundryMaterialOverlay(canvas);\n      renderer.dispose();'],
      ];
      for (const [before, after] of replacements) {
        if (code.split(before).length !== 2) throw Error('UNSUPPORTED_OI_VIEWER_POSE_BOUNDARY: ' + before);
        code = code.replace(before, after);
      }
      return { code: `import { foundryRuntimePoses, reportFoundryWorld } from '${ADAPTER_URL}';\nimport { renderFoundryMaterial, removeFoundryMaterialOverlay } from '${MATERIAL_URL}';\n` + code, map: null };
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
      let controls: FoundryControls | null = null;
      try {
        const session = await db.authenticate({
          username: "local-founder", password: operatorPassword,
        });
        let activeId = db.lineage(session.token, instanceId).at(-1)!;
        controls = new FoundryControls(db, session.token, instanceId, async () => {
          activeId = controls!.active();
          bridge?.selectInstance(activeId);
          await bridge?.refresh();
        });
        controls.initialize();
        bridge = new FoundrySseBridge(
          { read: () => db.read(session.token, activeId) },
          { instanceId: activeId, oiSceneId: sceneId, pollMs: 200 },
        );
        await bridge.start();
        const manifest = JSON.parse(await readFile(resolve(ROOT, '.generated/lunar-foundry.oi.json'), 'utf8'));
        const mapping = await buildKinematicsMap(ROOT, manifest);
        const materialMapping = await buildMaterialMap(ROOT, manifest);
        const inspectionMapping = await buildInspectionMap(ROOT, manifest);
        vite.middlewares.use((request, response, next) => {
          const url = request.url ?? "";
          if (['/api/foundry/control-session', '/api/foundry/control-lease', '/api/foundry/commands'].includes(url.split('?')[0])) {
            void controls!.handle(request, response); return;
          }
          controls!.observeStream(request, response);
          const path = url.split('?')[0];
          const artifact = inspectionMapping.machines.flatMap(m => m.artifacts).find(a => a.url === path);
          if (["/api/foundry/kinematics", "/api/foundry/material-map", "/api/foundry/inspection-map"].includes(path) || artifact) {
            if (request.method !== 'GET' || !isLocal(request)) {
              response.writeHead(403, { 'Content-Type': 'application/json' });
              response.end('{"error":"LOCAL_READ_ONLY"}');
              return;
            }
            if (artifact) {
              // Only exact, startup-verified plan sources; never a user-supplied filesystem path.
              void readFile(resolve(ROOT, artifact.path)).then(bytes => {
                if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
                  response.writeHead(409); response.end('ENGINEERING_SOURCE_CHANGED'); return;
                }
                response.writeHead(200, { 'Content-Type': 'application/octet-stream',
                  'Content-Disposition': `attachment; filename="${artifact.path.split('/').at(-1)}"`,
                  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
                  'Cross-Origin-Resource-Policy': 'same-origin' });
                response.end(bytes);
              }).catch(() => { response.writeHead(503); response.end(); });
              return;
            }
            response.writeHead(200, {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
              "Cross-Origin-Resource-Policy": "same-origin",
            });
            response.end(JSON.stringify(path === '/api/foundry/inspection-map' ? inspectionMapping :
              path === '/api/foundry/material-map' ? materialMapping : mapping));
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
          controls?.close();
          bridge?.close();
          db.close();
        });
      } catch (error) {
        controls?.close();
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
  resolve: { ...baseConfig.resolve, dedupe: ['react', 'react-dom'] },
  plugins: [makePlugin(), ...(baseConfig.plugins ?? [])],
  server: {
    ...baseConfig.server,
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { allow: [ROOT] },
  },
};
