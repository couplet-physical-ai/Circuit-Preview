import path from "node:path"
import { PreviewError } from "./errors.js"
import {
  canonicalManifestPayload,
  readRegularFile,
  requireSha256,
  sha256Bytes,
  sha256RegularFile,
} from "./hash.js"

const MANIFEST_MAX_BYTES = 4 * 1024 * 1024
const EVIDENCE_MAX_BYTES = 512 * 1024 * 1024
const ORIGINS = ["tscircuit", "kicad"]
export const RUN_STATUSES = ["not-run", "carried-input", "reported", "passed", "failed", "unavailable"]

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PreviewError("manifest.invalid_field", `${field} must be an object`, { field })
  }
  return value
}

function exactKeys(value, expected, field) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new PreviewError("manifest.invalid_origins", `${field} must name exactly tscircuit and kicad`, {
      field,
      actual: actual.join(", "),
    })
  }
}

function referencedPath(value, manifestDirectory) {
  if (typeof value !== "string" || value.length === 0) return null
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(manifestDirectory, value)
}

/**
 * The native evidence a manifest binds, under its version's vocabulary: V2 says studio_*,
 * V3 says native_artifact_* / native_revision (PhiCad Platform ADR 0002). Same evidence,
 * different names; each version is verified against its own fields only.
 */
export function nativeEvidence(manifest) {
  if (manifest.manifest_version === 3) {
    return {
      label: "Native revision",
      artifactLabel: "native artifact",
      record: manifest.native_artifact,
      recordField: "native_artifact",
      hash: manifest.native_artifact_hash,
      hashField: "native_artifact_hash",
      path: manifest.native_artifact_path,
      revision: manifest.native_revision,
    }
  }
  return {
    label: "Studio revision",
    artifactLabel: "Studio artifact",
    record: manifest.studio,
    recordField: "studio",
    hash: manifest.studio_hash,
    hashField: "studio_hash",
    path: manifest.studio_path,
    revision: manifest.studio_revision,
  }
}

async function verifyBoundFile(filePath, expected, label, maxBytes = EVIDENCE_MAX_BYTES, fileCode = "evidence") {
  const result = await sha256RegularFile(filePath, { label: fileCode, maxBytes })
  if (result.sha256 !== expected) {
    throw new PreviewError("evidence.hash_mismatch", `${label} hash mismatch; rendering is refused`, {
      path: filePath,
      expected,
      actual: result.sha256,
    })
  }
  return result.bytes
}

function validateManifestShape(manifest) {
  if (manifest.manifest_version !== 2 && manifest.manifest_version !== 3) {
    throw new PreviewError(
      "manifest.unsupported_version",
      `Manifest version ${String(manifest.manifest_version)} is unsupported; expected 2 or 3`,
    )
  }
  if (manifest.manifest_version === 3 && (!manifest.native_apply || typeof manifest.native_apply !== "object" || Array.isArray(manifest.native_apply))) {
    throw new PreviewError("manifest.missing_native_apply", "Manifest V3 must declare a native_apply block")
  }
  if (typeof manifest.design_id !== "string" || manifest.design_id.trim() === "") {
    throw new PreviewError("manifest.invalid_design_id", "design_id must be a non-empty string")
  }

  const approval = object(manifest.approval, "approval")
  if (!["pending", "approved", "rejected"].includes(manifest.approval_state) || approval.state !== manifest.approval_state) {
    throw new PreviewError("manifest.invalid_approval", "approval and approval_state must name the same canonical approval state")
  }
  const configuration = object(manifest.configuration, "configuration")
  if (configuration.artifact_root != null && (typeof configuration.artifact_root !== "string" || configuration.artifact_root.length === 0)) {
    throw new PreviewError("manifest.invalid_configuration", "configuration.artifact_root must be a non-empty string when present")
  }

  requireSha256(manifest.source_hash, "source_hash")
  requireSha256(manifest.circuit_json_hash, "circuit_json_hash")
  const evidence = nativeEvidence(manifest)
  requireSha256(evidence.hash, evidence.hashField)
  requireSha256(manifest.manifest_hash, "manifest_hash")

  const circuit = object(manifest.circuit_json, "circuit_json")
  const source = object(manifest.source, "source")
  const native = object(evidence.record, evidence.recordField)
  if (circuit.hash !== manifest.circuit_json_hash || source.hash !== manifest.source_hash || native.sha256 !== evidence.hash) {
    throw new PreviewError("manifest.inconsistent_alias", "Top-level evidence hashes do not match their nested records")
  }
  if (manifest.circuit_json_path !== circuit.path || manifest.source_path !== source.path || evidence.path !== native.path) {
    throw new PreviewError("manifest.inconsistent_alias", "Top-level evidence paths do not match their nested records")
  }
  if (evidence.revision !== native.revision || typeof native.revision !== "string" || native.revision.length === 0) {
    throw new PreviewError("manifest.inconsistent_alias", `Top-level ${evidence.label} does not match its nested record`)
  }

  const diagnostics = object(manifest.diagnostics, "diagnostics")
  const statuses = object(manifest.diagnostic_status, "diagnostic_status")
  exactKeys(diagnostics, ORIGINS, "diagnostics")
  exactKeys(statuses, ORIGINS, "diagnostic_status")
  for (const origin of ORIGINS) {
    if (!RUN_STATUSES.includes(statuses[origin])) {
      throw new PreviewError("manifest.invalid_run_status", `Invalid run status for ${origin}: ${String(statuses[origin])}`)
    }
    const counts = object(diagnostics[origin], `diagnostics.${origin}`)
    for (const severity of ["errors", "warnings", "info"]) {
      if (!Number.isSafeInteger(counts[severity]) || counts[severity] < 0) {
        throw new PreviewError("manifest.invalid_diagnostics", `diagnostics.${origin}.${severity} must be a non-negative integer`)
      }
    }
  }

  if (!Array.isArray(manifest.artifacts)) {
    throw new PreviewError("manifest.invalid_artifacts", "artifacts must be an array")
  }
  if (manifest.artifacts.length > 256) {
    throw new PreviewError("manifest.artifact_limit", `Manifest references ${manifest.artifacts.length} artifacts; the limit is 256`)
  }
  const artifactHashes = object(manifest.artifact_hashes, "artifact_hashes")
  const seenKinds = new Set()
  for (const artifact of manifest.artifacts) {
    object(artifact, "artifact")
    if (typeof artifact.kind !== "string" || artifact.kind.length === 0 || seenKinds.has(artifact.kind)) {
      throw new PreviewError("manifest.invalid_artifacts", "Artifact kinds must be non-empty and unique")
    }
    seenKinds.add(artifact.kind)
    requireSha256(artifact.sha256, `artifacts.${artifact.kind}.sha256`)
    if (artifactHashes[artifact.kind] !== artifact.sha256) {
      throw new PreviewError("manifest.inconsistent_artifact_hashes", "artifact_hashes does not match artifacts", {
        kind: artifact.kind,
      })
    }
    if (typeof artifact.path !== "string" || artifact.path.length === 0 || path.isAbsolute(artifact.path) || artifact.path.split(/[\\/]/).includes("..")) {
      throw new PreviewError("manifest.invalid_artifact_path", `Artifact path must stay relative: ${String(artifact.path)}`)
    }
  }
  if (Object.keys(artifactHashes).length !== manifest.artifacts.length) {
    throw new PreviewError("manifest.inconsistent_artifact_hashes", "artifact_hashes contains entries not present in artifacts")
  }
  object(manifest.tool_versions, "tool_versions")
  for (const [tool, version] of Object.entries(manifest.tool_versions)) {
    if (!tool || typeof version !== "string" || version.trim() === "") {
      throw new PreviewError("manifest.invalid_tool_versions", "tool_versions must contain non-empty string pairs")
    }
  }
}

export async function verifyManifest(manifestInput, circuitOverride = null) {
  const manifestPath = path.resolve(manifestInput)
  const manifestBytes = await readRegularFile(manifestPath, { label: "manifest", maxBytes: MANIFEST_MAX_BYTES })
  const rawText = manifestBytes.toString("utf8")
  let manifest
  try {
    manifest = JSON.parse(rawText)
  } catch (error) {
    throw new PreviewError("manifest.invalid_json", `Cannot parse manifest JSON: ${error.message}`)
  }
  validateManifestShape(manifest)

  const calculatedSelfHash = sha256Bytes(canonicalManifestPayload(rawText))
  if (calculatedSelfHash !== manifest.manifest_hash) {
    throw new PreviewError("manifest.self_hash_mismatch", "Manifest self-hash does not match canonical manifest content", {
      expected: manifest.manifest_hash,
      actual: calculatedSelfHash,
    })
  }

  const manifestDirectory = path.dirname(manifestPath)
  const circuitPath = circuitOverride
    ? path.resolve(circuitOverride)
    : referencedPath(manifest.circuit_json_path, manifestDirectory)
  if (!circuitPath) {
    throw new PreviewError("circuit_json.missing", "Circuit JSON is missing: pass --circuit-json or provide circuit_json_path in the manifest")
  }

  const circuitBytes = await verifyBoundFile(
    circuitPath,
    manifest.circuit_json_hash,
    "Circuit JSON",
    32 * 1024 * 1024,
    "circuit_json",
  )

  const sourcePath = referencedPath(manifest.source_path, manifestDirectory)
  if (sourcePath) await verifyBoundFile(sourcePath, manifest.source_hash, "source", 2 * 1024 * 1024)
  const evidence = nativeEvidence(manifest)
  const nativePath = referencedPath(evidence.path, manifestDirectory)
  if (nativePath) await verifyBoundFile(nativePath, evidence.hash, evidence.artifactLabel)

  const configuredRoot = manifest.configuration?.artifact_root
  const artifactRoot = configuredRoot
    ? referencedPath(configuredRoot, manifestDirectory)
    : manifestDirectory
  const artifactBytes = new Map()
  const artifactPaths = new Map()
  let retainedArtifactBytes = 0
  for (const artifact of manifest.artifacts) {
    const candidate = path.resolve(artifactRoot, artifact.path)
    const relative = path.relative(path.resolve(artifactRoot), candidate)
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new PreviewError("manifest.artifact_escape", `Artifact escapes its configured root: ${artifact.path}`)
    }
    const bytes = await verifyBoundFile(candidate, artifact.sha256, `artifact ${artifact.kind}`)
    retainedArtifactBytes += bytes.length
    if (retainedArtifactBytes > EVIDENCE_MAX_BYTES) {
      throw new PreviewError("manifest.retained_output_limit", `Referenced artifacts exceed the ${EVIDENCE_MAX_BYTES}-byte retained-output limit`, {
        bytes: retainedArtifactBytes,
        limit: EVIDENCE_MAX_BYTES,
      })
    }
    artifactBytes.set(artifact.kind, bytes)
    artifactPaths.set(artifact.kind, candidate)
  }

  return {
    manifest,
    manifestPath,
    manifestFileSha256: sha256Bytes(manifestBytes),
    circuitPath,
    circuitBytes,
    artifactBytes,
    artifactPaths,
  }
}
