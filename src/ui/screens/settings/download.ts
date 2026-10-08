/** Hand the viewer a file (data export, audit log). Everything stays on the device: the file is built locally. */

/** "fundbun-data-2026-10-22.json" style names, from a timestamp. */
export function exportFileName(kind: string, ext: string, now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
  return `fundbun-${kind}-${stamp}.${ext}`
}

/** Pretty-print a JSON string for humans; returns the input unchanged if it isn't JSON. */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** Trigger a browser download of `text`. Returns false where downloads aren't possible (tests, old engines). */
export function downloadText(fileName: string, text: string, mime = 'application/json'): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

/** Size label for a payload ("12.4 KB"). */
export function byteSize(text: string): string {
  const bytes = new TextEncoder().encode(text).length
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
