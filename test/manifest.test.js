import assert from "node:assert/strict"
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { canonicalPythonJsonBytes, sha256Bytes } from "../src/hash.js"
import { verifyManifest } from "../src/manifest.js"
import { createFixture } from "../test-support/helpers.js"

async function temporaryFixture(options) {
  const root = await mkdtemp(path.join(os.tmpdir(), "circuit-preview-test-"))
  const fixture = await createFixture(root, options)
  return { ...fixture, cleanup: () => rm(root, { recursive: true, force: true }) }
}

test("canonical manifest hashing matches Python float and Unicode semantics", () => {
  const raw = '{"b":2.0,"a":"é"}'
  assert.equal(
    sha256Bytes(canonicalPythonJsonBytes(raw)),
    "a049d321e7accc91830c081906f977eb901b56d3d766e66903b9c0702ff90efb",
  )
})

test("manifest self-hash and every referenced file hash verify", async (t) => {
  const fixture = await temporaryFixture()
  t.after(fixture.cleanup)
  const result = await verifyManifest(fixture.manifestPath)
  assert.equal(result.manifest.design_id, "test-design")
  assert.equal(result.artifactBytes.size, 2)
  assert.equal(result.circuitPath, fixture.circuitPath)
})

test("manifest self-hash mismatch fails closed", async (t) => {
  const fixture = await temporaryFixture()
  t.after(fixture.cleanup)
  const text = await import("node:fs/promises").then(({ readFile }) => readFile(fixture.manifestPath, "utf8"))
  await writeFile(fixture.manifestPath, text.replace("test-design", "tampered-design"))
  await assert.rejects(() => verifyManifest(fixture.manifestPath), { code: "manifest.self_hash_mismatch" })
})

test("referenced artifact hash mismatch fails closed", async (t) => {
  const fixture = await temporaryFixture()
  t.after(fixture.cleanup)
  await writeFile(fixture.boardPath, "tampered board\n")
  await assert.rejects(() => verifyManifest(fixture.manifestPath), (error) => {
    assert.equal(error.code, "evidence.hash_mismatch")
    assert.match(error.message, /artifact kicad-pcb hash mismatch/)
    assert.equal(error.details.expected, fixture.manifest.artifact_hashes["kicad-pcb"])
    assert.match(error.details.actual, /^[0-9a-f]{64}$/)
    return true
  })
})

test("V3 native_apply block is integrity-bound but tolerated as declared data", async (t) => {
  const fixture = await temporaryFixture({ version: 3 })
  t.after(fixture.cleanup)
  const result = await verifyManifest(fixture.manifestPath)
  assert.equal(result.manifest.native_apply.status, "future-declared-status")
  assert.equal(result.manifest.native_apply.extra.retained, true)
})

test("missing Circuit JSON has a specific refusal", async (t) => {
  const fixture = await temporaryFixture()
  t.after(fixture.cleanup)
  await unlink(fixture.circuitPath)
  await assert.rejects(() => verifyManifest(fixture.manifestPath), (error) => {
    assert.equal(error.code, "circuit_json.missing")
    assert.match(error.message, /circuit json is missing/i)
    return true
  })
})

const GOLDEN_V3 = path.join(import.meta.dirname, "fixtures", "platform-v3")

async function goldenCopy() {
  const root = await mkdtemp(path.join(os.tmpdir(), "circuit-preview-golden-"))
  await cp(GOLDEN_V3, root, { recursive: true })
  return { root, manifestPath: path.join(root, "design.manifest.json"), cleanup: () => rm(root, { recursive: true, force: true }) }
}

test("a V3 manifest written by PhiCad Platform itself verifies (native_artifact vocabulary)", async () => {
  const result = await verifyManifest(path.join(GOLDEN_V3, "design.manifest.json"))
  assert.equal(result.manifest.manifest_version, 3)
  assert.equal(result.manifest.native_revision, "r0-golden")
  assert.equal(result.manifest.studio_hash, undefined)
  assert.equal(result.manifest.native_apply.status, "unavailable-v1")
})

test("a tampered V3 native revision fails the self-hash", async (t) => {
  const golden = await goldenCopy()
  t.after(golden.cleanup)
  const text = await readFile(golden.manifestPath, "utf8")
  await writeFile(golden.manifestPath, text.replaceAll("r0-golden", "r1-forged"))
  await assert.rejects(() => verifyManifest(golden.manifestPath), { code: "manifest.self_hash_mismatch" })
})

test("a V3 native artifact whose bytes changed fails closed", async (t) => {
  const golden = await goldenCopy()
  t.after(golden.cleanup)
  await writeFile(path.join(golden.root, "board.kicad_pcb"), "tampered board\n")
  await assert.rejects(() => verifyManifest(golden.manifestPath), (error) => {
    assert.equal(error.code, "evidence.hash_mismatch")
    assert.match(error.message, /native artifact hash mismatch/)
    return true
  })
})
