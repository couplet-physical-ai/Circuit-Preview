import { createHash } from "node:crypto"
import { lstat, open, readFile } from "node:fs/promises"
import { constants } from "node:fs"
import { PreviewError } from "./errors.js"

const SHA256_RE = /^[0-9a-f]{64}$/

class JsonNumber {
  constructor(source) {
    this.source = source
  }
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

export function requireSha256(value, field) {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    throw new PreviewError("manifest.invalid_sha256", `${field} must be a lowercase SHA-256 digest`, {
      field,
    })
  }
  return value
}

export async function readRegularFile(path, { label, maxBytes }) {
  let stat
  try {
    stat = await lstat(path)
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new PreviewError(`${label}.missing`, `${label.replaceAll("_", " ")} is missing: ${path}`, { path })
    }
    throw new PreviewError(`${label}.unreadable`, `Cannot inspect ${label.replaceAll("_", " ")}: ${error.message}`, {
      path,
    })
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new PreviewError(`${label}.not_regular`, `${label.replaceAll("_", " ")} must be a regular, non-symlink file`, {
      path,
    })
  }
  if (stat.size > maxBytes) {
    throw new PreviewError(`${label}.too_large`, `${label.replaceAll("_", " ")} exceeds the ${maxBytes}-byte limit`, {
      path,
      bytes: stat.size,
      limit: maxBytes,
    })
  }
  return readFile(path)
}

export async function sha256RegularFile(path, options) {
  const bytes = await readRegularFile(path, options)
  return { bytes, sha256: sha256Bytes(bytes) }
}

function pythonFloat(source) {
  const value = Number(source)
  if (!Number.isFinite(value)) throw new PreviewError("manifest.invalid_json", "Manifest contains a non-finite number")
  if (Object.is(value, -0) || (value === 0 && source.trimStart().startsWith("-"))) return "-0.0"
  if (value === 0) return "0.0"

  const magnitude = Math.abs(value)
  if (magnitude >= 1e16 || magnitude < 1e-4) {
    return value
      .toExponential()
      .replace(/e([+-])(\d+)$/, (_match, sign, digits) => `e${sign}${digits.padStart(2, "0")}`)
  }
  const decimal = String(value)
  return decimal.includes(".") ? decimal : `${decimal}.0`
}

function compareCodePoints(left, right) {
  const a = [...left]
  const b = [...right]
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = a[index].codePointAt(0) - b[index].codePointAt(0)
    if (difference !== 0) return difference
  }
  return a.length - b.length
}

function canonicalValue(value) {
  if (value instanceof JsonNumber) {
    return /[.eE]/.test(value.source) ? pythonFloat(value.source) : BigInt(value.source).toString()
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`
  const members = Object.keys(value)
    .sort(compareCodePoints)
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`)
  return `{${members.join(",")}}`
}

function parseWithNumberKinds(rawText) {
  try {
    return JSON.parse(rawText, (_key, value, context) =>
      typeof value === "number" ? new JsonNumber(context.source) : value,
    )
  } catch (error) {
    throw new PreviewError("manifest.invalid_json", `Cannot parse manifest JSON: ${error.message}`)
  }
}

/** Mirror Python's canonical json.dumps settings while retaining int/float kinds. */
export function canonicalPythonJsonBytes(rawText) {
  return Buffer.from(canonicalValue(parseWithNumberKinds(rawText)), "utf8")
}

/**
 * Mirror DesignManifest._payload() and its Python canonical JSON encoding.
 * V2 hashes only the declared payload fields and sorts artifact records by
 * kind/path. V3 names the native evidence native_artifact_* instead of
 * studio_* and adds the integrity-bound native_apply declaration, whose
 * internal fields remain opaque to this preview.
 */
export function canonicalManifestPayload(rawText) {
  const parsed = parseWithNumberKinds(rawText)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PreviewError("manifest.invalid_root", "Manifest root must be an object")
  }
  const artifacts = Array.isArray(parsed.artifacts)
    ? parsed.artifacts.map((artifact) => ({ kind: artifact.kind, path: artifact.path, sha256: artifact.sha256 }))
      .sort((left, right) => compareCodePoints(`${left.kind}\0${left.path}`, `${right.kind}\0${right.path}`))
    : parsed.artifacts
  const artifactHashes = Array.isArray(artifacts)
    ? Object.fromEntries(artifacts.map((artifact) => [artifact.kind, artifact.sha256]))
    : parsed.artifact_hashes
  const diagnostics = {
    tscircuit: {
      errors: parsed.diagnostics?.tscircuit?.errors,
      warnings: parsed.diagnostics?.tscircuit?.warnings,
      info: parsed.diagnostics?.tscircuit?.info,
    },
    kicad: {
      errors: parsed.diagnostics?.kicad?.errors,
      warnings: parsed.diagnostics?.kicad?.warnings,
      info: parsed.diagnostics?.kicad?.info,
    },
  }
  const payload = {
    approval: { state: parsed.approval_state },
    approval_state: parsed.approval_state,
    artifact_hashes: artifactHashes,
    artifacts,
    circuit_json: { hash: parsed.circuit_json_hash, path: parsed.circuit_json_path },
    circuit_json_hash: parsed.circuit_json_hash,
    circuit_json_path: parsed.circuit_json_path,
    configuration: parsed.configuration,
    design_id: parsed.design_id,
    diagnostic_status: {
      tscircuit: parsed.diagnostic_status?.tscircuit,
      kicad: parsed.diagnostic_status?.kicad,
    },
    diagnostics,
    manifest_version: parsed.manifest_version,
    source: { hash: parsed.source_hash, path: parsed.source_path },
    source_hash: parsed.source_hash,
    source_path: parsed.source_path,
    tool_versions: parsed.tool_versions,
  }
  // V2 keeps its original studio_* vocabulary; V3 names the same evidence native_artifact_*
  // and adds native_apply (DesignManifest._payload() in PhiCad Platform's manifest.py).
  if (parsed.manifest_version instanceof JsonNumber && Number(parsed.manifest_version.source) === 3) {
    payload.native_artifact = {
      path: parsed.native_artifact?.path,
      revision: parsed.native_artifact?.revision,
      sha256: parsed.native_artifact?.sha256,
    }
    payload.native_artifact_hash = parsed.native_artifact_hash
    payload.native_artifact_path = parsed.native_artifact_path
    payload.native_revision = parsed.native_revision
    payload.native_apply = parsed.native_apply
  } else {
    payload.studio = { path: parsed.studio_path, revision: parsed.studio_revision, sha256: parsed.studio_hash }
    payload.studio_hash = parsed.studio_hash
    payload.studio_path = parsed.studio_path
    payload.studio_revision = parsed.studio_revision
  }
  return Buffer.from(canonicalValue(payload), "utf8")
}

export async function writeExactFile(path, bytes) {
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW || 0)
  let handle
  try {
    handle = await open(path, flags, 0o600)
    await handle.writeFile(bytes)
  } finally {
    await handle?.close()
  }
}
