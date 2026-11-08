const root = document.documentElement
const themeButton = document.querySelector("#theme-toggle")
themeButton?.addEventListener("click", () => {
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches
  const currentDark = root.dataset.theme ? root.dataset.theme === "dark" : systemDark
  root.dataset.theme = currentDark ? "light" : "dark"
})

const tabs = [...document.querySelectorAll('[role="tab"]')]
function selectTab(tab) {
  for (const candidate of tabs) {
    const selected = candidate === tab
    candidate.setAttribute("aria-selected", String(selected))
    candidate.tabIndex = selected ? 0 : -1
    document.querySelector(`#${candidate.getAttribute("aria-controls")}`).hidden = !selected
  }
  tab.focus()
}
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener("click", () => selectTab(tab))
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    const next = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
    selectTab(tabs[next])
  })
}

let zoom = 1
const zoomOutput = document.querySelector("#zoom-output")
function setZoom(value) {
  zoom = Math.max(0.5, Math.min(3, value))
  for (const image of document.querySelectorAll(".canvas img")) image.style.setProperty("--zoom", String(zoom))
  zoomOutput.value = `${Math.round(zoom * 100)}%`
  zoomOutput.textContent = `${Math.round(zoom * 100)}%`
}
for (const button of document.querySelectorAll("[data-zoom]")) {
  button.addEventListener("click", () => {
    const operation = button.dataset.zoom
    setZoom(operation === "in" ? zoom + 0.25 : operation === "out" ? zoom - 0.25 : 1)
  })
}
for (const canvas of document.querySelectorAll(".canvas")) {
  canvas.addEventListener("keydown", (event) => {
    const delta = event.shiftKey ? 120 : 40
    if (event.key === "ArrowLeft") canvas.scrollBy({ left: -delta })
    else if (event.key === "ArrowRight") canvas.scrollBy({ left: delta })
    else if (event.key === "ArrowUp") canvas.scrollBy({ top: -delta })
    else if (event.key === "ArrowDown") canvas.scrollBy({ top: delta })
    else return
    event.preventDefault()
  })
}

const reviewForm = document.querySelector("#review-form")
const comments = document.querySelector("#comments")
const template = document.querySelector("#comment-template")
const reviewStatus = document.querySelector("#review-status")
function addComment(target = "board") {
  const fragment = template.content.cloneNode(true)
  const row = fragment.querySelector(".comment-row")
  row.querySelector("select").value = target
  row.querySelector(".remove-comment").addEventListener("click", () => row.remove())
  comments.append(fragment)
  row.querySelector("textarea").focus()
}
document.querySelector("#add-comment")?.addEventListener("click", () => addComment())
for (const button of document.querySelectorAll("[data-comment-target]")) {
  button.addEventListener("click", () => {
    if (document.querySelector("#add-comment").disabled) return
    addComment(button.dataset.commentTarget)
    document.querySelector("#review-heading").scrollIntoView({ behavior: "smooth", block: "start" })
  })
}

for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy)
      button.textContent = "copied"
      window.setTimeout(() => { button.textContent = "copy" }, 900)
    } catch {
      button.textContent = "unavailable"
    }
  })
}

reviewForm?.addEventListener("submit", async (event) => {
  event.preventDefault()
  reviewStatus.textContent = "Writing review intent to the configured path…"
  reviewStatus.dataset.state = "working"
  const decision = new FormData(reviewForm).get("decision")
  const payload = {
    decision,
    comments: [...comments.querySelectorAll(".comment-row")].map((row) => ({
      target: row.querySelector("select").value,
      body: row.querySelector("textarea").value,
    })),
    reviewer_note: document.querySelector("#reviewer-note").value,
  }
  try {
    const response = await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.reason || "Review intent was refused")
    reviewStatus.dataset.state = "saved"
    reviewStatus.textContent = `Review intent written at ${result.intent.created_at}. It applies nothing.`
  } catch (error) {
    reviewStatus.dataset.state = "error"
    reviewStatus.textContent = `Review intent was not written: ${error.message}`
  }
})
