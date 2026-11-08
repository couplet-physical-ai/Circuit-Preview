# Golden PhiCad Platform V3 manifest

`design.manifest.json` was written by PhiCad Platform's own Python `create_manifest()`
([`couplet-physical-ai/PhiCad-Platform`](https://github.com/couplet-physical-ai/PhiCad-Platform)), not by this
repository's hash code, so the test that verifies it checks Preview's JavaScript
canonicalization against the real producer. The bound files are a tscircuit `blinky.tsx`
(`source.tsx`), its `circuit.json`, the native board PhiCad Verify exported from it
(`board.kicad_pcb`), and that board's KiCad DRC report. All of it is a synthetic
two-part example (a resistor and an LED). Regenerate only together with a Platform
manifest-format change, and record the producing commit.
