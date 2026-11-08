export class PreviewError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = "PreviewError"
    this.code = code
    this.details = details
  }
}

export function refusalText(error) {
  const code = error instanceof PreviewError ? error.code : "preview.internal_error"
  const lines = [
    "Circuit Preview refused to render.",
    `Code: ${code}`,
    `Reason: ${error.message || String(error)}`,
  ]
  if (error instanceof PreviewError) {
    for (const [name, value] of Object.entries(error.details)) {
      lines.push(`${name}: ${String(value)}`)
    }
  }
  return `${lines.join("\n")}\n`
}
