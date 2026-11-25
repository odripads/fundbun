import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

type Env = Record<string, string | undefined>

/** Windows runs a program by its extension; these are the ones an agent or npx ships as. */
export const WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.bat'] as const

export interface FindOptions {
  /** Which rules to follow; defaults to this computer's. Tests pass 'win32' to check Windows on any machine. */
  platform?: NodeJS.Platform
  /** Whether `full` is a command that can be started; defaults to a real file-system check. */
  exists?: (full: string, platform: NodeJS.Platform) => boolean
}

const pathLib = (platform: NodeJS.Platform) => (platform === 'win32' ? win32 : posix)

/** PATH, read the way the platform does: on Windows the variable is often spelled `Path`. */
function rawPath(env: Env, platform: NodeJS.Platform): string {
  if (platform !== 'win32') return env.PATH ?? ''
  if (env.PATH !== undefined) return env.PATH
  if (env.Path !== undefined) return env.Path
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path')
  return (key && env[key]) || ''
}

/** Where command-line tools usually live when an app is started outside a terminal. */
function extraDirs(env: Env, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    const { join } = win32
    const home = env.USERPROFILE || homedir()
    return [
      env.APPDATA ? join(env.APPDATA, 'npm') : '',
      env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs') : '',
      env.ProgramFiles ? join(env.ProgramFiles, 'nodejs') : '',
      join(home, '.local', 'bin'), join(home, '.bun', 'bin'), join(home, '.cargo', 'bin'),
    ]
  }
  const { join } = posix
  const home = homedir()
  return [
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
    join(home, '.local', 'bin'), join(home, '.npm-global', 'bin'), join(home, '.bun', 'bin'),
    join(home, '.opencode', 'bin'), join(home, '.cargo', 'bin'), join(home, '.volta', 'bin'),
  ]
}

/**
 * An app started from the Finder, the Dock or the Start menu gets a bare PATH, so the places command-line
 * tools usually live are added: Homebrew, npm's global folder, and the agents' own install folders.
 */
export function searchPath(env: Env = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const seen = new Set<string>()
  // Windows folder names are not case-sensitive, so C:\Tools and c:\tools are one folder
  const key = (dir: string) => (platform === 'win32' ? dir.toLowerCase() : dir)
  return [...rawPath(env, platform).split(pathLib(platform).delimiter), ...extraDirs(env, platform)]
    .filter((dir) => dir && !seen.has(key(dir)) && Boolean(seen.add(key(dir))))
}

function realExists(full: string, platform: NodeJS.Platform): boolean {
  try {
    // Windows has no "executable" bit: the extension decides, so the file only has to be there
    accessSync(full, platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** File names to try for `bin`: as it is on macOS and Linux; with .exe, .cmd or .bat on Windows. */
function candidates(bin: string, platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') return [bin]
  const lower = bin.toLowerCase()
  if (WINDOWS_EXTENSIONS.some((ext) => lower.endsWith(ext))) return [bin]
  return WINDOWS_EXTENSIONS.map((ext) => `${bin}${ext}`)
}

/** Full path of a command, or null. Names only: anything with a slash is refused (no path tricks). */
export function findCommand(bin: string, env: Env = process.env, opts: FindOptions = {}): string | null {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(bin)) return null
  const platform = opts.platform ?? process.platform
  const exists = opts.exists ?? realExists
  const { join } = pathLib(platform)
  for (const dir of searchPath(env, platform)) {
    for (const name of candidates(bin, platform)) {
      const full = join(dir, name)
      if (exists(full, platform)) return full
    }
  }
  return null
}

const NESTED_SESSION = /^(?:CLAUDECODE$|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID$|CODEX_SANDBOX)/

/** The environment a child process (an agent, npx) is started with: the user's own, with the wider PATH. */
export function childEnv(env: Env = process.env, platform: NodeJS.Platform = process.platform): Record<string, string> {
  const out: Record<string, string> = {}
  // FundBun started from inside an agent's own terminal must not pass that session's identity on to a new agent
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== 'string' || NESTED_SESSION.test(k)) continue
    // one PATH only: on Windows `Path` and `PATH` are the same variable
    if (platform === 'win32' && k.toLowerCase() === 'path') continue
    out[k] = v
  }
  out.PATH = searchPath(env, platform).join(pathLib(platform).delimiter)
  return out
}
