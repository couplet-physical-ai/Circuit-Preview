import path from "node:path"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { canonicalManifestPayload, sha256Bytes } from "../src/hash.js"

export async function createFixture(root, options = {}) {
  const output = path.join(root, "out")
  await mkdir(output, { recursive: true })
  const circuit = options.circuit ?? []
  const circuitBytes = Buffer.from(`${JSON.stringify(circuit, null, 2)}\n`)
  const sourceBytes = Buffer.from("export default <board />\n")
  const drcBytes = Buffer.from(`${JSON.stringify({ violations: [], unconnected_items: [], schematic_parity: [] }, null, 2)}\n`)
  const boardBytes = Buffer.from("(kicad_pcb (version 20240108))\n")
  const circuitPath = path.join(root, "circuit.json")
  const sourcePath = path.join(root, "source.tsx")
  const drcPath = path.join(output, "drc.json")
  const boardPath = path.join(output, "board.kicad_pcb")
  await Promise.all([
    writeFile(circuitPath, circuitBytes),
    writeFile(sourcePath, sourceBytes),
    writeFile(drcPath, drcBytes),
    writeFile(boardPath, boardBytes),
  ])
  const circuitHash = sha256Bytes(circuitBytes)
  const sourceHash = sha256Bytes(sourceBytes)
  const artifacts = [
    { kind: "kicad-drc", path: "drc.json", sha256: sha256Bytes(drcBytes) },
    { kind: "kicad-pcb", path: "board.kicad_pcb", sha256: sha256Bytes(boardBytes) },
  ]
  const manifest = {
    approval: { state: "pending" },
    approval_state: "pending",
    artifact_hashes: Object.fromEntries(artifacts.map((artifact) => [artifact.kind, artifact.sha256])),
    artifacts,
    circuit_json: { hash: circuitHash, path: circuitPath },
    circuit_json_hash: circuitHash,
    circuit_json_path: circuitPath,
    configuration: { artifact_root: output, verify_limits: { terminate_grace_seconds: 2.0 } },
    design_id: "test-design",
    diagnostic_status: options.statuses ?? { kicad: "not-run", tscircuit: "carried-input" },
    diagnostics: options.diagnostics ?? {
      kicad: { errors: 0, info: 0, warnings: 0 },
      tscircuit: { errors: 0, info: 0, warnings: 0 },
    },
    manifest_hash: "0".repeat(64),
    manifest_version: options.version ?? 2,
    source: { hash: sourceHash, path: sourcePath },
    source_hash: sourceHash,
    source_path: sourcePath,
    tool_versions: { "circuit-json": "0.0.491", "fixture-tool": "1.0.0" },
  }
  if (manifest.manifest_version === 3) {
    Object.assign(manifest, {
      native_apply: options.nativeApply ?? { status: "future-declared-status", extra: { retained: true } },
      native_artifact: { path: null, revision: "test-revision", sha256: circuitHash },
      native_artifact_hash: circuitHash,
      native_artifact_path: null,
      native_revision: "test-revision",
    })
  } else {
    Object.assign(manifest, {
      studio: { path: null, revision: "test-revision", sha256: circuitHash },
      studio_hash: circuitHash,
      studio_path: null,
      studio_revision: "test-revision",
    })
  }
  let serialized = `${JSON.stringify(manifest, null, 2)}\n`
  manifest.manifest_hash = sha256Bytes(canonicalManifestPayload(serialized))
  serialized = `${JSON.stringify(manifest, null, 2)}\n`
  const manifestPath = path.join(root, "design.manifest.json")
  await writeFile(manifestPath, serialized)
  return { root, output, manifest, manifestPath, circuitPath, sourcePath, drcPath, boardPath }
}

export async function snapshotTree(root) {
  const result = new Map()
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(root, absolute)
      if (entry.isDirectory()) await visit(absolute)
      else result.set(relative, sha256Bytes(await readFile(absolute)))
    }
  }
  await visit(root)
  return result
}
