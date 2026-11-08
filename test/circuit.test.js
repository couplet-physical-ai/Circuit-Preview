import assert from "node:assert/strict"
import test from "node:test"
import { MAX_CIRCUIT_ELEMENTS, parseCircuitJson, renderCircuitSvgs, summarizeCircuit } from "../src/circuit.js"

test("unsupported Circuit JSON element types are named and refused", () => {
  const bytes = Buffer.from('[{"type":"future_flux_capacitor"}]')
  assert.throws(() => parseCircuitJson(bytes), (error) => {
    assert.equal(error.code, "circuit_json.unsupported_element_types")
    assert.match(error.message, /future_flux_capacitor/)
    return true
  })
})

test("Circuit JSON above 100000 elements is specifically refused", () => {
  const elements = Array.from({ length: MAX_CIRCUIT_ELEMENTS + 1 }, () => ({ type: "source_group" }))
  assert.throws(() => parseCircuitJson(Buffer.from(JSON.stringify(elements))), (error) => {
    assert.equal(error.code, "circuit_json.element_limit")
    assert.equal(error.details.elements, 100001)
    assert.equal(error.details.limit, 100000)
    return true
  })
})

test("PCB and schematic renderings carry accessible authority boundaries", () => {
  const svgs = renderCircuitSvgs([])
  for (const [view, svg] of Object.entries(svgs)) {
    assert.match(svg, /<svg role="img"/)
    assert.match(svg, /<title id=/)
    assert.match(svg, /<desc id=/)
    assert.match(svg, /no native CAD authority/)
    assert.ok(svg.length > 1000, `${view} SVG should contain renderer output`)
  }
})

test("parts, nets, and tscircuit findings remain distinct summary facts", () => {
  const summary = summarizeCircuit([
    { type: "source_component", source_component_id: "source_component_1", name: "R1", ftype: "simple_resistor", display_resistance: "1kΩ" },
    { type: "source_net", source_net_id: "source_net_1", name: "GND", connected_source_port_ids: ["source_port_1"] },
    { type: "source_pin_missing_trace_warning", source_pin_missing_trace_warning_id: "warning_1", message: "Pin is open" },
  ])
  assert.deepEqual(summary.components.map((part) => part.ref), ["R1"])
  assert.deepEqual(summary.connections.map((net) => net.name), ["GND"])
  assert.equal(summary.findings.tscircuit.length, 1)
  assert.equal(summary.findings.tscircuit[0].severity, "warning")
})
