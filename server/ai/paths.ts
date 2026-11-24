import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/**
 * An app started from the Finder or the Dock gets a bare PATH (/usr/bin:/bin:…), so the places command-line
 * tools usually live are added: Homebrew, npm's global folder, and the agents' own install folders.
 */
export function searchPath(env: Record<string, string | undefined> = process.env): string[] {
  const home = homedir()
  const extra = [
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
    join(home, '.local', 'bin'), join(home, '.npm-global', 'bin'), join(home, '.bun', 'bin'),
    join(home, '.opencode', 'bin'), join(home, '.cargo', 'bin'), join(home, '.volta', 'bin'),
  ]
  const seen = new Set<string>()
  return [...(env.PATH ?? '').split(delimiter), ...extra].filter((dir) => dir && !seen.has(dir) && Boolean(seen.add(dir)))
}

/** Full path of a command, or null. Names only: anything with a slash is refused (no path tricks). */
export function findCommand(bin: string, env: Record<string, string | undefined> = process.env): string | null {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(bin)) return null
  for (const dir of searchPath(env)) {
    const full = join(dir, bin)
    try {
      accessSync(full, constants.X_OK)
      return full
    } catch {
      // not here
    }
  }
  return null
}

const NESTED_SESSION = /^(?:CLAUDECODE$|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID$|CODEX_SANDBOX)/

/** The environment a child process (an agent, npx) is started with: the user's own, with the wider PATH. */
export function childEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {}
  // FundBun started from inside an agent's own terminal must not pass that session's identity on to a new agent
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && !NESTED_SESSION.test(k)) out[k] = v
  out.PATH = searchPath(env).join(delimiter)
  return out
}
