import path from "node:path"
import { PreviewError } from "./errors.js"
import { writeExactFile } from "./hash.js"

export const CLAIM_NOT_MADE = "This is review intent only; it applies nothing and approves no fabrication."
const DECISIONS = new Set(["approve", "request-change", "comment-only"])
const TARGET = /^(board|net:[A-Za-z0-9_.+:/-]{1,200}|finding:[A-Za-z0-9_.+:/-]{1,200}|[A-Za-z][A-Za-z0-9_.-]{0,199})$/

export function buildReviewIntent(payload, context, now = new Date()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PreviewError("review.invalid_payload", "Review request must be a JSON object")
  }
  if (!DECISIONS.has(payload.decision)) {
    throw new PreviewError("review.invalid_decision", "decision must be approve, request-change, or comment-only")
  }
  if (!Array.isArray(payload.comments) || payload.comments.length > 256) {
    throw new PreviewError("review.invalid_comments", "comments must be an array with at most 256 entries")
  }
  const comments = payload.comments.map((comment, index) => {
    if (!comment || typeof comment !== "object" || Array.isArray(comment)) {
      throw new PreviewError("review.invalid_comment", `Comment ${index + 1} must be an object`)
    }
    if (typeof comment.target !== "string" || !TARGET.test(comment.target)) {
      throw new PreviewError("review.invalid_target", `Comment ${index + 1} has an invalid target`)
    }
    if (typeof comment.body !== "string" || comment.body.trim() === "" || comment.body.length > 10_000) {
      throw new PreviewError("review.invalid_comment", `Comment ${index + 1} body must contain 1–10000 characters`)
    }
    return { target: comment.target, body: comment.body }
  })
  if (typeof payload.reviewer_note !== "string" || payload.reviewer_note.length > 50_000) {
    throw new PreviewError("review.invalid_note", "reviewer_note must be a string of at most 50000 characters")
  }
  return {
    schema: "io.github.couplet-physical-ai.circuit-preview.review-intent/v1",
    manifest_path: path.resolve(context.manifestPath),
    manifest_sha256: context.manifestFileSha256,
    decision: payload.decision,
    comments,
    reviewer_note: payload.reviewer_note,
    created_at: now.toISOString(),
    claims_not_made: [CLAIM_NOT_MADE],
  }
}

export async function recordReviewIntent(reviewOut, payload, context, now = new Date()) {
  if (!reviewOut) {
    throw new PreviewError("review.output_not_configured", "No --review-out path was supplied; review intent cannot be written")
  }
  const intent = buildReviewIntent(payload, context, now)
  const bytes = Buffer.from(`${JSON.stringify(intent, null, 2)}\n`, "utf8")
  try {
    await writeExactFile(path.resolve(reviewOut), bytes)
  } catch (error) {
    if (error instanceof PreviewError) throw error
    throw new PreviewError("review.write_failed", `Could not write the caller-supplied review path: ${error.message}`, {
      path: path.resolve(reviewOut),
    })
  }
  return intent
}
