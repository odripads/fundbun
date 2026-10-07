/** Arrow-key navigation for radio groups and tab lists (WAI-ARIA roving tabindex). */
export function rovingIndex(current: number, key: string, count: number, disabled: (i: number) => boolean = () => false): number | null {
  if (count <= 0) return null
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0
  if (key === 'Home' || key === 'End') {
    const order = Array.from({ length: count }, (_, i) => (key === 'Home' ? i : count - 1 - i))
    return order.find((i) => !disabled(i)) ?? null
  }
  if (step === 0) return null
  for (let n = 1; n <= count; n++) {
    const i = (((current + step * n) % count) + count) % count
    if (!disabled(i)) return i
  }
  return null
}
