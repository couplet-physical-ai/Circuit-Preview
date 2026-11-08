import { createHash } from "node:crypto"
import {
  convertCircuitJsonToPcbSvg,
  convertCircuitJsonToSchematicSvg,
} from "circuit-to-svg"
import { PreviewError } from "./errors.js"

export const MAX_CIRCUIT_ELEMENTS = 100_000

// Types explicitly exercised by the pinned renderer, plus non-visual identity
// records needed to interpret those views. Future geometry fails closed.
const RENDERER_TYPES = new Set(`
pcb_board
pcb_component
pcb_component_outside_board_error
pcb_connector_not_in_accessible_orientation_warning
pcb_copper_pour
pcb_copper_text
pcb_courtyard_circle
pcb_courtyard_outline
pcb_courtyard_overlap_error
pcb_courtyard_polygon
pcb_courtyard_rect
pcb_cutout
pcb_debug_object
pcb_fabrication_note_dimension
pcb_fabrication_note_path
pcb_fabrication_note_rect
pcb_fabrication_note_text
pcb_footprint_overlap_error
pcb_group
pcb_hole
pcb_keepout
pcb_manual_edit_conflict_warning
pcb_note_dimension
pcb_note_line
pcb_note_path
pcb_note_rect
pcb_note_text
pcb_pad_trace_clearance_error
pcb_panel
pcb_plated_hole
pcb_port
pcb_silkscreen_circle
pcb_silkscreen_graphic
pcb_silkscreen_line
pcb_silkscreen_oval
pcb_silkscreen_path
pcb_silkscreen_pill
pcb_silkscreen_rect
pcb_silkscreen_text
pcb_smtpad
pcb_solder_paste
pcb_trace
pcb_trace_error
pcb_via
pcb_via_trace_clearance_error
schematic_arc
schematic_box
schematic_circle
schematic_component
schematic_component_overlap_warning
schematic_component_styling_warning
schematic_debug_object
schematic_element_outside_sheet_warning
schematic_graphic
schematic_group
schematic_line
schematic_manual_edit_conflict_warning
schematic_net_label
schematic_path
schematic_port
schematic_rect
schematic_sheet
schematic_table
schematic_table_cell
schematic_text
schematic_trace
schematic_voltage_probe
simulation_ac_sweep_current_graph
simulation_ac_sweep_voltage_graph
simulation_current_probe
simulation_dc_operating_point_current
simulation_dc_operating_point_voltage
simulation_dc_sweep_current_graph
simulation_dc_sweep_voltage_graph
simulation_experiment
simulation_oscilloscope_trace
simulation_transient_current_graph
simulation_transient_voltage_graph
simulation_voltage_probe
source_board
source_component
source_component_internal_connection
source_group
source_manually_placed_via
source_net
source_pcb_ground_plane
source_port
source_project_metadata
source_trace
cad_component
`.trim().split("\n"))

function isFindingType(type) {
  return type.endsWith("_warning") || type.endsWith("_error") || type === "unknown_error_finding_part"
}

export function parseCircuitJson(bytes) {
  let elements
  try {
    elements = JSON.parse(bytes.toString("utf8"))
  } catch (error) {
    throw new PreviewError("circuit_json.invalid_json", `Circuit JSON cannot be parsed: ${error.message}`)
  }
  if (!Array.isArray(elements)) {
    throw new PreviewError("circuit_json.invalid_root", "Circuit JSON root must be an array of elements")
  }
  if (elements.length > MAX_CIRCUIT_ELEMENTS) {
    throw new PreviewError(
      "circuit_json.element_limit",
      `Circuit JSON has ${elements.length} elements; the limit is ${MAX_CIRCUIT_ELEMENTS}`,
      { elements: elements.length, limit: MAX_CIRCUIT_ELEMENTS },
    )
  }
  const unsupported = new Set()
  for (const [index, element] of elements.entries()) {
    if (!element || typeof element !== "object" || Array.isArray(element) || typeof element.type !== "string") {
      unsupported.add(`<missing type at index ${index}>`)
      continue
    }
    if (!RENDERER_TYPES.has(element.type) && !isFindingType(element.type)) unsupported.add(element.type)
  }
  if (unsupported.size > 0) {
    const types = [...unsupported].sort()
    throw new PreviewError(
      "circuit_json.unsupported_element_types",
      `Unsupported Circuit JSON element type${types.length === 1 ? "" : "s"}: ${types.join(", ")}`,
      { types: types.join(", ") },
    )
  }
  return elements
}

function idField(element) {
  const candidate = Object.entries(element).find(([key, value]) => key.endsWith("_id") && typeof value === "string")
  return candidate?.[1] || null
}

function stableFindingId(origin, value, index) {
  return createHash("sha256").update(`${origin}\0${index}\0${JSON.stringify(value)}`).digest("hex").slice(0, 12)
}

export function extractTscircuitFindings(elements) {
  return elements
    .filter((element) => isFindingType(element.type))
    .map((element, index) => ({
      id: idField(element) || stableFindingId("tscircuit", element, index),
      origin: "tscircuit",
      severity: element.type.endsWith("_warning") ? "warning" : "error",
      code: `tsc.${element.warning_type || element.error_type || element.type}`,
      message: typeof element.message === "string" ? element.message : "Finding has no message.",
      refs: Object.entries(element)
        .filter(([key, value]) => key.endsWith("_id") && typeof value === "string")
        .map(([, value]) => value),
    }))
}

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 }

function rankFindings(findings) {
  return findings.sort((left, right) =>
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] || left.code.localeCompare(right.code),
  )
}

function parseDrc(bytes) {
  if (!bytes) return []
  let drc
  try {
    drc = JSON.parse(bytes.toString("utf8"))
  } catch {
    return [{
      id: "drc-artifact-invalid-json",
      origin: "kicad",
      severity: "info",
      code: "drc.invalid_artifact_json",
      message: "The hash-verified KiCad DRC artifact is not valid JSON; finding details cannot be listed.",
      refs: [],
    }]
  }
  const groups = [
    ...(Array.isArray(drc.violations) ? drc.violations : []),
    ...(Array.isArray(drc.unconnected_items) ? drc.unconnected_items : []),
    ...(Array.isArray(drc.schematic_parity) ? drc.schematic_parity : []),
  ]
  return rankFindings(groups.map((finding, index) => ({
    id: stableFindingId("kicad", finding, index),
    origin: "kicad",
    severity: ["error", "warning", "info"].includes(finding.severity) ? finding.severity : "info",
    code: `drc.${finding.type || "finding"}`,
    message: typeof finding.description === "string" ? finding.description : "Finding has no description.",
    refs: Array.isArray(finding.items)
      ? finding.items.map((item) => item?.description).filter((value) => typeof value === "string")
      : [],
  })))
}

export function summarizeCircuit(elements, drcBytes = null) {
  const components = elements
    .filter((element) => element.type === "source_component")
    .map((component) => ({
      ref: component.name || component.source_component_id || "unnamed",
      kind: component.ftype || "component",
      value: component.display_resistance || component.symbol_display_value || component.part_number || "—",
      sourceId: component.source_component_id || "—",
    }))
  const connections = elements
    .filter((element) => element.type === "source_net" || element.type === "source_trace")
    .map((net) => ({
      name: net.name || net.display_name || net.source_net_id || net.source_trace_id || "unnamed",
      kind: net.type === "source_net" ? "net" : "trace",
      id: net.source_net_id || net.source_trace_id || "—",
      connections: [
        ...(Array.isArray(net.connected_source_port_ids) ? net.connected_source_port_ids : []),
        ...(Array.isArray(net.connected_source_net_ids) ? net.connected_source_net_ids : []),
      ],
    }))
  const typeCounts = {}
  for (const element of elements) typeCounts[element.type] = (typeCounts[element.type] || 0) + 1
  return {
    elementCount: elements.length,
    components,
    connections,
    typeCounts,
    findings: {
      tscircuit: rankFindings(extractTscircuitFindings(elements)),
      kicad: parseDrc(drcBytes),
    },
  }
}

function annotateSvg(svg, title, description) {
  if (typeof svg !== "string" || !svg.trimStart().startsWith("<svg")) {
    throw new PreviewError("circuit_json.render_failed", `${title} renderer did not return SVG`)
  }
  const titleId = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-title`
  const descId = `${titleId}-description`
  const escapedTitle = title.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  const escapedDescription = description.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  return svg.replace(
    /<svg\b/,
    `<svg role="img" aria-labelledby="${titleId} ${descId}" focusable="false"`,
  ).replace(/(<svg\b[^>]*>)/, `$1<title id="${titleId}">${escapedTitle}</title><desc id="${descId}">${escapedDescription}</desc>`)
}

export function renderCircuitSvgs(elements) {
  try {
    return {
      pcb: annotateSvg(
        convertCircuitJsonToPcbSvg(elements, {
          includeVersion: false,
          matchBoardAspectRatio: true,
          backgroundColor: "#161922",
          showPinNumbers: true,
          shouldDrawErrors: true,
          shouldDrawWarnings: true,
        }),
        "PCB preview",
        "Circuit JSON board geometry, components, pads, traces, and supported finding overlays; this preview has no native CAD authority.",
      ),
      schematic: annotateSvg(
        convertCircuitJsonToSchematicSvg(elements, { includeVersion: false, grid: true }),
        "Schematic preview",
        "Circuit JSON schematic components, ports, and traces; this preview has no native CAD authority.",
      ),
    }
  } catch (error) {
    if (error instanceof PreviewError) throw error
    throw new PreviewError("circuit_json.render_failed", `Pinned circuit-to-svg renderer refused the Circuit JSON: ${error.message}`)
  }
}
