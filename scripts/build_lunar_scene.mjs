#!/usr/bin/env node
/**
 * Build a REAL OpenIndustries portable scene from NASA-APP STEP assemblies.
 *
 * Run from an installed OpenIndustries checkout so its native tsx loader,
 * occt-import-js and STEP/scene libraries are resolved from that checkout:
 *
 *   cd vendor/openindustries
 *   node --import tsx ../../scripts/build_lunar_scene.mjs \
 *      --oi-root . --app-root ../.. --output ../../.generated/foundry.oi.json
 *
 * No LLMs, fake meshes, browser footage, or simulation state are created.
 */

import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const DEFAULT_APP_ROOT = resolve(dirname(SCRIPT), "..");
const DEFAULT_PLAN = "scenes/lunar-foundry.plan.json";
const MAX_PORTABLE_BYTES = 75 * 1024 * 1024;
const STATION_PAD = 0.9;
const ROOT_PADDING = 4;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function args(argv) {
  const values = Object.fromEntries(
    argv.filter((v) => v.startsWith("--")).map((key) => [key.slice(2), null]),
  );
  for (let i = 0; i < argv.length; ++i) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    if (!["oi-root", "app-root", "output", "plan", "store", "first-four"].includes(key))
      throw Error("Unknown flag: " + argv[i]);
    if (key === "first-four") {
      values[key] = true;
    } else {
      if (!argv[i + 1] || argv[i + 1].startsWith("--"))
        throw Error("Missing value after " + argv[i]);
      values[key] = argv[++i];
    }
  }
  return {
    oiRoot: resolve(values["oi-root"] ?? "vendor/openindustries"),
    appRoot: resolve(values["app-root"] ?? DEFAULT_APP_ROOT),
    output: resolve(values.output ?? join(DEFAULT_APP_ROOT, ".generated/lunar-foundry.oi.json")),
    plan: values.plan ?? DEFAULT_PLAN,
    store: values.store ? resolve(values.store) : null,
    firstFour: Boolean(values["first-four"]),
  };
}

function guardedInputPath(root, candidate) {
  if (typeof candidate !== "string" || isAbsolute(candidate) || !candidate.trim())
    throw Error("Plan references an invalid source path");
  const full = resolve(root, candidate);
  const relation = relative(root, full);
  if (relation.startsWith(".." + sep) || relation === ".." || isAbsolute(relation))
    throw Error("Plan references path outside NASA-APP: " + candidate);
  return full;
}

function checkPlan(plan, firstFour = false) {
  if (plan?.format !== "nasa.foundry-scene-plan" || plan?.version !== 1 ||
      !Array.isArray(plan.machines) || plan.machines.length !== 10 ||
      !Array.isArray(plan.links) || !plan.rows || !Array.isArray(plan.rows.production) ||
      !Array.isArray(plan.rows.support)) throw Error("Invalid foundry plan v1");
  const machines = firstFour ? plan.machines.filter((m) => m.number <= 4) : plan.machines;
  const ids = new Set(machines.map((m) => m.id));
  if (ids.size !== machines.length) throw Error("Duplicate machine IDs");
  for (const m of machines) {
    if (!m.id || !m.name || !m.cad?.endsWith(".step") || !m.mechanical_ir ||
        !Array.isArray(m.ports) || m.ports.length === 0 ||
        !m.ports.every((s) => typeof s === "string")) throw Error("Invalid machine in plan");
    if (m.executable !== false || m.wired !== "declared-only")
      throw Error("Layout may not claim executable machinery");
  }
  const links = plan.links.filter((link) => ids.has(link.from) && ids.has(link.to));
  for (const link of links) {
    const a = machines.find((m) => m.id === link.from);
    const b = machines.find((m) => m.id === link.to);
    if (!a.ports.includes(link.from_port) || !b.ports.includes(link.to_port) ||
        link.operational !== false) throw Error("Invalid declared connection: " + JSON.stringify(link));
  }
  return { machines, links };
}

function coordinatePort(name, dimensions) {
  const [w, h, d] = dimensions;
  const y = Math.max(0.1, Math.min(0.7, h / 2));
  if (name === "power_in") return [0, y, -d / 2];
  if (name === "power_out") return [0, y, d / 2];
  if (name === "heat_in") return [0, y, d / 2];
  if (name === "heat_out" || name === "solids_out") return [0, y, d / 2];
  if (name === "solids_in") return [0, y, -d / 2];
  return name.endsWith("_in") ? [-w / 2, y, 0] : [w / 2, y, 0];
}

function makeRow(assetItems, numbers, z, gap) {
  const active = numbers.map((n) => assetItems.get(n)).filter(Boolean);
  const occupied = active.reduce((total, station) => total + station.asset.dimensions[0], 0) +
      Math.max(0, active.length - 1) * gap;
  let x = -occupied / 2;
  for (const station of active) {
    station.position = [x + station.asset.dimensions[0] / 2, 0, z];
    x += station.asset.dimensions[0] + gap;
  }
  return occupied;
}

function makeLayout(plan, machineAssets, links, firstFour) {
  const byNumber = new Map(machineAssets.map((station) => [station.machine.number, station]));
  const primary = plan.rows.production.filter((n) => byNumber.has(n));
  const secondary = plan.rows.support.filter((n) => byNumber.has(n));
  const primaryDepth = Math.max(0, ...primary.map((n) => byNumber.get(n).asset.dimensions[2]));
  const secondaryDepth = Math.max(0, ...secondary.map((n) => byNumber.get(n).asset.dimensions[2]));
  const gap = plan.rows.gap_m ?? STATION_PAD;
  const betweenRows = plan.rows.row_clearance_m ?? 3;
  const secondZ = (primaryDepth + secondaryDepth) / 2 + betweenRows;
  const width1 = makeRow(byNumber, primary, 0, gap);
  const width2 = makeRow(byNumber, secondary, secondZ, gap);
  const maxX = Math.max(width1, width2);
  const maxZ = secondZ + secondaryDepth / 2;
  const room = [
    Math.ceil(maxX + 2 * ROOT_PADDING),
    Math.ceil(Math.max(...machineAssets.map((s) => s.asset.dimensions[1])) + 4),
    Math.ceil(2 * Math.max(primaryDepth / 2, maxZ) + 2 * ROOT_PADDING),
  ];
  if (room.some((v) => !Number.isFinite(v) || v > 100 || v < 1))
    throw Error("Factory station layout exceeds OpenIndustries room dimensions: " + room.join(","));

  const stations = machineAssets.map(({ machine, asset, position, cadHash, irHash }) => {
    if (!position) throw Error("Station missing layout position: " + machine.id);
    if (asset.dimensions.some((v) => !Number.isFinite(v) || v <= 0))
      throw Error("Degenerate geometry in " + machine.id);
    const ports = Object.fromEntries(machine.ports.map((key) => {
      const local = coordinatePort(key, asset.dimensions);
      return [key, {
        local_m: local,
        world_m: local.map((v, i) => v + position[i]),
        status: "declared-not-verified",
      }];
    }));
    return {
      id: machine.id,
      number: machine.number,
      name: machine.name,
      asset_id: asset.id,
      position_m: position,
      rotation_deg: [0, 0, 0],
      dimensions_m: asset.dimensions,
      cad: machine.cad,
      cad_sha256: cadHash,
      mechanical_ir: machine.mechanical_ir,
      mechanical_ir_sha256: irHash,
      design_brief: machine.asset_brief,
      ports,
      status: { present: true, wired: "declared-only", executable: false },
    };
  });

  // Collision checks here are axis-aligned envelopes for static, unrotated
  // assembly origins. Actual articulated sweep, collision and cable routing
  // are not certified in this issue.
  for (let i = 0; i < stations.length; ++i) for (let j = i + 1; j < stations.length; ++j) {
    const a = stations[i], b = stations[j];
    const dx = Math.abs(a.position_m[0] - b.position_m[0]);
    const dz = Math.abs(a.position_m[2] - b.position_m[2]);
    const minX = (a.dimensions_m[0] + b.dimensions_m[0]) / 2;
    const minZ = (a.dimensions_m[2] + b.dimensions_m[2]) / 2;
    if (dx < minX - 1e-6 && dz < minZ - 1e-6) throw Error("Overlapping stations: " + a.id + " and " + b.id);
  }
  const byId = new Map(stations.map((s) => [s.id, s]));
  const routedLinks = links.map((link, index) => {
    const source = byId.get(link.from);
    const sink = byId.get(link.to);
    const from = source.ports[link.from_port].world_m;
    const to = sink.ports[link.to_port].world_m;
    const distance = Math.hypot(from[0] - to[0], from[1] - to[1], from[2] - to[2]);
    // Horizontal station gap and vertical connection allowance are separate
    // constraints; a higher feed hopper can legitimately have a taller port.
    const horizontalDistance = Math.hypot(from[0] - to[0], from[2] - to[2]);
    if (link.kind === "regolith" && source.number + 1 === sink.number &&
        (horizontalDistance > gap + 1e-5 || Math.abs(from[1] - to[1]) > 0.75))
      throw Error("Process inlet/outlet anchors are not adjacent: " + source.id + " -> " + sink.id);
    return {
      id: "foundry-link-" + String(index + 1).padStart(2, "0"),
      ...link,
      from_world_m: from,
      to_world_m: to,
      distance_m: Number(distance.toFixed(6)),
      status: "declared-only",
    };
  });
  const items = machineAssets.map(({ machine, asset, position }) => ({
    id: machine.id,
    name: String(machine.number).padStart(2, "0") + " — " + machine.name + " [NOT EXECUTABLE]",
    asset,
    position,
    rotation: [0, 0, 0],
    visible: true,
  }));
  return {
    room, items,
    graph: {
      format: "nasa.foundry-connections",
      version: 1,
      scene: firstFour ? "lunar-foundry-first-four" : "lunar-foundry-mvp",
      reference_frame: "right-handed Y-up meters",
      source_frame: "right-handed Z-up millimeters",
      site: plan.site,
      status: "spatial-layout-only",
      machine_count: stations.length,
      stations,
      links: routedLinks,
      excluded: plan.excluded,
      limitations: plan.declared_constraints,
    },
  };
}

async function createKernel(oiRoot) {
  const oiRequire = createRequire(join(oiRoot, "package.json"));
  const occtModule = oiRequire("occt-import-js");
  const factory = occtModule.default ?? occtModule;
  if (typeof factory !== "function") throw Error("OpenIndustries OCCT importer API unavailable");
  const wasm = await readFile(join(oiRoot, "node_modules/occt-import-js/dist/occt-import-js.wasm"));
  return factory({ wasmBinary: new Uint8Array(wasm) });
}


/** Publish verified portable geometry into OI's real local SQLite+asset backend.
 *
 * Direct backend use preserves the native System Inspector metadata. The MCP
 * create_scene draft currently carries scene instances but not inspection data.
 */
async function persistLocalScene(oiRoot, storePath, manifest) {
  const { LocalSceneBackend } =
    await import(pathToFileURL(join(oiRoot, "server/local-scene-backend.ts")).href);
  const { readManifest, hydrateManifest } =
    await import(pathToFileURL(join(oiRoot, "src/lib/workspace.ts")).href);
  const backend = new LocalSceneBackend(storePath);
  try {
    const versions = new Map();
    for (const asset of manifest.bundledAssets) {
      versions.set(asset.id, await backend.persistAsset(asset));
    }
    const digest = sha256(Buffer.from(JSON.stringify(manifest.assets) + JSON.stringify(manifest.instances)));
    const makeUUID = (hex) =>
      hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-4" + hex.slice(13, 16) +
      "-a" + hex.slice(17, 20) + "-" + hex.slice(20, 32);
    const sceneId = makeUUID(digest);
    const requestId = makeUUID(sha256(Buffer.from("NASA-APP-layout:" + digest)));
    const document = {
      ...manifest,
      instances: manifest.instances.map((entry) => ({
        ...entry,
        cloudVersionId: versions.get(entry.assetId),
      })),
      authoring: {
        via: "cli",
        agent: "NASA-APP-spatial-builder",
        parent_revision: null,
        request_id: requestId,
        request_digest: digest,
      },
    };
    delete document.bundledAssets;
    delete document.bundledVersions;
    readManifest(document);
    const current = await backend.head(sceneId);
    if (current) {
      if (JSON.stringify(current.document) !== JSON.stringify(document)) {
        throw Error("Scene ID collision or altered local scene. Use a fresh store; existing revisions will not be overwritten.");
      }
    } else {
      await backend.save(sceneId, "NASA-APP Lunar Oxygen Foundry (layout only)", document, 0, requestId);
    }
    const exported = await backend.exportScene(sceneId);
    const reopened = hydrateManifest(readManifest(exported), []);
    if (reopened.items.length !== manifest.instances.length || reopened.items.some((i) => i.missing))
      throw Error("Persisted OI scene export/reload lost CAD geometry");
    return {
      scene_id: sceneId,
      store_dir: storePath,
      local_browser_url: "http://127.0.0.1:5173/?localSceneId=" + sceneId,
      portable_asset_count: reopened.items.length,
      inspected_system_count: exported.inspection?.systems.length ?? 0,
      note: "Scene persistence verified; runtime machines still NOT EXECUTABLE.",
    };
  } finally {
    backend.close();
  }
}

async function main() {
  const opts = args(process.argv.slice(2));
  const source = JSON.parse(await readFile(guardedInputPath(opts.appRoot, opts.plan), "utf8"));
  const { machines, links } = checkPlan(source, opts.firstFour);
  // Import the real OI functions, not a parallel STEP/scene implementation.
  const { stepToAsset } = await import(pathToFileURL(join(opts.oiRoot, "src/lib/step.ts")).href);
  const { makeManifest, readManifest, hydrateManifest } =
      await import(pathToFileURL(join(opts.oiRoot, "src/lib/workspace.ts")).href);
  const occt = await createKernel(opts.oiRoot);
  const machineAssets = [];
  for (const machine of machines) {
    const file = guardedInputPath(opts.appRoot, machine.cad);
    const irFile = guardedInputPath(opts.appRoot, machine.mechanical_ir);
    const [bytes, irBytes] = await Promise.all([readFile(file), readFile(irFile)]);
    if (bytes.byteLength === 0 || bytes.byteLength > 25 * 1024 * 1024 ||
        !bytes.subarray(0, 4096).toString("latin1").includes("ISO-10303-21;"))
      throw Error("Missing or invalid STEP Part 21 input: " + machine.cad);
    const cadHash = sha256(bytes);
    const irHash = sha256(irBytes);
    const mesh = occt.ReadStepFile(new Uint8Array(bytes), {
      linearUnit: "millimeter",
      linearDeflectionType: "bounding_box_ratio",
      linearDeflection: 0.006,
      angularDeflection: 0.4,
    });
    if (!mesh.success || !mesh.meshes?.length)
      throw Error("OpenIndustries OCCT cannot tessellate " + machine.cad);
    const result = {
      success: true,
      root: mesh.root,
      meshes: mesh.meshes.map((m) => ({
        name: m.name,
        color: m.color,
        attributes: { position: { array: Array.from(m.attributes.position.array) } },
        index: { array: Array.from(m.index.array) },
      })),
    };
    const asset = stepToAsset(result, machine.cad, cadHash, { upAxis: "Z", scale: 1 });
    asset.name = machine.name;
    asset.warnings.push(
      "NASA-APP #4: CAD geometry only; ports are declared, equipment is NOT EXECUTABLE.",
      "Source STEP is Z-up millimeters; OI-normalized scene is Y-up meters.",
      "OpenCAD geometry is an unverified engineering concept, not a flight-qualified machine.",
    );
    machineAssets.push({ machine, asset, cadHash, irHash, position: null });
    console.log(JSON.stringify({
      event: "tessellated", machine: machine.id, parts: asset.parts.length,
      triangles: asset.parts.reduce((total, part) => total + part.indices.length / 3, 0),
      dimensions_m: asset.dimensions, cad_sha256: cadHash,
    }));
  }
  const { room, items, graph } = makeLayout(source, machineAssets, links, opts.firstFour);

  // Native OI System Inspector binds each *actual STEP-derived* assembly to the
  // real machine occurrence and its pinned MechanicalIR, not to a fake mesh.
  const { readSystemInspection, meshFingerprint } =
    await import(pathToFileURL(join(opts.oiRoot, "src/lib/system-inspection.ts")).href);
  const systems = await Promise.all(machineAssets.map(async ({ machine, asset, cadHash, irHash }) => {
    const bindingId = machine.id;
    const label = machine.name;
    return {
      id: machine.id,
      manifest: {
        schema_version: "1.0",
        product_id: "NASA-APP-" + machine.id,
        geometry: {
          artifact_id: machine.id + "-step",
          revision: 1,
          sha256: cadHash,
          format: "step",
          producer: "OpenCAD STEP imported by OpenIndustries OCCT",
          producer_version: "0.0.23",
          frame: "right-handed Z-up",
          units: "mm",
        },
        entities: [{
          entity_id: "assembly",
          selector: "assembly",
          kind: "assembly",
          fidelity: "detailed",
          source: "supplied_cad",
          verified_from_artifact: true,
        }],
        bindings: [{
          binding_id: bindingId,
          semantic: {
            domain: "MechanicalIR",
            artifact_id: "ASSET-" + String(machine.number).padStart(2, "0") + "-mechanical",
            revision: 1,
            sha256: irHash,
            entity_id: "assembly",
            occurrence_path: [machine.id],
            label,
          },
          selector: "assembly",
          role: "physical_body",
          resolution: "resolved",
          fidelity: "detailed",
          source: "supplied_cad",
          assumptions: [
            "Conceptual CAD geometry: no manufacturing or flight qualification.",
            "Wired means a declared graph connection; not a physically routed or operational interface.",
            "No task controller or process physics has been attached to this machine.",
          ],
        }],
        evidence: {
          mechanical_ir: machine.mechanical_ir,
          step_source: machine.cad,
          source_sha256: cadHash,
          declared_connections: "scenes/lunar-foundry.plan.json",
        },
      },
      targets: [{
        bindingId,
        instanceId: machine.id,
        assetId: asset.id,
        sourceDigest: cadHash,
        meshSha256: await meshFingerprint(asset),
      }],
      annotations: [{
        bindingId,
        function: machine.name + " (spatial scene only)",
        properties: [
          { name: "Presence", value: "Imported STEP geometry", source: "NASA-APP #4 native OI importer" },
          { name: "Connections", value: "Declared in a separate graph; unverified", source: "scenes/lunar-foundry.plan.json" },
          { name: "Execution", value: "NOT EXECUTABLE", source: "NASA-APP #4: #5 and #6 are pending" },
          { name: "STEP SHA-256", value: cadHash, source: machine.cad },
        ],
      }],
    };
  }));
  const inspection = readSystemInspection({
    format: "oi.system-inspection",
    version: 1,
    systems,
  });
  const manifest = makeManifest({
    room,
    items,
    inspection,
    animation: { duration: 3, loop: false, tracks: [] },
  }, true);
  const parsed = readManifest(manifest);
  const reopened = hydrateManifest(parsed, []);
  if (reopened.items.length !== machineAssets.length ||
      reopened.items.some((item) => item.missing || !item.asset.parts?.length) ||
      reopened.items.some((item, i) => item.id !== items[i].id ||
        JSON.stringify(item.position) !== JSON.stringify(items[i].position) ||
        item.asset.source.digest !== items[i].asset.source.digest))
    throw Error("Native OI scene round-trip validation failed");
  const payload = Buffer.from(JSON.stringify(manifest));
  if (payload.byteLength > MAX_PORTABLE_BYTES)
    throw Error("Bundled scene exceeds OI 75 MiB limit (" +
      (payload.byteLength / 1048576).toFixed(1) +
      " MiB); do not save an unloadable file. Reduce tessellation or split geometry.");
  graph.portable_scene_sha256 = sha256(payload);
  const localScene = opts.store ? await persistLocalScene(opts.oiRoot, opts.store, manifest) : null;
  await mkdir(dirname(opts.output), { recursive: true });
  await writeFile(opts.output, payload);
  const graphFile = opts.output.replace(/\.oi\.json$/, ".connections.json");
  if (graphFile === opts.output) throw Error("Output filename must end in .oi.json");
  await writeFile(graphFile, JSON.stringify(graph, null, 2) + "\n");
  console.log(JSON.stringify({
    event: "complete", scene: opts.output, graph: graphFile,
    scene_bytes: payload.byteLength, room, machines: items.length, links: links.length,
    scene_sha256: graph.portable_scene_sha256,
    ...(localScene ? { local_scene: localScene } : {}),
    note: "Static OpenIndustries scene with real CAD geometry; no factory execution.",
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) {
  main().catch((error) => {
    console.error("FOUNDARY_SCENE_BUILD_FAILED:", error?.stack ?? String(error));
    process.exitCode = 1;
  });
}

export { checkPlan, guardedInputPath, makeLayout };
