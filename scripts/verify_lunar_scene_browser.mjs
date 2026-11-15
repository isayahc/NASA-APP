#!/usr/bin/env node
/** Browser-level OpenIndustries import/export test of the REAL STEP-backed scene.
 *
 * This test operates the existing OI workbench, not a NASA-APP test renderer.
 * It deliberately does not execute machines or display fabricated measurements.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

function opts(argv) {
  const val = (flag, fallback) => {
    const index = argv.indexOf(flag);
    return index === -1 ? fallback : argv[index + 1];
  };
  return {
    oiRoot: resolve(val("--oi-root", "vendor/openindustries")),
    scenePath: resolve(val("--scene", ".generated/lunar-foundry.oi.json")),
    screenshot: resolve(val("--screenshot", ".generated/lunar-foundry-browser.png")),
  };
}

async function main() {
  const config = opts(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(config.scenePath, "utf8"));
  assert.equal(manifest.format, "astra.scene");
  assert.equal(manifest.version, 1);
  assert(manifest.bundledAssets.length >= 4, "real bundled CAD assets required");
  const oiRequire = createRequire(join(config.oiRoot, "package.json"));
  const { chromium, expect } = oiRequire("@playwright/test");
  const { createServer } = await import(pathToFileURL(join(config.oiRoot, "node_modules/vite/dist/node/index.js")).href);
  const web = await createServer({
    root: config.oiRoot,
    server: { host: "127.0.0.1", port: 4186, strictPort: true },
  });
  let browser;
  const errors = [];
  try {
    await web.listen();
    browser = await chromium.launch({
      headless: true,
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl"],
    });
    async function importInto(page, file) {
      await page.goto("http://127.0.0.1:4186", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "Import OI project", exact: true }))
        .toBeEnabled({ timeout: 30000 });
      const chooser = page.waitForEvent("filechooser", { timeout: 15000 });
      await page.getByRole("button", { name: "+ Import project", exact: true }).click();
      await (await chooser).setFiles({
        name: "lunar-foundry.oi.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(file)),
      });
      await expect(page.locator(".asset")).toHaveCount(file.instances.length, { timeout: 120000 });
      await expect(page.locator(".asset").filter({ hasText: "MISSING" })).toHaveCount(0, { timeout: 15000 });
      const names = await page.locator(".asset").allTextContents();
      for (const instance of file.instances) {
        assert(names.some((value) => value.includes(instance.name)),
          "Missing named machine in OI viewer: " + instance.name);
      }
      assert(await page.locator("canvas").count() > 0, "OpenIndustries 3D canvas missing");
    }

    const context1 = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    const page1 = await context1.newPage();
    page1.on("pageerror", (error) => errors.push(error.message));
    await importInto(page1, manifest);
    // Use the *native* system inspector, which binds imported STEP source
    // digests to the actual geometry and shows the declared/not-running state.
    const inspector = page1.getByRole("region", { name: "System inspector", exact: true });
    const components = inspector.getByLabel("Semantic components");
    await expect(components.getByRole("button", { name: /Regolith Excavator/ }))
      .toBeVisible({ timeout: 30000 });
    await components.getByRole("button", { name: /Regolith Excavator/ }).click();
    const detail = inspector.getByRole("article", { name: "Binding details" });
    await expect(detail).toHaveAttribute("data-binding-status", "resolved");
    await expect(detail).toContainText("NOT EXECUTABLE");
    await expect(detail).toContainText("Declared");
    await detail.getByRole("button", { name: /Locate/ }).click();
    await mkdir(dirname(config.screenshot), { recursive: true });
    await page1.screenshot({ path: config.screenshot, fullPage: false });

    const download = page1.waitForEvent("download", { timeout: 30000 });
    await page1.getByRole("button", { name: "Export OI project", exact: true }).click();
    const file = await download;
    const downloadPath = config.scenePath.replace(/\.oi\.json$/, ".roundtrip.oi.json");
    await file.saveAs(downloadPath);
    const exported = JSON.parse(await readFile(downloadPath, "utf8"));
    assert.deepEqual(exported.instances.map((item) => item.id), manifest.instances.map((item) => item.id));
    assert.deepEqual(exported.instances.map((item) => item.position), manifest.instances.map((item) => item.position));
    assert.deepEqual(exported.assets.map((asset) => asset.source.digest),
      manifest.assets.map((asset) => asset.source.digest));
    assert.equal(exported.bundledAssets.length, manifest.bundledAssets.length);
    assert(exported.bundledAssets.every((asset) => asset.parts.length > 0));
    assert.equal(exported.inspection?.systems.length, manifest.instances.length,
      "Native OI inspector bindings must survive export/reimport");
    assert.deepEqual(exported.inspection?.systems.map((sys) => sys.targets[0].sourceDigest),
      manifest.inspection.systems.map((sys) => sys.targets[0].sourceDigest));

    const context2 = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    const page2 = await context2.newPage();
    page2.on("pageerror", (error) => errors.push(error.message));
    await importInto(page2, exported);
    assert.deepEqual(errors, [], "Browser errors during two independent scene imports");
    console.log(JSON.stringify({
      status: "pass",
      real_geometry_assets: exported.bundledAssets.length,
      imported_scene_instances: exported.instances.length,
      roundtrip_preserved_ids_and_cad_hashes: true,
      independent_browser_import_without_missing_geometry: true,
      screenshot: config.screenshot,
      caveat: "Layout-only scene; no real-time machine execution or material flow yet.",
    }));
  } finally {
    await browser?.close();
    await web.close();
  }
}

main().catch((error) => {
  console.error("LUNAR_BROWSER_VALIDATION_FAILED", error?.stack ?? String(error));
  process.exitCode = 1;
});
