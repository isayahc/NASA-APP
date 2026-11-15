/** Decode NASA RASSOR Draco-compressed GLB into an uncompressed temporary GLB. */
import { NodeIO } from "@gltf-transform/core";
import { KHRDracoMeshCompression } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  throw new Error("Expected source.glb and decoded.glb arguments");
}
const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(),
  });
const document = await io.read(input);
const meshCount = document.getRoot().listMeshes().length;
if (meshCount === 0) {
  throw new Error("NASA GLB decoded but contains no meshes");
}
const draco = document
  .getRoot()
  .listExtensionsUsed()
  .find((ext) => ext.extensionName === "KHR_draco_mesh_compression");
draco?.dispose();
await io.write(output, document);
console.log("Decoded NASA GLB: " + meshCount + " meshes; Draco removed: " + Boolean(draco));
