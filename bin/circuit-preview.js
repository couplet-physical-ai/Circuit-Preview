#!/usr/bin/env node
import path from "node:path"
import { fileURLToPath } from "node:url"
import { refusalText } from "../src/errors.js"
import { preparePreview, startServer } from "../src/server.js"

const USAGE = `Usage: circuit-preview --manifest <path> [--circuit-json <path>] [--review-out <path>] [--port 0]\n\nStarts one localhost-only preview process bound to one hash-verified manifest.\nThe default port is 0 (an operating-system-selected ephemeral port).\n`

export function parseArguments(argv) {
  const result = { manifestPath: null, circuitPath: null, reviewOut: null, port: 0 }
  const values = new Set(["--manifest", "--circuit-json", "--review-out", "--port"])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--help" || argument === "-h") return { help: true }
    if (!values.has(argument)) throw new Error(`Unknown argument: ${argument}`)
    if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) throw new Error(`Missing value for ${argument}`)
    const value = argv[++index]
    if (argument === "--manifest") result.manifestPath = value
    else if (argument === "--circuit-json") result.circuitPath = value
    else if (argument === "--review-out") result.reviewOut = value
    else result.port = Number(value)
  }
  if (!result.manifestPath) throw new Error("--manifest is required")
  if (!Number.isInteger(result.port) || result.port < 0 || result.port > 65535) {
    throw new Error("--port must be an integer from 0 through 65535")
  }
  return result
}

async function main() {
  let options
  try {
    options = parseArguments(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}`)
    process.exitCode = 2
    return
  }
  if (options.help) {
    process.stdout.write(USAGE)
    return
  }

  try {
    const context = await preparePreview(options)
    const listening = await startServer(context, options.port)
    process.stdout.write(`Circuit Preview: ${listening.url}\n`)
    process.stdout.write(`Manifest file SHA-256: ${context.manifestFileSha256}\n`)
    process.stdout.write(`Circuit JSON SHA-256: ${context.manifest.circuit_json_hash}\n`)
    process.stdout.write(context.reviewOut
      ? `Review intent output: ${context.reviewOut}\n`
      : "Review intent output: disabled (no --review-out path supplied)\n")

    const stop = () => listening.server.close(() => process.exit(0))
    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
  } catch (error) {
    process.stderr.write(refusalText(error))
    process.exitCode = 3
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main()
