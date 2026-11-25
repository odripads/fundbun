import vm from 'node:vm'
import type { PluginValidationIssue } from '../../src/core/plugins/types'

export const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/
export const MAX_PLUGIN_CODE_BYTES = 24_576
export const MAX_PLUGIN_CSS_BYTES = 8_192
export const MAX_INSTALLED_PLUGINS = 20

interface ForbiddenRule {
  rule: string
  pattern: RegExp
  message: string
  fix: string
}

const JS_FORBIDDEN_RULES: readonly ForbiddenRule[] = [
  {
    rule: 'plugin/no-dynamic-exec',
    pattern: /\beval\b/,
    message: 'Dynamic eval() is not allowed in FundBun plugins.',
    fix: 'Compute values directly using static JavaScript expressions.',
  },
  {
    rule: 'plugin/no-dynamic-exec',
    pattern: /\bFunction\b/,
    message: 'Dynamic Function() constructor is not allowed in FundBun plugins.',
    fix: 'Define static functions instead of constructing code at runtime.',
  },
  {
    rule: 'plugin/no-dynamic-exec',
    pattern: /\bimportScripts\b/,
    message: 'importScripts() is not allowed in FundBun plugins.',
    fix: 'Keep all widget rendering logic self-contained inside render(root, data, helpers).',
  },
  {
    rule: 'plugin/no-dynamic-import',
    pattern: /(?:^|[^.\w$])import\s*\(/,
    message: 'Dynamic import() is not allowed in FundBun plugins.',
    fix: 'Use only the provided data and helpers arguments inside render(root, data, helpers).',
  },
  {
    rule: 'plugin/no-require',
    pattern: /\brequire\s*\(/,
    message: 'require() is not allowed in FundBun plugins.',
    fix: 'Plugins run inside a locked browser iframe with data and helpers already supplied.',
  },
  {
    rule: 'plugin/no-network',
    pattern: /\bfetch\b/,
    message: 'Network access (fetch) is blocked in FundBun plugins.',
    fix: 'Compute metrics solely from the read-only data snapshot passed to render().',
  },
  {
    rule: 'plugin/no-network',
    pattern: /\bXMLHttpRequest\b/,
    message: 'Network access (XMLHttpRequest) is blocked in FundBun plugins.',
    fix: 'Compute metrics solely from the read-only data snapshot passed to render().',
  },
  {
    rule: 'plugin/no-network',
    pattern: /\bWebSocket\b/,
    message: 'Network access (WebSocket) is blocked in FundBun plugins.',
    fix: 'Compute metrics solely from the read-only data snapshot passed to render().',
  },
  {
    rule: 'plugin/no-network',
    pattern: /\bEventSource\b/,
    message: 'Network access (EventSource) is blocked in FundBun plugins.',
    fix: 'Compute metrics solely from the read-only data snapshot passed to render().',
  },
  {
    rule: 'plugin/no-network',
    pattern: /\bsendBeacon\b/,
    message: 'Network access (sendBeacon) is blocked in FundBun plugins.',
    fix: 'Remove sendBeacon; plugins are strictly local and read-only.',
  },
  {
    rule: 'plugin/no-frame-escape',
    pattern: /\bparent\b/,
    message: 'Accessing parent frame references is not allowed in FundBun plugins.',
    fix: 'Render strictly inside root without referencing outer windows (rename local variables like parent if needed).',
  },
  {
    rule: 'plugin/no-frame-escape',
    pattern: /\btop\b/,
    message: 'Accessing top window references is not allowed in FundBun plugins.',
    fix: 'Render strictly inside root; rename any local variable named "top" (e.g. topItem or leader).',
  },
  {
    rule: 'plugin/no-frame-escape',
    pattern: /\bopener\b/,
    message: 'Accessing window.opener is not allowed in FundBun plugins.',
    fix: 'Remove opener references and render strictly inside root.',
  },
  {
    rule: 'plugin/no-frame-escape',
    pattern: /\bframeElement\b/,
    message: 'Accessing frameElement is not allowed in FundBun plugins.',
    fix: 'Remove frameElement references and render strictly inside root.',
  },
  {
    rule: 'plugin/no-frame-escape',
    pattern: /\bpostMessage\b/,
    message: 'Calling postMessage directly is not allowed in FundBun plugins.',
    fix: 'Let the FundBun host handle snapshots and sizing automatically.',
  },
  {
    rule: 'plugin/no-storage',
    pattern: /\blocalStorage\b/,
    message: 'localStorage access is blocked in FundBun plugins.',
    fix: 'Derive widget state directly from the snapshot passed to render().',
  },
  {
    rule: 'plugin/no-storage',
    pattern: /\bsessionStorage\b/,
    message: 'sessionStorage access is blocked in FundBun plugins.',
    fix: 'Derive widget state directly from the snapshot passed to render().',
  },
  {
    rule: 'plugin/no-storage',
    pattern: /\bindexedDB\b/,
    message: 'indexedDB access is blocked in FundBun plugins.',
    fix: 'Derive widget state directly from the snapshot passed to render().',
  },
  {
    rule: 'plugin/no-storage',
    pattern: /\bcaches\b/,
    message: 'Cache Storage access is blocked in FundBun plugins.',
    fix: 'Derive widget state directly from the snapshot passed to render().',
  },
  {
    rule: 'plugin/no-storage',
    pattern: /\bcookie\b/,
    message: 'Cookie access is blocked in FundBun plugins.',
    fix: 'Remove cookie references; plugins run in a cookie-less sandbox.',
  },
  {
    rule: 'plugin/no-dom-breakout',
    pattern: /\bdocument\s*\.\s*write(?:ln)?\b/,
    message: 'document.write() is not allowed in FundBun plugins.',
    fix: 'Build DOM elements using helpers.el() or document.createElement().',
  },
  {
    rule: 'plugin/no-dom-breakout',
    pattern: /\bwindow\s*\.\s*open\b/,
    message: 'window.open() is not allowed in FundBun plugins.',
    fix: 'Render insights inline inside root instead of opening popups.',
  },
  {
    rule: 'plugin/no-dom-breakout',
    pattern: /\binnerHTML\b/,
    message: 'Direct innerHTML assignment is discouraged for plugin safety.',
    fix: 'Use helpers.el(tag, attrs, ...children) or textContent to construct safe DOM nodes.',
  },
  {
    rule: 'plugin/no-host-globals',
    pattern: /\b(?:process|electron|ipcRenderer|child_process)\b/,
    message: 'Node or Electron runtime identifiers are not allowed in FundBun plugins.',
    fix: 'Plugins execute in a browser sandbox with zero OS or Electron access.',
  },
]

const CSS_FORBIDDEN_RULES: readonly ForbiddenRule[] = [
  {
    rule: 'plugin/no-css-close-tag',
    pattern: /<\/style/i,
    message: 'Closing </style tags are not allowed inside plugin CSS.',
    fix: 'Remove </style from the stylesheet.',
  },
  {
    rule: 'plugin/no-css-import',
    pattern: /@import\b/i,
    message: 'CSS @import is blocked in FundBun plugins.',
    fix: 'Inline CSS rules using FundBun theme custom properties directly.',
  },
  {
    rule: 'plugin/no-css-external-url',
    pattern: /url\s*\(\s*['"]?\s*(?:https?:|\/\/|javascript:)/i,
    message: 'External CSS url(...) references are blocked in FundBun plugins.',
    fix: 'Use solid colors, CSS gradients, or theme variables instead of external URLs.',
  },
  {
    rule: 'plugin/no-css-expression',
    pattern: /expression\s*\(/i,
    message: 'Legacy CSS expression() is not allowed.',
    fix: 'Remove CSS expression().',
  },
  {
    rule: 'plugin/no-css-binding',
    pattern: /(?:behavior|-moz-binding)\s*:/i,
    message: 'CSS behavior / -moz-binding rules are not allowed.',
    fix: 'Remove legacy CSS behavior properties.',
  },
]

export function slugifyPluginId(name: string): string {
  const base = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  if (PLUGIN_ID_RE.test(base)) return base
  if (base.length === 1) return `${base}-widget`
  return 'custom-widget'
}

/**
 * Strip comments and string literals while preserving line breaks so rule checks do not false-positive
 * on harmless UI labels (e.g. "fetch your average") while still scanning `${...}` inside template literals.
 */
function maskNonCodeKeepLines(src: string): string {
  const out: string[] = []
  let i = 0
  const n = src.length
  const templateStack: number[] = []

  const pushSpace = (ch: string) => {
    out.push(ch === '\n' || ch === '\r' ? ch : ' ')
  }

  const scanTemplateChunk = () => {
    while (i < n) {
      const ch = src[i]
      if (ch === '\\') {
        pushSpace(ch)
        i++
        if (i < n) {
          pushSpace(src[i])
          i++
        }
        continue
      }
      if (ch === '`') {
        out.push(' ')
        i++
        return
      }
      if (ch === '$' && src[i + 1] === '{') {
        out.push(' ', ' ')
        i += 2
        templateStack.push(1)
        return
      }
      pushSpace(ch)
      i++
    }
  }

  while (i < n) {
    const ch = src[i]
    const next = src[i + 1]

    if (ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n') {
        out.push(' ')
        i++
      }
      continue
    }
    if (ch === '/' && next === '*') {
      out.push(' ', ' ')
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        pushSpace(src[i])
        i++
      }
      if (i < n) {
        out.push(' ', ' ')
        i += 2
      }
      continue
    }
    if (ch === "'" || ch === '"') {
      const quote = ch
      out.push(' ')
      i++
      while (i < n) {
        const cur = src[i]
        if (cur === '\\') {
          pushSpace(cur)
          i++
          if (i < n) {
            pushSpace(src[i])
            i++
          }
          continue
        }
        if (cur === quote) {
          out.push(' ')
          i++
          break
        }
        pushSpace(cur)
        i++
      }
      continue
    }
    if (ch === '`') {
      out.push(' ')
      i++
      scanTemplateChunk()
      continue
    }
    if (templateStack.length > 0) {
      if (ch === '{') templateStack[templateStack.length - 1]++
      else if (ch === '}') {
        templateStack[templateStack.length - 1]--
        if (templateStack[templateStack.length - 1] === 0) {
          templateStack.pop()
          out.push(' ')
          i++
          scanTemplateChunk()
          continue
        }
      }
    }

    out.push(ch)
    i++
  }

  return out.join('')
}

function lineAndColAt(source: string, index: number): { line: number; column: number } {
  const before = source.slice(0, Math.max(0, index))
  const lines = before.split('\n')
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}

function scanRule(text: string, rule: ForbiddenRule, out: PluginValidationIssue[]): void {
  const re = new RegExp(rule.pattern.source, rule.pattern.flags.replace('g', ''))
  const m = re.exec(text)
  if (!m) return
  const pos = lineAndColAt(text, m.index)
  out.push({
    rule: rule.rule,
    line: pos.line,
    column: pos.column,
    message: rule.message,
    fix: rule.fix,
  })
}

export function validatePluginCode(code: string, css = ''): { ok: true } | { ok: false; issues: PluginValidationIssue[] } {
  const issues: PluginValidationIssue[] = []

  if (typeof code !== 'string' || !code.trim()) {
    return {
      ok: false,
      issues: [{ rule: 'plugin/empty-code', message: 'Plugin code cannot be empty.', fix: 'Define function render(root, data, helpers).' }],
    }
  }
  if (Buffer.byteLength(code, 'utf8') > MAX_PLUGIN_CODE_BYTES) {
    issues.push({
      rule: 'plugin/code-too-large',
      message: `Plugin JavaScript exceeds ${MAX_PLUGIN_CODE_BYTES} bytes.`,
      fix: 'Keep widget code concise and below 24 KB.',
    })
  }
  if (typeof css !== 'string') {
    issues.push({ rule: 'plugin/invalid-css', message: 'CSS must be a string.', fix: 'Pass a plain CSS string or omit css.' })
  } else if (Buffer.byteLength(css, 'utf8') > MAX_PLUGIN_CSS_BYTES) {
    issues.push({
      rule: 'plugin/css-too-large',
      message: `Plugin CSS exceeds ${MAX_PLUGIN_CSS_BYTES} bytes.`,
      fix: 'Keep widget CSS concise and below 8 KB.',
    })
  }

  if (/<\/script/i.test(code)) {
    const idx = code.search(/<\/script/i)
    const pos = lineAndColAt(code, idx)
    issues.push({
      rule: 'plugin/no-script-close-tag',
      line: pos.line,
      column: pos.column,
      message: 'Closing </script tags are not allowed in plugin code.',
      fix: 'Remove </script from plugin JavaScript.',
    })
  }

  const cleanCode = maskNonCodeKeepLines(code)
  for (const rule of JS_FORBIDDEN_RULES) scanRule(cleanCode, rule, issues)

  if (!/\bfunction\s+render\s*\(|\b(?:const|let|var)\s+render\s*=/.test(cleanCode)) {
    issues.push({
      rule: 'plugin/missing-render',
      message: 'Plugin code must define a top-level render(root, data, helpers) function.',
      fix: 'Add function render(root, data, helpers) { ... }.',
    })
  }

  if (typeof css === 'string' && css.trim()) {
    for (const rule of CSS_FORBIDDEN_RULES) scanRule(css, rule, issues)
  }

  if (issues.length === 0) {
    try {
      // Syntax check ONLY (never executes runInContext / runInThisContext).
      new vm.Script(`(function(root, data, helpers) {\n${code}\nreturn typeof render === 'function' ? render : null;\n})`, {
        filename: 'widget.js',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Syntax error in plugin JavaScript.'
      issues.push({
        rule: 'plugin/syntax-error',
        message: `JavaScript syntax error: ${msg}`,
        fix: 'Fix the syntax error inside widget.js without using ES module import/export statements.',
      })
    }
  }

  return issues.length ? { ok: false, issues } : { ok: true }
}
