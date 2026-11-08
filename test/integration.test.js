import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { preparePreview, startServer } from "../src/server.js"
import { createFixture, snapshotTree } from "../test-support/helpers.js"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function runCli(argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repositoryRoot, "bin/circuit-preview.js"), ...argumentsList], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || "C" },
    })
    const stdout = []
    const stderr = []
    child.stdout.on("data", (chunk) => stdout.push(chunk))
    child.stderr.on("data", (chunk) => stderr.push(chunk))
    child.once("error", reject)
    child.once("close", (code, signal) => resolve({ code, signal, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }))
  })
}

test("CLI visibly refuses and exits non-zero on an artifact mismatch", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "circuit-preview-cli-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = await createFixture(root)
  await writeFile(fixture.boardPath, "hash mismatch\n")
  const result = await runCli(["--manifest", fixture.manifestPath])
  assert.equal(result.code, 3)
  assert.equal(result.stdout, "")
  assert.match(result.stderr, /Circuit Preview refused to render/)
  assert.match(result.stderr, /Code: evidence\.hash_mismatch/)
  assert.match(result.stderr, /expected: [0-9a-f]{64}/)
  assert.match(result.stderr, /actual: [0-9a-f]{64}/)
})

test("serving and recording intent write nothing outside the supplied review path", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "circuit-preview-write-boundary-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = await createFixture(root)
  const reviewOut = path.join(root, "explicit-review-output.json")
  const before = await snapshotTree(root)
  const context = await preparePreview({ manifestPath: fixture.manifestPath, reviewOut })
  const listening = await startServer(context, 0)
  t.after(() => new Promise((resolve) => listening.server.close(resolve)))

  const page = await fetch(listening.url)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /data-status="not-run"/)
  const response = await fetch(`${listening.url}api/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      decision: "comment-only",
      comments: [{ target: "board", body: "No design write is requested." }],
      reviewer_note: "Boundary test",
    }),
  })
  assert.equal(response.status, 201)
  const responseBody = await response.json()
  assert.equal(responseBody.intent.claims_not_made[0], "This is review intent only; it applies nothing and approves no fabrication.")

  const after = await snapshotTree(root)
  assert.deepEqual([...after.keys()].sort(), [...before.keys(), "explicit-review-output.json"].sort())
  for (const [file, hash] of before) assert.equal(after.get(file), hash, `${file} must remain byte-identical`)
  const written = JSON.parse(await readFile(reviewOut, "utf8"))
  assert.equal(written.decision, "comment-only")
  assert.equal(written.manifest_sha256, context.manifestFileSha256)
})
