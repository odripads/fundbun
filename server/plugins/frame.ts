export const PLUGIN_FRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; object-src 'none'"

function safeInlineJs(code: string): string {
  return code.replace(/<\/script/gi, '<\\/script')
}

function safeInlineCss(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style')
}

function safeHtmlTitle(name: string): string {
  return name.replace(/[&<>"]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'))
}

/**
 * Build the HTML document served inside `<iframe sandbox="allow-scripts">`.
 * Runs with an opaque `null` origin, no network (`connect-src 'none'`), and receives only
 * a read-only PII-minimized `PluginFinanceSnapshot` from the host over `postMessage`.
 */
export function buildPluginFrameHtml(plugin: { id: string; name: string; code: string; css: string }, frameToken: string): string {
  const tokenJson = JSON.stringify(frameToken)
  const title = safeHtmlTitle(plugin.name || plugin.id)
  const css = safeInlineCss(plugin.css || '')
  const code = safeInlineJs(plugin.code)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
:root {
  --bg: #fffaf2;
  --bg-sunken: #fff4e3;
  --surface: #ffffff;
  --surface-2: #f6e7cc;
  --border: rgba(58, 42, 31, 0.12);
  --text: #24180f;
  --text-2: #5b4636;
  --text-3: #75614f;
  --accent: #e3a21a;
  --accent-text: #8a5e00;
  --accent-soft: rgba(227, 162, 26, 0.16);
  --over: #d9472b;
  --over-text: #b8381f;
  --over-soft: rgba(217, 71, 43, 0.12);
  --under: #2e8b66;
  --under-text: #1f6c4e;
  --under-soft: rgba(46, 139, 102, 0.12);
  --warn: #c98a0b;
  --warn-text: #8a5e00;
  --warn-soft: rgba(201, 138, 11, 0.14);
  --info: #4a78b5;
  --font-ui: 'DM Sans', system-ui, -apple-system, sans-serif;
  --font-display: 'Fraunces', Georgia, serif;
  --r-sm: 8px;
  --r-md: 14px;
}
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: transparent;
  color: var(--text);
  font-family: var(--font-ui);
  line-height: 1.4;
}
#plugin-root {
  width: 100%;
  min-width: 0;
}
.fb-plugin-error {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--over-soft);
  color: var(--over-text);
  font-size: 0.84rem;
}
${css}
</style>
</head>
<body>
<div id="plugin-root"></div>
<script>
(function () {
  'use strict';
  var TOKEN = ${tokenJson};
  var hostWindow = window.parent;
  var postToHost = hostWindow && typeof hostWindow.postMessage === 'function'
    ? hostWindow.postMessage.bind(hostWindow)
    : null;
  var root = document.getElementById('plugin-root');
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SVG_TAGS = { svg: 1, rect: 1, circle: 1, line: 1, path: 1, polyline: 1, polygon: 1, g: 1, text: 1, defs: 1, linearGradient: 1, stop: 1 };
  var BLOCKED_TAGS = { script: 1, style: 1, iframe: 1, object: 1, embed: 1, link: 1, meta: 1, base: 1, form: 1 };
  var SYMBOLS = { CNY: '¥', USD: '$', EUR: '€', GBP: '£', HKD: 'HK$', SGD: 'S$', JPY: '¥', IDR: 'Rp', MYR: 'RM', AUD: 'A$' };
  var ZERO_DEC = { JPY: 1, IDR: 1 };
  var latestCategories = Object.create(null);

  function notifyHost(payload) {
    if (!postToHost) return;
    try {
      postToHost(payload, '*');
    } catch (_) {
      // ignore if parent disconnected
    }
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;';
    });
  }

  function pct(part, total) {
    if (!total || !isFinite(part) || !isFinite(total) || total <= 0) return 0;
    return Math.round((part / total) * 100);
  }

  function makeHelpers(currency) {
    var cur = typeof currency === 'string' && currency ? currency : 'CNY';
    var sym = SYMBOLS[cur] || cur + ' ';
    var zero = ZERO_DEC[cur] === 1;

    function money(minor) {
      var n = typeof minor === 'number' && isFinite(minor) ? minor : 0;
      var sign = n < 0 ? '-' : '';
      var abs = Math.abs(n);
      if (zero) return sign + sym + Math.round(abs).toLocaleString('en-US');
      var major = abs / 100;
      var formatted = major.toLocaleString('en-US', {
        minimumFractionDigits: abs % 100 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
      });
      return sign + sym + formatted;
    }

    function categoryLabel(id) {
      return latestCategories[id] || String(id || 'Other').replace(/_/g, ' ');
    }

    function appendChild(node, child) {
      if (child == null || child === false) return;
      if (Array.isArray(child)) {
        for (var i = 0; i < child.length; i++) appendChild(node, child[i]);
        return;
      }
      if (typeof child === 'object' && child.nodeType) {
        node.appendChild(child);
        return;
      }
      node.appendChild(document.createTextNode(String(child)));
    }

    function el(tag, props) {
      var rawTag = String(tag || 'div');
      var lower = rawTag.toLowerCase();
      var safeTag = BLOCKED_TAGS[lower] ? 'span' : rawTag;
      var node = SVG_TAGS[safeTag]
        ? document.createElementNS(SVG_NS, safeTag)
        : document.createElement(safeTag);
      if (props && typeof props === 'object') {
        var keys = Object.keys(props);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          var val = props[k];
          if (val == null || val === false) continue;
          if (/^on/i.test(k)) continue;
          if (k === 'style' && typeof val === 'object') {
            var skeys = Object.keys(val);
            for (var s = 0; s < skeys.length; s++) {
              node.style[skeys[s]] = String(val[skeys[s]]);
            }
            continue;
          }
          var attr = k === 'className' ? 'class' : k;
          var sVal = String(val);
          if ((attr === 'href' || attr === 'src' || attr === 'xlink:href') && /^\\s*(?:javascript:|data:text\\/html)/i.test(sVal)) continue;
          node.setAttribute(attr, val === true ? '' : sVal);
        }
      }
      for (var c = 2; c < arguments.length; c++) appendChild(node, arguments[c]);
      return node;
    }

    return { money: money, pct: pct, esc: esc, el: el, categoryLabel: categoryLabel };
  }

  function applyTheme(theme) {
    if (!theme || typeof theme !== 'object') return;
    var docStyle = document.documentElement.style;
    var keys = Object.keys(theme);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.indexOf('--') === 0 && typeof theme[k] === 'string') {
        docStyle.setProperty(k, theme[k]);
      }
    }
  }

  function postHeight() {
    if (!root) return;
    var h = Math.ceil(root.getBoundingClientRect().height || root.scrollHeight || 0);
    if (h > 0) notifyHost({ type: 'fundbun:resize', token: TOKEN, height: h });
  }

  var compiledRender = null;
  var compileError = null;
  try {
    compiledRender = (function (root, data, helpers) {
      ${code}
      return typeof render === 'function' ? render : null;
    })(root, null, makeHelpers('CNY'));
  } catch (err) {
    compileError = err && err.message ? err.message : 'Failed to initialize widget.';
  }

  function renderError(msg) {
    if (!root) return;
    root.textContent = '';
    var p = document.createElement('p');
    p.className = 'fb-plugin-error';
    p.textContent = 'Widget error: ' + msg;
    root.appendChild(p);
    postHeight();
  }

  window.addEventListener('message', function (ev) {
    var msg = ev && ev.data;
    if (!msg || typeof msg !== 'object' || msg.token !== TOKEN) return;
    if (msg.type === 'fundbun:snapshot') {
      applyTheme(msg.theme);
      if (compileError) return renderError(compileError);
      if (typeof compiledRender !== 'function') return renderError('Plugin did not define render(root, data, helpers).');
      var snap = msg.snapshot || {};
      latestCategories = Object.create(null);
      if (snap.summary && Array.isArray(snap.summary.byCategory)) {
        for (var i = 0; i < snap.summary.byCategory.length; i++) {
          var item = snap.summary.byCategory[i];
          if (item && item.category) latestCategories[item.category] = item.label || item.category;
        }
      }
      try {
        compiledRender(root, snap, makeHelpers(snap.currency));
        postHeight();
      } catch (err) {
        renderError(err && err.message ? err.message : 'Widget failed while rendering.');
      }
    }
  });

  if (typeof ResizeObserver === 'function' && root) {
    new ResizeObserver(postHeight).observe(root);
  }
  notifyHost({ type: 'fundbun:ready', token: TOKEN });
})();
</script>
</body>
</html>`
}
