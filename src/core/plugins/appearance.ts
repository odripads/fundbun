/**
 * Shell Appearance Plugins (Desktop Creator Mode): bounded, reversible changes to the app shell.
 *
 * Three things can change, and nothing else:
 *   1. the theme (a preset, or hex overrides of an allow-list of colour tokens),
 *   2. what Bun wears on its head,
 *   3. the name on the wordmark and the window title (at most 28 printable characters).
 *
 * Everything here is pure data and pure functions: the spec, its validator, the patch arithmetic and a
 * deterministic reader for chat prompts ("change the theme to midnight"). No DOM, no storage, no model.
 * A patch is only ever proposed: the user presses Apply on the chat card, and can undo or reset at once.
 */
import type { MascotHat, ShellAppearance, ShellAppearancePatch, ShellThemeId, ShellTokenName, ShellTokenOverrides } from '../types'

export type { MascotHat, PluginAppearanceCard, ShellAppearance, ShellAppearancePatch, ShellThemeId, ShellTokenName, ShellTokenOverrides } from '../types'

export const SHELL_THEME_IDS = ['system', 'light', 'dark', 'midnight', 'sakura', 'forest', 'ocean', 'amber', 'cyberpunk', 'contrast'] as const satisfies readonly ShellThemeId[]
export const MASCOT_HATS = ['none', 'kamen_rider', 'crown', 'cap', 'halo'] as const satisfies readonly MascotHat[]
export const SHELL_TOKEN_NAMES = [
  '--bg',
  '--bg-sunken',
  '--surface',
  '--surface-2',
  '--surface-glass',
  '--border',
  '--border-strong',
  '--text',
  '--text-2',
  '--text-3',
  '--accent',
  '--accent-strong',
  '--accent-soft',
  '--accent-text',
  '--text-on-accent',
] as const satisfies readonly ShellTokenName[]

/** Tokens that may carry an alpha channel (#rrggbbaa). Every other token must be an opaque colour. */
const TRANSLUCENT_TOKENS = new Set<ShellTokenName>(['--surface-glass', '--border', '--border-strong', '--accent-soft'])

export const APP_NAME_MAX = 28
export const DEFAULT_APP_NAME = 'FundBun'
export const SHELL_APPEARANCE_PLUGIN_ID = 'shell-appearance'

export const DEFAULT_SHELL_APPEARANCE: ShellAppearance = { theme: 'system', tokens: {}, mascotHat: 'none', appName: null }

export interface ShellThemePreset {
  id: ShellThemeId
  label: string
  /** which of the app's own themes it builds on (`system` follows the device) */
  base: 'light' | 'dark' | 'system'
  /** token overrides on top of the base theme */
  tokens: ShellTokenOverrides
}

function preset(id: ShellThemeId, label: string, base: 'light' | 'dark' | 'system', tokens: ShellTokenOverrides = {}): ShellThemePreset {
  return { id, label, base, tokens }
}

export const SHELL_THEMES: Record<ShellThemeId, ShellThemePreset> = {
  system: preset('system', 'FundBun (follows your device)', 'system'),
  light: preset('light', 'Light', 'light'),
  dark: preset('dark', 'Dark', 'dark'),
  midnight: preset('midnight', 'Midnight', 'dark', {
    '--bg': '#0b1020',
    '--bg-sunken': '#070b17',
    '--surface': '#141b33',
    '--surface-2': '#1d2747',
    '--surface-glass': '#141b33cc',
    '--border': '#c7d2fe1f',
    '--border-strong': '#c7d2fe3d',
    '--text': '#e8ecff',
    '--text-2': '#b9c2e6',
    '--text-3': '#8791ba',
    '--accent': '#8ea2ff',
    '--accent-strong': '#6f86f5',
    '--accent-soft': '#8ea2ff29',
    '--accent-text': '#a9b8ff',
    '--text-on-accent': '#0b1020',
  }),
  sakura: preset('sakura', 'Sakura', 'light', {
    '--bg': '#fff5f8',
    '--bg-sunken': '#ffe9f0',
    '--surface': '#ffffff',
    '--surface-2': '#ffdce8',
    '--surface-glass': '#fff5f8c7',
    '--border': '#7a2e4a1f',
    '--border-strong': '#7a2e4a3d',
    '--text': '#3d1626',
    '--text-2': '#6b3049',
    '--text-3': '#8a4f66',
    '--accent': '#e8799f',
    '--accent-strong': '#d45f88',
    '--accent-soft': '#e8799f29',
    '--accent-text': '#a8355f',
    '--text-on-accent': '#3d1626',
  }),
  forest: preset('forest', 'Forest', 'dark', {
    '--bg': '#0d1711',
    '--bg-sunken': '#09110c',
    '--surface': '#15241b',
    '--surface-2': '#1e3326',
    '--surface-glass': '#15241bcc',
    '--border': '#d6f5df1f',
    '--border-strong': '#d6f5df3d',
    '--text': '#e6f4ea',
    '--text-2': '#b7d3bf',
    '--text-3': '#86a690',
    '--accent': '#6fcf97',
    '--accent-strong': '#4fb37b',
    '--accent-soft': '#6fcf9729',
    '--accent-text': '#86dba8',
    '--text-on-accent': '#0d1711',
  }),
  ocean: preset('ocean', 'Ocean', 'dark', {
    '--bg': '#071a24',
    '--bg-sunken': '#05131b',
    '--surface': '#0e2836',
    '--surface-2': '#153747',
    '--surface-glass': '#0e2836cc',
    '--border': '#c9eefc1f',
    '--border-strong': '#c9eefc3d',
    '--text': '#e3f4fb',
    '--text-2': '#b0d2e0',
    '--text-3': '#7ea5b5',
    '--accent': '#4cc9f0',
    '--accent-strong': '#2fb0d9',
    '--accent-soft': '#4cc9f029',
    '--accent-text': '#7fd8f5',
    '--text-on-accent': '#071a24',
  }),
  amber: preset('amber', 'Amber', 'light', {
    '--bg': '#fff8e8',
    '--bg-sunken': '#ffefcc',
    '--surface': '#fffdf7',
    '--surface-2': '#ffe4a8',
    '--surface-glass': '#fff8e8c7',
    '--border': '#5c3d001f',
    '--border-strong': '#5c3d003d',
    '--text': '#2e1f00',
    '--text-2': '#5c4310',
    '--text-3': '#7a5c1e',
    '--accent': '#f59e0b',
    '--accent-strong': '#d98a00',
    '--accent-soft': '#f59e0b29',
    '--accent-text': '#8a5a00',
    '--text-on-accent': '#2e1f00',
  }),
  cyberpunk: preset('cyberpunk', 'Cyberpunk', 'dark', {
    '--bg': '#0a0612',
    '--bg-sunken': '#06030c',
    '--surface': '#150d24',
    '--surface-2': '#22143a',
    '--surface-glass': '#150d24cc',
    '--border': '#f0abfc2e',
    '--border-strong': '#f0abfc57',
    '--text': '#fdf4ff',
    '--text-2': '#e2c9f5',
    '--text-3': '#b39ccc',
    '--accent': '#ff2bd6',
    '--accent-strong': '#e010b8',
    '--accent-soft': '#ff2bd629',
    '--accent-text': '#ff7ae6',
    '--text-on-accent': '#12001a',
  }),
  contrast: preset('contrast', 'High contrast', 'dark', {
    '--bg': '#000000',
    '--bg-sunken': '#000000',
    '--surface': '#0d0d0d',
    '--surface-2': '#1c1c1c',
    '--surface-glass': '#0d0d0de6',
    '--border': '#ffffff66',
    '--border-strong': '#ffffffa6',
    '--text': '#ffffff',
    '--text-2': '#f0f0f0',
    '--text-3': '#d0d0d0',
    '--accent': '#ffd60a',
    '--accent-strong': '#ffc300',
    '--accent-soft': '#ffd60a33',
    '--accent-text': '#ffe45c',
    '--text-on-accent': '#000000',
  }),
}

export const MASCOT_HAT_LABELS: Record<MascotHat, string> = {
  none: 'No headwear',
  kamen_rider: 'Kamen Rider helmet',
  crown: 'Crown',
  cap: 'Cap',
  halo: 'Halo',
}

/** JSON Schema of a patch: what the AI tool is told, and what validateShellAppearancePatch enforces. */
export const SHELL_APPEARANCE_SCHEMA = {
  type: 'object',
  properties: {
    reset: { type: 'boolean', description: "Start again from FundBun's own look before applying the other fields." },
    theme: { type: 'string', enum: [...SHELL_THEME_IDS], description: 'Theme preset. "system" follows the device.' },
    tokens: {
      type: 'object',
      description: 'Optional colour overrides on top of the theme. Only these design tokens, hex colours only.',
      properties: Object.fromEntries(SHELL_TOKEN_NAMES.map((name) => [name, { type: 'string', pattern: '^#[0-9a-fA-F]{3}([0-9a-fA-F]{3}([0-9a-fA-F]{2})?)?$' }])),
      additionalProperties: false,
    },
    mascotHat: { type: 'string', enum: [...MASCOT_HATS], description: 'What Bun wears on its head. "none" takes it off.' },
    appName: {
      type: 'string',
      minLength: 1,
      maxLength: APP_NAME_MAX,
      description: `Name on the wordmark and window title, at most ${APP_NAME_MAX} printable characters. "FundBun" puts the original name back.`,
    },
  },
  additionalProperties: false,
} as const

// ───────────────────────────── validation ─────────────────────────────

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const NAME_ALLOWED_RE = /^[\p{L}\p{N}\p{P}\p{S}\p{M} ]+$/u
const NAME_NEEDS_RE = /[\p{L}\p{N}]/u
const NAME_MARK_RUN_RE = /\p{M}{3,}/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type AppNameResult = { ok: true; name: string } | { ok: false; issue: string }

/**
 * An app name is at most 28 printable characters (letters, digits, punctuation, symbols, single spaces) with at
 * least one letter or digit. Control and invisible characters, direction overrides and stacked marks are refused,
 * so a name cannot hide text or reorder what the title bar shows.
 */
export function validateAppName(raw: unknown): AppNameResult {
  if (typeof raw !== 'string') return { ok: false, issue: 'The app name must be text.' }
  const name = raw.normalize('NFC').replace(/[\t\n\r ]+/g, ' ').trim()
  if (!name) return { ok: false, issue: 'The app name cannot be empty.' }
  if ([...name].length > APP_NAME_MAX) return { ok: false, issue: `The app name can be at most ${APP_NAME_MAX} characters.` }
  if (!NAME_ALLOWED_RE.test(name) || NAME_MARK_RUN_RE.test(name)) return { ok: false, issue: 'The app name can only use printable letters, digits, symbols and spaces.' }
  if (!NAME_NEEDS_RE.test(name)) return { ok: false, issue: 'The app name needs at least one letter or digit.' }
  return { ok: true, name }
}

function isThemeId(value: unknown): value is ShellThemeId {
  return typeof value === 'string' && (SHELL_THEME_IDS as readonly string[]).includes(value)
}

function isMascotHat(value: unknown): value is MascotHat {
  return typeof value === 'string' && (MASCOT_HATS as readonly string[]).includes(value)
}

function isTokenName(value: string): value is ShellTokenName {
  return (SHELL_TOKEN_NAMES as readonly string[]).includes(value)
}

/** #rgb, #rrggbb or #rrggbbaa to linear channels. */
function channels(hex: string): { r: number; g: number; b: number } {
  const h = hex.slice(1)
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  const lin = (i: number) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return { r: lin(0), g: lin(2), b: lin(4) }
}

/** WCAG contrast ratio of two opaque hex colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = channels(hex)
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The app's own light and dark values for the tokens the legibility rule looks at. */
const BASE_TOKENS: Record<'light' | 'dark', Record<'--bg' | '--surface' | '--text' | '--accent' | '--text-on-accent', string>> = {
  light: { '--bg': '#fffaf2', '--surface': '#ffffff', '--text': '#24180f', '--accent': '#e3a21a', '--text-on-accent': '#24180f' },
  dark: { '--bg': '#17110c', '--surface': '#221912', '--text': '#f8ebdd', '--accent': '#f2bd3d', '--text-on-accent': '#24180f' },
}

export const MIN_TEXT_CONTRAST = 4.5
export const MIN_ACCENT_CONTRAST = 3

/**
 * A look must stay readable: body text against the page and the cards (4.5:1), and the label on an accent button
 * (3:1). This is what stops an override from hiding an approval card by painting text in the background colour.
 */
export function legibilityIssues(theme: ShellThemeId, overrides: ShellTokenOverrides): string[] {
  const p = SHELL_THEMES[theme]
  const bases = p.base === 'system' ? (['light', 'dark'] as const) : [p.base]
  const issues: string[] = []
  for (const base of bases) {
    const t = { ...BASE_TOKENS[base], ...p.tokens, ...overrides }
    const text = t['--text'].slice(0, 7)
    for (const ground of ['--bg', '--surface'] as const) {
      if (contrastRatio(text, t[ground].slice(0, 7)) < MIN_TEXT_CONTRAST) issues.push(`Text would be hard to read on ${ground} (needs ${MIN_TEXT_CONTRAST}:1 contrast).`)
    }
    if (contrastRatio(t['--text-on-accent'].slice(0, 7), t['--accent'].slice(0, 7)) < MIN_ACCENT_CONTRAST) issues.push('Button labels would be hard to read on the accent colour.')
  }
  return [...new Set(issues)]
}

function validateTokens(raw: unknown, issues: string[]): ShellTokenOverrides | undefined {
  if (!isRecord(raw)) {
    issues.push('tokens must be an object of colour tokens.')
    return undefined
  }
  const out: ShellTokenOverrides = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!isTokenName(key)) {
      issues.push(`"${key.slice(0, 40)}" is not a token a shell appearance plugin may change.`)
      continue
    }
    if (typeof value !== 'string' || !HEX_RE.test(value)) {
      issues.push(`${key} must be a hex colour like #1a2b3c.`)
      continue
    }
    if (value.length === 9 && !TRANSLUCENT_TOKENS.has(key)) {
      issues.push(`${key} must be an opaque colour (no alpha).`)
      continue
    }
    out[key] = value.toLowerCase()
  }
  return out
}

export type ShellPatchResult = { ok: true; patch: ShellAppearancePatch } | { ok: false; issues: string[] }

const PATCH_KEYS = new Set(['reset', 'theme', 'tokens', 'mascotHat', 'appName'])

/**
 * Validates an untrusted patch (from a model, a stored chat card, or storage) against the spec. Unknown keys,
 * unknown themes or hats, non-hex colours, tokens off the allow-list, unreadable colour pairs and names outside
 * the bounds are all refused: the result is either a clean patch or the list of reasons.
 */
export function validateShellAppearancePatch(input: unknown): ShellPatchResult {
  if (!isRecord(input)) return { ok: false, issues: ['A shell appearance patch must be an object.'] }
  const issues: string[] = []
  const patch: ShellAppearancePatch = {}
  for (const key of Object.keys(input)) if (!PATCH_KEYS.has(key)) issues.push(`"${key.slice(0, 40)}" is not part of a shell appearance patch.`)

  if (input.reset !== undefined) {
    if (typeof input.reset !== 'boolean') issues.push('reset must be true or false.')
    else if (input.reset) patch.reset = true
  }
  if (input.theme !== undefined) {
    if (isThemeId(input.theme)) patch.theme = input.theme
    else issues.push(`Unknown theme. Choose one of: ${SHELL_THEME_IDS.join(', ')}.`)
  }
  if (input.mascotHat !== undefined) {
    if (isMascotHat(input.mascotHat)) patch.mascotHat = input.mascotHat
    else issues.push(`Unknown headwear. Choose one of: ${MASCOT_HATS.join(', ')}.`)
  }
  if (input.appName !== undefined) {
    if (input.appName === null) patch.appName = null
    else {
      const name = validateAppName(input.appName)
      if (!name.ok) issues.push(name.issue)
      else patch.appName = name.name.toLowerCase() === DEFAULT_APP_NAME.toLowerCase() ? null : name.name
    }
  }
  if (input.tokens !== undefined) {
    const tokens = validateTokens(input.tokens, issues)
    if (tokens && Object.keys(tokens).length) {
      patch.tokens = tokens
      issues.push(...legibilityIssues(patch.theme ?? 'system', tokens))
    }
  }
  if (issues.length) return { ok: false, issues }
  if (!Object.keys(patch).length) return { ok: false, issues: ['The patch changes nothing: give a theme, tokens, mascotHat, appName or reset.'] }
  return { ok: true, patch }
}

/** The look after a patch. A new theme drops earlier token overrides unless the patch brings its own. */
export function applyShellAppearancePatch(current: ShellAppearance, patch: ShellAppearancePatch): ShellAppearance {
  const next: ShellAppearance = patch.reset ? { ...DEFAULT_SHELL_APPEARANCE, tokens: {} } : { ...current, tokens: { ...current.tokens } }
  if (patch.theme !== undefined) {
    next.theme = patch.theme
    next.tokens = {}
  }
  if (patch.tokens !== undefined) next.tokens = { ...next.tokens, ...patch.tokens }
  if (patch.mascotHat !== undefined) next.mascotHat = patch.mascotHat
  if (patch.appName !== undefined) next.appName = patch.appName
  return next
}

export function sameShellAppearance(a: ShellAppearance, b: ShellAppearance): boolean {
  const ka = Object.keys(a.tokens).sort()
  const kb = Object.keys(b.tokens).sort()
  return (
    a.theme === b.theme &&
    a.mascotHat === b.mascotHat &&
    a.appName === b.appName &&
    ka.length === kb.length &&
    ka.every((k, i) => k === kb[i] && isTokenName(k) && a.tokens[k] === b.tokens[k])
  )
}

export function isDefaultShellAppearance(a: ShellAppearance): boolean {
  return sameShellAppearance(a, DEFAULT_SHELL_APPEARANCE)
}

/**
 * Reads a stored look back (browser storage is untrusted: it may be old, edited or corrupt). Anything outside the
 * spec falls back to FundBun's own look for that field.
 */
export function sanitizeShellAppearance(raw: unknown): ShellAppearance {
  if (!isRecord(raw)) return DEFAULT_SHELL_APPEARANCE
  const theme = isThemeId(raw.theme) ? raw.theme : 'system'
  const issues: string[] = []
  const tokens = raw.tokens === undefined ? {} : (validateTokens(raw.tokens, issues) ?? {})
  const name = raw.appName === null || raw.appName === undefined ? null : validateAppName(raw.appName)
  return {
    theme,
    tokens: issues.length || legibilityIssues(theme, tokens).length ? {} : tokens,
    mascotHat: isMascotHat(raw.mascotHat) ? raw.mascotHat : 'none',
    appName: name && name.ok && name.name.toLowerCase() !== DEFAULT_APP_NAME.toLowerCase() ? name.name : null,
  }
}

/** The colour tokens a look sets on the page: the preset's, then the user's overrides. */
export function resolvedShellTokens(a: ShellAppearance): ShellTokenOverrides {
  return { ...SHELL_THEMES[a.theme].tokens, ...a.tokens }
}

export interface ShellChangeLine {
  kind: 'reset' | 'theme' | 'tokens' | 'mascot' | 'name'
  label: string
  value: string
}

/** What a patch changes, one line per part, for the chat card, the trace and the audit entry. */
export function describeShellAppearancePatch(patch: ShellAppearancePatch): ShellChangeLine[] {
  const lines: ShellChangeLine[] = []
  if (patch.reset) lines.push({ kind: 'reset', label: 'Reset', value: "Back to FundBun's own look" })
  if (patch.theme !== undefined) lines.push({ kind: 'theme', label: 'Theme', value: SHELL_THEMES[patch.theme].label })
  if (patch.tokens && Object.keys(patch.tokens).length) lines.push({ kind: 'tokens', label: 'Colours', value: `${Object.keys(patch.tokens).length} custom colour(s)` })
  if (patch.mascotHat !== undefined) lines.push({ kind: 'mascot', label: 'Bun wears', value: MASCOT_HAT_LABELS[patch.mascotHat] })
  if (patch.appName !== undefined) lines.push({ kind: 'name', label: 'App name', value: patch.appName ?? DEFAULT_APP_NAME })
  return lines
}

/** The customizations that are active right now (empty when the shell wears FundBun's own look). */
export function describeShellAppearance(a: ShellAppearance): ShellChangeLine[] {
  const lines: ShellChangeLine[] = []
  if (a.theme !== 'system') lines.push({ kind: 'theme', label: 'Theme', value: SHELL_THEMES[a.theme].label })
  if (Object.keys(a.tokens).length) lines.push({ kind: 'tokens', label: 'Colours', value: `${Object.keys(a.tokens).length} custom colour(s)` })
  if (a.mascotHat !== 'none') lines.push({ kind: 'mascot', label: 'Bun wears', value: MASCOT_HAT_LABELS[a.mascotHat] })
  if (a.appName !== null) lines.push({ kind: 'name', label: 'App name', value: a.appName })
  return lines
}

// ───────────────────────────── reading a chat prompt (deterministic, no model) ─────────────────────────────

const THEME_ALIASES: readonly (readonly [RegExp, ShellThemeId])[] = [
  [/high[\s-]?contrast/, 'contrast'],
  [/cyber[\s-]?punk|neon/, 'cyberpunk'],
  [/midnight/, 'midnight'],
  [/sakura|cherry[\s-]?blossom/, 'sakura'],
  [/forest/, 'forest'],
  [/ocean/, 'ocean'],
  [/amber/, 'amber'],
  [/contrast/, 'contrast'],
  [/dark|night/, 'dark'],
  [/light|day/, 'light'],
  [/system|default|auto(?:matic)?|normal|original|fundbun/, 'system'],
]
const NAMED_THEME = 'high[\\s-]?contrast|cyber[\\s-]?punk|neon|midnight|sakura|cherry[\\s-]?blossom|forest|ocean|amber|contrast|dark|night|light|day'
// "default", "auto" and the like only count right after the word "theme": "auto mode" is about autonomy, not colours
const THEME_WORD = `${NAMED_THEME}|system|default|auto(?:matic)?|normal|original`
const THEME_NOUN = '(?:colou?r\\s+)?(?:theme|tema|skin)'

const THEME_SET_RES: readonly RegExp[] = [
  // "change the theme to midnight", "switch theme to cyberpunk", "set theme: sakura", "theme = dark"
  new RegExp(`\\b${THEME_NOUN}\\b(?:\\s+of\\s+(?:the\\s+)?(?:app|fundbun))?\\s*(?:to|into|as|ke|jadi|menjadi|=|:)?\\s*(?:the\\s+|a\\s+)?(${THEME_WORD})\\b`),
  // "use the midnight theme", "dark mode", "go cyberpunk mode"
  new RegExp(`\\b(${NAMED_THEME})\\s+(?:${THEME_NOUN}|mode|look)\\b`),
  // "make it cyberpunk", "make the app look midnight"
  new RegExp(`\\bmake\\s+(?:it|the\\s+app|fundbun|the\\s+ui|everything)\\s+(?:look\\s+)?(?:like\\s+)?(${NAMED_THEME})\\b`),
]
const THEME_RESET_RE = new RegExp(`\\b(?:reset|restore|revert|undo|remove|clear)\\b[^.,;]{0,24}\\b${THEME_NOUN}\\b|\\b${THEME_NOUN}\\b[^.,;]{0,16}\\bback\\b`)
const THEME_UNKNOWN_RE = new RegExp(`\\b${THEME_NOUN}\\s+(?:to|into|as|ke|jadi|menjadi)\\s+(?:the\\s+|a\\s+)?([a-z][a-z-]{1,20})\\b`)

const RESET_ALL_RE =
  /\b(?:reset|restore|revert|undo|clear|remove)\b[^.,;]{0,40}\b(?:shell\s+appearance|appearance|shell\s+look|customi[sz]ations?|shell\s+plugins?)\b|\b(?:reset|restore)\s+(?:the\s+|fundbun'?s\s+|bun'?s\s+|app'?s\s+)?(?:look|shell)\b|\bback\s+to\s+(?:the\s+)?(?:default|original|normal|fundbun)\s+(?:look|appearance)\b/

const WEARER = '(?:bun|the\\s+bun|the\\s+mascot|mascot|bao)'
const HEADWEAR = '(?:helmet|helm|hat|crown|cap|halo|costume|headwear|mask|headgear)'
const HAT_OFF_RE = new RegExp(
  `\\b(?:remove|take\\s+off|lose|drop|ditch|no\\s+more|without|reset|lepas(?:kan)?)\\b[^.,;]{0,40}\\b${HEADWEAR}\\b|\\btake\\b[^.,;]{0,30}\\b${HEADWEAR}\\s+off\\b|\\b${HEADWEAR}\\s+off\\b`,
)
const WEAR_VERB = '(?:put|give|wear|wears|wearing|add|dress|equip|pakai|pakaikan|kasih)'
const KAMEN_RE = /\b(?:kamen\s*rider|masked\s+rider|rider\s+(?:helmet|helm|mask))\b/
const HAT_CONTEXT_RE = new RegExp(`\\b${WEARER}\\b|\\b${WEAR_VERB}\\b`)
const CROWN_RE = /\bcrown\b/
const HALO_RE = /\bhalo\b/
// "cap" also means a spending cap here, so it needs both a wearer and a wearing verb
const CAP_RE = new RegExp(`\\b${WEAR_VERB}\\b[^.,;]{0,30}\\b(?:baseball\\s+)?cap\\b[^.,;]{0,20}\\b${WEARER}\\b|\\b${WEAR_VERB}\\s+${WEARER}\\b[^.,;]{0,12}\\b(?:baseball\\s+)?cap\\b|\\b${WEARER}\\b[^.,;]{0,24}\\b(?:wear|wears|wearing)\\b[^.,;]{0,12}\\b(?:baseball\\s+)?cap\\b`)

const APP_TARGET = "(?:fundbun|the\\s+app|this\\s+app|app|aplikasi(?:nya)?|it)"
const NAME_TARGET = "(?:(?:the\\s+)?app(?:lication)?(?:'s)?\\s*(?:name|title)|fundbun(?:'s)?\\s+name|(?:the\\s+)?wordmark|(?:the\\s+)?brand(?:\\s+name)?|(?:the\\s+)?name\\s+of\\s+(?:the\\s+)?(?:app|fundbun)|nama\\s+(?:app|aplikasi|fundbun)(?:nya)?)"
const NAME_SET_RES: readonly RegExp[] = [
  new RegExp(`\\brename\\s+(?:the\\s+)?${APP_TARGET}\\s+(?:back\\s+)?(?:to|as|into)\\s+`, 'i'),
  new RegExp(`\\b(?:change|set|switch|update|make|ganti|ubah)\\s+${NAME_TARGET}\\s+(?:back\\s+)?(?:to|as|into|ke|jadi|menjadi|=|:)\\s*`, 'i'),
  new RegExp(`\\b${NAME_TARGET}\\s*(?:=|:)\\s*`, 'i'),
  new RegExp(`\\bcall\\s+(?:the\\s+app|this\\s+app|fundbun)\\s+`, 'i'),
]
const NAME_RESET_RE = new RegExp(`\\b(?:reset|restore|revert|undo|remove|clear)\\b[^.,;]{0,24}\\b${NAME_TARGET}|\\b${NAME_TARGET}\\b[^.,;]{0,12}\\bback\\b`, 'i')
/** Where a typed name ends when the sentence goes on: ", and put a helmet on Bun". */
const NAME_END_RE = /\s*(?:[,;]|\.(?:\s|$)|\s+(?:and|then|also|plus|dan|lalu)\s+(?=(?:please\s+)?(?:put|give|change|switch|set|make|use|remove|reset|add|turn|wear|dress|ganti|pakai)\b))/i
const QUOTED_RE = /^\s*(?:"([^"]*)"|“([^”]*)”|'([^']*)'|‘([^’]*)’|`([^`]*)`)/

export interface ShellAppearancePromptReading {
  /** the valid part of the request, or null when nothing valid was asked */
  patch: ShellAppearancePatch | null
  /** parts that were asked for but are outside the bounds (unknown theme, a name that is too long) */
  issues: string[]
}

function themeOf(word: string): ShellThemeId | null {
  for (const [re, id] of THEME_ALIASES) if (re.test(word)) return id
  return null
}

function readName(text: string): { span: [number, number]; raw: string } | null {
  for (const re of NAME_SET_RES) {
    const m = re.exec(text)
    if (!m) continue
    const start = m.index + m[0].length
    const rest = text.slice(start)
    const quoted = QUOTED_RE.exec(rest)
    if (quoted) {
      const inner = quoted.slice(1).find((g) => g !== undefined) ?? ''
      return { span: [m.index, start + quoted[0].length], raw: inner }
    }
    const end = NAME_END_RE.exec(rest)
    const raw = (end ? rest.slice(0, end.index) : rest).replace(/[.!?。！？\s]+$/u, '')
    return { span: [m.index, start + raw.length], raw }
  }
  return null
}

const PROMPT_MAX = 400

/**
 * Reads a chat message as a shell appearance request, with no model: theme, headwear and app name, alone or in
 * one sentence, plus the resets. Returns null when the message is not about the shell at all, so every other
 * message goes on to the usual engines untouched.
 */
export function readShellAppearancePrompt(text: string): ShellAppearancePromptReading | null {
  const original = String(text ?? '').trim()
  if (!original || original.length > PROMPT_MAX) return null
  const patch: ShellAppearancePatch = {}
  const issues: string[] = []
  let asked = false

  // the name first: its words must not be read as a theme or a hat
  let rest = original
  const named = readName(original)
  if (named) {
    asked = true
    rest = `${original.slice(0, named.span[0])} ${original.slice(named.span[1])}`
    const name = validateAppName(named.raw)
    if (!name.ok) issues.push(name.issue)
    else patch.appName = name.name.toLowerCase() === DEFAULT_APP_NAME.toLowerCase() ? null : name.name
  } else if (NAME_RESET_RE.test(original)) {
    asked = true
    patch.appName = null
  }

  const lower = rest.toLowerCase().replace(/[’`]/g, "'")
  if (RESET_ALL_RE.test(lower)) {
    asked = true
    patch.reset = true
  }

  const themeHit = THEME_SET_RES.map((re) => re.exec(lower)).find((m) => m !== null)
  const theme = themeHit ? themeOf(themeHit[1]) : null
  if (theme) {
    asked = true
    patch.theme = theme
  } else if (THEME_RESET_RE.test(lower)) {
    asked = true
    patch.theme = 'system'
  } else {
    const unknown = THEME_UNKNOWN_RE.exec(lower)
    if (unknown) {
      asked = true
      issues.push(`There is no theme called "${unknown[1]}". Try ${SHELL_THEME_IDS.filter((t) => t !== 'system').join(', ')}.`)
    }
  }

  if (HAT_OFF_RE.test(lower) && (KAMEN_RE.test(lower) || HAT_CONTEXT_RE.test(lower) || /\b(?:helmet|helm|costume|headwear|headgear)\b/.test(lower))) {
    asked = true
    patch.mascotHat = 'none'
  } else if (KAMEN_RE.test(lower)) {
    asked = true
    patch.mascotHat = 'kamen_rider'
  } else if (CROWN_RE.test(lower) && HAT_CONTEXT_RE.test(lower)) {
    asked = true
    patch.mascotHat = 'crown'
  } else if (HALO_RE.test(lower) && HAT_CONTEXT_RE.test(lower)) {
    asked = true
    patch.mascotHat = 'halo'
  } else if (CAP_RE.test(lower)) {
    asked = true
    patch.mascotHat = 'cap'
  }

  if (!asked) return null
  return { patch: Object.keys(patch).length ? patch : null, issues }
}

/**
 * The patch a chat message asks for, or null. "change theme to cyberpunk, put a kamen rider helm on bun, and
 * rename fundbun to #ilovemoney" gives all three parts in one patch.
 */
export function parseShellAppearancePrompt(text: string): ShellAppearancePatch | null {
  return readShellAppearancePrompt(text)?.patch ?? null
}

/**
 * Whether a shell appearance request may be staged for Apply in this turn, by the same rules as the other Creator
 * tools: never while Bun is paused by the kill switch, and never in a turn that carries untrusted content.
 */
export function shellAppearanceGate(input: { tainted: boolean; frozen: boolean }): { allowed: true } | { allowed: false; ruleId: 'P-FROZEN' | 'P-TAINT-CREATOR'; reason: string } {
  if (input.frozen) return { allowed: false, ruleId: 'P-FROZEN', reason: 'FundBun is paused by the kill switch, so the look cannot be changed right now.' }
  if (input.tainted) return { allowed: false, ruleId: 'P-TAINT-CREATOR', reason: 'This turn includes untrusted content (a file, a bill or pasted text), so changing the look is blocked.' }
  return { allowed: true }
}
