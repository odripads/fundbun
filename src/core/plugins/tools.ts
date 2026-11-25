export const CREATOR_TOOL_NAMES = ['plugin_list', 'plugin_read', 'plugin_draft', 'plugin_remove'] as const
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

/**
 * Tool definitions offered ONLY when Desktop Creator Mode is enabled on this computer.
 * Keep money, PIN, mandate, and file-system tools strictly separated: Creator tools can only inspect
 * sandboxed plugins and propose validated widget drafts for explicit user approval.
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
  ]
}

export const CREATOR_PROMPT_SECTION = `## Desktop Creator Mode (UI + Compute Plugins)
Desktop Creator Mode is ON. When the user asks to create, customize, tweak, or remove a custom FundBun dashboard/home card or mini widget:
- Use \`plugin_list\` to see existing plugins, \`plugin_read\` before modifying an existing plugin, \`plugin_draft\` to stage a live preview card, and \`plugin_remove\` to propose uninstalling/disabling/enabling one.
- Plugins NEVER auto-install: \`plugin_draft\` shows a live sandboxed preview card in chat, and the user clicks Install when ready.
- Plugin code runs inside a locked read-only iframe and MUST define \`function render(root, data, helpers)\`:
  - \`root\`: empty \`#plugin-root\` DOM element you clear/populate with \`helpers.el(tag, props, ...children)\` (or safe \`document.createElement\`).
  - \`data\`: read-only \`PluginFinanceSnapshot\` with integer minor units (e.g. ¥25.00 = 2500): \`today\`, \`month\`, \`currency\`, \`mode\`, \`summary\` (\`income\`, \`spent\`, \`target\`, \`projected\`, \`safePerDay\`, \`daysLeft\`, \`byCategory\`), \`history\`, \`goals\`, \`bills\`, \`transactions\` (\`date\`, \`time\`, \`merchant\`, \`category\`, \`amount\`), and \`checkIn\` (\`streak\`, \`best\`, \`golden\`, \`checkedToday\`).
  - \`helpers\`: \`money(minor)\`, \`pct(part, total)\`, \`esc(text)\`, \`categoryLabel(id)\`, \`el(tag, attrs, ...children)\` (SVG tags supported cleanly too).
  - Theme CSS variables available: \`--bg\`, \`--bg-sunken\`, \`--surface\`, \`--surface-2\`, \`--border\`, \`--text\`, \`--text-2\`, \`--text-3\`, \`--accent\`, \`--accent-text\`, \`--accent-soft\`, \`--under\`, \`--under-text\`, \`--under-soft\`, \`--over\`, \`--over-text\`, \`--over-soft\`, \`--warn\`, \`--font-ui\`, \`--font-display\`, \`--r-sm\`, \`--r-md\`.
- Forbidden inside plugin code: \`eval\`, \`new Function\`, \`fetch\`, \`XMLHttpRequest\`, \`WebSocket\`, \`localStorage\`, \`sessionStorage\`, \`indexedDB\`, \`parent\`, \`top\`, \`postMessage\`, \`window.open\`, \`document.write\`, \`cookie\`, or CSS \`@import\` / external \`url()\`. Never include em dashes or write "under target" / "under budget" in widget copy.

`
