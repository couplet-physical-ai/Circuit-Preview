import assert from "node:assert/strict"
import test from "node:test"
import { renderRunStatus } from "../src/html.js"
import { buildReviewIntent, CLAIM_NOT_MADE } from "../src/review.js"

const zeroCounts = { errors: 0, warnings: 0, info: 0 }

test("review intent has exactly the section 6 contract shape", () => {
  const now = new Date("2026-09-15T12:34:56.000Z")
  const intent = buildReviewIntent(
    {
      decision: "request-change",
      comments: [
        { target: "R1", body: "Confirm value." },
        { target: "net:GND", body: "Review return path." },
        { target: "finding:abc123", body: "Resolve this finding." },
        { target: "board", body: "Review board outline." },
      ],
      reviewer_note: "Human review note.",
    },
    { manifestPath: "/tmp/design.manifest.json", manifestFileSha256: "a".repeat(64) },
    now,
  )
  assert.deepEqual(Object.keys(intent), [
    "schema", "manifest_path", "manifest_sha256", "decision", "comments",
    "reviewer_note", "created_at", "claims_not_made",
  ])
  assert.deepEqual(intent, {
    schema: "io.github.couplet-physical-ai.circuit-preview.review-intent/v1",
    manifest_path: "/tmp/design.manifest.json",
    manifest_sha256: "a".repeat(64),
    decision: "request-change",
    comments: [
      { target: "R1", body: "Confirm value." },
      { target: "net:GND", body: "Review return path." },
      { target: "finding:abc123", body: "Resolve this finding." },
      { target: "board", body: "Review board outline." },
    ],
    reviewer_note: "Human review note.",
    created_at: "2026-09-15T12:34:56.000Z",
    claims_not_made: [CLAIM_NOT_MADE],
  })
})

test("all six run statuses render verbatim with status-specific treatment", () => {
  for (const status of ["not-run", "carried-input", "reported", "passed", "failed", "unavailable"]) {
    const reason = status === "unavailable" ? "kicad-cli was not installed" : null
    const html = renderRunStatus("kicad", status, zeroCounts, reason)
    assert.match(html, new RegExp(`data-status="${status}"`))
    assert.match(html, new RegExp(`run-status--${status}`))
    assert.match(html, new RegExp(`<strong class="status-literal">${status}</strong>`))
  }
})

test("zero findings with not-run never renders as a pass", () => {
  const html = renderRunStatus("tscircuit", "not-run", zeroCounts)
  assert.doesNotMatch(html, /run-status--passed/)
  assert.doesNotMatch(html, /status-glyph[^>]*>✓/)
  assert.match(html, /Not run\. Circuit Preview ran no checker/)
  assert.match(html, /<dt>total<\/dt><dd>0<\/dd>/)
})

test("carried-input and unavailable expose their distinct reasons", () => {
  const carried = renderRunStatus("tscircuit", "carried-input", zeroCounts)
  const unavailable = renderRunStatus("kicad", "unavailable", zeroCounts, "PhiCad Verify executable was absent")
  assert.match(carried, /Findings were carried in with the input; Circuit Preview ran no checker/)
  assert.match(unavailable, /PhiCad Verify executable was absent/)
  assert.match(carried, /run-status--carried-input/)
  assert.match(unavailable, /run-status--unavailable/)
})
