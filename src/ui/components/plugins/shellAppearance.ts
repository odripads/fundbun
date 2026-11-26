/**
 * The shell's look in this browser: theme, what Bun wears, the app name and the ergonomics (Desktop Creator Mode).
 *
 * One small store, kept in localStorage so a reload keeps the look, and read back through the same validator a
 * patch goes through (storage is untrusted). Applying a look only touches these things on <html>: the
 * `data-theme` and `data-shell-*` attributes, the allow-listed colour variables, the typeface, corner and spacing
 * tokens that already exist in tokens.css (so the whole app follows through the cascade), the root font size,
 * and `document.title`. Reset removes every one of them. Nothing here reads or writes the finance state.
 */
import { useLayoutEffect, useSyncExternalStore } from 'react'
import {
  DEFAULT_APP_NAME,
  DEFAULT_SHELL_APPEARANCE,
  SHELL_ERGONOMIC_VARS,
  SHELL_THEMES,
  SHELL_TOKEN_NAMES,
  applyShellAppearancePatch,
  isDefaultShellAppearance,
  legibilityIssues,
  resolvedShellTokens,
  resolvedShellVariables,
  sameShellAppearance,
  sanitizeShellAppearance,
  shellRootFontSize,
  validateShellAppearancePatch,
  type ShellAppearance,
  type ShellAppearancePatch,
} from '../../../core/plugins/appearance'

export const SHELL_APPEARANCE_KEY = 'fundbun.shell-appearance.v1'

let current: ShellAppearance = DEFAULT_SHELL_APPEARANCE
let loaded = false
const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // storage can be switched off (private mode, a locked-down webview): the look then lasts for this visit only
    return null
  }
}

function load(): ShellAppearance {
  const raw = storage()?.getItem(SHELL_APPEARANCE_KEY)
  if (!raw) return DEFAULT_SHELL_APPEARANCE
  try {
    return sanitizeShellAppearance(JSON.parse(raw))
  } catch {
    // not JSON any more: fall back to FundBun's own look
    return DEFAULT_SHELL_APPEARANCE
  }
}

function persist(next: ShellAppearance): void {
  const store = storage()
  if (!store) return
  try {
    if (isDefaultShellAppearance(next)) store.removeItem(SHELL_APPEARANCE_KEY)
    else store.setItem(SHELL_APPEARANCE_KEY, JSON.stringify(next))
  } catch {
    // storage is full or refused: the look still applies for this visit
  }
}

function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  current = load()
}

/** The look right now (read from storage on first use). */
export function getShellAppearance(): ShellAppearance {
  ensureLoaded()
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const serverSnapshot = (): ShellAppearance => DEFAULT_SHELL_APPEARANCE

/** The look, for React: Bun's headwear, the wordmark and the settings list all read it from here. */
export function useShellAppearance(): ShellAppearance {
  return useSyncExternalStore(subscribe, getShellAppearance, serverSnapshot)
}

/**
 * Writes a look onto the page. FundBun's own look removes everything this function ever set, so Reset leaves no
 * trace: no attribute, no inline variable, the original title.
 */
export function applyShellAppearanceToDocument(look: ShellAppearance, doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (!doc) return
  const root = doc.documentElement
  const preset = SHELL_THEMES[look.theme]
  const themed = look.theme !== 'system'
  if (themed) {
    if (preset.base === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', preset.base)
    root.setAttribute('data-shell-theme', look.theme)
  } else if (root.hasAttribute('data-shell-theme')) {
    root.removeAttribute('data-theme')
    root.removeAttribute('data-shell-theme')
  }
  const tokens = resolvedShellTokens(look)
  for (const name of SHELL_TOKEN_NAMES) {
    const value = tokens[name]
    if (value) root.style.setProperty(name, value)
    else root.style.removeProperty(name)
  }
  setOrRemove(root, 'data-shell-hat', look.mascotSvg ? 'custom' : look.mascotHat === 'none' ? null : look.mascotHat)

  // ergonomics: existing design tokens are overridden on the root, so every screen follows without its own rule
  const vars = resolvedShellVariables(look)
  for (const name of SHELL_ERGONOMIC_VARS) {
    const value = vars[name]
    if (value) root.style.setProperty(name, value)
    else root.style.removeProperty(name)
  }
  setOrRemove(root, 'data-shell-font', look.fontStyle && look.fontStyle !== 'default' ? look.fontStyle : null)
  setOrRemove(root, 'data-shell-radius', look.radius && look.radius !== 'default' ? look.radius : null)
  setOrRemove(root, 'data-shell-density', look.density && look.density !== 'default' ? look.density : null)
  // text size: every type size in the app is in rem, so the root font size scales them all together
  const rootSize = shellRootFontSize(look)
  if (rootSize) {
    root.style.setProperty('font-size', rootSize)
    root.setAttribute('data-shell-scale', look.fontScale ?? 'default')
  } else if (root.hasAttribute('data-shell-scale')) {
    root.style.removeProperty('font-size')
    root.removeAttribute('data-shell-scale')
  }

  if (look.appName) {
    doc.title = shellDocumentTitle(look)
    root.setAttribute('data-shell-name', '')
  } else if (root.hasAttribute('data-shell-name')) {
    doc.title = DEFAULT_APP_NAME
    root.removeAttribute('data-shell-name')
  }
}

function setOrRemove(el: Element, name: string, value: string | null): void {
  if (value === null) el.removeAttribute(name)
  else el.setAttribute(name, value)
}

/** The window title for a look: the chosen name, with FundBun still named after it. */
export function shellDocumentTitle(look: ShellAppearance): string {
  return look.appName ? `${look.appName} · ${DEFAULT_APP_NAME}` : DEFAULT_APP_NAME
}

function commit(next: ShellAppearance): void {
  ensureLoaded()
  if (sameShellAppearance(current, next)) return
  current = next
  persist(next)
  applyShellAppearanceToDocument(next)
  listeners.forEach((l) => l())
}

export type ShellApplyResult = { ok: true; previous: ShellAppearance; next: ShellAppearance } | { ok: false; issues: string[] }

/**
 * Applies a patch the user approved (the Apply button). The patch is validated again here, so a card restored
 * from an old chat cannot carry anything the spec does not allow. Returns the look before it, for Undo.
 */
export function applyShellAppearancePatchNow(patch: ShellAppearancePatch): ShellApplyResult {
  const checked = validateShellAppearancePatch(patch)
  if (!checked.ok) return { ok: false, issues: checked.issues }
  const previous = getShellAppearance()
  const next = applyShellAppearancePatch(previous, checked.patch)
  // the patch was checked on its own: colours laid over the theme that is on right now must stay readable too
  const unreadable = legibilityIssues(next.theme, next.tokens)
  if (unreadable.length) return { ok: false, issues: unreadable }
  commit(next)
  return { ok: true, previous, next }
}

/** Puts a look back (Undo): the value is sanitized like anything read from storage. */
export function restoreShellAppearance(look: ShellAppearance): void {
  commit(sanitizeShellAppearance(look))
}

/** Back to FundBun's own look, at once. */
export function resetShellAppearance(): void {
  commit(DEFAULT_SHELL_APPEARANCE)
}

/** What the page would look like after a patch, without applying it (the chat card's preview). */
export function previewShellAppearance(patch: ShellAppearancePatch): ShellAppearance {
  return applyShellAppearancePatch(getShellAppearance(), patch)
}

/**
 * Mount once at the top of the app: puts the stored look on the page before the first paint, and keeps two
 * windows of the same app in step when one of them changes it.
 */
export function useShellAppearanceOnDocument(): void {
  const look = useShellAppearance()
  useLayoutEffect(() => {
    applyShellAppearanceToDocument(look)
  }, [look])
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== SHELL_APPEARANCE_KEY) return
      const next = load()
      if (sameShellAppearance(current, next)) return
      current = next
      applyShellAppearanceToDocument(next)
      listeners.forEach((l) => l())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
}

/** Tests only: forget the look and what was read from storage. */
export function resetShellAppearanceStore(): void {
  current = DEFAULT_SHELL_APPEARANCE
  loaded = false
  applyShellAppearanceToDocument(DEFAULT_SHELL_APPEARANCE)
  listeners.forEach((l) => l())
}
