/**
 * Turns one STEP / IGES / BREP file into a light GLB that the browser opens in a moment.
 * Runs as its own process (forked by services/previews.ts) because reading a large CAD file
 * with OpenCascade can take minutes and gigabytes; the API keeps answering meanwhile.
 *
 * Usage: node cad-preview.mjs <input> <output.glb>
 * Exit 0 on success; on failure prints the reason to stderr and exits 1.
 */
import { createRequire } from "node:module";
import { readFile, rename, writeFile } from "node:fs/promises";
import { extname } from "node:path";

const require = createRequire(import.meta.url);
const [input, output] = process.argv.slice(2);

const occt = await require("occt-import-js")();
const bytes = new Uint8Array(await readFile(input));
const ext = extname(input).toLowerCase();
const read = ext === ".igs" || ext === ".iges" ? occt.ReadIgesFile : ext === ".brep" ? occt.ReadBrepFile : occt.ReadStepFile;
const res = read(bytes, null);
if (!res.success || !res.meshes.length) {
  console.error("This CAD file could not be read. Try exporting it again as STEP AP214 or AP242.");
  process.exit(1);
}

// ── Minimal GLB writer: one node + mesh per CAD body, positions, normals, uint32 indices. ──
const chunks = [];
let offset = 0;
const views = [];
const accessors = [];
const push = (typed, target) => {
  const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target });
  chunks.push(buf);
  offset += buf.length;
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    offset += pad;
  }
  return views.length - 1;
};

const meshes = [];
const nodes = [];
for (const m of res.meshes) {
  const pos = Float32Array.from(m.attributes.position.array);
  if (!pos.length) continue;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[i + k]);
      max[k] = Math.max(max[k], pos[i + k]);
    }
  const attributes = {};
  accessors.push({ bufferView: push(pos, 34962), componentType: 5126, count: pos.length / 3, type: "VEC3", min, max });
  attributes.POSITION = accessors.length - 1;
  if (m.attributes.normal?.array?.length) {
    const nor = Float32Array.from(m.attributes.normal.array);
    accessors.push({ bufferView: push(nor, 34962), componentType: 5126, count: nor.length / 3, type: "VEC3" });
    attributes.NORMAL = accessors.length - 1;
  }
  const prim = { attributes, mode: 4 };
  if (m.index?.array?.length) {
    const idx = Uint32Array.from(m.index.array);
    accessors.push({ bufferView: push(idx, 34963), componentType: 5125, count: idx.length, type: "SCALAR" });
    prim.indices = accessors.length - 1;
  }
  // The viewer shows steel by default and the design colour on request.
  meshes.push({ name: m.name || undefined, primitives: [prim], extras: m.color ? { cadColor: m.color } : undefined });
  nodes.push({ mesh: meshes.length - 1, name: m.name || undefined });
}

const json = {
  asset: { version: "2.0", generator: "Ironline CAD preview" },
  scene: 0,
  scenes: [{ nodes: nodes.map((_, i) => i) }],
  nodes,
  meshes,
  accessors,
  bufferViews: views,
  buffers: [{ byteLength: offset }],
};
let jsonBuf = Buffer.from(JSON.stringify(json));
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
const bin = Buffer.concat(chunks);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
const chunkHead = (len, type) => {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(len, 0);
  b.writeUInt32LE(type, 4);
  return b;
};
// Write to a temp name first so a half-written file is never served.
await writeFile(`${output}.part`, Buffer.concat([header, chunkHead(jsonBuf.length, 0x4e4f534a), jsonBuf, chunkHead(bin.length, 0x004e4942), bin]));
await rename(`${output}.part`, output);
