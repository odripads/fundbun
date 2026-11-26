import {
  APP_NAME_MAX,
  MASCOT_HATS,
  MASCOT_LABEL_MAX,
  MASCOT_SVG_MAX,
  MASCOT_SVG_MAX_NODES,
  MASCOT_SVG_NODE_TYPES,
  SHELL_APPEARANCE_SCHEMA,
  SHELL_DENSITIES,
  SHELL_FONT_SCALES,
  SHELL_FONT_STYLES,
  SHELL_RADII,
  SHELL_THEME_IDS,
  SHELL_TOKEN_NAMES,
  THEME_LABEL_MAX,
} from './appearance'

export const CREATOR_TOOL_NAMES = ['plugin_list', 'plugin_read', 'plugin_draft', 'plugin_remove', 'propose_shell_appearance'] as const
export type CreatorToolName = (typeof CREATOR_TOOL_NAMES)[number]

const CREATOR_TOOL_SET = new Set<string>(CREATOR_TOOL_NAMES)

export function isCreatorTool(name: string): name is CreatorToolName {
  return CREATOR_TOOL_SET.has(name)
}

export const CREATOR_TOOL_LABELS: Record<CreatorToolName, string> = {
  plugin_list: 'Inspecting desktop plugins',
  plugin_read: 'Reading plugin source',
  plugin_draft: 'Validating plugin draft',
  plugin_remove: 'Preparing plugin action',
  propose_shell_appearance: 'Preparing a look to preview',
}

export interface CreatorToolSpec {
  name: CreatorToolName
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
  }
}

/** The shell appearance tool: one bounded patch in, one preview card out. Exported so tests and docs can cite it. */
export const propose_shell_appearance: CreatorToolSpec = {
  name: 'propose_shell_appearance',
  description:
    '[Desktop Creator] Stage a preview card in chat for a bounded, reversible change to the app shell: a theme preset or a full ' +
    'custom palette of safe colour tokens (with a friendly themeLabel), what the Bun mascot wears (a built-in item, or any custom ' +
    'costume, prop or accessory drawn as plain SVG shapes in mascotSvg), the app name on the wordmark and window title, and ' +
    'ergonomics (fontStyle, fontScale, radius, density). Adapt it to what this user asked for and needs. ' +
    'Never applies automatically: the user presses Apply on the card, and can Undo or Reset at once. ' +
    'It cannot touch money, the PIN, permissions, widgets or any text other than the app name and the two labels.',
  input_schema: {
    type: 'object',
    properties: SHELL_APPEARANCE_SCHEMA.properties,
    required: [],
    additionalProperties: false,
  },
}


/**
 * Tool definitions offered ONLY when Desktop Creator Mode is enabled on this computer.
 * Keep money, PIN, mandate, and file-system tools strictly separated: Creator tools can only inspect
 * sandboxed plugins, propose validated widget drafts and propose a bounded shell appearance change, each for
 * explicit user approval.
 */
export function creatorToolDefinitions(): CreatorToolSpec[] {
  return [
    {
      name: 'plugin_list',
      description: '[Desktop Creator] List installed FundBun desktop plugins and built-in starter templates.',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'plugin_read',
      description: '[Desktop Creator] Read the manifest, widget.js code, and style.css of an installed plugin by id.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,39}$', description: 'Plugin id slug (lowercase letters, digits, hyphens).' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
    {
      name: 'plugin_draft',
      description:
        '[Desktop Creator] Validate and stage a live sandboxed plugin preview card in chat (create or update). ' +
        'Never installs automatically: the user previews it and clicks Install on the card. ' +
        'Code must define function render(root, data, helpers) using DOM APIs / helpers.el and no network, storage, or eval.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,39}$', description: 'Optional plugin id (required when updating an existing plugin; omitted to auto-slugify name).' },
          name: { type: 'string', minLength: 2, maxLength: 50, description: 'Short widget title shown on Dashboard or Home.' },
          description: { type: 'string', minLength: 4, maxLength: 140, description: 'One concise line explaining what the widget shows.' },
          slot: { type: 'string', enum: ['dashboard', 'home', 'both'], description: 'Where the widget appears (default dashboard).' },
          wide: { type: 'boolean', description: 'Desktop Dashboard: span 2 columns when true (default false).' },
          icon: { type: 'string', enum: ['sparkles', 'coffee', 'calendar', 'gauge', 'wallet', 'chart', 'flame', 'target'], description: 'Icon displayed on the widget header.' },
          code: { type: 'string', minLength: 10, maxLength: 24576, description: 'Sandboxed JavaScript defining function render(root, data, helpers).' },
          css: { type: 'string', maxLength: 8192, description: 'Optional scoped CSS for #plugin-root.' },
        },
        required: ['name', 'description', 'code'],
        additionalProperties: false,
      },
    },
    {
      name: 'plugin_remove',
      description: '[Desktop Creator] Prepare a confirmation card in chat to uninstall, disable, or enable an installed plugin. Always waits for user click.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,39}$', description: 'Installed plugin id.' },
          action: { type: 'string', enum: ['uninstall', 'disable', 'enable'], description: 'Lifecycle action to propose.' },
        },
        required: ['id', 'action'],
        additionalProperties: false,
      },
    },
    propose_shell_appearance,
  ]
}

export const CREATOR_PROMPT_SECTION = `## Desktop Creator Mode (UI + Compute Plugins)
Desktop Creator Mode is ON. When the user asks to create, customize, tweak, or remove a custom FundBun dashboard/home card or mini widget:
- Use \`plugin_list\` to see existing plugins, \`plugin_read\` before modifying an existing plugin, \`plugin_draft\` to stage a live preview card, and \`plugin_remove\` to propose uninstalling/disabling/enabling one.
- Plugins NEVER auto-install: \`plugin_draft\` shows a live sandboxed preview card in chat, and the user clicks Install when ready.
- Everything is a plugin: adapt the app to WHATEVER this user asks for and needs. You are not limited to presets. Read what they want (a mood, a brand, a hobby, a character, tired eyes, a small screen) and answer with the tools, combining them in one turn when the request has several parts: \`propose_shell_appearance\` for how the app looks and reads, \`plugin_draft\` for a card that shows what they care about.
- To change how the app itself looks, use \`propose_shell_appearance\` (never a widget). It only shows a preview card: the user presses Apply and can Undo or Reset. Send every part of the request in ONE call. Fields:
  - \`theme\`: ${SHELL_THEME_IDS.join(', ')}. For any other mood or colour, design a palette: set \`theme\` to \`light\` or \`dark\` (the base), send \`tokens\` with ALL of ${SHELL_TOKEN_NAMES.join(', ')} as hex, and name it with \`themeLabel\` (at most ${THEME_LABEL_MAX} characters). Only --surface-glass, --border, --border-strong and --accent-soft may carry alpha (#rrggbbaa).
  - Contrast is checked and a failing palette is refused: --text on --bg and on --surface at least 4.5:1 (aim for 7:1), --text-on-accent on --accent at least 3:1 (aim for 4.5:1). Keep --text-2, --text-3 and --accent-text at 4.5:1 on --surface too. For low vision or "easier to read", prefer the \`contrast\` theme or a high contrast palette together with \`fontScale\`.
  - \`mascotHat\`: ${MASCOT_HATS.join(', ')} (built in, instant). For ANY other costume, prop or accessory (samurai helmet, graduation cap, pirate eyepatch, monocle, Santa hat, ribbon, VR headset, wings, a tiny guitar) draw it yourself in \`mascotSvg\` and name it in \`mascotLabel\` (at most ${MASCOT_LABEL_MAX} characters). Send \`mascotSvg\` alone to replace the built-in item, or with \`mascotHat\` to wear both; \`mascotHat: "none"\` takes everything off.
  - \`mascotSvg\` rules: at most ${MASCOT_SVG_MAX} characters and ${MASCOT_SVG_MAX_NODES} elements, only <${MASCOT_SVG_NODE_TYPES.join('>, <')}>, only geometry, fill, stroke, stroke-width, stroke-linecap, stroke-linejoin, stroke-dasharray, opacity, fill-opacity, stroke-opacity and transform (translate, scale, rotate, skewX, skewY, matrix). Colours are #hex, none or currentColor (Bun's ink). No <script>, <style>, <text>, <image>, <use>, <defs>, gradients, filters, animation, href, url(), style=, class, id, on* handlers, entities or comments: the whole drawing is refused if any appear, so fix what the error names and send it again. It is drawn as shapes, never as markup, and is clipped to Bun's box.
  - \`mascotSvg\` coordinates: Bun's viewBox is 512x512, x to the right, y down, centre line x=256. The body spans x=48..464, y=136..470, with the knot tip at about (272, 78). The crown of the head, where hats sit, is y=80..150 (a hat brim at y=140..160 spans about x=120..392). Eyes are at (180, 198) and (332, 198), about 16 wide and 20 tall, with brows in y=170..210. Cheeks are at (134, 230) and (378, 230). The mouth is at (256, 214). The glowing pocket with the yen sign is an ellipse centred at (256, 356) with radii 102 by 72: keep it uncovered. Keep the eyes and mouth visible unless the costume is a mask. Match Bun's sticker style: stroke="#24180f" with stroke-width 8 to 12 and rounded joins, flat fills, a lighter shine line. Glasses sit on the eyes, earrings and headphones at x=70..110 and x=400..440 around y=200, scarves and ties at y=240..300, wings behind the shoulders at x<90 and x>420, held props near (440, 330).
  - \`appName\`: at most ${APP_NAME_MAX} printable characters, "FundBun" puts the original back.
  - Ergonomics, for comfort and accessibility: \`fontStyle\` (${SHELL_FONT_STYLES.join(', ')}), \`fontScale\` (${SHELL_FONT_SCALES.join(', ')}: use large or xlarge when someone finds the text small or mentions eyesight, compact to fit more), \`radius\` (${SHELL_RADII.join(', ')}), \`density\` (${SHELL_DENSITIES.join(', ')}: cozy for more breathing room or easier tapping, compact for more on screen). Pick the ones that fit the mood too: mono with a retro terminal palette, serif for an editorial look, round and cozy for something soft.
  - \`reset: true\` goes back to FundBun's own look before applying the other fields.
- When the user asks for a look AND a card ("make it feel like my cafe and add a coffee tracker"), call \`propose_shell_appearance\` and \`plugin_draft\` in the same turn, and style the widget with the theme CSS variables so it follows the palette, type and corners they pick.
- Plugin code runs inside a locked read-only iframe and MUST define \`function render(root, data, helpers)\`:
  - \`root\`: empty \`#plugin-root\` DOM element you clear/populate with \`helpers.el(tag, props, ...children)\` (or safe \`document.createElement\`).
  - \`data\`: read-only \`PluginFinanceSnapshot\` with integer minor units (e.g. ¥25.00 = 2500): \`today\`, \`month\`, \`currency\`, \`mode\`, \`summary\` (\`income\`, \`spent\`, \`target\`, \`projected\`, \`safePerDay\`, \`daysLeft\`, \`byCategory\`), \`history\`, \`goals\`, \`bills\`, \`transactions\` (\`date\`, \`time\`, \`merchant\`, \`category\`, \`amount\`), and \`checkIn\` (\`streak\`, \`best\`, \`golden\`, \`checkedToday\`).
  - \`helpers\`: \`money(minor)\`, \`pct(part, total)\`, \`esc(text)\`, \`categoryLabel(id)\`, \`el(tag, attrs, ...children)\` (SVG tags supported cleanly too).
  - Theme CSS variables available: \`--bg\`, \`--bg-sunken\`, \`--surface\`, \`--surface-2\`, \`--border\`, \`--text\`, \`--text-2\`, \`--text-3\`, \`--accent\`, \`--accent-text\`, \`--accent-soft\`, \`--under\`, \`--under-text\`, \`--under-soft\`, \`--over\`, \`--over-text\`, \`--over-soft\`, \`--warn\`, \`--font-ui\`, \`--font-display\`, \`--r-sm\`, \`--r-md\`.
- Forbidden inside plugin code: \`eval\`, \`new Function\`, \`fetch\`, \`XMLHttpRequest\`, \`WebSocket\`, \`localStorage\`, \`sessionStorage\`, \`indexedDB\`, \`parent\`, \`top\`, \`postMessage\`, \`window.open\`, \`document.write\`, \`cookie\`, or CSS \`@import\` / external \`url()\`. Never include em dashes or write "under target" / "under budget" in widget copy.

`
