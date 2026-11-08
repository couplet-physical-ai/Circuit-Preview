import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readFile } from "node:fs/promises"
import { parseCircuitJson, renderCircuitSvgs, summarizeCircuit } from "./circuit.js"
import { PreviewError } from "./errors.js"
import { renderPage } from "./html.js"
import { verifyManifest } from "./manifest.js"
import { recordReviewIntent } from "./review.js"

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const publicDirectory = path.resolve(moduleDirectory, "../public")
const MAX_REVIEW_REQUEST = 1024 * 1024
const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
const SVG_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:"

function commonHeaders(contentType, csp = PAGE_CSP) {
  return {
    "Content-Type": contentType,
    "Content-Security-Policy": csp,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-origin",
  }
}

function respond(response, status, body, contentType, csp) {
  response.writeHead(status, commonHeaders(contentType, csp))
  response.end(body)
}

async function readJsonRequest(request) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > MAX_REVIEW_REQUEST) {
      throw new PreviewError("review.request_too_large", `Review request exceeds ${MAX_REVIEW_REQUEST} bytes`)
    }
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch (error) {
    throw new PreviewError("review.invalid_json", `Review request is not valid JSON: ${error.message}`)
  }
}

function allowedRequest(request, port) {
  const expected = `127.0.0.1:${port}`
  if (request.headers.host !== expected) return false
  const origin = request.headers.origin
  return !origin || origin === `http://${expected}`
}

export async function preparePreview({ manifestPath, circuitPath = null, reviewOut = null }) {
  const verified = await verifyManifest(manifestPath, circuitPath)
  const elements = parseCircuitJson(verified.circuitBytes)
  const svgs = renderCircuitSvgs(elements)
  const summary = summarizeCircuit(elements, verified.artifactBytes.get("kicad-drc"))
  const context = {
    ...verified,
    elements,
    svgs,
    summary,
    reviewOut: reviewOut ? path.resolve(reviewOut) : null,
  }
  context.html = renderPage(context)
  return context
}

export async function startServer(context, requestedPort = 0) {
  const css = await readFile(path.join(publicDirectory, "app.css"))
  const javascript = await readFile(path.join(publicDirectory, "app.js"))
  let actualPort = null
  const server = http.createServer(async (request, response) => {
    if (!allowedRequest(request, actualPort)) {
      respond(response, 403, "Request origin or Host is not allowed.\n", "text/plain; charset=utf-8")
      return
    }
    const url = new URL(request.url, `http://127.0.0.1:${actualPort}`)
    if (request.method === "GET" && url.pathname === "/") {
      respond(response, 200, context.html, "text/html; charset=utf-8")
      return
    }
    if (request.method === "GET" && url.pathname === "/assets/app.css") {
      respond(response, 200, css, "text/css; charset=utf-8")
      return
    }
    if (request.method === "GET" && url.pathname === "/assets/app.js") {
      respond(response, 200, javascript, "text/javascript; charset=utf-8")
      return
    }
    if (request.method === "GET" && url.pathname === "/render/pcb.svg") {
      respond(response, 200, context.svgs.pcb, "image/svg+xml; charset=utf-8", SVG_CSP)
      return
    }
    if (request.method === "GET" && url.pathname === "/render/schematic.svg") {
      respond(response, 200, context.svgs.schematic, "image/svg+xml; charset=utf-8", SVG_CSP)
      return
    }
    if (request.method === "POST" && url.pathname === "/api/review") {
      if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
        respond(response, 415, JSON.stringify({ code: "review.invalid_content_type", reason: "Content-Type must be application/json" }), "application/json; charset=utf-8")
        return
      }
      try {
        const payload = await readJsonRequest(request)
        const intent = await recordReviewIntent(context.reviewOut, payload, context)
        respond(response, 201, JSON.stringify({ ok: true, intent }), "application/json; charset=utf-8")
      } catch (error) {
        const code = error instanceof PreviewError ? error.code : "review.internal_error"
        respond(response, 400, JSON.stringify({ ok: false, code, reason: error.message }), "application/json; charset=utf-8")
      }
      return
    }
    respond(response, 404, "Not found.\n", "text/plain; charset=utf-8")
  })
  server.requestTimeout = 60_000
  server.headersTimeout = 60_000
  server.keepAliveTimeout = 2_000
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(requestedPort, "127.0.0.1", resolve)
  })
  actualPort = server.address().port
  return { server, port: actualPort, url: `http://127.0.0.1:${actualPort}/` }
}
