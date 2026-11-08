import { nativeEvidence } from "./manifest.js"
import { CLAIM_NOT_MADE } from "./review.js"

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function hashChip(hash, label = "Copy full hash") {
  const short = `${hash.slice(0, 12)}…`
  return `<span class="hash-pair"><code title="${escapeHtml(hash)}">${short}</code><button class="copy-button" type="button" data-copy="${escapeHtml(hash)}" aria-label="${escapeHtml(label)}">copy</button></span>`
}

function statusExplanation(status, reason) {
  switch (status) {
    case "passed": return "Checker ran; no disqualifying finding was reported."
    case "failed": return "Checker ran and rejected the design."
    case "reported": return "Checker ran and reported findings without a pass/fail verdict."
    case "carried-input": return "Findings were carried in with the input; Circuit Preview ran no checker."
    case "not-run": return "Not run. Circuit Preview ran no checker for this origin."
    case "unavailable": return reason || "No unavailable reason was supplied by the manifest."
    default: return "Unknown run status."
  }
}

export function renderRunStatus(origin, status, counts, reason = null) {
  const glyph = { passed: "✓", failed: "×", reported: "•", "carried-input": "↳", "not-run": "—", unavailable: "!" }[status] || "?"
  const total = counts.errors + counts.warnings + counts.info
  return `<section class="run-status run-status--${escapeHtml(status)}" data-origin="${escapeHtml(origin)}" data-status="${escapeHtml(status)}" aria-label="${escapeHtml(origin)} status ${escapeHtml(status)}">
    <div class="run-status__head"><span class="status-glyph" aria-hidden="true">${glyph}</span><h3>${escapeHtml(origin)}</h3><strong class="status-literal">${escapeHtml(status)}</strong></div>
    <p>${escapeHtml(statusExplanation(status, reason))}</p>
    <dl class="severity-counts"><div><dt>errors</dt><dd>${counts.errors}</dd></div><div><dt>warnings</dt><dd>${counts.warnings}</dd></div><div><dt>info</dt><dd>${counts.info}</dd></div><div><dt>total</dt><dd>${total}</dd></div></dl>
  </section>`
}

function renderFinding(finding) {
  const refs = finding.refs?.length ? `<p class="finding__refs">${finding.refs.map(escapeHtml).join(" · ")}</p>` : ""
  return `<li class="finding finding--${escapeHtml(finding.severity)}">
    <div class="finding__meta"><span class="severity-mark" aria-hidden="true"></span><strong>${escapeHtml(finding.severity)}</strong><code>${escapeHtml(finding.code)}</code><button type="button" class="comment-target" data-comment-target="finding:${escapeHtml(finding.id)}">comment</button></div>
    <p>${escapeHtml(finding.message)}</p>${refs}<code class="finding__id">finding:${escapeHtml(finding.id)}</code>
  </li>`
}

function renderFindings(origin, findings, expectedCounts) {
  const expected = expectedCounts.errors + expectedCounts.warnings + expectedCounts.info
  const countNote = findings.length === expected
    ? `${findings.length} detailed finding${findings.length === 1 ? "" : "s"}`
    : `${findings.length} detailed findings available; manifest count is ${expected}`
  return `<section class="finding-group" aria-labelledby="findings-${origin}">
    <div class="section-heading"><h3 id="findings-${origin}">${escapeHtml(origin)}</h3><span>${escapeHtml(countNote)}</span></div>
    ${findings.length ? `<ol class="finding-list">${findings.map(renderFinding).join("")}</ol>` : `<p class="empty-state">No detailed findings are present. This count does not imply a checker passed.</p>`}
  </section>`
}

function renderComponentRows(components) {
  if (!components.length) return `<tr><td colspan="4" class="empty-cell">No source components are present.</td></tr>`
  return components.map((component) => `<tr>
    <th scope="row"><button type="button" class="table-target" data-comment-target="${escapeHtml(component.ref)}">${escapeHtml(component.ref)}</button></th>
    <td>${escapeHtml(component.kind)}</td><td>${escapeHtml(component.value)}</td><td><code>${escapeHtml(component.sourceId)}</code></td>
  </tr>`).join("")
}

function renderConnectionRows(connections) {
  if (!connections.length) return `<tr><td colspan="4" class="empty-cell">No source nets or traces are present.</td></tr>`
  return connections.map((connection) => {
    const target = `net:${connection.name}`
    return `<tr><th scope="row"><button type="button" class="table-target" data-comment-target="${escapeHtml(target)}">${escapeHtml(connection.name)}</button></th><td>${escapeHtml(connection.kind)}</td><td><code>${escapeHtml(connection.id)}</code></td><td>${escapeHtml(connection.connections.join(", ") || "—")}</td></tr>`
  }).join("")
}

function optionTargets(summary) {
  const values = new Map([["board", "Board"]])
  for (const component of summary.components) values.set(component.ref, `Component · ${component.ref}`)
  for (const connection of summary.connections) values.set(`net:${connection.name}`, `Net/trace · ${connection.name}`)
  for (const origin of ["tscircuit", "kicad"]) {
    for (const finding of summary.findings[origin]) values.set(`finding:${finding.id}`, `Finding · ${finding.code}`)
  }
  return [...values].map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("")
}

function toolsFooter(toolVersions) {
  return Object.entries(toolVersions).sort(([a], [b]) => a.localeCompare(b)).map(([tool, version]) => `<span><strong>${escapeHtml(tool)}</strong> <code>${escapeHtml(version)}</code></span>`).join("")
}

export function renderPage(context) {
  const { manifest, manifestPath, manifestFileSha256, circuitPath, summary, reviewOut } = context
  const unavailableReasons = manifest.diagnostic_reasons || {}
  const native = nativeEvidence(manifest)
  const artifacts = manifest.artifacts.map((artifact) => `<tr><th scope="row">${escapeHtml(artifact.path)}</th><td>${escapeHtml(artifact.kind)}</td><td>${hashChip(artifact.sha256, `Copy ${artifact.path} hash`)}</td></tr>`).join("")
  const nativeApply = manifest.manifest_version === 3
    ? `<span class="identity-item"><span>native apply declaration</span><code>${escapeHtml(manifest.native_apply?.status || "declared")}</code></span>`
    : `<span class="identity-item"><span>native apply</span><code>unavailable-v1 (V2 default)</code></span>`
  const reviewDisabled = reviewOut ? "" : "disabled"
  const reviewNote = reviewOut
    ? `Writes only to ${escapeHtml(reviewOut)}`
    : "Unavailable: restart with --review-out &lt;path&gt; to permit one explicit output file."

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(manifest.design_id)} · Circuit Preview</title>
  <link rel="stylesheet" href="/assets/app.css">
  <script src="/assets/app.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#workspace">Skip to preview workspace</a>
  <header class="app-header">
    <div class="brand-mark" aria-hidden="true"></div>
    <div><p class="eyebrow">Circuit Preview</p><h1>${escapeHtml(manifest.design_id)}</h1><p>Verified local preview · no native CAD authority</p></div>
    <button id="theme-toggle" class="quiet-button" type="button" aria-label="Toggle light and dark theme">theme</button>
  </header>

  <section class="identity-strip" aria-labelledby="identity-heading">
    <h2 id="identity-heading" class="sr-only">Design identity</h2>
    <span class="identity-item"><span>manifest file</span>${hashChip(manifestFileSha256, "Copy manifest file hash")}</span>
    <span class="identity-item"><span>manifest self-hash</span>${hashChip(manifest.manifest_hash, "Copy manifest self-hash")}</span>
    <span class="identity-item"><span>Circuit JSON</span>${hashChip(manifest.circuit_json_hash, "Copy Circuit JSON hash")}</span>
    <span class="identity-item"><span>${escapeHtml(native.label)}</span><code title="${escapeHtml(native.revision)}">${escapeHtml(native.revision.slice(0, 12))}…</code></span>
    <span class="identity-item"><span>approval state</span><code>${escapeHtml(manifest.approval_state)}</code></span>
    ${nativeApply}
  </section>

  <main id="workspace" class="workspace">
    <section class="status-band" aria-labelledby="checks-heading">
      <div class="section-heading"><div><p class="step-label">01 · check state</p><h2 id="checks-heading">Did anything check these bytes?</h2></div><p>Run status is independent from finding count.</p></div>
      <div class="status-grid">
        ${["tscircuit", "kicad"].map((origin) => renderRunStatus(origin, manifest.diagnostic_status[origin], manifest.diagnostics[origin], unavailableReasons[origin] || manifest.diagnostics[origin]?.reason)).join("")}
      </div>
    </section>

    <section class="preview-area" aria-labelledby="preview-heading">
      <div class="view-header">
        <div><p class="step-label">02 · exact input preview</p><h2 id="preview-heading">Circuit JSON views</h2></div>
        <div class="tab-list" role="tablist" aria-label="Circuit views">
          <button id="tab-pcb" role="tab" aria-selected="true" aria-controls="panel-pcb" tabindex="0">PCB</button>
          <button id="tab-schematic" role="tab" aria-selected="false" aria-controls="panel-schematic" tabindex="-1">Schematic</button>
          <button id="tab-summary" role="tab" aria-selected="false" aria-controls="panel-summary" tabindex="-1">Parts &amp; nets</button>
        </div>
      </div>
      <div class="canvas-toolbar" aria-label="Canvas controls"><span>Arrow keys pan the focused canvas</span><button type="button" data-zoom="out" aria-label="Zoom out">−</button><output id="zoom-output">100%</output><button type="button" data-zoom="in" aria-label="Zoom in">+</button><button type="button" data-zoom="reset">reset</button></div>
      <div id="panel-pcb" class="tab-panel" role="tabpanel" aria-labelledby="tab-pcb"><div class="canvas" tabindex="0" aria-label="PCB preview canvas; use arrow keys to pan"><img src="/render/pcb.svg" alt="PCB preview generated from the hash-verified Circuit JSON"></div></div>
      <div id="panel-schematic" class="tab-panel" role="tabpanel" aria-labelledby="tab-schematic" hidden><div class="canvas" tabindex="0" aria-label="Schematic preview canvas; use arrow keys to pan"><img src="/render/schematic.svg" alt="Schematic preview generated from the hash-verified Circuit JSON"></div></div>
      <div id="panel-summary" class="tab-panel summary-panel" role="tabpanel" aria-labelledby="tab-summary" hidden>
        <section><div class="section-heading"><h3>Parts</h3><span>${summary.components.length}</span></div><div class="table-wrap"><table><thead><tr><th>reference</th><th>kind</th><th>value</th><th>source id</th></tr></thead><tbody>${renderComponentRows(summary.components)}</tbody></table></div></section>
        <section><div class="section-heading"><h3>Nets &amp; traces</h3><span>${summary.connections.length}</span></div><div class="table-wrap"><table><thead><tr><th>name</th><th>kind</th><th>id</th><th>connections</th></tr></thead><tbody>${renderConnectionRows(summary.connections)}</tbody></table></div></section>
        <section><div class="section-heading"><h3>Element inventory</h3><span>${summary.elementCount} total</span></div><dl class="inventory">${Object.entries(summary.typeCounts).sort(([a], [b]) => a.localeCompare(b)).map(([type, count]) => `<div><dt><code>${escapeHtml(type)}</code></dt><dd>${count}</dd></div>`).join("")}</dl></section>
      </div>
      <p class="authority-note"><strong>Preview boundary:</strong> these SVGs are derived from Circuit JSON. They are not native PhiCad state and are not fabrication evidence.</p>
    </section>

    <aside class="findings-panel" aria-labelledby="findings-heading">
      <div class="section-heading"><div><p class="step-label">03 · findings</p><h2 id="findings-heading">What was reported?</h2></div><span>${summary.findings.tscircuit.length + summary.findings.kicad.length} details</span></div>
      ${renderFindings("tscircuit", summary.findings.tscircuit, manifest.diagnostics.tscircuit)}
      ${renderFindings("kicad", summary.findings.kicad, manifest.diagnostics.kicad)}
    </aside>

    <section class="evidence-panel" aria-labelledby="evidence-heading">
      <div class="section-heading"><div><p class="step-label">04 · evidence</p><h2 id="evidence-heading">Artifact bindings</h2></div><span>all hashes re-verified before render</span></div>
      <div class="table-wrap"><table><thead><tr><th>artifact</th><th>kind</th><th>SHA-256</th></tr></thead><tbody>${artifacts}</tbody></table></div>
      <dl class="paths"><div><dt>Manifest input</dt><dd><code>${escapeHtml(manifestPath)}</code></dd></div><div><dt>Circuit JSON input</dt><dd><code>${escapeHtml(circuitPath)}</code></dd></div></dl>
    </section>

    <section class="review-panel" aria-labelledby="review-heading">
      <div class="section-heading"><div><p class="step-label">05 · human intent</p><h2 id="review-heading">Record review intent</h2></div><span>${reviewNote}</span></div>
      <form id="review-form" data-target-options="${escapeHtml(optionTargets(summary))}">
        <fieldset ${reviewDisabled}><legend>Decision</legend><label><input type="radio" name="decision" value="approve" required> Approve review intent</label><label><input type="radio" name="decision" value="request-change"> Request change</label><label><input type="radio" name="decision" value="comment-only"> Comment only</label></fieldset>
        <div class="comments-heading"><h3>Per-target comments</h3><button id="add-comment" class="quiet-button" type="button" ${reviewDisabled}>Add comment</button></div>
        <div id="comments" class="comments"></div>
        <label for="reviewer-note">Reviewer note</label><textarea id="reviewer-note" name="reviewer_note" rows="4" maxlength="50000" ${reviewDisabled}></textarea>
        <div class="claim"><strong>Claim not made</strong><p>${escapeHtml(CLAIM_NOT_MADE)}</p></div>
        <button class="primary-button" type="submit" ${reviewDisabled}>Write review intent to the configured path</button>
        <p id="review-status" class="review-status" role="status" aria-live="polite"></p>
      </form>
    </section>
  </main>

  <footer class="tool-strip"><span><strong>Preview renderer</strong> <code>circuit-to-svg 0.0.423</code></span>${toolsFooter(manifest.tool_versions)}<span>No credentials · no telemetry · localhost only</span></footer>
  <template id="comment-template"><div class="comment-row"><label>Target<select class="comment-target-select">${optionTargets(summary)}</select></label><label>Comment<textarea class="comment-body" rows="2" maxlength="10000" required></textarea></label><button class="remove-comment quiet-button" type="button">Remove</button></div></template>
</body>
</html>`
}
