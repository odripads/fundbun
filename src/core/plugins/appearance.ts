/**
 * Shell Appearance Plugins (Desktop Creator Mode): bounded, reversible changes to the app shell.
 *
 * These things can change, and nothing else:
 *   1. the theme (a preset, or hex overrides of an allow-list of colour tokens, with an optional friendly name),
 *   2. what Bun wears: a built-in item, or a custom costume drawn from sanitized SVG shapes,
 *   3. the name on the wordmark and the window title (at most 28 printable characters),
 *   4. ergonomics: typeface family, text size, corner rounding and spacing, each from a short fixed list.
 *
 * Everything here is pure data and pure functions: the spec, its validator, the SVG sanitizer, the patch
 * arithmetic, an offline palette synthesizer and a deterministic reader for chat prompts ("change the theme to
 * midnight", "matcha theme", "bigger text"). No DOM, no storage, no model.
 * A patch is only ever proposed: the user presses Apply on the chat card, and can undo or reset at once.
 */
import type {
  MascotHat,
  MascotSvgAttr,
  MascotSvgNode,
  MascotSvgNodeType,
  ShellAppearance,
  ShellAppearancePatch,
  ShellDensity,
  ShellFontScale,
  ShellFontStyle,
  ShellRadius,
  ShellThemeId,
  ShellTokenName,
  ShellTokenOverrides,
} from '../types'

export type {
  MascotHat,
  MascotSvgAttr,
  MascotSvgNode,
  MascotSvgNodeType,
  PluginAppearanceCard,
  ShellAppearance,
  ShellAppearancePatch,
  ShellDensity,
  ShellFontScale,
  ShellFontStyle,
  ShellRadius,
  ShellThemeId,
  ShellTokenName,
  ShellTokenOverrides,
} from '../types'

export const SHELL_THEME_IDS = ['system', 'light', 'dark', 'midnight', 'sakura', 'forest', 'ocean', 'amber', 'cyberpunk', 'contrast'] as const satisfies readonly ShellThemeId[]
export const MASCOT_HATS = ['none', 'kamen_rider', 'crown', 'cap', 'halo', 'wizard', 'sunglasses', 'headphones', 'cat_ears', 'chef'] as const satisfies readonly MascotHat[]
export const SHELL_FONT_STYLES = ['default', 'mono', 'serif', 'rounded'] as const satisfies readonly ShellFontStyle[]
export const SHELL_FONT_SCALES = ['compact', 'default', 'large', 'xlarge'] as const satisfies readonly ShellFontScale[]
export const SHELL_RADII = ['sharp', 'default', 'round', 'pill'] as const satisfies readonly ShellRadius[]
export const SHELL_DENSITIES = ['compact', 'default', 'cozy'] as const satisfies readonly ShellDensity[]
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
export const THEME_LABEL_MAX = 32
export const MASCOT_LABEL_MAX = 40
/** A custom costume is at most this many characters of SVG, and at most this many elements. */
export const MASCOT_SVG_MAX = 4096
export const MASCOT_SVG_MAX_NODES = 48
export const MASCOT_SVG_MAX_DEPTH = 4
export const MASCOT_SVG_NODE_TYPES = ['g', 'path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line'] as const satisfies readonly MascotSvgNodeType[]
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
  wizard: 'Wizard hat',
  sunglasses: 'Sunglasses',
  headphones: 'Headphones',
  cat_ears: 'Cat ears',
  chef: 'Chef hat',
}

export const CUSTOM_COSTUME_LABEL = 'Custom costume'

export const SHELL_FONT_STYLE_LABELS: Record<ShellFontStyle, string> = { default: 'FundBun type', mono: 'Monospace', serif: 'Serif', rounded: 'Rounded' }
export const SHELL_FONT_SCALE_LABELS: Record<ShellFontScale, string> = { compact: 'Compact', default: 'Standard', large: 'Large', xlarge: 'Extra large' }
export const SHELL_RADIUS_LABELS: Record<ShellRadius, string> = { sharp: 'Sharp', default: 'Standard', round: 'Round', pill: 'Extra round' }
export const SHELL_DENSITY_LABELS: Record<ShellDensity, string> = { compact: 'Compact', default: 'Standard', cozy: 'Cozy' }

/**
 * What the ergonomic choices put on the page: values for design tokens that already exist in tokens.css, so the
 * whole app follows through the cascade. These are fixed lists written here, never text from a model or a user.
 */
export const SHELL_FONT_STACKS: Record<Exclude<ShellFontStyle, 'default'>, { ui: string; display: string }> = {
  mono: {
    ui: "ui-monospace, 'SF Mono', 'JetBrains Mono', 'Cascadia Code', Menlo, Consolas, 'PingFang SC', monospace",
    display: "ui-monospace, 'SF Mono', 'JetBrains Mono', 'Cascadia Code', Menlo, Consolas, 'PingFang SC', monospace",
  },
  serif: {
    ui: "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, 'Songti SC', serif",
    display: "'Fraunces Variable', 'Fraunces', Georgia, 'Songti SC', serif",
  },
  rounded: {
    ui: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Varela Round', 'Hiragino Maru Gothic ProN', 'DM Sans Variable', system-ui, sans-serif",
    display: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Varela Round', 'Hiragino Maru Gothic ProN', 'Fraunces Variable', system-ui, sans-serif",
  },
}

/** Root text size as a share of the device default: every rem-based size in the app follows it. */
export const SHELL_FONT_SCALE_FACTORS: Record<ShellFontScale, number> = { compact: 0.9375, default: 1, large: 1.125, xlarge: 1.25 }

const RADIUS_TOKENS = ['--r-sm', '--r-md', '--r-lg', '--r-xl'] as const
/** Corner radii in px for --r-sm, --r-md, --r-lg and --r-xl. "pill" stays a bounded radius so tall cards keep their corners. */
export const SHELL_RADIUS_PX: Record<Exclude<ShellRadius, 'default'>, readonly [number, number, number, number]> = {
  sharp: [2, 3, 4, 6],
  round: [12, 20, 28, 36],
  pill: [16, 26, 34, 44],
}

const SPACING_TOKENS = [
  ['--s-1', 4],
  ['--s-2', 8],
  ['--s-3', 12],
  ['--s-4', 16],
  ['--s-5', 20],
  ['--s-6', 24],
  ['--s-8', 32],
  ['--s-10', 40],
  ['--s-12', 48],
] as const
export const SHELL_DENSITY_FACTORS: Record<ShellDensity, number> = { compact: 0.85, default: 1, cozy: 1.15 }

/** Every non-colour design token an ergonomic choice may set (and that Reset removes again). */
export const SHELL_ERGONOMIC_VARS = ['--font-ui', '--font-display', ...RADIUS_TOKENS, ...SPACING_TOKENS.map(([name]) => name)] as const
export type ShellErgonomicVar = (typeof SHELL_ERGONOMIC_VARS)[number]

/** The non-colour tokens a look sets on the page. Empty for FundBun's own ergonomics. */
export function resolvedShellVariables(a: Pick<ShellAppearance, 'fontStyle' | 'radius' | 'density'>): Partial<Record<ShellErgonomicVar, string>> {
  const out: Partial<Record<ShellErgonomicVar, string>> = {}
  if (a.fontStyle && a.fontStyle !== 'default') {
    out['--font-ui'] = SHELL_FONT_STACKS[a.fontStyle].ui
    out['--font-display'] = SHELL_FONT_STACKS[a.fontStyle].display
  }
  if (a.radius && a.radius !== 'default') {
    const px = SHELL_RADIUS_PX[a.radius]
    RADIUS_TOKENS.forEach((name, i) => {
      out[name] = `${px[i]}px`
    })
  }
  if (a.density && a.density !== 'default') {
    const factor = SHELL_DENSITY_FACTORS[a.density]
    for (const [name, px] of SPACING_TOKENS) out[name] = `${Math.round(px * factor)}px`
  }
  return out
}

/** FundBun's own values of those tokens (they mirror src/ui/styles/tokens.css; a test keeps the two in step). */
export const SHELL_DEFAULT_VARIABLES: Record<ShellErgonomicVar, string> = {
  '--font-ui': "'DM Sans Variable', 'DM Sans', system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', sans-serif",
  '--font-display': "'Fraunces Variable', 'Fraunces', Georgia, 'Songti SC', serif",
  '--r-sm': '8px',
  '--r-md': '14px',
  '--r-lg': '20px',
  '--r-xl': '28px',
  '--s-1': '4px',
  '--s-2': '8px',
  '--s-3': '12px',
  '--s-4': '16px',
  '--s-5': '20px',
  '--s-6': '24px',
  '--s-8': '32px',
  '--s-10': '40px',
  '--s-12': '48px',
}

/**
 * Every ergonomic token with a value, for a preview box: a preview must show FundBun's own type and corners
 * even while the page around it wears something else.
 */
export function shellPreviewVariables(a: Pick<ShellAppearance, 'fontStyle' | 'radius' | 'density'>): Record<ShellErgonomicVar, string> {
  return { ...SHELL_DEFAULT_VARIABLES, ...resolvedShellVariables(a) }
}

/** The root font size a look asks for, as a CSS percentage, or null for the device default. */
export function shellRootFontSize(a: Pick<ShellAppearance, 'fontScale'>): string | null {
  return a.fontScale && a.fontScale !== 'default' ? `${SHELL_FONT_SCALE_FACTORS[a.fontScale] * 100}%` : null
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
    themeLabel: {
      type: 'string',
      minLength: 1,
      maxLength: THEME_LABEL_MAX,
      description: `Friendly name for a custom palette, at most ${THEME_LABEL_MAX} printable characters (for example "Matcha"). Only together with tokens.`,
    },
    mascotHat: { type: 'string', enum: [...MASCOT_HATS], description: 'Built-in item Bun wears. "none" takes everything off, a custom costume included.' },
    mascotSvg: {
      type: 'string',
      maxLength: MASCOT_SVG_MAX,
      description:
        `A custom costume, prop or accessory for Bun, drawn in Bun's 512x512 viewBox as plain SVG shapes: at most ${MASCOT_SVG_MAX} characters and ${MASCOT_SVG_MAX_NODES} elements. ` +
        `Only <${MASCOT_SVG_NODE_TYPES.join('>, <')}> with geometry, fill, stroke, opacity and transform attributes. Colours are #hex, none or currentColor. ` +
        'No script, style, href, url(), image, use, text or animation. Sent alone it replaces the built-in item; with mascotHat Bun wears both. An empty string takes the custom costume off.',
    },
    mascotLabel: {
      type: 'string',
      minLength: 1,
      maxLength: MASCOT_LABEL_MAX,
      description: `What the custom costume is called, at most ${MASCOT_LABEL_MAX} printable characters (for example "Samurai helmet"). Only together with mascotSvg.`,
    },
    appName: {
      type: 'string',
      minLength: 1,
      maxLength: APP_NAME_MAX,
      description: `Name on the wordmark and window title, at most ${APP_NAME_MAX} printable characters. "FundBun" puts the original name back.`,
    },
    fontStyle: { type: 'string', enum: [...SHELL_FONT_STYLES], description: 'Typeface family of the whole app. "default" puts FundBun\'s own type back.' },
    fontScale: { type: 'string', enum: [...SHELL_FONT_SCALES], description: 'Text size of the whole app, for readability: compact, default, large or xlarge.' },
    radius: { type: 'string', enum: [...SHELL_RADII], description: 'Corner rounding of cards, buttons and fields: sharp, default, round or pill (extra round).' },
    density: { type: 'string', enum: [...SHELL_DENSITIES], description: 'Spacing of the layout: compact, default or cozy (more room).' },
  },
  additionalProperties: false,
} as const

// ───────────────────────────── custom costume: a strict SVG reader ─────────────────────────────
//
// A connected AI can draw Bun any costume, prop or accessory. What it sends is text from a model, so it is never
// put on the page as markup. This reader walks it character by character, keeps only shapes and groups with
// geometry, paint and transform attributes whose values match narrow patterns, and returns a small tree of plain
// data. The mascot draws that tree as React elements. Nothing that can load a file, follow a link, run script or
// carry CSS has a way through: such input is refused whole, with the reason.

export type MascotSvgResult = { ok: true; svg: string; nodes: MascotSvgNode[] } | { ok: false; issues: string[] }

/** Attribute spellings a model may use (SVG's own kebab-case or React's camelCase), mapped to one name. */
const SVG_ATTR_SPELLINGS: Record<string, MascotSvgAttr> = {
  d: 'd',
  cx: 'cx',
  cy: 'cy',
  r: 'r',
  rx: 'rx',
  ry: 'ry',
  x: 'x',
  y: 'y',
  width: 'width',
  height: 'height',
  points: 'points',
  x1: 'x1',
  y1: 'y1',
  x2: 'x2',
  y2: 'y2',
  fill: 'fill',
  stroke: 'stroke',
  'stroke-width': 'strokeWidth',
  strokeWidth: 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  strokeLinecap: 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  strokeLinejoin: 'strokeLinejoin',
  'stroke-dasharray': 'strokeDasharray',
  strokeDasharray: 'strokeDasharray',
  opacity: 'opacity',
  'fill-opacity': 'fillOpacity',
  fillOpacity: 'fillOpacity',
  'stroke-opacity': 'strokeOpacity',
  strokeOpacity: 'strokeOpacity',
  transform: 'transform',
}
const SVG_ATTR_NAMES = new Map<string, MascotSvgAttr>(Object.entries(SVG_ATTR_SPELLINGS))

/** The canonical (SVG) spelling of each attribute, in the order they are written out. */
const SVG_ATTR_OUT: readonly (readonly [MascotSvgAttr, string])[] = [
  ['d', 'd'],
  ['points', 'points'],
  ['cx', 'cx'],
  ['cy', 'cy'],
  ['r', 'r'],
  ['rx', 'rx'],
  ['ry', 'ry'],
  ['x', 'x'],
  ['y', 'y'],
  ['width', 'width'],
  ['height', 'height'],
  ['x1', 'x1'],
  ['y1', 'y1'],
  ['x2', 'x2'],
  ['y2', 'y2'],
  ['fill', 'fill'],
  ['stroke', 'stroke'],
  ['strokeWidth', 'stroke-width'],
  ['strokeLinecap', 'stroke-linecap'],
  ['strokeLinejoin', 'stroke-linejoin'],
  ['strokeDasharray', 'stroke-dasharray'],
  ['opacity', 'opacity'],
  ['fillOpacity', 'fill-opacity'],
  ['strokeOpacity', 'stroke-opacity'],
  ['transform', 'transform'],
]

const PAINT_ATTRS: readonly MascotSvgAttr[] = ['fill', 'stroke', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'strokeDasharray', 'opacity', 'fillOpacity', 'strokeOpacity', 'transform']

/** Geometry each element may carry, and the part of it the element cannot be drawn without. */
const SVG_GEOMETRY: Record<MascotSvgNodeType, { may: readonly MascotSvgAttr[]; needs: readonly MascotSvgAttr[] }> = {
  g: { may: [], needs: [] },
  path: { may: ['d'], needs: ['d'] },
  circle: { may: ['cx', 'cy', 'r'], needs: ['r'] },
  ellipse: { may: ['cx', 'cy', 'rx', 'ry'], needs: ['rx', 'ry'] },
  rect: { may: ['x', 'y', 'width', 'height', 'rx', 'ry'], needs: ['width', 'height'] },
  polygon: { may: ['points'], needs: ['points'] },
  polyline: { may: ['points'], needs: ['points'] },
  line: { may: ['x1', 'y1', 'x2', 'y2'], needs: ['x2', 'y2'] },
}

/** Attributes of an outer <svg> wrapper that are read and dropped (the costume is always drawn in Bun's own box). */
const SVG_WRAPPER_IGNORED = new Set(['xmlns', 'xmlns:xlink', 'viewBox', 'width', 'height', 'version'])

const SVG_NUMBER = '-?(?:\\d{1,4}(?:\\.\\d{1,4})?|\\.\\d{1,4})'
const SVG_NUMBER_RE = new RegExp(`^${SVG_NUMBER}$`)
const SVG_PATH_RE = /^[Mm][MmLlHhVvCcSsQqTtAaZz\d\s,.-]*$/
const SVG_POINTS_RE = /^-?[\d.][\d\s,.-]*$/
const SVG_DASH_RE = /^\d[\d\s,.]*$/
const SVG_PAINT_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const SVG_TRANSFORM_FN_RE = new RegExp(`\\s*(translate|scale|rotate|skewX|skewY|matrix)\\s*\\(\\s*(${SVG_NUMBER}(?:(?:\\s*,\\s*|\\s+)${SVG_NUMBER}){0,5})\\s*\\)\\s*,?\\s*`, 'y')
const SVG_TRANSFORM_ARITY: Record<string, readonly number[]> = { translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1], matrix: [6] }
const SVG_COORD_MAX = 2048
const SVG_STROKE_MAX = 96
const SVG_TRANSFORM_MAX_FNS = 6

/** Things that are never part of a costume, named so the refusal says exactly what to take out. */
const SVG_FORBIDDEN: readonly (readonly [RegExp, string])[] = [
  [/<\s*\/?\s*script/i, '<script> is not allowed.'],
  [/javascript\s*:/i, 'javascript: is not allowed.'],
  [/data\s*:/i, 'data: values are not allowed.'],
  [/url\s*\(/i, 'url(...) is not allowed: paint with #hex colours only.'],
  [/(?:^|[\s"'<])on[a-z]+\s*=/i, 'Event handler attributes (on...) are not allowed.'],
  [/href/i, 'href and xlink:href are not allowed.'],
  [/\bstyle\s*=/i, 'style= is not allowed: use fill, stroke and opacity attributes.'],
  [/<\s*\/?\s*style/i, '<style> is not allowed.'],
  [/<!|<\?/, 'Comments, doctypes and processing instructions are not allowed.'],
  [/&/, 'Character entities (&...;) are not allowed.'],
]

function svgIssue(message: string): MascotSvgResult {
  return { ok: false, issues: [`mascotSvg: ${message}`] }
}

function inRange(value: string, min: number, max: number): boolean {
  if (!SVG_NUMBER_RE.test(value)) return false
  const n = Number(value)
  return Number.isFinite(n) && n >= min && n <= max
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** One transform list ("translate(10 4) rotate(-12 256 80)") to its canonical form, or null when it is anything else. */
function cleanTransform(value: string): string | null {
  const out: string[] = []
  let at = 0
  while (at < value.length) {
    SVG_TRANSFORM_FN_RE.lastIndex = at
    const m = SVG_TRANSFORM_FN_RE.exec(value)
    if (!m || m[0].length === 0) return null
    const args = m[2].split(/[\s,]+/).filter(Boolean)
    if (!SVG_TRANSFORM_ARITY[m[1]].includes(args.length) || args.some((a) => !inRange(a, -SVG_COORD_MAX, SVG_COORD_MAX))) return null
    out.push(`${m[1]}(${args.join(' ')})`)
    if (out.length > SVG_TRANSFORM_MAX_FNS) return null
    at += m[0].length
  }
  return out.length ? out.join(' ') : null
}

/** The clean value of one attribute, or null when the value is outside what that attribute may hold. */
function cleanSvgValue(attr: MascotSvgAttr, raw: string): string | null {
  const value = collapse(raw)
  if (!value) return null
  switch (attr) {
    case 'd':
      return SVG_PATH_RE.test(value) ? value : null
    case 'points':
      return SVG_POINTS_RE.test(value) ? value : null
    case 'fill':
    case 'stroke':
      if (value === 'none' || value === 'currentColor') return value
      return SVG_PAINT_RE.test(value) ? value.toLowerCase() : null
    case 'strokeLinecap':
      return value === 'butt' || value === 'round' || value === 'square' ? value : null
    case 'strokeLinejoin':
      return value === 'miter' || value === 'round' || value === 'bevel' ? value : null
    case 'strokeDasharray':
      return value === 'none' || SVG_DASH_RE.test(value) ? value : null
    case 'opacity':
    case 'fillOpacity':
    case 'strokeOpacity':
      return inRange(value, 0, 1) ? value : null
    case 'strokeWidth':
      return inRange(value, 0, SVG_STROKE_MAX) ? value : null
    case 'r':
    case 'rx':
    case 'ry':
    case 'width':
    case 'height':
      return inRange(value, 0, SVG_COORD_MAX) ? value : null
    case 'transform':
      return cleanTransform(value)
    default:
      return inRange(value, -SVG_COORD_MAX, SVG_COORD_MAX) ? value : null
  }
}

function isSvgNodeType(name: string): name is MascotSvgNodeType {
  return (MASCOT_SVG_NODE_TYPES as readonly string[]).includes(name)
}

const SVG_TAG_NAME_RE = /[A-Za-z][A-Za-z0-9:_-]*/y
const SVG_ATTR_NAME_RE = /[A-Za-z_:][A-Za-z0-9_:.-]*/y
const SVG_SPACE_RE = /[\t\n\r ]*/y

/** Writes a validated tree back out as SVG text. Every value already matches a pattern with no quote or angle bracket in it. */
export function serializeMascotSvg(nodes: readonly MascotSvgNode[]): string {
  return nodes
    .map((node) => {
      const attrs = SVG_ATTR_OUT.map(([key, name]) => (node.attrs[key] === undefined ? '' : ` ${name}="${node.attrs[key]}"`)).join('')
      return node.type === 'g' ? `<g${attrs}>${serializeMascotSvg(node.children)}</g>` : `<${node.type}${attrs}/>`
    })
    .join('')
}

/**
 * Reads untrusted SVG text into a tree of at most 48 shapes and groups. The whole input is refused (never
 * trimmed down to "the safe part") when it holds anything else: another element, an attribute off the allow-list,
 * a value outside its pattern, text, an entity, a comment, script, style, a link or a url().
 */
export function parseSafeSvgElements(raw: unknown): MascotSvgResult {
  if (typeof raw !== 'string') return svgIssue('must be SVG text.')
  const text = raw.trim()
  if (!text) return svgIssue('is empty.')
  if (text.length > MASCOT_SVG_MAX) return svgIssue(`can be at most ${MASCOT_SVG_MAX} characters.`)
  if (/[^\t\n\r\x20-\x7e]/.test(text)) return svgIssue('may only hold plain ASCII characters.')
  for (const [re, why] of SVG_FORBIDDEN) if (re.test(text)) return svgIssue(why)

  const roots: MascotSvgNode[] = []
  const open: MascotSvgNode[] = []
  /** an outer <svg> is a frame, not a shape: it is dropped, or kept as a group when it paints or moves the drawing */
  let wrapper: 'none' | 'open' | 'closed' = 'none'
  let wrapperGroup: MascotSvgNode | null = null
  let count = 0
  let drawn = 0
  let at = 0

  const skipSpace = () => {
    SVG_SPACE_RE.lastIndex = at
    at += SVG_SPACE_RE.exec(text)?.[0].length ?? 0
  }
  const siblings = (): MascotSvgNode[] => (open.length ? open[open.length - 1].children : roots)

  while (true) {
    skipSpace()
    if (at >= text.length) break
    if (text[at] !== '<') return svgIssue('Text is not allowed, only shapes.')
    at++

    if (text[at] === '/') {
      at++
      SVG_TAG_NAME_RE.lastIndex = at
      const name = SVG_TAG_NAME_RE.exec(text)?.[0] ?? ''
      at += name.length
      skipSpace()
      if (text[at] !== '>') return svgIssue('has a closing tag that is not well formed.')
      at++
      const top = open[open.length - 1]
      if (top && top === wrapperGroup) {
        if (name !== 'svg') return svgIssue(`</${name.slice(0, 20)}> does not match <svg>.`)
        open.pop()
        wrapper = 'closed'
      } else if (top) {
        if (top.type !== name) return svgIssue(`</${name.slice(0, 20)}> does not match <${top.type}>.`)
        open.pop()
      } else if (name === 'svg' && wrapper === 'open') wrapper = 'closed'
      else return svgIssue(`</${name.slice(0, 20)}> closes nothing.`)
      continue
    }

    SVG_TAG_NAME_RE.lastIndex = at
    const name = SVG_TAG_NAME_RE.exec(text)?.[0] ?? ''
    if (!name) return svgIssue('has a tag that is not well formed.')
    at += name.length
    if (wrapper === 'closed') return svgIssue('has content after </svg>.')
    const isWrapper = name === 'svg' && wrapper === 'none' && !open.length && !roots.length
    if (!isWrapper && !isSvgNodeType(name)) return svgIssue(`<${name.slice(0, 24)}> is not allowed. Use only: ${MASCOT_SVG_NODE_TYPES.join(', ')}.`)
    const type: MascotSvgNodeType = isWrapper || !isSvgNodeType(name) ? 'g' : name
    const parent = open[open.length - 1]
    if (parent && parent.type !== 'g') return svgIssue(`<${parent.type}> cannot contain other elements.`)

    const attrs: MascotSvgNode['attrs'] = {}
    let selfClosed = false
    while (true) {
      const before = at
      skipSpace()
      if (text.startsWith('/>', at)) {
        at += 2
        selfClosed = true
        break
      }
      if (text[at] === '>') {
        at++
        break
      }
      if (at >= text.length) return svgIssue('ends inside a tag.')
      if (at === before) return svgIssue('has a tag that is not well formed.')
      SVG_ATTR_NAME_RE.lastIndex = at
      const attrName = SVG_ATTR_NAME_RE.exec(text)?.[0] ?? ''
      if (!attrName) return svgIssue('has an attribute that is not well formed.')
      at += attrName.length
      skipSpace()
      if (text[at] !== '=') return svgIssue(`attribute "${attrName.slice(0, 24)}" needs a quoted value.`)
      at++
      skipSpace()
      const quote = text[at]
      if (quote !== '"' && quote !== "'") return svgIssue(`attribute "${attrName.slice(0, 24)}" needs a quoted value.`)
      const end = text.indexOf(quote, at + 1)
      if (end < 0) return svgIssue('has an attribute value with no closing quote.')
      const value = text.slice(at + 1, end)
      at = end + 1
      if (/[<>]/.test(value)) return svgIssue(`attribute "${attrName.slice(0, 24)}" holds a tag.`)
      if (isWrapper && SVG_WRAPPER_IGNORED.has(attrName)) continue
      const key = SVG_ATTR_NAMES.get(attrName)
      if (!key || !(PAINT_ATTRS.includes(key) || SVG_GEOMETRY[type].may.includes(key))) {
        return svgIssue(`attribute "${attrName.slice(0, 24)}" is not allowed on <${name}>. Use geometry, fill, stroke, opacity and transform only.`)
      }
      if (attrs[key] !== undefined) return svgIssue(`attribute "${attrName.slice(0, 24)}" is given twice.`)
      const clean = cleanSvgValue(key, value)
      if (clean === null) {
        const hint = key === 'fill' || key === 'stroke' ? ' Colours must be #hex, none or currentColor.' : ''
        return svgIssue(`"${attrName.slice(0, 24)}" has a value that is not allowed.${hint}`)
      }
      attrs[key] = clean
    }

    if (isWrapper) {
      wrapper = selfClosed ? 'closed' : 'open'
      if (Object.keys(attrs).length && !selfClosed) {
        wrapperGroup = { type: 'g', attrs, children: [] }
        roots.push(wrapperGroup)
        open.push(wrapperGroup)
        count++
      }
      continue
    }

    for (const need of SVG_GEOMETRY[type].needs) if (attrs[need] === undefined) return svgIssue(`<${type}> needs ${need}.`)
    const node: MascotSvgNode = { type, attrs, children: [] }
    siblings().push(node)
    count++
    if (type !== 'g') drawn++
    if (count > MASCOT_SVG_MAX_NODES) return svgIssue(`can hold at most ${MASCOT_SVG_MAX_NODES} elements.`)
    if (!selfClosed) {
      open.push(node)
      if (open.filter((n) => n.type === 'g').length > MASCOT_SVG_MAX_DEPTH) return svgIssue(`groups can be nested at most ${MASCOT_SVG_MAX_DEPTH} deep.`)
    }
  }

  if (open.length) return svgIssue(`<${open[open.length - 1].type}> is never closed.`)
  if (wrapper === 'open') return svgIssue('<svg> is never closed.')
  if (!drawn) return svgIssue('draws nothing: add at least one shape.')
  const svg = serializeMascotSvg(roots)
  if (svg.length > MASCOT_SVG_MAX) return svgIssue(`can be at most ${MASCOT_SVG_MAX} characters.`)
  return { ok: true, svg, nodes: roots }
}

/** The sanitizer by its other name: untrusted SVG text in, canonical SVG text and its tree out (or the reasons). */
export function sanitizeMascotSvg(raw: unknown): MascotSvgResult {
  return parseSafeSvgElements(raw)
}

const mascotSvgCache = new Map<string, MascotSvgNode[]>()
const MASCOT_SVG_CACHE_MAX = 16

/**
 * The tree to draw for a stored costume, re-validated here so a renderer can never be handed raw markup: anything
 * that does not pass comes back as an empty list. Remembers the last few costumes so drawing Bun stays cheap.
 */
export function mascotSvgNodes(svg: string | null | undefined): MascotSvgNode[] {
  if (!svg) return []
  const hit = mascotSvgCache.get(svg)
  if (hit) return hit
  const parsed = parseSafeSvgElements(svg)
  const nodes = parsed.ok ? parsed.nodes : []
  if (mascotSvgCache.size >= MASCOT_SVG_CACHE_MAX) mascotSvgCache.clear()
  mascotSvgCache.set(svg, nodes)
  return nodes
}

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
 * A short printable label: letters, digits, punctuation, symbols and single spaces, with at least one letter or
 * digit. Control and invisible characters, direction overrides and stacked marks are refused, so a label cannot
 * hide text or reorder what the screen shows.
 */
function validatePrintableLabel(raw: unknown, max: number, what: string): AppNameResult {
  if (typeof raw !== 'string') return { ok: false, issue: `${what} must be text.` }
  const name = raw.normalize('NFC').replace(/[\t\n\r ]+/g, ' ').trim()
  if (!name) return { ok: false, issue: `${what} cannot be empty.` }
  if ([...name].length > max) return { ok: false, issue: `${what} can be at most ${max} characters.` }
  if (!NAME_ALLOWED_RE.test(name) || NAME_MARK_RUN_RE.test(name)) return { ok: false, issue: `${what} can only use printable letters, digits, symbols and spaces.` }
  if (!NAME_NEEDS_RE.test(name)) return { ok: false, issue: `${what} needs at least one letter or digit.` }
  return { ok: true, name }
}

/** An app name is at most 28 printable characters (see validatePrintableLabel for what "printable" means here). */
export function validateAppName(raw: unknown): AppNameResult {
  return validatePrintableLabel(raw, APP_NAME_MAX, 'The app name')
}

/** The friendly name of a custom palette: at most 32 printable characters. */
export function validateThemeLabel(raw: unknown): AppNameResult {
  return validatePrintableLabel(raw, THEME_LABEL_MAX, 'The theme label')
}

/** The name of a custom costume: at most 40 printable characters. */
export function validateMascotLabel(raw: unknown): AppNameResult {
  return validatePrintableLabel(raw, MASCOT_LABEL_MAX, 'The costume label')
}

function oneOf<T extends string>(list: readonly T[]): (value: unknown) => value is T {
  return (value): value is T => typeof value === 'string' && (list as readonly string[]).includes(value)
}

const isThemeId = oneOf(SHELL_THEME_IDS)
const isMascotHat = oneOf(MASCOT_HATS)
const isFontStyle = oneOf(SHELL_FONT_STYLES)
const isFontScale = oneOf(SHELL_FONT_SCALES)
const isRadius = oneOf(SHELL_RADII)
const isDensity = oneOf(SHELL_DENSITIES)

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

const PATCH_KEYS = new Set(['reset', 'theme', 'tokens', 'themeLabel', 'mascotHat', 'mascotSvg', 'mascotLabel', 'appName', 'fontStyle', 'fontScale', 'radius', 'density'])

/**
 * Validates an untrusted patch (from a model, a stored chat card, or storage) against the spec. Unknown keys,
 * unknown themes or hats, non-hex colours, tokens off the allow-list, unreadable colour pairs, SVG outside the
 * shape allow-list and names outside the bounds are all refused: the result is either a clean patch or the list
 * of reasons. A custom costume comes back in its canonical, sanitized form.
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
    else issues.push(`Unknown headwear. Choose one of: ${MASCOT_HATS.join(', ')}, or draw a custom costume with mascotSvg.`)
  }
  if (input.mascotSvg !== undefined) {
    if (input.mascotSvg === null || input.mascotSvg === '') patch.mascotSvg = null
    else {
      const drawn = sanitizeMascotSvg(input.mascotSvg)
      if (drawn.ok) patch.mascotSvg = drawn.svg
      else issues.push(...drawn.issues)
    }
  }
  if (input.mascotLabel !== undefined) {
    const label = validateMascotLabel(input.mascotLabel)
    if (!label.ok) issues.push(label.issue)
    else if (typeof input.mascotSvg !== 'string' || !input.mascotSvg) issues.push('mascotLabel names a custom costume, so it needs mascotSvg in the same patch.')
    else if (typeof patch.mascotSvg === 'string') patch.mascotLabel = label.name
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
  if (input.themeLabel !== undefined) {
    if (input.themeLabel === null) patch.themeLabel = null
    else {
      const label = validateThemeLabel(input.themeLabel)
      if (!label.ok) issues.push(label.issue)
      else if (input.tokens === undefined) issues.push('themeLabel names a custom palette, so it needs tokens in the same patch.')
      else if (patch.tokens) patch.themeLabel = label.name
    }
  }
  if (input.fontStyle !== undefined) {
    if (isFontStyle(input.fontStyle)) patch.fontStyle = input.fontStyle
    else issues.push(`Unknown fontStyle. Choose one of: ${SHELL_FONT_STYLES.join(', ')}.`)
  }
  if (input.fontScale !== undefined) {
    if (isFontScale(input.fontScale)) patch.fontScale = input.fontScale
    else issues.push(`Unknown fontScale. Choose one of: ${SHELL_FONT_SCALES.join(', ')}.`)
  }
  if (input.radius !== undefined) {
    if (isRadius(input.radius)) patch.radius = input.radius
    else issues.push(`Unknown radius. Choose one of: ${SHELL_RADII.join(', ')}.`)
  }
  if (input.density !== undefined) {
    if (isDensity(input.density)) patch.density = input.density
    else issues.push(`Unknown density. Choose one of: ${SHELL_DENSITIES.join(', ')}.`)
  }
  if (issues.length) return { ok: false, issues }
  if (!Object.keys(patch).length) {
    return { ok: false, issues: ['The patch changes nothing: give a theme, tokens, mascotHat, mascotSvg, appName, fontStyle, fontScale, radius, density or reset.'] }
  }
  return { ok: true, patch }
}

/** Sets an optional field only when it differs from FundBun's own value, so a default look carries no extra keys. */
function setOrDrop<K extends 'fontStyle' | 'fontScale' | 'radius' | 'density'>(look: ShellAppearance, key: K, value: ShellAppearance[K] | undefined): void {
  if (value === undefined || value === 'default') delete look[key]
  else look[key] = value
}

/**
 * The look after a patch. A new theme drops earlier token overrides (and their name) unless the patch brings its
 * own. A built-in item sent alone takes a custom costume off, and a custom costume sent alone takes the built-in
 * item off: sent together, Bun wears both.
 */
export function applyShellAppearancePatch(current: ShellAppearance, patch: ShellAppearancePatch): ShellAppearance {
  const next: ShellAppearance = patch.reset ? { ...DEFAULT_SHELL_APPEARANCE, tokens: {} } : { ...current, tokens: { ...current.tokens } }
  if (patch.theme !== undefined) {
    next.theme = patch.theme
    next.tokens = {}
    delete next.themeLabel
  }
  if (patch.tokens !== undefined) next.tokens = { ...next.tokens, ...patch.tokens }
  if (patch.themeLabel !== undefined) {
    if (patch.themeLabel === null) delete next.themeLabel
    else next.themeLabel = patch.themeLabel
  }
  if (!Object.keys(next.tokens).length) delete next.themeLabel

  if (patch.mascotHat !== undefined) {
    next.mascotHat = patch.mascotHat
    if (patch.mascotSvg === undefined) {
      delete next.mascotSvg
      delete next.mascotLabel
    }
  }
  if (patch.mascotSvg !== undefined) {
    delete next.mascotLabel
    if (patch.mascotSvg === null) delete next.mascotSvg
    else {
      next.mascotSvg = patch.mascotSvg
      if (patch.mascotLabel !== undefined) next.mascotLabel = patch.mascotLabel
      if (patch.mascotHat === undefined) next.mascotHat = 'none'
    }
  }
  if (patch.appName !== undefined) next.appName = patch.appName
  if (patch.fontStyle !== undefined) setOrDrop(next, 'fontStyle', patch.fontStyle)
  if (patch.fontScale !== undefined) setOrDrop(next, 'fontScale', patch.fontScale)
  if (patch.radius !== undefined) setOrDrop(next, 'radius', patch.radius)
  if (patch.density !== undefined) setOrDrop(next, 'density', patch.density)
  return next
}

export function sameShellAppearance(a: ShellAppearance, b: ShellAppearance): boolean {
  const ka = Object.keys(a.tokens).sort()
  const kb = Object.keys(b.tokens).sort()
  return (
    a.theme === b.theme &&
    a.mascotHat === b.mascotHat &&
    a.appName === b.appName &&
    (a.themeLabel ?? null) === (b.themeLabel ?? null) &&
    (a.mascotSvg ?? null) === (b.mascotSvg ?? null) &&
    (a.mascotLabel ?? null) === (b.mascotLabel ?? null) &&
    (a.fontStyle ?? 'default') === (b.fontStyle ?? 'default') &&
    (a.fontScale ?? 'default') === (b.fontScale ?? 'default') &&
    (a.radius ?? 'default') === (b.radius ?? 'default') &&
    (a.density ?? 'default') === (b.density ?? 'default') &&
    ka.length === kb.length &&
    ka.every((k, i) => k === kb[i] && isTokenName(k) && a.tokens[k] === b.tokens[k])
  )
}

export function isDefaultShellAppearance(a: ShellAppearance): boolean {
  return sameShellAppearance(a, DEFAULT_SHELL_APPEARANCE)
}

/**
 * Reads a stored look back (browser storage is untrusted: it may be old, edited or corrupt). Anything outside the
 * spec falls back to FundBun's own look for that field: a stored costume is parsed and rebuilt by the same
 * sanitizer a new one goes through.
 */
export function sanitizeShellAppearance(raw: unknown): ShellAppearance {
  if (!isRecord(raw)) return DEFAULT_SHELL_APPEARANCE
  const theme = isThemeId(raw.theme) ? raw.theme : 'system'
  const issues: string[] = []
  const read = raw.tokens === undefined ? {} : (validateTokens(raw.tokens, issues) ?? {})
  const tokens = issues.length || legibilityIssues(theme, read).length ? {} : read
  const name = raw.appName === null || raw.appName === undefined ? null : validateAppName(raw.appName)
  const look: ShellAppearance = {
    theme,
    tokens,
    mascotHat: isMascotHat(raw.mascotHat) ? raw.mascotHat : 'none',
    appName: name && name.ok && name.name.toLowerCase() !== DEFAULT_APP_NAME.toLowerCase() ? name.name : null,
  }
  if (Object.keys(tokens).length && typeof raw.themeLabel === 'string') {
    const label = validateThemeLabel(raw.themeLabel)
    if (label.ok) look.themeLabel = label.name
  }
  if (typeof raw.mascotSvg === 'string' && raw.mascotSvg) {
    const drawn = sanitizeMascotSvg(raw.mascotSvg)
    if (drawn.ok) {
      look.mascotSvg = drawn.svg
      const label = raw.mascotLabel === undefined ? null : validateMascotLabel(raw.mascotLabel)
      if (label && label.ok) look.mascotLabel = label.name
    }
  }
  if (isFontStyle(raw.fontStyle)) setOrDrop(look, 'fontStyle', raw.fontStyle)
  if (isFontScale(raw.fontScale)) setOrDrop(look, 'fontScale', raw.fontScale)
  if (isRadius(raw.radius)) setOrDrop(look, 'radius', raw.radius)
  if (isDensity(raw.density)) setOrDrop(look, 'density', raw.density)
  return look
}

/** The colour tokens a look sets on the page: the preset's, then the user's overrides. */
export function resolvedShellTokens(a: ShellAppearance): ShellTokenOverrides {
  return { ...SHELL_THEMES[a.theme].tokens, ...a.tokens }
}

export interface ShellChangeLine {
  kind: 'reset' | 'theme' | 'tokens' | 'mascot' | 'name' | 'font' | 'scale' | 'radius' | 'density'
  label: string
  value: string
}

function coloursLine(count: number, label: string | null | undefined): ShellChangeLine {
  const n = `${count} custom colour${count === 1 ? '' : 's'}`
  return { kind: 'tokens', label: 'Colours', value: label ? `${label} (${n})` : n }
}

/** What Bun is wearing, in words: the built-in item, the custom costume, or both. */
export function describeMascotWear(hat: MascotHat, svg: string | null | undefined, label: string | null | undefined): string {
  if (!svg) return MASCOT_HAT_LABELS[hat]
  const custom = label || CUSTOM_COSTUME_LABEL
  return hat === 'none' ? custom : `${MASCOT_HAT_LABELS[hat]} and ${custom}`
}

/** What a patch changes, one line per part, for the chat card, the trace and the audit entry. */
export function describeShellAppearancePatch(patch: ShellAppearancePatch): ShellChangeLine[] {
  const lines: ShellChangeLine[] = []
  if (patch.reset) lines.push({ kind: 'reset', label: 'Reset', value: "Back to FundBun's own look" })
  if (patch.theme !== undefined) lines.push({ kind: 'theme', label: 'Theme', value: SHELL_THEMES[patch.theme].label })
  if (patch.tokens && Object.keys(patch.tokens).length) lines.push(coloursLine(Object.keys(patch.tokens).length, patch.themeLabel))
  if (typeof patch.mascotSvg === 'string') lines.push({ kind: 'mascot', label: 'Bun wears', value: describeMascotWear(patch.mascotHat ?? 'none', patch.mascotSvg, patch.mascotLabel) })
  else if (patch.mascotHat !== undefined) lines.push({ kind: 'mascot', label: 'Bun wears', value: MASCOT_HAT_LABELS[patch.mascotHat] })
  else if (patch.mascotSvg === null) lines.push({ kind: 'mascot', label: 'Bun wears', value: 'No custom costume' })
  if (patch.appName !== undefined) lines.push({ kind: 'name', label: 'App name', value: patch.appName ?? DEFAULT_APP_NAME })
  if (patch.fontStyle !== undefined) lines.push({ kind: 'font', label: 'Typeface', value: SHELL_FONT_STYLE_LABELS[patch.fontStyle] })
  if (patch.fontScale !== undefined) lines.push({ kind: 'scale', label: 'Text size', value: SHELL_FONT_SCALE_LABELS[patch.fontScale] })
  if (patch.radius !== undefined) lines.push({ kind: 'radius', label: 'Corners', value: SHELL_RADIUS_LABELS[patch.radius] })
  if (patch.density !== undefined) lines.push({ kind: 'density', label: 'Spacing', value: SHELL_DENSITY_LABELS[patch.density] })
  return lines
}

/** The customizations that are active right now (empty when the shell wears FundBun's own look). */
export function describeShellAppearance(a: ShellAppearance): ShellChangeLine[] {
  const lines: ShellChangeLine[] = []
  if (a.theme !== 'system') lines.push({ kind: 'theme', label: 'Theme', value: SHELL_THEMES[a.theme].label })
  if (Object.keys(a.tokens).length) lines.push(coloursLine(Object.keys(a.tokens).length, a.themeLabel))
  if (a.mascotHat !== 'none' || a.mascotSvg) lines.push({ kind: 'mascot', label: 'Bun wears', value: describeMascotWear(a.mascotHat, a.mascotSvg, a.mascotLabel) })
  if (a.appName !== null) lines.push({ kind: 'name', label: 'App name', value: a.appName })
  if (a.fontStyle && a.fontStyle !== 'default') lines.push({ kind: 'font', label: 'Typeface', value: SHELL_FONT_STYLE_LABELS[a.fontStyle] })
  if (a.fontScale && a.fontScale !== 'default') lines.push({ kind: 'scale', label: 'Text size', value: SHELL_FONT_SCALE_LABELS[a.fontScale] })
  if (a.radius && a.radius !== 'default') lines.push({ kind: 'radius', label: 'Corners', value: SHELL_RADIUS_LABELS[a.radius] })
  if (a.density && a.density !== 'default') lines.push({ kind: 'density', label: 'Spacing', value: SHELL_DENSITY_LABELS[a.density] })
  return lines
}

/** The name a look's colours go by: the custom palette's label, or the preset's. */
export function shellThemeName(a: ShellAppearance): string {
  return (Object.keys(a.tokens).length && a.themeLabel) || SHELL_THEMES[a.theme].label
}

// ───────────────────────────── offline palette synthesis (deterministic, no model) ─────────────────────────────
//
// "make it matcha", "lavender theme", "retro look", "theme colour #7c3aed": a colour word (or a hex) becomes a
// full 15 token palette on this device. Every palette is built from a hue and a few numbers, and each text and
// accent colour is walked lighter or darker until it clears the WCAG contrast the legibility rule asks for.

export interface ShellVibeSeed {
  label: string
  /** which of the app's own themes the palette sits on unless the request says light or dark */
  base: 'light' | 'dark'
  /** hue (0 to 360) and colourfulness (0 to 1) of the page, cards and text */
  hue: number
  sat: number
  accentHue?: number
  accentSat?: number
  /** lightness of the accent (0 to 1); the default depends on the base */
  accentLight?: number
  /** dark base only: lightness and colourfulness of body text (a phosphor green terminal, say) */
  textLight?: number
  textSat?: number
  /** light base only: how deep the page colour is (0 is near white, 1 is a strong tint) */
  depth?: number
}

function seed(label: string, base: 'light' | 'dark', hue: number, sat: number, accentHue = hue, accentSat = Math.max(sat, 0.5), accentLight?: number, extra: Partial<ShellVibeSeed> = {}): ShellVibeSeed {
  return { label, base, hue, sat, accentHue, accentSat, ...(accentLight === undefined ? {} : { accentLight }), ...extra }
}

/** Colour words the offline synthesizer knows. Several words may share one palette (gray, grey, grayscale). */
export const SHELL_VIBES: Record<string, ShellVibeSeed> = {
  matcha: seed('Matcha', 'light', 95, 0.4, 100, 0.45, 0.36),
  mint: seed('Mint', 'light', 158, 0.45, 160, 0.6, 0.36),
  sage: seed('Sage', 'light', 110, 0.18, 115, 0.25, 0.38),
  green: seed('Green', 'light', 135, 0.45, 135, 0.55, 0.36),
  emerald: seed('Emerald', 'dark', 152, 0.5, 152, 0.65, 0.55),
  olive: seed('Olive', 'light', 70, 0.3, 70, 0.45, 0.34),
  lime: seed('Lime', 'dark', 85, 0.5, 85, 0.8, 0.6),
  teal: seed('Teal', 'dark', 178, 0.5, 175, 0.6, 0.52),
  turquoise: seed('Turquoise', 'light', 175, 0.45, 175, 0.65, 0.36),
  aqua: seed('Aqua', 'dark', 188, 0.55, 188, 0.8, 0.6),
  cyan: seed('Cyan', 'dark', 188, 0.55, 188, 0.8, 0.6),
  sky: seed('Sky', 'light', 205, 0.55, 205, 0.75, 0.45),
  blue: seed('Blue', 'light', 215, 0.5, 215, 0.75, 0.5),
  cobalt: seed('Cobalt', 'dark', 220, 0.6, 218, 0.85, 0.64),
  navy: seed('Navy', 'dark', 225, 0.55, 215, 0.7, 0.68),
  indigo: seed('Indigo', 'dark', 242, 0.5, 242, 0.8, 0.74),
  lavender: seed('Lavender', 'light', 265, 0.45, 265, 0.55, 0.55),
  lilac: seed('Lilac', 'light', 285, 0.4, 285, 0.45, 0.55),
  purple: seed('Purple', 'dark', 272, 0.5, 272, 0.8, 0.72),
  violet: seed('Violet', 'dark', 258, 0.55, 258, 0.85, 0.74),
  plum: seed('Plum', 'dark', 305, 0.4, 305, 0.5, 0.66),
  magenta: seed('Magenta', 'dark', 318, 0.55, 318, 0.85, 0.62),
  pink: seed('Pink', 'light', 335, 0.55, 335, 0.75, 0.55),
  rose: seed('Rose', 'light', 345, 0.5, 345, 0.65, 0.5),
  blush: seed('Blush', 'light', 352, 0.4, 352, 0.6, 0.64),
  crimson: seed('Crimson', 'dark', 348, 0.55, 348, 0.8, 0.6),
  ruby: seed('Ruby', 'dark', 338, 0.55, 338, 0.8, 0.58),
  red: seed('Red', 'dark', 4, 0.55, 4, 0.8, 0.62),
  maroon: seed('Maroon', 'dark', 345, 0.45, 345, 0.55, 0.62),
  burgundy: seed('Burgundy', 'dark', 345, 0.45, 345, 0.55, 0.62),
  wine: seed('Wine', 'dark', 340, 0.45, 340, 0.55, 0.62),
  coral: seed('Coral', 'light', 12, 0.6, 12, 0.8, 0.6),
  peach: seed('Peach', 'light', 24, 0.65, 20, 0.85, 0.62),
  sunset: seed('Sunset', 'dark', 268, 0.4, 22, 0.9, 0.6),
  orange: seed('Orange', 'light', 28, 0.6, 28, 0.9, 0.52),
  yellow: seed('Yellow', 'light', 48, 0.6, 46, 0.9, 0.5),
  mustard: seed('Mustard', 'light', 44, 0.5, 42, 0.75, 0.45),
  gold: seed('Gold', 'dark', 42, 0.35, 44, 0.85, 0.55),
  luxury: seed('Luxury', 'dark', 42, 0.12, 44, 0.7, 0.58),
  espresso: seed('Espresso', 'dark', 24, 0.4, 30, 0.55, 0.62),
  coffee: seed('Coffee', 'dark', 26, 0.35, 32, 0.6, 0.6),
  mocha: seed('Mocha', 'dark', 18, 0.3, 24, 0.5, 0.62),
  chocolate: seed('Chocolate', 'dark', 20, 0.4, 26, 0.6, 0.6),
  brown: seed('Brown', 'dark', 22, 0.4, 28, 0.6, 0.6),
  latte: seed('Latte', 'light', 32, 0.45, 28, 0.5, 0.38),
  beige: seed('Beige', 'light', 40, 0.35, 35, 0.45, 0.38),
  cream: seed('Cream', 'light', 44, 0.45, 36, 0.5, 0.4),
  sand: seed('Sand', 'light', 38, 0.35, 32, 0.45, 0.4),
  charcoal: seed('Charcoal', 'dark', 215, 0.1, 210, 0.3, 0.72),
  slate: seed('Slate', 'dark', 215, 0.2, 210, 0.45, 0.7),
  graphite: seed('Graphite', 'dark', 220, 0.06, 215, 0.25, 0.72),
  retro: seed('Retro terminal', 'dark', 135, 0.7, 135, 1, 0.5, { textLight: 0.62, textSat: 0.95 }),
  matrix: seed('Matrix', 'dark', 135, 0.7, 135, 1, 0.5, { textLight: 0.62, textSat: 0.95 }),
  terminal: seed('Terminal', 'dark', 135, 0.7, 135, 1, 0.5, { textLight: 0.62, textSat: 0.95 }),
  gameboy: seed('Game Boy', 'light', 75, 0.55, 100, 0.6, 0.22, { depth: 0.8 }),
  pastel: seed('Pastel', 'light', 300, 0.5, 340, 0.7, 0.72, { depth: 0.12 }),
  mono: seed('Monochrome', 'light', 0, 0, 0, 0, 0.12),
  monochrome: seed('Monochrome', 'light', 0, 0, 0, 0, 0.12),
  grayscale: seed('Grayscale', 'light', 0, 0, 0, 0, 0.12),
  greyscale: seed('Greyscale', 'light', 0, 0, 0, 0, 0.12),
  gray: seed('Gray', 'light', 0, 0, 0, 0, 0.3),
  grey: seed('Grey', 'light', 0, 0, 0, 0, 0.3),
}

/** The colour words, longest first, as a regex alternation. */
const VIBE_WORDS = Object.keys(SHELL_VIBES)
  .sort((a, b) => b.length - a.length)
  .join('|')

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** Hue (degrees), saturation and lightness (0 to 1) to #rrggbb. */
export function hslToHex(h: number, s: number, l: number): string {
  const hue = (((h % 360) + 360) % 360) / 30
  const sat = clamp01(s)
  const light = clamp01(l)
  const a = sat * Math.min(light, 1 - light)
  const channel = (n: number) => {
    const k = (n + hue) % 12
    return Math.round((light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const raw = hex.slice(1)
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw.slice(0, 6)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (!d) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

/** Walks a colour lighter (step above 0) or darker until it clears `min` contrast on every ground. */
function fitContrast(hue: number, sat: number, start: number, step: number, grounds: readonly string[], min: number): string {
  for (let l = start; l >= 0 && l <= 1; l += step) {
    const hex = hslToHex(hue, sat, l)
    if (grounds.every((g) => contrastRatio(hex, g) >= min)) return hex
  }
  return step < 0 ? '#000000' : '#ffffff'
}

const ON_ACCENT_TARGET = 4.5

/**
 * A full palette from a seed: page, cards, borders, three text levels and the accent family. Body text clears
 * 7:1, secondary and hint text 4.5:1 on every ground, coloured text 4.5:1, and the label on an accent button
 * 4.5:1 (the rule itself asks for 3:1).
 */
export function synthesizeShellPalette(vibe: ShellVibeSeed, base: 'light' | 'dark' = vibe.base, accentHex?: string): ShellTokenOverrides {
  const light = base === 'light'
  const h = vibe.hue
  const s = vibe.sat
  const ah = vibe.accentHue ?? h
  const as = vibe.accentSat ?? Math.max(s, 0.5)
  const depth = light ? (vibe.depth ?? 0) : 0
  const bg = light ? hslToHex(h, s * 0.6, 0.965 - depth * 0.2) : hslToHex(h, s * 0.5, 0.075)
  const sunken = light ? hslToHex(h, s * 0.6, 0.935 - depth * 0.22) : hslToHex(h, s * 0.5, 0.05)
  const surface = light ? hslToHex(h, s * 0.4, 0.995 - depth * 0.14) : hslToHex(h, s * 0.45, 0.12)
  const surface2 = light ? hslToHex(h, s * 0.65, 0.885 - depth * 0.2) : hslToHex(h, s * 0.45, 0.18)
  const grounds = [bg, sunken, surface, surface2]
  const step = light ? -0.01 : 0.01
  const textSat = light ? Math.min(0.5, s * 0.8) : (vibe.textSat ?? Math.min(0.5, s * 0.5))
  const textLight = light ? 0.13 : (vibe.textLight ?? 0.93)
  const text = fitContrast(h, textSat, textLight, step, grounds, 7)
  const text2 = fitContrast(h, textSat * 0.8, light ? 0.29 : textLight - 0.15, step, grounds, MIN_TEXT_CONTRAST)
  const text3 = fitContrast(h, textSat * 0.6, light ? 0.4 : textLight - 0.31, step, grounds, MIN_TEXT_CONTRAST)

  // the accent keeps its hue; its lightness moves until the better of a dark or a white label reads on it
  const dark = light ? text : sunken
  let accentLight = vibe.accentLight ?? (light ? 0.5 : 0.66)
  let accent = accentHex ?? hslToHex(ah, as, accentLight)
  let onAccent = contrastRatio(dark, accent) >= contrastRatio('#ffffff', accent) ? dark : '#ffffff'
  for (let i = 0; !accentHex && i < 40 && contrastRatio(onAccent, accent) < ON_ACCENT_TARGET; i++) {
    accentLight = clamp01(accentLight + (onAccent === dark ? 0.01 : -0.01))
    accent = hslToHex(ah, as, accentLight)
  }
  if (accentHex) accentLight = hexToHsl(accentHex).l
  if (contrastRatio(dark, accent) > contrastRatio(onAccent, accent)) onAccent = dark
  const accentStrong = hslToHex(ah, as, clamp01(accentLight - 0.07))
  const accentText = fitContrast(ah, Math.min(as, 0.8), light ? 0.34 : 0.72, step, grounds, MIN_TEXT_CONTRAST)

  return {
    '--bg': bg,
    '--bg-sunken': sunken,
    '--surface': surface,
    '--surface-2': surface2,
    '--surface-glass': `${light ? bg : surface}${light ? 'c7' : 'cc'}`,
    '--border': `${text}1f`,
    '--border-strong': `${text}3d`,
    '--text': text,
    '--text-2': text2,
    '--text-3': text3,
    '--accent': accent,
    '--accent-strong': accentStrong,
    '--accent-soft': `${accent}29`,
    '--accent-text': accentText,
    '--text-on-accent': onAccent,
  }
}

export interface SynthesizedShellTheme {
  theme: 'light' | 'dark'
  tokens: ShellTokenOverrides
  themeLabel: string
}

/** The palette for a colour word ("matcha", "lavender", "retro"), optionally forced light or dark. Null for a word it does not know. */
export function synthesizeShellTheme(word: string, mode?: 'light' | 'dark'): SynthesizedShellTheme | null {
  const key = word.toLowerCase().trim()
  if (!Object.prototype.hasOwnProperty.call(SHELL_VIBES, key)) return null
  const vibe = SHELL_VIBES[key]
  const base = mode ?? vibe.base
  return { theme: base, tokens: synthesizeShellPalette(vibe, base), themeLabel: base === vibe.base ? vibe.label : `${vibe.label} ${base}` }
}

/** A palette built around one colour the user typed as hex: that exact colour is the accent. */
export function synthesizeShellThemeFromHex(hex: string, mode?: 'light' | 'dark'): SynthesizedShellTheme | null {
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return null
  const raw = hex.toLowerCase()
  const accent = raw.length === 4 ? `#${[...raw.slice(1)].map((c) => c + c).join('')}` : raw
  const { h, s } = hexToHsl(accent)
  const base = mode ?? 'dark'
  const vibe: ShellVibeSeed = { label: `Custom ${accent}`, base, hue: h, sat: Math.min(0.5, s * 0.6), accentHue: h, accentSat: s }
  return { theme: base, tokens: synthesizeShellPalette(vibe, base, accent), themeLabel: vibe.label }
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
const PRESET_THEME = 'high[\\s-]?contrast|cyber[\\s-]?punk|neon|midnight|sakura|cherry[\\s-]?blossom|forest|ocean|amber|contrast|dark|night|light|day'
/** presets and the colour words the synthesizer knows */
const NAMED_THEME = `${PRESET_THEME}|${VIBE_WORDS}`
// "default", "auto" and the like only count right after the word "theme": "auto mode" is about autonomy, not colours
const THEME_WORD = `${NAMED_THEME}|system|default|auto(?:matic)?|normal|original`
const THEME_NOUN = '(?:colou?r\\s+)?(?:theme|tema|skin)'

const THEME_SET_RES: readonly RegExp[] = [
  // "change the theme to midnight", "switch theme to cyberpunk", "set theme: sakura", "theme = dark"
  new RegExp(`\\b${THEME_NOUN}\\b(?:\\s+of\\s+(?:the\\s+)?(?:app|fundbun))?\\s*(?:to|into|as|ke|jadi|menjadi|=|:)?\\s*(?:the\\s+|a\\s+)?(${THEME_WORD})\\b`),
  // "switch to high contrast", "change into midnight", "turn on dark", "go cyberpunk"
  new RegExp(`\\b(?:switch|change|turn|go)\\s+(?:(?:to|into|on)\\s+)?(?:the\\s+|a\\s+)?(${NAMED_THEME})\\b`),
  // "use the midnight theme", "dark mode", "go cyberpunk mode", "a matcha look"
  new RegExp(`\\b(${NAMED_THEME})\\s+(?:${THEME_NOUN}|mode|look)\\b`),
  // "make it cyberpunk", "make the app look midnight", "make it matcha"
  new RegExp(`\\bmake\\s+(?:it|the\\s+app|fundbun|the\\s+ui|everything)\\s+(?:look\\s+)?(?:like\\s+)?(${NAMED_THEME})\\b`),
  // "lavender vibes", "a retro palette", "espresso colours"
  new RegExp(`\\b(${VIBE_WORDS})\\s+(?:vibes?|palette|aesthetic|colou?rs?|colou?r\\s+scheme)\\b`),
]
/** "dark matcha", "lavender light": a colour word with the base it should sit on */
const MODE_VIBE_RE = new RegExp(`\\b(?:(dark|light|night|day|bright)\\s+(${VIBE_WORDS})|(${VIBE_WORDS})\\s+(dark|light))\\b`)
const HEX_COLOUR = '#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])'
/** "theme colour #7c3aed", "accent #0af", "#ff6600 theme" */
const HEX_THEME_RE = new RegExp(`\\b(?:${THEME_NOUN}|accent|palette|colou?rs?)\\b[^.;#]{0,24}(${HEX_COLOUR})|(${HEX_COLOUR})\\s+(?:${THEME_NOUN}|accent|palette)\\b`)
const THEME_RESET_RE = new RegExp(`\\b(?:reset|restore|revert|undo|remove|clear)\\b[^.,;]{0,24}\\b${THEME_NOUN}\\b|\\b${THEME_NOUN}\\b[^.,;]{0,16}\\bback\\b`)
const THEME_UNKNOWN_RE = new RegExp(`\\b${THEME_NOUN}\\s+(?:to|into|as|ke|jadi|menjadi)\\s+(?:the\\s+|a\\s+)?([a-z][a-z-]{1,20})\\b`)

const RESET_ALL_RE =
  /\b(?:reset|restore|revert|undo|clear|remove)\b[^.,;]{0,40}\b(?:shell\s+appearance|appearance|shell\s+look|customi[sz]ations?|shell\s+plugins?)\b|\b(?:reset|restore)\s+(?:the\s+|fundbun'?s\s+|bun'?s\s+|app'?s\s+)?(?:look|shell)\b|\bback\s+to\s+(?:the\s+)?(?:default|original|normal|fundbun)\s+(?:look|appearance)\b/

const WEARER = '(?:bun|the\\s+bun|the\\s+mascot|mascot|bao)'
const HEADWEAR = '(?:helmet|helm|hat|crown|cap|halo|costume|headwear|mask|headgear|sunglasses|shades|glasses|headphones|headset|ears|outfit|accessor(?:y|ies))'
const HAT_OFF_RE = new RegExp(
  `\\b(?:remove|take\\s+off|lose|drop|ditch|no\\s+more|without|reset|lepas(?:kan)?)\\b[^.,;]{0,40}\\b${HEADWEAR}\\b|\\btake\\b[^.,;]{0,30}\\b${HEADWEAR}\\s+off\\b|\\b${HEADWEAR}\\s+off\\b`,
)
const HAT_OFF_CONTEXT_RE = /\b(?:helmet|helm|costume|headwear|headgear|sunglasses|shades|headphones|outfit)\b/
const WEAR_VERB = '(?:put|give|wear|wears|wearing|add|dress|equip|pakai|pakaikan|kasih)'
const KAMEN_RE = /\b(?:kamen\s*rider|masked\s+rider|rider\s+(?:helmet|helm|mask))\b/
const HAT_CONTEXT_RE = new RegExp(`\\b${WEARER}\\b|\\b${WEAR_VERB}\\b`)
// "cap" also means a spending cap here, so it needs both a wearer and a wearing verb
const CAP_RE = new RegExp(`\\b${WEAR_VERB}\\b[^.,;]{0,30}\\b(?:baseball\\s+)?cap\\b[^.,;]{0,20}\\b${WEARER}\\b|\\b${WEAR_VERB}\\s+${WEARER}\\b[^.,;]{0,12}\\b(?:baseball\\s+)?cap\\b|\\b${WEARER}\\b[^.,;]{0,24}\\b(?:wear|wears|wearing)\\b[^.,;]{0,12}\\b(?:baseball\\s+)?cap\\b`)
/** Built-in items read by a word of their own, once the sentence is about Bun or about wearing something. */
const HAT_WORD_RES: readonly (readonly [RegExp, MascotHat])[] = [
  [/\bcrown\b/, 'crown'],
  [/\bhalo\b/, 'halo'],
  [/\b(?:wizard|witch|sorcerer|mage)(?:'s)?\b/, 'wizard'],
  [/\b(?:sunglasses|sunnies|shades)\b/, 'sunglasses'],
  [/\bheadphones\b|\bearphones\b|(?<!\bvr\s)\bheadset\b/, 'headphones'],
  [/\b(?:cat|kitty|kitten|neko)\s+ears?\b/, 'cat_ears'],
  [/\bchef(?:'s)?\b|\btoque\b/, 'chef'],
]
/** Things one could put on a mascot. With a wearer in the sentence, an item outside the wardrobe is a costume request. */
const COSTUME_NOUN =
  '(?:helmet|helm|hat|crown|cap|halo|costume|headwear|mask|headgear|outfit|glasses|sunglasses|shades|goggles|monocle|eyepatch|headphones|headset|ears|horns|antlers|wig|bow|bowtie|tie|ribbon|scarf|cape|cloak|wings|tiara|beanie|beret|hood|veil|visor|armou?r|mustache|moustache|beard|necklace|accessor(?:y|ies)|prop)'
const COSTUME_ASK_RE = new RegExp(
  `\\b${WEAR_VERB}\\b[^.;]{0,60}\\b${COSTUME_NOUN}\\b[^.;]{0,30}\\b${WEARER}\\b|\\b${WEAR_VERB}\\s+${WEARER}\\b[^.;]{0,60}\\b${COSTUME_NOUN}\\b|\\b${WEARER}\\b[^.;]{0,30}\\b(?:wear|wears|wearing|in)\\b[^.;]{0,40}\\b${COSTUME_NOUN}\\b|\\b(?:dress|turn|make)\\s+(?:up\\s+)?${WEARER}\\s+(?:up\\s+)?(?:as|like|into|look\\s+like)\\s+an?\\s+[a-z]`,
)

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

// ergonomics: text size, typeface, corners and spacing
const TEXT_NOUN = '(?:text|texts|font|fonts|letters|lettering|typography)'
const BACK_WORD = '(?:reset|restore|revert|default|normal|regular|standard|original)'
const GAP = '(?:\\s+[a-z\']+){0,2}\\s+'
const LINK = '(?:\\s+(?:size|to|a|bit|little|much|way|be|is|are|looks?|more|so))*\\s+'
const SHELL_TARGET = '(?:it|the\\s+app|everything|the\\s+ui|fundbun|the\\s+layout)'
const TEXT_SIZE_RESET_RE = new RegExp(`\\b${BACK_WORD}\\b${GAP}(?:text|font)\\s+size\\b|\\b(?:text|font)\\s+size\\b[^.,;]{0,12}\\b(?:back|normal|default|standard)\\b`)
const FONT_RESET_RE = new RegExp(`\\b${BACK_WORD}\\b${GAP}(?:font|fonts|typeface|typography)\\b(?!\\s+size)|\\bsans[\\s-]?serif\\b`)
const CORNER_RESET_RE = new RegExp(`\\b${BACK_WORD}\\b${GAP}(?:corners?|edges|radius|rounding)\\b`)
const LAYOUT_RESET_RE = new RegExp(`\\b${BACK_WORD}\\b${GAP}(?:layout|spacing|density|padding)\\b`)
const TEXT_TOO_SMALL_RE = new RegExp(`\\b${TEXT_NOUN}\\b(?:\\s+size)?(?:\\s+(?:is|are|looks?|seems?|feels?))?\\s+(?:too|so|very)\\s+(?:small|tiny|little)\\b`)
const TEXT_TOO_BIG_RE = new RegExp(`\\b${TEXT_NOUN}\\b(?:\\s+size)?(?:\\s+(?:is|are|looks?|seems?|feels?))?\\s+(?:too|so|very)\\s+(?:big|large|huge)\\b`)
const XL_WORD = '(?:extra[\\s-]?large|x-?large|xl|huge|giant|biggest|largest|maximum|very\\s+(?:big|large)|much\\s+(?:bigger|larger))'
const TEXT_XL_RE = new RegExp(`\\b${XL_WORD}\\b${GAP}${TEXT_NOUN}\\b|\\b${TEXT_NOUN}\\b${LINK}${XL_WORD}\\b`)
const READ_TARGET = '(?:text|font|fonts|letters|app|screen|everything|ui)'
const TEXT_LARGE_RE = new RegExp(
  `\\b(?:bigger|larger|large|big|increase|enlarge)\\b${GAP}${TEXT_NOUN}\\b|\\b${TEXT_NOUN}\\b${LINK}(?:bigger|larger|large|big)\\b|\\baccessib(?:le|ility)\\b|\\b${READ_TARGET}\\b[^.,;]{0,24}\\b(?:easier|hard|harder|difficult)\\s+to\\s+read\\b|\\b(?:easier|hard|harder|difficult)\\s+to\\s+read\\b[^.,;]{0,24}\\b${READ_TARGET}\\b|\\bmore\\s+readable\\b`,
)
const TEXT_COMPACT_RE = new RegExp(`\\b(?:smaller|small|compact|tiny|decrease|shrink|reduce)\\b${GAP}${TEXT_NOUN}\\b|\\b${TEXT_NOUN}\\b${LINK}(?:smaller|small|compact|tiny)\\b`)
const FACE_NOUN = '(?:font|fonts|type|typeface|text|letters)'
const FONT_MONO_RE = new RegExp(`\\bmonospaced?\\b|\\b(?:mono|code|coding|coder|terminal|typewriter|hacker|console)\\s+${FACE_NOUN}\\b|\\b(?:font|typeface)\\b${LINK}(?:mono|monospaced?|code|terminal|typewriter)\\b`)
const FONT_SERIF_RE = new RegExp(`(?<!\\bsans[\\s-])\\bserif\\b|\\beditorial\\b|\\b(?:newspaper|bookish|book|classic|elegant)\\s+${FACE_NOUN}\\b`)
const FONT_ROUNDED_RE = new RegExp(`\\b(?:rounded|round|bubbly|friendly|soft|playful)\\s+${FACE_NOUN}\\b`)
const BOX_NOUN = '(?:corners?|edges|buttons?|cards?|shapes?|look|ui|style)'
const RADIUS_PILL_RE = new RegExp(`\\bpill[\\s-]?shaped\\b|\\bpill\\s+${BOX_NOUN}\\b|\\b(?:extra|super|very|fully|maximum)[\\s-]?round(?:ed)?\\b`)
const RADIUS_ROUND_RE = new RegExp(
  `\\b(?:round(?:ed|er)?|soft(?:er)?|curvy|curved)\\s+${BOX_NOUN}\\b|\\b(?:corners?|edges)\\b${LINK}(?:round(?:ed|er)?|soft(?:er)?)\\b|\\bmake\\s+${SHELL_TARGET}\\s+(?:more\\s+|look\\s+|a\\s+bit\\s+)?(?:round(?:ed|er)?|softer|bubbly|curvy)\\b|^\\s*(?:more\\s+)?round(?:ed|er)\\s*[.!]?\\s*$`,
)
const RADIUS_SHARP_RE = new RegExp(
  `\\bsharp(?:er)?\\s+${BOX_NOUN}\\b|\\bbrutalis[mt]\\b|\\bsquared?[\\s-]?(?:off\\s+)?${BOX_NOUN}\\b|\\b(?:corners?|edges)\\b${LINK}(?:sharp(?:er)?|squared?)\\b|\\bboxy\\b|\\bno\\s+round(?:ed)?\\s+corners\\b|\\bmake\\s+${SHELL_TARGET}\\s+(?:more\\s+|look\\s+)?(?:sharp(?:er)?|square|boxy)\\b|^\\s*square\\s*[.!]?\\s*$`,
)
const DENSITY_COZY_RE = /\bco[sz]y\b|\bmore\s+(?:breathing\s+room|spacing|padding|white\s?space|air)\b|\bspacious\b|\broomier\b|\bairy\b|\bless\s+(?:cramped|crowded|dense)\b|\bcomfortable\s+(?:layout|spacing)\b/
const DENSITY_COMPACT_RE = new RegExp(
  `\\bcompact\\s+(?:layout|mode|ui|view|spacing|density|look)\\b|\\b(?:layout|spacing|density)\\b${LINK}compact\\b|\\bdenser\\b|\\bdense\\s+(?:layout|ui)\\b|\\btighter\\s+(?:layout|spacing)\\b|\\bless\\s+(?:padding|spacing|white\\s?space)\\b|\\bfit\\s+more\\s+on\\s+(?:the\\s+|my\\s+)?screen\\b|\\bmake\\s+${SHELL_TARGET}\\s+(?:more\\s+)?compact\\b`,
)

/**
 * Words that mean the user wants something made for them (a widget, a one-off design) instead of a built-in
 * preset. With an AI connected such a message is the AI's to answer, even when part of it names a preset.
 */
const CREATIVE_RE =
  /\b(?:widgets?|cards?|trackers?|charts?|calculators?|counters?|graphs?|dashboards?|build|create|design|custom(?:i[sz]e)?|generate|draw|invent|adjust|adapt|tailor|match(?:ing|es)?|inspired|based\s+on)\b|\bmake\s+me\b|(?<!\b(?:i'd|i|would|we'd)\s)\blike\s+an?\b/

/** Every word the reader itself understands. Anything else in a message is "unresolved": a detail only a model can use. */
const KNOWN_WORDS = new Set(
  `please pls kindly can could would will you i i'd i'm i'll we want wanna need like love prefer let let's lets hey hi ok okay bun bao fundbun mascot
  the a an to into as of on in at for with and then also plus too now just my me it its this that these app application ui interface everything whole entire all shell screen
  change switch set use make turn go put give wear wears wearing add dress equip apply enable try show get have should be is are look looks looking feel
  theme themes mode skin color colour colors colours palette vibe vibes style scheme appearance aesthetic accent
  reset restore revert undo remove clear back default original normal regular standard off take lose drop ditch no more without out again
  helmet helm hat hats crown cap baseball halo costume headwear mask headgear kamen rider masked wizard witch sorcerer mage sunglasses sunnies shades glasses headphones earphones headset cat kitty kitten neko ear ears chef toque outfit accessory accessories
  high contrast cyber punk cyberpunk neon midnight sakura cherry blossom forest ocean amber dark night light day bright system auto automatic
  text texts font fonts size sizes typeface typography letters lettering bigger larger large big extra xl x-large huge giant biggest largest maximum very much increase enlarge
  smaller small compact tiny decrease shrink reduce little bit way so too monospace monospaced code coding coder terminal typewriter hacker console serif sans editorial newspaper bookish book classic elegant
  rounded round rounder bubbly friendly soft softer playful curvy curved corners corner edges edge buttons button shapes shape pill shaped fully super sharp sharper brutalist brutalism square squared boxy radius rounding
  cozy cosy breathing room spacing padding whitespace white space air spacious roomier airy cramped crowded dense denser tighter comfortable layout density view fit less
  accessibility accessible easier hard harder difficult read readable can't cannot cant name title rename wordmark brand call
  tema ke jadi menjadi ganti ubah pakai pakaikan kasih lepas lepaskan dan lalu aplikasi aplikasinya nama tolong`
    .split(/\s+/)
    .filter(Boolean)
    .concat(Object.keys(SHELL_VIBES)),
)

function unresolvedWords(lower: string): string[] {
  const out: string[] = []
  for (const raw of lower.match(/#?[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []) {
    const word = raw.replace(/'s$/, '').replace(/^'+|'+$/g, '')
    if (!word || KNOWN_WORDS.has(word) || /^#(?:[0-9a-f]{6}|[0-9a-f]{3})$/.test(word)) continue
    if (word.includes('-') && word.split('-').every((part) => KNOWN_WORDS.has(part))) continue
    if (!out.includes(word)) out.push(word)
  }
  return out
}

export interface ShellAppearancePromptReading {
  /** the valid part of the request, or null when nothing valid was asked */
  patch: ShellAppearancePatch | null
  /** parts that were asked for but are outside the bounds (unknown theme, a name that is too long) */
  issues: string[]
  /** words of the message the reader did not understand ("sparkly", "samurai"): details only a model can use */
  unresolved: string[]
  /** the message asks for something to be made (a widget, a custom design), not only for built-in presets */
  creative: boolean
  /** part of the request can only be met by a connected AI (a costume outside the wardrobe, an unknown theme) */
  needsAi: boolean
  /** what to tell the user about those parts when no AI is connected */
  aiHints: string[]
}

/**
 * True when the whole message was read as built-in presets, known colour words, ergonomics or resets, with no
 * word left over and nothing creative asked. Only such a message is answered on the device while an AI is
 * connected; every other look request goes to the AI, which can design it.
 */
export function isExactShellAppearanceReading(reading: ShellAppearancePromptReading): boolean {
  return reading.patch !== null && !reading.issues.length && !reading.unresolved.length && !reading.creative && !reading.needsAi
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
const VIBE_EXAMPLES = 'matcha, lavender, rose, cobalt, espresso, sunset, retro, pastel or monochrome'
const WARDROBE = MASCOT_HATS.filter((hat) => hat !== 'none')
  .map((hat) => MASCOT_HAT_LABELS[hat].toLowerCase())
  .join(', ')

interface PromptPart {
  asked: boolean
  needsAi: boolean
}
const PART_NONE: PromptPart = { asked: false, needsAi: false }
const PART_READ: PromptPart = { asked: true, needsAi: false }
const PART_NEEDS_AI: PromptPart = { asked: true, needsAi: true }
/** "design a theme from my logo", "create a palette that feels like autumn": a theme made to order */
const THEME_TO_ORDER_RE = /\b(?:theme(?!\s+park)|tema|palette|colou?r\s+scheme)\b/

/** Reads the theme part of a message into the patch: a preset, a colour word, a hex, the reset, or what is missing. */
function readTheme(lower: string, patch: ShellAppearancePatch, issues: string[], aiHints: string[]): PromptPart {
  const hit = THEME_SET_RES.map((re) => re.exec(lower)).find((m) => m !== null)
  const hex = HEX_THEME_RE.exec(lower)
  const paired = MODE_VIBE_RE.exec(lower)
  const mode = (word: string | undefined): 'light' | 'dark' | undefined => (word === undefined ? undefined : word === 'dark' || word === 'night' ? 'dark' : 'light')
  const wear = (made: SynthesizedShellTheme | null): boolean => {
    if (!made) return false
    patch.theme = made.theme
    patch.tokens = made.tokens
    patch.themeLabel = made.themeLabel
    return true
  }
  if (hex) {
    const side = /\b(?:light|bright|day)\b/.test(lower) ? 'light' : /\b(?:dark|night)\b/.test(lower) ? 'dark' : undefined
    if (wear(synthesizeShellThemeFromHex(hex[1] ?? hex[2], side))) return PART_READ
  }
  if (hit) {
    if (paired && wear(synthesizeShellTheme(paired[2] ?? paired[3], mode(paired[1] ?? paired[4])))) return PART_READ
    if (wear(synthesizeShellTheme(hit[1]))) return PART_READ
    const preset = themeOf(hit[1])
    if (preset) {
      patch.theme = preset
      return PART_READ
    }
  }
  if (THEME_RESET_RE.test(lower)) {
    patch.theme = 'system'
    return PART_READ
  }
  const unknown = THEME_UNKNOWN_RE.exec(lower)
  if (unknown) {
    issues.push(
      `There is no theme called "${unknown[1]}". Try ${SHELL_THEME_IDS.filter((t) => t !== 'system').join(', ')}, or a colour such as ${VIBE_EXAMPLES}. For anything else, connect your AI in Settings and Bun can design it.`,
    )
    return PART_NEEDS_AI
  }
  if (THEME_TO_ORDER_RE.test(lower) && CREATIVE_RE.test(lower)) {
    aiHints.push(`A theme made to order needs a connected AI: connect yours in Settings, Your AI. On this device I know the presets and colours such as ${VIBE_EXAMPLES}.`)
    return PART_NEEDS_AI
  }
  return PART_NONE
}

/** Reads what Bun should wear. A known item goes in the patch; an item outside the wardrobe is reported. */
function readWear(lower: string, patch: ShellAppearancePatch, aiHints: string[]): PromptPart {
  const context = HAT_CONTEXT_RE.test(lower)
  if (HAT_OFF_RE.test(lower) && (KAMEN_RE.test(lower) || context || HAT_OFF_CONTEXT_RE.test(lower))) {
    patch.mascotHat = 'none'
    return PART_READ
  }
  const found: MascotHat[] = []
  if (KAMEN_RE.test(lower)) found.push('kamen_rider')
  if (context) for (const [re, hat] of HAT_WORD_RES) if (re.test(lower)) found.push(hat)
  if (CAP_RE.test(lower)) found.push('cap')
  if (found.length) {
    patch.mascotHat = found[0]
    if (found.length > 1) {
      aiHints.push(`Bun wears one built-in item at a time, so I kept the ${MASCOT_HAT_LABELS[found[0]].toLowerCase()}. A connected AI can draw a costume that combines them.`)
      return PART_NEEDS_AI
    }
    return PART_READ
  }
  if (COSTUME_ASK_RE.test(lower)) {
    aiHints.push(`That costume is not in Bun's built-in wardrobe (${WARDROBE}). A connected AI can draw any costume or prop: connect yours in Settings, Your AI, and ask again.`)
    return PART_NEEDS_AI
  }
  return PART_NONE
}

/** Reads text size, typeface, corners and spacing. Returns true when any of them was asked for. */
function readErgonomics(lower: string, patch: ShellAppearancePatch): boolean {
  const before = Object.keys(patch).length
  if (TEXT_SIZE_RESET_RE.test(lower)) patch.fontScale = 'default'
  else if (TEXT_TOO_BIG_RE.test(lower)) patch.fontScale = 'compact'
  else if (TEXT_XL_RE.test(lower)) patch.fontScale = 'xlarge'
  else if (TEXT_LARGE_RE.test(lower) || TEXT_TOO_SMALL_RE.test(lower)) patch.fontScale = 'large'
  else if (TEXT_COMPACT_RE.test(lower)) patch.fontScale = 'compact'

  if (FONT_RESET_RE.test(lower)) {
    patch.fontStyle = 'default'
    // "reset font" puts the size back too; "sans serif" only names a typeface
    if (patch.fontScale === undefined && !/\bsans[\s-]?serif\b/.test(lower) && !/\btypeface\b/.test(lower)) patch.fontScale = 'default'
  } else if (FONT_MONO_RE.test(lower)) patch.fontStyle = 'mono'
  else if (FONT_ROUNDED_RE.test(lower)) patch.fontStyle = 'rounded'
  else if (FONT_SERIF_RE.test(lower)) patch.fontStyle = 'serif'

  const withoutFaces = lower.replace(new RegExp(FONT_ROUNDED_RE.source, 'g'), ' ')
  if (CORNER_RESET_RE.test(lower)) patch.radius = 'default'
  else if (RADIUS_PILL_RE.test(withoutFaces)) patch.radius = 'pill'
  else if (RADIUS_SHARP_RE.test(withoutFaces)) patch.radius = 'sharp'
  else if (RADIUS_ROUND_RE.test(withoutFaces)) patch.radius = 'round'

  if (LAYOUT_RESET_RE.test(lower)) {
    patch.density = 'default'
    if (/\blayout\b/.test(lower) && patch.radius === undefined) patch.radius = 'default'
  } else if (DENSITY_COZY_RE.test(lower)) patch.density = 'cozy'
  else if (DENSITY_COMPACT_RE.test(lower)) patch.density = 'compact'
  return Object.keys(patch).length > before
}

/**
 * Reads a chat message as a shell appearance request, with no model: theme (a preset, a colour word or a hex),
 * what Bun wears, the app name, text size, typeface, corners and spacing, alone or in one sentence, plus the
 * resets. Returns null when the message is not about the shell at all, so every other message goes on to the
 * usual engines untouched.
 */
export function readShellAppearancePrompt(text: string): ShellAppearancePromptReading | null {
  const original = String(text ?? '').trim()
  if (!original || original.length > PROMPT_MAX) return null
  const patch: ShellAppearancePatch = {}
  const issues: string[] = []
  const aiHints: string[] = []
  let asked = false
  let needsAi = false

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

  for (const part of [readTheme(lower, patch, issues, aiHints), readWear(lower, patch, aiHints)]) {
    asked = asked || part.asked
    needsAi = needsAi || part.needsAi
  }
  if (readErgonomics(lower, patch)) asked = true

  if (!asked) return null
  return { patch: Object.keys(patch).length ? patch : null, issues, unresolved: unresolvedWords(lower), creative: CREATIVE_RE.test(lower), needsAi, aiHints }
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
