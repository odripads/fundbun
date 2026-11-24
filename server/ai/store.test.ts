import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_AI, PLAIN_CODEC, createFileStore, createMemoryStore, defaultHome, normalise, type StoredAi, type StoredConnection } from './store'

const POSIX = process.platform !== 'win32'

const conn = (over: Partial<StoredConnection> = {}): StoredConnection => ({
  id: 'ai_0123456789ab',
  kind: 'openai_compat',
  presetId: 'deepseek',
  label: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  secret: 'plain:sk-test-not-a-real-key',
  createdAt: '2026-11-25T08:00:00.000Z',
  ...over,
})

const dirs: string[] = []
function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fundbun-ai-store-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('normalise', () => {
  it('keeps a well-formed connection exactly as it was stored', () => {
    const c = conn({ okAt: '2026-11-25T09:00:00.000Z', lastError: 'The AI provider failed.' })
    expect(normalise({ version: 1, connections: [c], activeId: c.id })).toEqual({ version: 1, connections: [c], activeId: c.id })
  })

  it('keeps an agent connection with its command line', () => {
    const agent: StoredConnection = { id: 'ai_agent0000001', kind: 'agent', presetId: 'custom-agent', label: 'My agent', command: ['my-agent', '--acp'], createdAt: '2026-11-25T08:00:00.000Z' }
    expect(normalise({ connections: [agent], activeId: agent.id }).connections).toEqual([agent])
  })

  it.each([
    ['null', null],
    ['a string', 'ai_0123456789ab'],
    ['a number', 7],
    ['an array', [conn()]],
    ['no id', conn({ id: undefined as unknown as string })],
    ['an empty id', conn({ id: '' })],
    ['a numeric id', conn({ id: 12 as unknown as string })],
    ['an id over 64 characters', conn({ id: 'a'.repeat(65) })],
    ['an unknown kind', conn({ kind: 'telnet' as never })],
    ['no kind', conn({ kind: undefined as never })],
    ['no preset', conn({ presetId: '' })],
    ['a preset over 64 characters', conn({ presetId: 'p'.repeat(65) })],
    ['no label', conn({ label: '' })],
    ['a label over 80 characters', conn({ label: 'L'.repeat(81) })],
  ])('drops a connection that is %s', (_what, bad) => {
    const good = conn({ id: 'ai_good00000001' })
    const out = normalise({ connections: [bad, good], activeId: null })
    expect(out.connections).toEqual([good])
  })

  it('keeps the connection but leaves out optional fields that are malformed', () => {
    const out = normalise({
      connections: [{
        ...conn(),
        baseUrl: 'h'.repeat(301),
        model: 42,
        secret: 's'.repeat(8001),
        command: ['ok', 7],
        okAt: { when: 'now' },
        lastError: 'e'.repeat(201),
      }],
    })
    expect(out.connections).toEqual([{ id: 'ai_0123456789ab', kind: 'openai_compat', presetId: 'deepseek', label: 'DeepSeek', createdAt: '2026-11-25T08:00:00.000Z' }])
  })

  it.each([
    ['empty', []],
    ['longer than 24 arguments', Array.from({ length: 25 }, (_, i) => `a${i}`)],
    ['holding an argument over 400 characters', ['agent', 'x'.repeat(401)]],
    ['not a list', 'agent --acp'],
  ])('leaves out a command that is %s', (_what, command) => {
    expect(normalise({ connections: [{ ...conn({ kind: 'agent' }), command }] }).connections[0]).not.toHaveProperty('command')
  })

  it('gives a connection without a date the epoch rather than dropping it', () => {
    const { createdAt: _gone, ...rest } = conn()
    expect(normalise({ connections: [rest] }).connections[0].createdAt).toBe('1970-01-01T00:00:00.000Z')
  })

  it('never copies fields it does not know (a hand-edited file cannot smuggle anything in)', () => {
    const out = normalise({ connections: [{ ...conn(), apiKey: 'sk-in-the-wrong-place', hasKey: true, local: true, __proto__: { admin: true } }], extra: 'x' })
    expect(Object.keys(out)).toEqual(['version', 'connections', 'activeId'])
    expect(Object.keys(out.connections[0]).sort()).toEqual(['baseUrl', 'createdAt', 'id', 'kind', 'label', 'model', 'presetId', 'secret'])
    expect(JSON.stringify(out)).not.toContain('sk-in-the-wrong-place')
  })

  it('nulls an activeId that names no connection', () => {
    expect(normalise({ connections: [conn()], activeId: 'ai_ffffffffffff' }).activeId).toBeNull()
    expect(normalise({ connections: [conn()], activeId: 7 }).activeId).toBeNull()
    expect(normalise({ connections: [conn()] }).activeId).toBeNull()
  })

  it('nulls an activeId whose connection was dropped as malformed', () => {
    expect(normalise({ connections: [conn({ label: '' })], activeId: 'ai_0123456789ab' })).toEqual({ version: 1, connections: [], activeId: null })
  })

  it('caps the list at 50 connections', () => {
    const many = Array.from({ length: 60 }, (_, i) => conn({ id: `ai_${String(i).padStart(12, '0')}` }))
    const out = normalise({ connections: many, activeId: many[59].id })
    expect(out.connections).toHaveLength(50)
    expect(out.connections.at(-1)?.id).toBe(many[49].id)
    // the 60th was cut, so it cannot stay active
    expect(out.activeId).toBeNull()
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'connections'],
    ['a number', 3],
    ['an array', []],
    ['an object without connections', { activeId: 'x' }],
    ['connections that are not a list', { connections: { 0: conn() } }],
  ])('reads %s as empty', (_what, raw) => {
    expect(normalise(raw)).toEqual({ version: 1, connections: [], activeId: null })
  })

  it('always answers version 1, whatever the file says', () => {
    expect(normalise({ version: 99, connections: [] }).version).toBe(1)
  })
})

describe('createFileStore', () => {
  it('loads as empty when nothing was saved yet, without creating anything', () => {
    const home = join(tempHome(), 'not-there-yet')
    const store = createFileStore(home)
    expect(store.home).toBe(home)
    expect(store.load()).toEqual(EMPTY_AI)
    expect(existsSync(home)).toBe(false)
  })

  it('round-trips what was saved', () => {
    const home = tempHome()
    const data: StoredAi = { version: 1, connections: [conn(), conn({ id: 'ai_agent0000001', kind: 'agent', presetId: 'custom-agent', label: 'Agent', command: ['agent', 'acp'], baseUrl: undefined, model: undefined, secret: undefined })], activeId: 'ai_0123456789ab' }
    createFileStore(home).save(data)
    // a second store on the same folder is what a restart looks like
    expect(createFileStore(home).load()).toEqual(JSON.parse(JSON.stringify(data)))
    expect(JSON.parse(readFileSync(join(home, 'connections.json'), 'utf8'))).toEqual(JSON.parse(JSON.stringify(data)))
  })

  it('a later save replaces the earlier one and leaves no temporary file behind', () => {
    const home = tempHome()
    const store = createFileStore(home)
    store.save({ version: 1, connections: [conn()], activeId: null })
    store.save({ version: 1, connections: [], activeId: null })
    expect(store.load()).toEqual(EMPTY_AI)
    expect(readdirSync(home)).toEqual(['connections.json'])
  })

  it.runIf(POSIX)('writes the file readable by the user only (0600)', () => {
    const home = tempHome()
    createFileStore(home).save({ version: 1, connections: [conn()], activeId: null })
    expect(statSync(join(home, 'connections.json')).mode & 0o777).toBe(0o600)
  })

  it.runIf(POSIX)('tightens a file that was left readable by others', () => {
    const home = tempHome()
    writeFileSync(join(home, 'connections.json'), '{}', { mode: 0o644 })
    createFileStore(home).save({ version: 1, connections: [conn()], activeId: null })
    expect(statSync(join(home, 'connections.json')).mode & 0o777).toBe(0o600)
  })

  it.runIf(POSIX)('creates its folder for the user only (0700)', () => {
    const home = join(tempHome(), 'nested', 'fundbun')
    createFileStore(home).save(EMPTY_AI)
    expect(statSync(home).mode & 0o777).toBe(0o700)
  })

  it.each([
    ['not JSON', '{"version":1,"connections":[{"id":"ai_'],
    ['empty', ''],
    ['JSON null', 'null'],
    ['a JSON list', '[1,2,3]'],
    ['binary noise', '\u0000\u0001��'],
  ])('a damaged file (%s) loads as empty without throwing', (_what, content) => {
    const home = tempHome()
    writeFileSync(join(home, 'connections.json'), content)
    const store = createFileStore(home)
    expect(() => store.load()).not.toThrow()
    expect(store.load()).toEqual(EMPTY_AI)
  })

  it('loading goes through normalise: malformed entries in the file are dropped', () => {
    const home = tempHome()
    writeFileSync(join(home, 'connections.json'), JSON.stringify({ version: 1, connections: [conn(), { id: 'broken' }], activeId: 'broken' }))
    expect(createFileStore(home).load()).toEqual({ version: 1, connections: [conn()], activeId: null })
  })

  it('what load() returns is a copy: changing it does not change EMPTY_AI', () => {
    const store = createFileStore(join(tempHome(), 'none'))
    store.load().connections.push(conn())
    expect(EMPTY_AI.connections).toHaveLength(0)
    expect(store.load().connections).toHaveLength(0)
  })
})

describe('createMemoryStore', () => {
  it('round-trips and never shares objects with the caller', () => {
    const initial: StoredAi = { version: 1, connections: [conn()], activeId: null }
    const store = createMemoryStore(initial)
    initial.connections[0].label = 'changed outside'
    const loaded = store.load()
    expect(loaded.connections[0].label).toBe('DeepSeek')
    loaded.connections[0].label = 'changed after load'
    expect(store.load().connections[0].label).toBe('DeepSeek')
    const next: StoredAi = { version: 1, connections: [conn({ label: 'Saved' })], activeId: 'ai_0123456789ab' }
    store.save(next)
    next.connections[0].label = 'changed after save'
    expect(store.load()).toEqual({ version: 1, connections: [conn({ label: 'Saved' })], activeId: 'ai_0123456789ab' })
  })

  it('starts empty by default', () => {
    expect(createMemoryStore().load()).toEqual(EMPTY_AI)
  })
})

describe('PLAIN_CODEC', () => {
  it.each(['sk-test-not-a-real-key', '', 'plain:plain:twice', 'ключ 🔑 with spaces'])('round-trips %j', (key) => {
    expect(PLAIN_CODEC.decode(PLAIN_CODEC.encode(key))).toBe(key)
  })

  it('marks what it stores, and reads anything unmarked as no key', () => {
    expect(PLAIN_CODEC.encode('abc')).toBe('plain:abc')
    expect(PLAIN_CODEC.decode('abc')).toBe('')
    expect(PLAIN_CODEC.decode('keychain:v1:AAAA')).toBe('')
  })

  it('says in plain words how keys are kept', () => {
    expect(PLAIN_CODEC.describe).toMatch(/file on this computer/)
  })
})

describe('defaultHome', () => {
  it('uses FUNDBUN_HOME when it is set, and ~/.fundbun otherwise', () => {
    expect(defaultHome({ FUNDBUN_HOME: '/data/fundbun' })).toBe('/data/fundbun')
    expect(defaultHome({ FUNDBUN_HOME: '  /data/fundbun  ' })).toBe('/data/fundbun')
    expect(defaultHome({ FUNDBUN_HOME: '   ' })).toBe(join(homedir(), '.fundbun'))
    expect(defaultHome({})).toBe(join(homedir(), '.fundbun'))
  })
})
