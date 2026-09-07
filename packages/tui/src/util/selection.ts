import type { ClipboardService } from "../context/clipboard"

type Toast = {
  show: (input: { message: string; variant: "info" | "success" | "warning" | "error" }) => void
  error: (err: unknown) => void
}

type FocusableSelectionTarget = {
  hasSelection: () => boolean
  getClipboardText?: (text: string) => string
}

type Renderer = {
  getSelection: () => { getSelectedText: () => string; selectedRenderables: FocusableSelectionTarget[] } | null
  clearSelection: () => void
  currentFocusedRenderable?: FocusableSelectionTarget | null
}

type SelectionKeyEvent = {
  ctrl?: boolean
  name: string
  preventDefault: () => void
  stopPropagation: () => void
}

export function copy(renderer: Renderer, toast: Toast, clipboard: ClipboardService): boolean {
  const selection = renderer.getSelection()
  if (!selection) return false

  const text = selection.getSelectedText()
  if (!text) return false

  const focus = renderer.currentFocusedRenderable
  const clipboardText =
    focus?.getClipboardText && selection.selectedRenderables.includes(focus) ? focus.getClipboardText(text) : text

  clipboard
    ?.write?.(clipboardText)
    .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
    .catch(toast.error)

  renderer.clearSelection()
  return true
}

let rightClickCopyAt = 0

const RIGHT_CLICK_PASTE_SUPPRESSION_MS = 300

export function markRightClickCopy() {
  rightClickCopyAt = Date.now()
}

// Windows Terminal fires its own bracketed paste on right-click even when our
// mousedown handler already intercepted the button and copied the selection.
// Swallow the collateral paste that arrives right after the copy so the stale
// buffer never lands in the prompt.
export function consumeRightClickPaste(): boolean {
  const suppress = Date.now() - rightClickCopyAt <= RIGHT_CLICK_PASTE_SUPPRESSION_MS
  rightClickCopyAt = 0
  return suppress
}

export function handleSelectionKey(
  renderer: Renderer,
  toast: Toast,
  event: SelectionKeyEvent,
  clipboard: ClipboardService,
) {
  const selection = renderer.getSelection()
  if (!selection) return

  if (event.ctrl && event.name === "c") {
    if (!copy(renderer, toast, clipboard)) {
      renderer.clearSelection()
      return
    }

    event.preventDefault()
    event.stopPropagation()
    return
  }

  if (event.name === "escape") {
    renderer.clearSelection()
    event.preventDefault()
    event.stopPropagation()
    return
  }

  const focus = renderer.currentFocusedRenderable
  if (focus?.hasSelection() && selection.selectedRenderables.includes(focus)) return

  renderer.clearSelection()
}

export * as Selection from "./selection"
