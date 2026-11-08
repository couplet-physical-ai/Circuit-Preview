# Circuit Preview

A thin, local, read-only browser preview for one Circuit JSON design: PCB and schematic renderings, parts, nets, hashes, checker statuses and findings, plus an optional human review-intent record.

![Status: experimental](https://img.shields.io/badge/status-experimental-orange) ![License: Apache--2.0](https://img.shields.io/badge/license-Apache--2.0-blue)

Created at [Exowatt](https://exowatt.com). Published under the vendor-neutral [couplet-physical-ai](https://github.com/couplet-physical-ai) organization.

## Status

Experimental. It works for the manifest formats documented below and is CI-tested on Node 22 and 24, but the manifest format follows [PhiCad-Platform](https://github.com/couplet-physical-ai/PhiCad-Platform) and may change. No support commitment.

Circuit Preview is **not CAD authority**. It never writes a design, invokes KiCad or PhiCad, applies a change, runs a checker, approves fabrication, asserts manufacturability, or creates a signed release. It holds no credentials and needs no external service.

## Quickstart

The repository ships a small golden fixture (a resistor and an LED) you can preview immediately:

```bash
npm ci
npm start -- --manifest test/fixtures/platform-v3/design.manifest.json \
  --circuit-json test/fixtures/platform-v3/circuit.json
```

Open the printed `http://127.0.0.1:<port>` URL.

## Trust boundary

Before opening a listening socket or rendering a view, the CLI:

1. requires a regular, non-symlink manifest file;
2. accepts manifest V2 (`studio_*` evidence), or V3 (`native_artifact_*` / `native_revision`
   evidence plus a declared `native_apply` object), each checked under its own vocabulary;
3. recomputes `manifest_hash` using the Platform's Python-compatible canonical
   JSON algorithm (sorted keys, compact separators, UTF-8, and the manifest
   payload with `manifest_hash` omitted);
4. hashes the source, selected Circuit JSON, optional Studio artifact, and every
   artifact record against the values bound by the manifest; and
5. checks the Circuit JSON size, root shape, 100,000-element limit, and explicit
   renderer element-type allowlist.

Any mismatch is printed as a fixed refusal containing a code, reason, and exact
expected/actual values; the process exits non-zero without serving a page.
Passing `--circuit-json` selects alternate local bytes, but those bytes must
still match the manifest's `circuit_json_hash`.

The server binds only `127.0.0.1`, selects an ephemeral port by default, and
serves one verified manifest per process. It has no analytics, telemetry,
runtime network fetch, CDN asset, service worker, cookie, or authentication
surface. Browser assets and SVGs are local and protected by restrictive Content
Security Policy headers.

## Install and run

Node.js 22 or newer is required.

```bash
npm ci
npm start -- --manifest /path/to/design.manifest.json \
  --circuit-json /path/to/circuit.json \
  --review-out /existing/directory/review-intent.json \
  --port 0
```

To install the requested command name from this checkout:

```bash
npm link
circuit-preview --manifest /path/to/design.manifest.json \
  --review-out /existing/directory/review-intent.json
```

CLI contract:

```text
circuit-preview --manifest <path> [--circuit-json <path>] [--review-out <path>] [--port 0]
```

`--port 0` is the default. The CLI prints the selected localhost URL and exact
manifest-file and Circuit JSON SHA-256 values. It does not open a browser.

`--review-out` is optional. Without it, review controls are visibly unavailable.
When supplied, its parent directory must already exist. A successful submission
writes only that exact caller-supplied file; no parent directory, temporary
file, preference file, design file, or other persistent state is created.

## What the browser shows

The reading order is:

1. project identity, manifest/Circuit hashes, Studio revision, and approval state;
2. literal per-origin run statuses for exactly `tscircuit` and `kicad`;
3. PCB, schematic, parts/net, and element-inventory views;
4. findings grouped by origin and severity;
5. exact artifact bindings and persistent tool versions; and
6. the optional review-intent form.

Run status and finding count are separate facts. In particular, `not-run` with
zero findings remains dashed and says that no checker ran; it never renders as a
pass. `carried-input` says that the findings arrived with the input.
`unavailable` displays the manifest-supplied reason, or explicitly says when the
manifest supplied none.

Hashes use a 12-character visual abbreviation with the exact value available in
the DOM, on hover, and through the adjacent copy control. Light/dark theme
selection lasts only for the page lifetime: the no-persistence contract
intentionally overrides local preference storage.

The SVG views are produced server-side from the verified Circuit JSON and served
as sandboxed image resources. Keyboard users can select views, zoom with the
buttons, and pan a focused canvas with arrow keys.

## Review-intent output

The form accepts `approve`, `request-change`, or `comment-only`, comments targeted
at a component reference, `net:<name>`, `finding:<id>`, or `board`, and an
optional reviewer note. The server timestamps and writes this exact schema:

```json
{
  "schema": "io.github.couplet-physical-ai.circuit-preview.review-intent/v1",
  "manifest_path": "/absolute/path/to/design.manifest.json",
  "manifest_sha256": "<sha256 of exact manifest file bytes>",
  "decision": "approve",
  "comments": [{ "target": "R1", "body": "Confirm value." }],
  "reviewer_note": "Human note.",
  "created_at": "2026-09-15T12:34:56.000Z",
  "claims_not_made": [
    "This is review intent only; it applies nothing and approves no fabrication."
  ]
}
```

The word `approve` is review intent only. It is not native approval, fabrication
approval, a manufacturability verdict, or a design write.

## Exact dependency pins

All direct dependencies use exact versions (no `^` or `~`), and
`package-lock.json` is committed:

| Package | Version | Role |
|---|---:|---|
| `circuit-to-svg` | `0.0.423` | PCB and schematic SVG conversion |
| `@tscircuit/alphabet` | `0.0.27` | schematic symbol font data required by the renderer |
| `@tscircuit/circuit-json-util` | `0.0.113` | renderer Circuit JSON selectors |
| `circuit-json` | `0.0.491` | renderer Circuit JSON runtime types |
| `circuit-json-to-connectivity-map` | `0.0.30` | renderer connectivity mapping |
| `schematic-symbols` | `0.0.245` | renderer schematic symbol definitions |

The five packages below `circuit-to-svg` are minimal direct runtime imports of
its published ESM bundle; some are not declared by that package, so omitting any
one makes a clean install fail to load. The installed packages are permissively licensed
(MIT, ISC, or Apache-2.0). No CSS, component, token, or source code was copied from
PhiCad Studio or OpenPCB.

`npm ci` requires the npm registry once to install the committed lock. Product
runtime performs no network fetch.

## Tests

```bash
npm test
```

The suite uses Node's built-in runner. GitHub Actions
(`.github/workflows/ci.yml`) runs it on Node 22 and 24 for every push to `main` and every
pull request. It covers:

- Python-compatible canonical self-hashing and valid manifest/evidence hashes;
- self-hash and artifact-hash failures;
- V3 `native_apply` tolerance;
- specific missing-Circuit-JSON, unknown-element, and element-limit refusals;
- accessible PCB/schematic output and parts/net/finding separation;
- exact review-intent shape and the required negative claim;
- all six run-status treatments and the zero-findings/not-run rule;
- CLI non-zero refusal with exact expected/actual hashes; and
- an integration assertion that serving and submitting writes nothing except
  the caller-supplied review output path.

## Deliberate limitations

- Circuit Preview does not run tscircuit checks, PhiCad Verify, KiCad, or any AI.
- It does not understand or apply V3 `native_apply`; the block is self-hash-bound,
  tolerated as declared metadata, and shown only as a status declaration.
- Unknown or unexercised Circuit JSON geometry fails closed instead of being
  approximated or silently dropped. This intentionally limits compatibility
  with future element types until renderer support is reviewed.
- Detailed KiCad findings are read only from a hash-bound `kicad-drc` JSON
  artifact. If details are unavailable, manifest counts remain separate facts.
- Evidence inputs are regular files only. Directory artifacts and symlinks are
  refused under the execution boundary.
- There is no shared-server or remote-access mode, auth, multi-manifest process,
  collaboration, saved UI preference, or review history.
- Localhost is the security boundary. Another process running as the same local
  user can reach the server; no token is placed in a URL and no cookie is used.
- The preview is visual evidence derived from Circuit JSON, not proof of copper,
  stackup, fabrication output, electrical correctness, or native persistence.

## Prerequisites

Node.js 22 or newer. No proprietary SDKs. KiCad is not required: KiCad DRC findings are read from a JSON artifact that a separate tool produced.

## Configuration

Everything is set on the command line (see the CLI contract above). There are no config files, environment variables, accounts or network services.

## License

Licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE). Runtime dependencies are permissively licensed (MIT, ISC, Apache-2.0) and are installed from npm, not vendored. KiCad, tscircuit and OpenPCB are named only as the upstream tools whose formats this preview reads; no code is copied from them.

## Contributing

See [CONTRIBUTING](https://github.com/couplet-physical-ai/.github/blob/main/CONTRIBUTING.md). Contributions require DCO sign-off (`git commit -s`); no CLA is required. Run `npm test` before opening a pull request.

## Security

Please report vulnerabilities privately using [GitHub private vulnerability reporting](https://github.com/couplet-physical-ai/Circuit-Preview/security/advisories/new), or contact software@exowatt.com. See the [security policy](https://github.com/couplet-physical-ai/.github/blob/main/SECURITY.md); do not open a public issue.
