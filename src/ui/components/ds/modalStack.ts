/** Open modals, bottom → top. Only the topmost one reacts to Escape and backdrop clicks. */
const stack: symbol[] = []
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of [...listeners]) l()
}

export function pushModal(id: symbol): () => void {
  stack.push(id)
  notify()
  return () => {
    const i = stack.lastIndexOf(id)
    if (i !== -1) {
      stack.splice(i, 1)
      notify()
    }
  }
}

export function isTopModal(id: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id
}

export function modalDepth(): number {
  return stack.length
}

/** Re-render on modals opening/closing (useSyncExternalStore with modalDepth) — e.g. toasts step behind sheets. */
export function subscribeModals(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
