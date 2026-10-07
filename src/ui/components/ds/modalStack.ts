/** Open modals, bottom → top. Only the topmost one reacts to Escape and backdrop clicks. */
const stack: symbol[] = []

export function pushModal(id: symbol): () => void {
  stack.push(id)
  return () => {
    const i = stack.lastIndexOf(id)
    if (i !== -1) stack.splice(i, 1)
  }
}

export function isTopModal(id: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id
}

export function modalDepth(): number {
  return stack.length
}
