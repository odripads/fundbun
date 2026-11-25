import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join, win32 } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { childEnv, findCommand, searchPath } from './paths'

const POSIX = process.platform !== 'win32'

const dirs: string[] = []
function tempBin(files: Record<string, number> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'fundbun-ai-paths-'))
  dirs.push(dir)
  for (const [name, mode] of Object.entries(files)) {
    writeFileSync(join(dir, name), '#!/bin/sh\nexit 0\n')
    chmodSync(join(dir, name), mode)
  }
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('searchPath', () => {
  it('keeps the user\'s PATH first, in order, and adds the usual places for command-line tools', () => {
    const dirsOut = searchPath({ PATH: ['/first', '/second'].join(delimiter) })
    expect(dirsOut.slice(0, 2)).toEqual(['/first', '/second'])
    for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', join(homedir(), '.local', 'bin'), join(homedir(), '.npm-global', 'bin')]) expect(dirsOut).toContain(dir)
  })

  it('lists each folder once and skips empty entries', () => {
    const dirsOut = searchPath({ PATH: ['/usr/bin', '', '/first', '/usr/bin', '/first'].join(delimiter) })
    expect(new Set(dirsOut).size).toBe(dirsOut.length)
    expect(dirsOut).not.toContain('')
    expect(dirsOut.slice(0, 2)).toEqual(['/usr/bin', '/first'])
  })

  it('works with no PATH at all (an app started from the Dock)', () => {
    const dirsOut = searchPath({})
    expect(dirsOut[0]).toBe('/opt/homebrew/bin')
    expect(dirsOut).toContain('/usr/bin')
  })
})

describe('findCommand', () => {
  it.each([
    ['an absolute path', '/bin/sh'],
    ['a relative path', './sh'],
    ['a parent path', '../bin/sh'],
    ['a nested path', 'bin/sh'],
    ['a backslash path', 'bin\\sh'],
    ['a name with a space', 'my agent'],
    ['a name with a shell separator', 'sh;id'],
    ['a name with a substitution', '$(id)'],
    ['a name with a pipe', 'sh|id'],
    ['a name with a quote', 'sh"'],
    ['a name with a line break', 'sh\nid'],
    ['a name ending in a line break', 'sh\n'],
    ['a name with a null byte', 'sh\u0000'],
    ['an empty name', ''],
    ['a name over 64 characters', 'a'.repeat(65)],
    ['a non-ASCII name', 'ｓｈ'],
  ])('refuses %s', (_what, name) => {
    // /bin holds a real `sh`: only the name check can make this null
    expect(findCommand(name, { PATH: '/bin' })).toBeNull()
  })

  it.runIf(POSIX)('returns the full path of an executable found on the PATH', () => {
    const dir = tempBin({ 'fundbun-test-agent': 0o755 })
    expect(findCommand('fundbun-test-agent', { PATH: dir })).toBe(join(dir, 'fundbun-test-agent'))
  })

  it.runIf(POSIX)('accepts dots, dashes and underscores in a name', () => {
    const dir = tempBin({ 'fundbun_test-agent.v2': 0o755 })
    expect(findCommand('fundbun_test-agent.v2', { PATH: dir })).toBe(join(dir, 'fundbun_test-agent.v2'))
  })

  it.runIf(POSIX)('takes the first match in PATH order', () => {
    const a = tempBin({ 'fundbun-test-agent': 0o755 })
    const b = tempBin({ 'fundbun-test-agent': 0o755 })
    expect(findCommand('fundbun-test-agent', { PATH: [b, a].join(delimiter) })).toBe(join(b, 'fundbun-test-agent'))
  })

  it.runIf(POSIX)('skips a file that is not executable', () => {
    const plain = tempBin({ 'fundbun-test-agent': 0o644 })
    const real = tempBin({ 'fundbun-test-agent': 0o755 })
    expect(findCommand('fundbun-test-agent', { PATH: plain })).toBeNull()
    expect(findCommand('fundbun-test-agent', { PATH: [plain, real].join(delimiter) })).toBe(join(real, 'fundbun-test-agent'))
  })

  it('answers null for a command that is not installed', () => {
    expect(findCommand('fundbun-no-such-command-7f3a', { PATH: tempBin() })).toBeNull()
  })

  it.runIf(POSIX)('finds a command outside a bare PATH through the added folders', () => {
    // `sh` lives in /bin, which is not on this PATH
    expect(findCommand('sh', { PATH: tempBin() })).toMatch(/\/sh$/)
  })
})

describe('childEnv', () => {
  const NESTED = {
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CODE_SSE_PORT: '1234',
    CLAUDE_CODE_OAUTH_TOKEN: 'not-a-real-token',
    CLAUDE_AGENT_SDK_VERSION: '0.1.0',
    CLAUDE_AGENT_SDK_CLIENT_APP: 'x',
    CLAUDE_PID: '4242',
    CODEX_SANDBOX: 'seatbelt',
    CODEX_SANDBOX_NETWORK_DISABLED: '1',
    ANTIGRAVITY_AGENT: '1',
    ANTIGRAVITY_CONVERSATION_ID: 'conv-1',
    AGY_ACP_FORCE_FILE_STORAGE: '1',
    T3_ACP_MCP_ENDPOINT: 'http://127.0.0.1:9999',
    T3CODE_THREAD_ID: 'thread-1',
  }

  it('drops the identity of an agent session FundBun was started from', () => {
    const out = childEnv({ PATH: '/usr/bin', HOME: '/Users/x', ...NESTED })
    for (const name of Object.keys(NESTED)) expect(out, name).not.toHaveProperty(name)
  })

  it('keeps every other variable as it is', () => {
    const env = {
      PATH: '/usr/bin',
      HOME: '/Users/x',
      LANG: 'en_US.UTF-8',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      // look-alikes that are not a session's identity
      CLAUDE_CONFIG_DIR: '/Users/x/.claude',
      ANTHROPIC_BASE_URL: 'https://example.invalid',
      MY_CLAUDECODE: 'kept',
      CODEX_HOME: '/Users/x/.codex',
      EMPTY: '',
    }
    const out = childEnv({ ...env, ...NESTED })
    const { PATH: _path, ...rest } = env
    expect(out).toMatchObject(rest)
    expect(Object.keys(out).sort()).toEqual(Object.keys(env).sort())
  })

  it('leaves out variables that have no value', () => {
    const out = childEnv({ PATH: '/usr/bin', GONE: undefined })
    expect(out).not.toHaveProperty('GONE')
    expect(Object.values(out).every((v) => typeof v === 'string')).toBe(true)
  })

  it('widens PATH: the user\'s folders first, then the places agents are installed', () => {
    const out = childEnv({ PATH: ['/first', '/second'].join(delimiter) })
    const path = out.PATH.split(delimiter)
    expect(path.slice(0, 2)).toEqual(['/first', '/second'])
    expect(path).toEqual(searchPath({ PATH: ['/first', '/second'].join(delimiter) }))
    expect(path).toContain('/opt/homebrew/bin')
    expect(path).toContain('/usr/local/bin')
  })

  it('sets a PATH even when there was none', () => {
    expect(childEnv({}).PATH.split(delimiter)).toContain('/usr/bin')
  })

  it('does not change the environment it was given', () => {
    const env = { PATH: '/usr/bin', CLAUDECODE: '1' }
    childEnv(env)
    expect(env).toEqual({ PATH: '/usr/bin', CLAUDECODE: '1' })
  })
})

describe('Windows', () => {
  const W = { platform: 'win32' as const }
  /** A pretend Windows disk: the set of files that exist. */
  const disk = (...files: string[]) => {
    const set = new Set(files.map((f) => f.toLowerCase()))
    return (full: string) => set.has(full.toLowerCase())
  }

  it('reads PATH spelled `Path`, splits it on semicolons, and adds the usual tool folders', () => {
    const env = { Path: 'C:\\Windows\\system32;C:\\Tools', APPDATA: 'C:\\Users\\x\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local', USERPROFILE: 'C:\\Users\\x' }
    const dirsOut = searchPath(env, 'win32')
    expect(dirsOut.slice(0, 2)).toEqual(['C:\\Windows\\system32', 'C:\\Tools'])
    for (const dir of [
      'C:\\Users\\x\\AppData\\Roaming\\npm', 'C:\\Users\\x\\AppData\\Local\\Programs', 'C:\\Users\\x\\AppData\\Local\\agy\\bin',
      'C:\\Users\\x\\.local\\bin', 'C:\\Users\\x\\.bun\\bin', 'C:\\Users\\x\\.cargo\\bin',
    ]) expect(dirsOut).toContain(dir)
    expect(dirsOut).not.toContain('/opt/homebrew/bin')
  })

  it('reads PATH in any spelling and lists a folder once whatever its case', () => {
    expect(searchPath({ pAtH: 'C:\\A' }, 'win32')[0]).toBe('C:\\A')
    const dirsOut = searchPath({ PATH: 'C:\\Tools;c:\\tools;C:\\TOOLS', USERPROFILE: 'C:\\Users\\x' }, 'win32')
    expect(dirsOut.filter((d) => d.toLowerCase() === 'c:\\tools')).toHaveLength(1)
  })

  it('finds npx as npx.cmd in npm\'s global folder', () => {
    const env = { Path: 'C:\\Windows', APPDATA: 'C:\\Users\\x\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\x' }
    const full = win32.join('C:\\Users\\x\\AppData\\Roaming\\npm', 'npx.cmd')
    expect(findCommand('npx', env, { ...W, exists: disk(full) })).toBe(full)
  })

  it('tries .exe, then .cmd, then .bat in each folder, in PATH order', () => {
    const env = { Path: 'C:\\A;C:\\B', USERPROFILE: 'C:\\Users\\x' }
    expect(findCommand('agent', env, { ...W, exists: disk('C:\\A\\agent.bat', 'C:\\A\\agent.cmd', 'C:\\A\\agent.exe') })).toBe('C:\\A\\agent.exe')
    expect(findCommand('agent', env, { ...W, exists: disk('C:\\A\\agent.bat', 'C:\\A\\agent.cmd') })).toBe('C:\\A\\agent.cmd')
    expect(findCommand('agent', env, { ...W, exists: disk('C:\\A\\agent.bat') })).toBe('C:\\A\\agent.bat')
    expect(findCommand('agent', env, { ...W, exists: disk('C:\\B\\agent.exe', 'C:\\A\\agent.bat') })).toBe('C:\\A\\agent.bat')
  })

  it('does not run a file with no extension or an unknown one (it would not start on Windows)', () => {
    const env = { Path: 'C:\\A', USERPROFILE: 'C:\\Users\\x' }
    expect(findCommand('agent', env, { ...W, exists: disk('C:\\A\\agent', 'C:\\A\\agent.ps1') })).toBeNull()
  })

  it('takes a name that already ends in .exe, .cmd or .bat as it is', () => {
    const env = { Path: 'C:\\A', USERPROFILE: 'C:\\Users\\x' }
    expect(findCommand('agent.cmd', env, { ...W, exists: disk('C:\\A\\agent.cmd') })).toBe('C:\\A\\agent.cmd')
    expect(findCommand('agent.cmd', env, { ...W, exists: disk('C:\\A\\agent.cmd.exe') })).toBeNull()
  })

  it('still refuses paths and shell characters', () => {
    const anything = () => true
    for (const name of ['C:\\A\\agent', '..\\agent', 'agent&calc', 'agent|x', '%COMSPEC%']) expect(findCommand(name, { Path: 'C:\\A' }, { ...W, exists: anything })).toBeNull()
  })

  it('childEnv keeps one PATH variable, joined with semicolons', () => {
    const out = childEnv({ Path: 'C:\\A', USERPROFILE: 'C:\\Users\\x', OTHER: '1' }, 'win32')
    expect(Object.keys(out).filter((k) => k.toLowerCase() === 'path')).toEqual(['PATH'])
    expect(out.PATH.split(';')[0]).toBe('C:\\A')
    expect(out.OTHER).toBe('1')
  })
})
