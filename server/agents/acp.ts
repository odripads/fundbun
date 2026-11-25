import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/**
 * A small client for the Agent Client Protocol (agentclientprotocol.com): JSON-RPC 2.0 over the agent's
 * stdin/stdout, one JSON message per line. FundBun is the "client"; the agent (Claude Code, Codex, Qwen Code…)
 * is a child process that keeps its own sign-in, models and tools.
 */
export type JsonObject = Record<string, unknown>

export interface AcpConnection {
  /** client → agent request */
  request(method: string, params: JsonObject, timeoutMs?: number): Promise<JsonObject>
  /** client → agent notification (no answer) */
  notify(method: string, params: JsonObject): void
  /** agent → client notifications (session/update) */
  onNotification(handler: (method: string, params: JsonObject) => void): void
  /** agent → client requests (session/request_permission); the returned value is the JSON-RPC result */
  onRequest(handler: (method: string, params: JsonObject) => Promise<JsonObject>): void
  /** resolves when the process has gone */
  readonly exited: Promise<{ code: number | null }>
  readonly alive: boolean
  /** the last lines the agent wrote to stderr, for a useful error message (never shown raw to the model) */
  stderrTail(): string
  close(): void
}

export class AcpError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly data?: unknown,
  ) {
    super(message)
    this.name = 'AcpError'
  }
}

export interface AcpSpawnOptions {
  cwd: string
  env: Record<string, string>
}

/** The byte stream both ways, so tests can drive the protocol without a real process. */
export interface AcpTransport {
  write(line: string): void
  onLine(handler: (line: string) => void): void
  onClose(handler: (code: number | null) => void): void
  onStderr(handler: (text: string) => void): void
  kill(): void
}

const MAX_LINE = 8 * 1024 * 1024
const STDERR_TAIL = 2000

/** How a command is started: the program, its arguments, and whether Node must pass them through unchanged. */
export interface SpawnPlan {
  file: string
  args: string[]
  verbatim: boolean
}

/** Characters cmd.exe still reads inside double quotes (expansion, escapes, quote toggling, line breaks). */
const CMD_UNSAFE = /["%!^\r\n\0]/

/**
 * How to start `command` without a shell. Windows cannot start a .cmd or .bat file directly (Node refuses
 * since CVE-2024-27980), and agents installed with npm are exactly that (npx.cmd, claude.cmd), so those go
 * through cmd.exe: every part is quoted, and anything cmd.exe would still read inside quotes is refused
 * instead of escaped (fail closed). Everything else, and every command on macOS and Linux, starts as it is.
 */
export function spawnPlan(command: string, args: string[], platform: NodeJS.Platform = process.platform, comSpec?: string): SpawnPlan | { error: string } {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(command)) return { file: command, args, verbatim: false }
  for (const part of [command, ...args]) {
    // a trailing backslash would escape the closing quote when the program reads its arguments
    if (CMD_UNSAFE.test(part) || part.endsWith('\\')) return { error: `FundBun will not pass ${JSON.stringify(part)} to a Windows .cmd file.` }
  }
  const line = [command, ...args].map((part) => `"${part}"`).join(' ')
  // /d: skip AutoRun scripts; /s /c: strip only the outer quotes and run the line once
  return { file: comSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true }
}

export function processTransport(command: string, args: string[], opts: AcpSpawnOptions): AcpTransport {
  let child: ChildProcessWithoutNullStreams
  const lineHandlers: ((line: string) => void)[] = []
  const closeHandlers: ((code: number | null) => void)[] = []
  const errHandlers: ((text: string) => void)[] = []
  let closed = false
  const close = (code: number | null) => {
    if (closed) return
    closed = true
    for (const h of closeHandlers) h(code)
  }
  try {
    const plan = spawnPlan(command, args, process.platform, process.env.ComSpec)
    if ('error' in plan) throw new Error(plan.error)
    // no shell: the command and each argument are passed as they are (cmd.exe only for a .cmd/.bat, see spawnPlan)
    child = spawn(plan.file, plan.args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsVerbatimArguments: plan.verbatim, windowsHide: true })
  } catch {
    queueMicrotask(() => close(null))
    return { write: () => undefined, onLine: (h) => void lineHandlers.push(h), onClose: (h) => void closeHandlers.push(h), onStderr: (h) => void errHandlers.push(h), kill: () => undefined }
  }
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    if (buffer.length > MAX_LINE) {
      buffer = ''
      child.kill()
      return
    }
    let nl = buffer.indexOf('\n')
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) for (const h of lineHandlers) h(line)
      nl = buffer.indexOf('\n')
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    for (const h of errHandlers) h(chunk)
  })
  child.on('error', () => close(null))
  child.on('exit', (code) => close(code))
  child.stdin.on('error', () => undefined)
  return {
    write: (line) => {
      if (!closed && child.stdin.writable) child.stdin.write(`${line}\n`)
    },
    onLine: (h) => void lineHandlers.push(h),
    onClose: (h) => void closeHandlers.push(h),
    onStderr: (h) => void errHandlers.push(h),
    kill: () => {
      if (closed) return
      if (process.platform === 'win32' && child.pid) {
        // killing cmd.exe would leave the agent it started running: end the whole process tree
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill())
          return
        } catch {
          // fall through to a plain kill
        }
      }
      child.kill('SIGTERM')
      setTimeout(() => !closed && child.kill('SIGKILL'), 2000).unref()
    },
  }
}

export function connectAcp(transport: AcpTransport): AcpConnection {
  let nextId = 1
  let alive = true
  let stderr = ''
  const pending = new Map<number, { resolve: (v: JsonObject) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> }>()
  let onNote: (method: string, params: JsonObject) => void = () => undefined
  let onReq: (method: string, params: JsonObject) => Promise<JsonObject> = async () => {
    throw new AcpError('Method not found', -32601)
  }
  let exit: (v: { code: number | null }) => void = () => undefined
  const exited = new Promise<{ code: number | null }>((r) => (exit = r))
  const send = (msg: JsonObject) => transport.write(JSON.stringify({ jsonrpc: '2.0', ...msg }))
  const asObject = (v: unknown): JsonObject => (v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {})

  transport.onStderr((text) => {
    stderr = (stderr + text).slice(-STDERR_TAIL)
  })
  transport.onClose((code) => {
    alive = false
    for (const p of pending.values()) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(new AcpError('The agent stopped before it answered.'))
    }
    pending.clear()
    exit({ code })
  })
  transport.onLine((line) => {
    let msg: JsonObject
    try {
      msg = asObject(JSON.parse(line))
    } catch {
      return // agents sometimes print a banner on stdout: not ours to read
    }
    const { id, method } = msg
    if (typeof method === 'string') {
      const params = asObject(msg.params)
      if (id === undefined || id === null) return onNote(method, params)
      void onReq(method, params).then(
        (result) => send({ id, result }),
        (e: unknown) => send({ id, error: { code: e instanceof AcpError && e.code ? e.code : -32603, message: e instanceof Error ? e.message : 'Internal error' } }),
      )
      return
    }
    if (typeof id !== 'number') return
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    if (p.timer) clearTimeout(p.timer)
    if (msg.error) {
      const err = asObject(msg.error)
      p.reject(new AcpError(typeof err.message === 'string' ? err.message : 'The agent reported an error.', typeof err.code === 'number' ? err.code : undefined, err.data))
    } else p.resolve(asObject(msg.result))
  })

  return {
    request(method, params, timeoutMs) {
      if (!alive) return Promise.reject(new AcpError('The agent is not running.'))
      const id = nextId++
      return new Promise<JsonObject>((resolve, reject) => {
        const entry: { resolve: (v: JsonObject) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> } = { resolve, reject }
        if (timeoutMs) {
          entry.timer = setTimeout(() => {
            pending.delete(id)
            reject(new AcpError(`The agent did not answer "${method}" in time.`))
          }, timeoutMs)
          entry.timer.unref?.()
        }
        pending.set(id, entry)
        send({ id, method, params })
      })
    },
    notify: (method, params) => {
      if (alive) send({ method, params })
    },
    onNotification: (h) => void (onNote = h),
    onRequest: (h) => void (onReq = h),
    exited,
    get alive() {
      return alive
    },
    stderrTail: () => stderr,
    close: () => transport.kill(),
  }
}
