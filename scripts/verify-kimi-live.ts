/**
 * Live verification: FundBun end to end against the real Kimi CLI on this computer (`kimi acp`).
 *
 *   npx tsx scripts/verify-kimi-live.ts
 *
 * Nothing here is mocked. The script uses FundBun's own code and only its public exports:
 *   - server/agents/acp.ts       the ACP client (connectAcp + processTransport)
 *   - server/agents/runtime.ts   asksFirst, safeModeOf, extractAgentModels, and (through startLocal) createAgentRuntime
 *   - server/local.ts            the real local server: connections, agent runtime, MCP bridge route
 *   - src/core/app.ts            the real app controller, whose policy gate (T0 to T4) decides every tool call
 *
 * What it proves, in order:
 *   a) `initialize` succeeds against `kimi acp` (protocolVersion and agentInfo are recorded)
 *   b) `session/new` succeeds (sessionId is recorded)
 *   c) FundBun's tools reach Kimi through the MCP bridge and stay behind the gate: the session asks first,
 *      a T0 read is allowed, a T4 tool is denied, and the bridge refuses calls without a session or outside a turn
 *   d) a real question turn: Kimi calls FundBun's `get_overview` (or answers grounded in a FundBun read)
 *
 * Isolation: the server's home is a fresh temp folder (never ~/.fundbun), the ledger is the app's in-memory
 * store seeded with the demo persona (FundBun keeps its ledger in app state, there is no SQLite), and the bank is
 * the sandbox bank. Every child process is stopped at the end, and a hard deadline stops a run that hangs.
 *
 * Output: stdout carries one JSON report and nothing else; progress lines, the server's request log and the final
 * summary line go to stderr. Exit code 0 on pass, 1 on fail.
 * Environment: VERIFY_KIMI_TIMEOUT_MS (whole run, default 300000), VERIFY_KIMI_TURN_TIMEOUT_MS (the turn,
 * default 180000), VERIFY_KIMI_KEEP_HOME=1 keeps the temp folder for inspection.
 */
import { execFile, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { AcpError, connectAcp, processTransport, type AcpConnection, type JsonObject } from '../server/agents/acp'
import { asksFirst, defaultWorkspace, extractAgentModels, safeModeOf, type Emit, type TurnInput } from '../server/agents/runtime'
import { childEnv } from '../server/ai/paths'
import { agentById } from '../server/ai/presets'
import { startLocal, type LocalServer } from '../server/local'
import { llmToolDefinitions, TOOL_SPECS } from '../src/core/agent/specs'
import type { AgentEvent } from '../src/core/ai/types'
import { createFundBunApp, memoryStorage, TEST_NOW, type FundBunApp } from '../src/core/app'
import { verifyAudit } from '../src/core/security/audit'
import type { ChatMessage } from '../src/core/types'

const PRESET_ID = 'kimi-code'
const EXPECTED_BIN = '/opt/homebrew/bin/kimi'
const QUESTION = 'Give me a brief 1-sentence summary of my spending overview using the tool'
const HARD_TIMEOUT_MS = Number(process.env.VERIFY_KIMI_TIMEOUT_MS) || 300_000
const TURN_TIMEOUT_MS = Number(process.env.VERIFY_KIMI_TURN_TIMEOUT_MS) || 180_000
const STEP_TIMEOUT_MS = 45_000
const KEEP_HOME = process.env.VERIFY_KIMI_KEEP_HOME === '1'

/** What FundBun's runtime sends as `initialize` (server/agents/runtime.ts, openSession). */
const INITIALIZE_PARAMS: JsonObject = {
  protocolVersion: 1,
  clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  clientInfo: { name: 'fundbun', title: 'FundBun', version: '1.0.0' },
}

const READ_TOOLS = Object.values(TOOL_SPECS).filter((t) => t.tier === 0).map((t) => t.name as string)
const PROHIBITED_TOOLS = Object.values(TOOL_SPECS).filter((t) => t.tier === 4).map((t) => t.name as string)

// ───────────────────────────── report ─────────────────────────────

type Detail = Record<string, unknown>

interface Check {
  id: string
  title: string
  ok: boolean
  ms: number
  detail: Detail
  /** the raw failure, as the agent or FundBun reported it */
  error?: Detail
}

const T0 = Date.now()
const elapsed = (): number => Date.now() - T0
const log = (line: string): void => void process.stderr.write(`[${String(elapsed()).padStart(6)} ms] ${line}\n`)

const report = {
  script: 'verify-kimi-live',
  startedAt: new Date(T0).toISOString(),
  ok: false,
  summary: '',
  elapsedMs: 0,
  passed: 0,
  failed: 0,
  kimi: {} as Detail,
  checks: [] as Check[],
  cleanup: {} as Detail,
  caveats: [] as string[],
  fatal: null as string | null,
}

/** A failed check: the message is the reason, `detail` is what was seen. */
class CheckFailed extends Error {
  constructor(message: string, public readonly detail: Detail = {}) {
    super(message)
    this.name = 'CheckFailed'
  }
}

/** The raw error of a failed step: ACP code and data when the agent sent them, never a rewritten message. */
function rawError(e: unknown, stderrTail = ''): Detail {
  const out: Detail = { name: e instanceof Error ? e.name : typeof e, message: e instanceof Error ? e.message : String(e) }
  if (e instanceof AcpError) {
    if (e.code !== undefined) out.acpCode = e.code
    if (e.data !== undefined) out.acpData = e.data
  }
  if (stderrTail.trim()) out.agentStderrTail = stderrTail.trim().slice(-1500)
  return out
}

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms)
  })
  return Promise.race([work, deadline]).finally(() => timer && clearTimeout(timer))
}

async function check(id: string, title: string, run: () => Promise<Detail>, stderrTail: () => string = () => ''): Promise<boolean> {
  const started = Date.now()
  log(`${id}: ${title} ...`)
  try {
    const detail = await run()
    report.checks.push({ id, title, ok: true, ms: Date.now() - started, detail })
    log(`${id}: PASS (${Date.now() - started} ms)`)
    return true
  } catch (e) {
    const detail = e instanceof CheckFailed ? e.detail : {}
    const error = rawError(e, stderrTail())
    report.checks.push({ id, title, ok: false, ms: Date.now() - started, detail, error })
    log(`${id}: FAIL (${Date.now() - started} ms): ${String(error.message)}`)
    return false
  }
}

function skip(id: string, title: string, why: string): void {
  report.checks.push({ id, title, ok: false, ms: 0, detail: { skipped: true }, error: { message: `Not run: ${why}` } })
  log(`${id}: SKIPPED (${why})`)
}

const obj = (v: unknown): JsonObject => (v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {})
const str = (v: unknown, max = 300): string => (typeof v === 'string' ? v.slice(0, max) : '')

// ───────────────────────────── child processes ─────────────────────────────

function childrenOf(pid: number): number[] {
  const out = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8', timeout: 5000 })
  return (out.stdout ?? '').split('\n').map((l) => Number(l.trim())).filter((n) => Number.isInteger(n) && n > 0)
}

/** Every process below this one (the agents, and the MCP bridge each agent starts). */
function descendants(): number[] {
  const found: number[] = []
  const queue = [process.pid]
  while (queue.length && found.length < 200) {
    const pid = queue.shift()
    if (pid === undefined) break
    for (const child of childrenOf(pid)) {
      if (found.includes(child)) continue
      found.push(child)
      queue.push(child)
    }
  }
  return found
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Processes that were already there (the TypeScript runner's helpers): never touched. */
const baseline = new Set(descendants())
const spawned = new Set<number>()
const noteSpawned = (): void => {
  for (const pid of descendants()) if (!baseline.has(pid)) spawned.add(pid)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ───────────────────────────── ~/.fundbun must not change ─────────────────────────────

const USER_HOME_DIR = join(homedir(), '.fundbun')

/** Names, sizes and change times of everything in the user's real FundBun folder. File contents are never read. */
function fingerprint(dir: string): { exists: boolean; entries: number; lines: string[] } {
  if (!existsSync(dir)) return { exists: false, entries: 0, lines: [] }
  const lines: string[] = []
  const walk = (at: string, rel: string): void => {
    if (lines.length > 5000) return
    let names: string[]
    try {
      names = readdirSync(at).sort()
    } catch {
      return
    }
    for (const name of names) {
      const full = join(at, name)
      const relPath = rel ? `${rel}/${name}` : name
      try {
        const st = lstatSync(full)
        lines.push(`${relPath}|${st.isDirectory() ? 'dir' : st.size}|${st.mtimeMs}`)
        if (st.isDirectory()) walk(full, relPath)
      } catch {
        lines.push(`${relPath}|unreadable`)
      }
    }
  }
  walk(dir, '')
  return { exists: true, entries: lines.length, lines }
}

// ───────────────────────────── the run ─────────────────────────────

let tempHome = ''
let local: LocalServer | null = null
let direct: AcpConnection | null = null
let app: FundBunApp | null = null
let finished = false

/** What the agent runtime emitted during the turn, and what the MCP bridge was asked (taps on the real objects). */
const tap = {
  turns: 0,
  preambleChars: 0,
  sentText: '',
  counts: {} as Record<string, number>,
  textChars: 0,
  thoughtChars: 0,
  firstTextMs: null as number | null,
  statuses: [] as string[],
  /** tool calls the runtime listed as the agent's own, by call id */
  ownTools: new Map<string, { title: string; kind: string; statuses: string[] }>(),
  fundbunTools: [] as { name: string; args: Detail; atMs: number }[],
  permissions: [] as { title: string; detail: string; options: string[]; answered: string }[],
  done: null as string | null,
  errors: [] as { code: string; message: string }[],
  bridge: [] as { atMs: number; method: string; name?: string; isError?: boolean; chars?: number; threw?: string; tools?: number }[],
  bridgeTools: [] as string[],
}
let bridgeToken = ''
let selfProbe = false
let turnStartedAt = 0

function installTaps(l: LocalServer): void {
  const runtime = l.agents
  const realTurn = runtime.turn.bind(runtime)
  const realBridge = runtime.bridge.bind(runtime)

  runtime.turn = (input: TurnInput, emit: Emit, signal?: AbortSignal): Promise<void> => {
    tap.turns += 1
    tap.preambleChars = input.preamble.length
    tap.sentText = input.text
    return realTurn(input, (ev: AgentEvent) => {
      tap.counts[ev.type] = (tap.counts[ev.type] ?? 0) + 1
      if (ev.type === 'text') {
        tap.textChars += ev.delta.length
        tap.firstTextMs ??= Date.now() - turnStartedAt
      } else if (ev.type === 'thought') tap.thoughtChars += ev.delta.length
      else if (ev.type === 'status') tap.statuses.push(ev.text)
      else if (ev.type === 'tool') {
        const seen = tap.ownTools.get(ev.id) ?? { title: ev.title.slice(0, 160), kind: ev.kind, statuses: [] }
        seen.statuses.push(ev.status)
        tap.ownTools.set(ev.id, seen)
      }
      else if (ev.type === 'fundbun_tool') {
        tap.fundbunTools.push({ name: ev.name, args: ev.args, atMs: Date.now() - turnStartedAt })
        log(`  Kimi called FundBun tool ${ev.name}(${JSON.stringify(ev.args)})`)
      } else if (ev.type === 'done') tap.done = ev.stopReason
      else if (ev.type === 'error') tap.errors.push({ code: ev.code, message: ev.message })
      else if (ev.type === 'permission') {
        // The agent asks the user before it uses a tool. Standing in for the user, this script says yes once to a
        // FundBun read-only tool with nothing else attached (no command line, no file path), and no to everything
        // else. A yes only lets the call reach FundBun: the policy gate in the app still decides it.
        const readTool = READ_TOOLS.find((name) => ev.title.includes(name))
        const allowOnce = ev.options.find((o) => o.kind === 'allow_once')
        const answer = readTool && !ev.detail && allowOnce ? allowOnce.id : null
        tap.permissions.push({ title: ev.title.slice(0, 200), detail: (ev.detail ?? '').slice(0, 200), options: ev.options.map((o) => `${o.kind}:${o.name}`), answered: answer ? 'allow_once' : 'dismissed' })
        log(`  Kimi asked permission: "${ev.title.slice(0, 120)}" -> ${answer ? 'allowed once' : 'dismissed'}`)
        setTimeout(() => app?.answerPermission(ev.requestId, answer), 50)
      }
      emit(ev)
    }, signal)
  }

  runtime.bridge = async (token: string, payload: JsonObject): Promise<JsonObject> => {
    const method = str(payload.method, 40)
    const entry: (typeof tap.bridge)[number] = { atMs: elapsed(), method, ...(typeof payload.name === 'string' ? { name: payload.name.slice(0, 64) } : {}) }
    try {
      const out = await realBridge(token, payload)
      if (!selfProbe) {
        // the session token is kept in memory only, for the fail-closed checks below; it is never printed
        bridgeToken = token
        if (method === 'tools/list') {
          const names = (Array.isArray(out.tools) ? out.tools : []).map((t) => str(obj(t).name, 64))
          entry.tools = names.length
          tap.bridgeTools = names
        } else {
          entry.isError = out.isError === true
          entry.chars = str(out.content, 1_000_000).length
        }
        tap.bridge.push(entry)
      }
      return out
    } catch (e) {
      if (!selfProbe) tap.bridge.push({ ...entry, threw: e instanceof Error ? e.message : 'error' })
      throw e
    }
  }
}

async function bridgePost(base: string, token: string | null, payload: unknown): Promise<{ status: number; body: JsonObject }> {
  const res = await fetch(`${base}/api/agent/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  })
  return { status: res.status, body: obj(await res.json().catch(() => null)) }
}

/**
 * The tool calls FundBun's runtime listed as the agent's own, split in two: FundBun's MCP tools that the runtime
 * did not recognise as its own (the agent named them only in the title), and everything else.
 */
function ownTools(): { fundbun: { title: string; kind: string; statuses: string[] }[]; other: { title: string; kind: string; statuses: string[] }[] } {
  const all = [...tap.ownTools.values()]
  const mine = (title: string): boolean => /^mcp_{1,2}fundbun_{1,2}[a-z_]+$/.test(title)
  return { fundbun: all.filter((t) => mine(t.title)), other: all.filter((t) => !mine(t.title)) }
}

const balancesOf = (a: FundBunApp): string => JSON.stringify(a.getSnapshot().state.bank.accounts.map((acc) => [acc.id, acc.balance]))

async function main(): Promise<void> {
  const userDirBefore = fingerprint(USER_HOME_DIR)

  // ── preflight: the preset, the binary, an isolated home ──
  const preset = agentById(PRESET_ID)
  let connectionId = ''
  let command = ''
  let args: string[] = []
  let workspace = ''
  const ready = await check('preflight', 'kimi-code preset resolves to the installed Kimi CLI, in an isolated home', async () => {
    if (!preset) throw new CheckFailed(`server/ai/presets.ts has no "${PRESET_ID}" agent`)
    tempHome = mkdtempSync(join(tmpdir(), 'fundbun-verify-kimi-'))
    if (resolve(tempHome).startsWith(resolve(USER_HOME_DIR) + sep)) throw new CheckFailed('The temp home is inside ~/.fundbun')
    // port 0: any free port, never the desktop app's own. env {}: no FUNDBUN_HOME, no provider keys from the shell.
    local = await startLocal({ port: 0, home: tempHome, distDir: null, env: {}, log: (line) => log(`  ${line}`) })
    installTaps(local)
    const added = await local.ai.add({ presetId: PRESET_ID })
    if (!added.ok) throw new CheckFailed(`Could not add the connection: ${added.error}`)
    connectionId = added.value.id
    const cmd = local.ai.agentCommand(connectionId)
    if (!cmd.ok) throw new CheckFailed(cmd.error)
    command = cmd.value.command
    args = cmd.value.args
    workspace = defaultWorkspace(tempHome)
    mkdirSync(workspace, { recursive: true, mode: 0o700 })
    const version = await new Promise<string>((done) => {
      execFile(command, ['--version'], { timeout: 15_000 }, (err, stdout, stderr) => done(err ? `unknown (${err.message.slice(0, 120)})` : `${stdout}${stderr}`.trim().slice(0, 80)))
    })
    report.kimi = { presetId: PRESET_ID, presetLaunch: preset.launch, command, args, version }
    const detail = { command, args, version, server: local.url, home: tempHome, workspace, userFundbunDirExists: userDirBefore.exists }
    if (command !== EXPECTED_BIN) throw new CheckFailed(`FundBun resolved "${preset.bin}" to ${command}, not ${EXPECTED_BIN}`, detail)
    if (JSON.stringify(args) !== JSON.stringify(['acp'])) throw new CheckFailed(`Expected the launch arguments ["acp"], got ${JSON.stringify(args)}`, detail)
    return detail
  })

  // ── a) + b) + ask-first: FundBun's ACP client, directly against `kimi acp` ──
  let handshakeOk = false
  let sessionOk = false
  if (!ready) {
    skip('a_initialize', 'ACP initialize handshake', 'preflight failed')
    skip('b_session_new', 'ACP session/new', 'preflight failed')
    skip('c1_asks_first', 'The session asks before it acts', 'preflight failed')
  } else {
    let created: JsonObject = {}
    let sessionId = ''
    handshakeOk = await check('a_initialize', 'ACP initialize handshake', async () => {
      direct = connectAcp(processTransport(command, args, { cwd: workspace, env: childEnv() }))
      const init = await direct.request('initialize', INITIALIZE_PARAMS, STEP_TIMEOUT_MS)
      noteSpawned()
      const agentInfo = obj(init.agentInfo)
      const detail = {
        protocolVersion: init.protocolVersion ?? null,
        agentInfo,
        agentCapabilities: obj(init.agentCapabilities),
        authMethods: (Array.isArray(init.authMethods) ? init.authMethods : []).map((m) => ({ id: str(obj(m).id), name: str(obj(m).name), type: str(obj(m).type) })),
      }
      if (init.protocolVersion !== 1) throw new CheckFailed(`The agent answered protocolVersion ${JSON.stringify(init.protocolVersion)}, FundBun speaks 1`, detail)
      if (!str(agentInfo.name)) throw new CheckFailed('The agent did not name itself (agentInfo.name)', detail)
      return detail
    }, () => direct?.stderrTail() ?? '')

    if (!handshakeOk || !direct) {
      skip('b_session_new', 'ACP session/new', 'initialize failed')
      skip('c1_asks_first', 'The session asks before it acts', 'initialize failed')
    } else {
      const conn: AcpConnection = direct
      sessionOk = await check('b_session_new', 'ACP session/new', async () => {
        created = await conn.request('session/new', { cwd: workspace, mcpServers: [] }, STEP_TIMEOUT_MS)
        sessionId = str(created.sessionId)
        const models = extractAgentModels(created)
        const detail = {
          sessionId,
          currentModel: models.current ?? null,
          modelConfigId: models.configId ?? null,
          models: models.options,
          modes: obj(created.modes),
        }
        if (!sessionId) throw new CheckFailed('The agent did not open a session (no sessionId)', detail)
        return detail
      }, () => conn.stderrTail())

      if (!sessionOk) skip('c1_asks_first', 'The session asks before it acts', 'session/new failed')
      else {
        await check('c1_asks_first', 'The session asks before it acts (asksFirst)', async () => {
          const sent: string[] = []
          const safe = safeModeOf(created.modes)
          const asks = await asksFirst({ request: (method, params, timeoutMs) => (sent.push(method), conn.request(method, params, timeoutMs)) }, sessionId, created.modes)
          const detail = { asksFirst: asks, currentMode: str(obj(created.modes).currentModeId) || null, safeMode: safe, requestsSent: sent }
          if (!asks) throw new CheckFailed('FundBun could not put the session in a mode that asks first', detail)
          if (safe && /auto|yolo|bypass/i.test(safe.id)) throw new CheckFailed(`The chosen mode "${safe.id}" does not ask first`, detail)
          return detail
        }, () => conn.stderrTail())
      }
      conn.close()
      await Promise.race([conn.exited, sleep(5000)])
      direct = null
    }
  }

  // ── c2) the tool catalogue the bridge serves: static, from the single source of truth ──
  const offered = llmToolDefinitions().map((t) => t.name)
  await check('c2_tool_catalogue', 'get_overview is a T0 read; no T4 tool is offered to any model', async () => {
    const spec = TOOL_SPECS.get_overview
    const leaked = PROHIBITED_TOOLS.filter((name) => offered.includes(name))
    const detail = { offered: offered.length, readOnlyT0: READ_TOOLS, prohibitedT4: PROHIBITED_TOOLS, get_overview: { tier: spec.tier, movesMoney: spec.movesMoney, exposedToLLM: spec.exposedToLLM } }
    if (spec.tier !== 0 || spec.movesMoney || !spec.exposedToLLM || !offered.includes('get_overview')) throw new CheckFailed('get_overview is not an offered T0 read', detail)
    if (leaked.length) throw new CheckFailed(`T4 tools are offered: ${leaked.join(', ')}`, detail)
    return detail
  })

  // ── the product path: connection test, the app, the ledger ──
  let appReady = false
  let balancesBefore = ''
  let txnsBefore = 0
  if (!ready || !local || !sessionOk) {
    const why = !ready ? 'preflight failed' : 'the ACP session did not open'
    skip('product_probe', 'FundBun connection test (Your AI "Test")', why)
    skip('app_ledger', 'The app answers through Kimi on an isolated, seeded ledger', why)
  } else {
    const l: LocalServer = local
    await check('product_probe', 'FundBun connection test (Your AI "Test"): start, ask first, list models', async () => {
      const result = await withTimeout(l.ai.test(connectionId), 70_000, 'The connection test')
      noteSpawned()
      const detail = { ok: result.ok, ms: result.ms, kind: result.kind ?? null, modelCount: result.modelCount ?? null, model: l.ai.get(connectionId)?.model ?? null, modelName: l.ai.get(connectionId)?.modelName ?? null }
      if (!result.ok) throw new CheckFailed(result.error ?? 'The connection test failed', detail)
      return detail
    })

    appReady = await check('app_ledger', 'The app answers through Kimi on an isolated, seeded ledger', async () => {
      const a = createFundBunApp({ storage: memoryStorage(), llmBaseUrl: `${l.url}/api`, now: () => new Date(TEST_NOW) })
      app = a
      a.loadDemo('mei')
      a.setConsent({ llmProcessing: true })
      await a.checkLlm()
      const snap = a.getSnapshot()
      balancesBefore = balancesOf(a)
      txnsBefore = snap.state.bank.transactions.length
      const detail = {
        storage: 'in-memory (memoryStorage), sandbox bank, demo persona "mei"',
        today: snap.derived.today,
        transactions: txnsBefore,
        accounts: snap.state.bank.accounts.length,
        goals: snap.state.dreams.map((d) => ({ name: d.name, kind: d.kind })),
        monthSpentMinor: snap.derived.summary?.spent ?? null,
        monthTargetMinor: snap.derived.summary?.target ?? null,
        llm: snap.derived.llm,
        engine: snap.derived.engine,
      }
      if (!txnsBefore || !snap.state.dreams.length) throw new CheckFailed('The ledger was not seeded', detail)
      if (snap.derived.llm.kind !== 'agent' || snap.derived.llm.connectionId !== connectionId || snap.derived.engine !== 'llm') {
        throw new CheckFailed('The app is not set to answer through the Kimi agent', detail)
      }
      return detail
    })
  }

  // ── d) the live turn ──
  let reply: ChatMessage | null = null
  let turnOk = false
  if (!appReady || !app || !local) skip('d_live_turn', 'A real question turn through Kimi', 'the app is not ready')
  else {
    const a: FundBunApp = app
    turnOk = await check('d_live_turn', 'A real question turn: Kimi uses FundBun\'s get_overview through the gate', async () => {
      turnStartedAt = Date.now()
      const watch = setInterval(noteSpawned, 1000)
      const sending = a.sendMessage(QUESTION)
      try {
        reply = await withTimeout(sending, TURN_TIMEOUT_MS, 'The turn')
      } catch (e) {
        a.stopReply()
        await Promise.race([sending.catch(() => undefined), sleep(8000)])
        throw new CheckFailed(e instanceof Error ? e.message : 'The turn failed', { question: QUESTION, events: tap.counts, statuses: tap.statuses, errors: tap.errors, permissions: tap.permissions, agentTools: [...tap.ownTools.values()], bridge: tap.bridge })
      } finally {
        clearInterval(watch)
        noteSpawned()
      }
      const turnMs = Date.now() - turnStartedAt
      const r: ChatMessage = reply
      const trace = (r.trace ?? []).map((t) => ({ kind: t.kind, label: t.label.slice(0, 160), detail: t.kind === 'policy' ? t.detail : undefined }))
      const gateAllowedOverview = trace.some((t) => t.kind === 'policy' && obj(t.detail).tool === 'get_overview' && obj(t.detail).decision === 'allow' && obj(t.detail).tier === 0)
      const overviewViaBridge = tap.bridge.some((b) => b.method === 'tools/call' && b.name === 'get_overview' && b.isError === false)
      const readsViaBridge = tap.bridge.filter((b) => b.method === 'tools/call' && b.name && READ_TOOLS.includes(b.name) && b.isError === false).length
      const kimiAnswered = tap.done !== null && tap.errors.length === 0 && tap.textChars > 0 && r.engine === 'llm' && /kimi/i.test(r.via ?? '')
      const invoked = overviewViaBridge && gateAllowedOverview
      const grounded = r.grounding?.ok === true && r.grounding.checked > 0 && readsViaBridge > 0
      const detail = {
        question: QUESTION,
        reply: r.text.slice(0, 700),
        answeredBy: r.via ?? null,
        engine: r.engine ?? null,
        stopReason: tap.done,
        turnMs,
        firstTextMs: tap.firstTextMs,
        kimiCalledGetOverview: overviewViaBridge,
        gateAllowedGetOverviewAsT0: gateAllowedOverview,
        fundbunToolCalls: tap.fundbunTools,
        grounding: r.grounding ?? null,
        groundedInFundbunRead: grounded,
        events: tap.counts,
        textChars: tap.textChars,
        thoughtChars: tap.thoughtChars,
        preambleChars: tap.preambleChars,
        statuses: tap.statuses,
        fundbunCallsListedAsAgentTools: ownTools().fundbun,
        kimiOtherTools: ownTools().other,
        permissionRequests: tap.permissions,
        agentErrors: tap.errors,
        trace: trace.map((t) => `${t.kind}: ${t.label}`),
      }
      if (!kimiAnswered) throw new CheckFailed('Kimi did not complete the answer (FundBun may have fallen back to its on-device engine)', detail)
      if (!invoked && !grounded) throw new CheckFailed('Kimi answered, but neither called get_overview through the gate nor gave an answer grounded in a FundBun read', detail)
      return detail
    })
  }

  // ── c3) what Kimi saw through the MCP bridge, and that the bridge fails closed ──
  if (!turnOk || !local) skip('c3_bridge', 'FundBun tools reach Kimi through the MCP bridge, and the bridge fails closed', 'the live turn did not complete')
  else {
    const base = local.url
    await check('c3_bridge', 'FundBun tools reach Kimi through the MCP bridge, and the bridge fails closed', async () => {
      const listedByKimi = tap.bridge.filter((b) => b.method === 'tools/list').length
      selfProbe = true
      try {
        const noToken = await bridgePost(base, null, { method: 'tools/list' })
        const wrongToken = await bridgePost(base, '0'.repeat(48), { method: 'tools/list' })
        const prohibited = bridgeToken ? await bridgePost(base, bridgeToken, { method: 'tools/call', name: 'transfer_external', arguments: { to: 'Someone', amount: 480000, account: '6222021001123456789' } }) : null
        const outsideTurn = bridgeToken ? await bridgePost(base, bridgeToken, { method: 'tools/call', name: 'get_overview', arguments: {} }) : null
        const refused = (r: { status: number; body: JsonObject } | null): boolean => Boolean(r) && (r?.status === 401 || r?.body.isError === true)
        const detail = {
          kimiListedTools: listedByKimi,
          toolsSeenByKimi: tap.bridgeTools,
          matchesCatalogue: JSON.stringify([...tap.bridgeTools].sort()) === JSON.stringify([...offered].sort()),
          bridgeCallsByKimi: tap.bridge.map((b) => ({ atMs: b.atMs, method: b.method, ...(b.name ? { name: b.name } : {}), ...(b.tools !== undefined ? { tools: b.tools } : {}), ...(b.isError !== undefined ? { isError: b.isError } : {}), ...(b.chars !== undefined ? { resultChars: b.chars } : {}), ...(b.threw ? { threw: b.threw } : {}) })),
          withoutToken: { status: noToken.status },
          withUnknownToken: { status: wrongToken.status },
          prohibitedToolWithSessionToken: prohibited ? { status: prohibited.status, isError: prohibited.body.isError ?? null, content: str(prohibited.body.content, 200) } : 'not run: Kimi never reached the bridge',
          readOutsideATurnWithSessionToken: outsideTurn ? { status: outsideTurn.status, isError: outsideTurn.body.isError ?? null, content: str(outsideTurn.body.content, 200) } : 'not run: Kimi never reached the bridge',
        }
        if (!listedByKimi || !tap.bridgeTools.includes('get_overview')) throw new CheckFailed('Kimi never listed FundBun\'s tools through the bridge', detail)
        if (!detail.matchesCatalogue) throw new CheckFailed('The tools Kimi saw differ from the catalogue', detail)
        if (PROHIBITED_TOOLS.some((name) => tap.bridgeTools.includes(name))) throw new CheckFailed('A T4 tool was listed to Kimi', detail)
        if (noToken.status !== 401 || wrongToken.status !== 401) throw new CheckFailed('The bridge answered a request without a valid session token', detail)
        if (!refused(prohibited)) throw new CheckFailed('The bridge did not refuse a T4 tool', detail)
        if (!refused(outsideTurn)) throw new CheckFailed('The bridge ran a tool outside a turn', detail)
        return detail
      } finally {
        selfProbe = false
      }
    })
  }

  // ── c4) the policy gate: the live T0 read was allowed, a T4 call is denied, nothing moved ──
  if (!turnOk || !app) skip('c4_policy_gate', 'Policy gate: T0 read allowed, T4 denied, no money moved', 'the live turn did not complete')
  else {
    const a: FundBunApp = app
    await check('c4_policy_gate', 'Policy gate: T0 read allowed, T4 denied, no money moved', async () => {
      const audit = a.getSnapshot().state.audit
      const liveCalls = audit.filter((e) => e.type === 'tool_call' && e.data.proposedBy === 'llm').map((e) => str(e.data.tool, 64))
      const liveDecisions = audit.filter((e) => e.type === 'policy_decision' && liveCalls.includes(str(e.data.tool, 64))).map((e) => ({ tool: e.data.tool, decision: e.data.decision, tier: e.data.tier, ruleIds: e.data.ruleIds }))
      const denied = await a.runSuggestedAction({ tool: 'transfer_external', args: { to: 'Someone', amount: 480000, account: '6222021001123456789' }, label: 'verify: prohibited transfer' })
      const after = a.getSnapshot()
      const chain = verifyAudit(after.state.audit)
      const detail = {
        modelToolCalls: liveCalls,
        modelPolicyDecisions: liveDecisions,
        t4Probe: { tool: 'transfer_external', status: denied.status, decision: denied.decision.decision, tier: denied.decision.tier, ruleIds: denied.decision.ruleIds },
        balancesUnchanged: balancesOf(a) === balancesBefore,
        transactionsUnchanged: after.state.bank.transactions.length === txnsBefore,
        pendingByStatus: after.state.pending.reduce<Record<string, number>>((acc, p) => ((acc[p.status] = (acc[p.status] ?? 0) + 1), acc), {}),
        frozen: after.state.mandate.frozen,
        auditChain: { ok: chain.ok, entries: chain.count },
      }
      const overviewDecision = liveDecisions.find((d) => d.tool === 'get_overview')
      if (liveCalls.includes('get_overview') && (overviewDecision?.decision !== 'allow' || overviewDecision.tier !== 0)) throw new CheckFailed('get_overview was not decided as an allowed T0 read', detail)
      if (liveDecisions.some((d) => d.tier !== 0)) throw new CheckFailed('The model\'s calls went beyond T0 reads in a read-only question', detail)
      if (denied.status !== 'denied' || denied.decision.decision !== 'deny' || !denied.decision.ruleIds.includes('P-T4-PROHIBITED')) throw new CheckFailed('The gate did not deny a T4 tool', detail)
      if (!detail.balancesUnchanged || !detail.transactionsUnchanged) throw new CheckFailed('A balance or the transaction list changed', detail)
      if (after.state.pending.some((p) => p.status === 'executed')) throw new CheckFailed('An action was executed', detail)
      if (!chain.ok) throw new CheckFailed('The audit chain does not verify', detail)
      return detail
    })
  }

  // ── isolation: the user's real FundBun folder is exactly as it was ──
  await check('isolation', 'The user\'s ~/.fundbun was not touched', async () => {
    const now = fingerprint(USER_HOME_DIR)
    const before = new Set(userDirBefore.lines)
    const changed = [...now.lines.filter((line) => !before.has(line)), ...userDirBefore.lines.filter((line) => !now.lines.includes(line))].map((line) => line.split('|')[0])
    const detail = { existedBefore: userDirBefore.exists, existsNow: now.exists, entriesBefore: userDirBefore.entries, entriesNow: now.entries, changed: [...new Set(changed)].slice(0, 20), verifyHome: tempHome }
    if (now.exists !== userDirBefore.exists || changed.length) throw new CheckFailed('Something in ~/.fundbun changed during the run', detail)
    return detail
  })
}

// ───────────────────────────── cleanup and exit ─────────────────────────────

async function cleanup(): Promise<void> {
  const started = Date.now()
  noteSpawned()
  try {
    app?.stopReply()
  } catch {
    // nothing was running
  }
  try {
    direct?.close()
  } catch {
    // already gone
  }
  let serverClosed = !local
  if (local) {
    const l: LocalServer = local
    serverClosed = await Promise.race([l.close().then(() => true), sleep(6000).then(() => false)])
  }
  // SIGTERM was sent by FundBun's own close(); give the agents a moment, then end whatever is left
  const deadline = Date.now() + 6000
  while (Date.now() < deadline && [...spawned].some(isAlive)) await sleep(100)
  const killed: number[] = []
  for (const pid of spawned) {
    if (!isAlive(pid)) continue
    try {
      process.kill(pid, 'SIGKILL')
      killed.push(pid)
    } catch {
      // it went away in between
    }
  }
  if (killed.length) await sleep(300)
  const leftover = descendants().filter((pid) => !baseline.has(pid) && isAlive(pid))
  let homeRemoved = false
  if (tempHome && !KEEP_HOME) {
    try {
      rmSync(tempHome, { recursive: true, force: true })
      homeRemoved = !existsSync(tempHome)
    } catch {
      homeRemoved = false
    }
  }
  report.cleanup = { ms: Date.now() - started, serverClosed, childProcessesSeen: spawned.size, forceKilled: killed.length, stillRunning: leftover.length, tempHomeRemoved: KEEP_HOME ? 'kept (VERIFY_KIMI_KEEP_HOME=1)' : homeRemoved }
  const clean = serverClosed && leftover.length === 0 && (KEEP_HOME || homeRemoved || !tempHome)
  report.checks.push({ id: 'cleanup', title: 'Child processes stopped, server closed, temp home removed', ok: clean, ms: Date.now() - started, detail: report.cleanup, ...(clean ? {} : { error: { message: 'Cleanup left something behind' } }) })
  if (killed.length) report.caveats.push(`${killed.length} child process(es) ignored SIGTERM and were ended with SIGKILL.`)
}

function addCaveats(): void {
  const own = ownTools()
  if (tap.permissions.some((p) => p.answered === 'allow_once')) {
    report.caveats.push('Kimi asked the user for permission before using a FundBun tool; this script answered "allow once" in the user\'s place (read-only FundBun tools only, never "always"). The policy gate still decided the call.')
  }
  if (own.fundbun.length) {
    report.caveats.push(`FundBun's runtime did not recognise ${own.fundbun.length} FundBun tool call(s) as its own: Kimi names the tool only in the call's title (for example "${own.fundbun[0].title}"), and the runtime trusts only a tool name field. The effect in the app: the user is asked to approve each FundBun tool call, and the call is listed among the agent's own tools. It fails safe (nothing runs unasked).`)
  }
  if (tap.permissions.some((p) => p.answered === 'dismissed')) report.caveats.push('Kimi asked to use something other than a FundBun read tool; this script dismissed it.')
  if (own.other.length) report.caveats.push(`Kimi used ${own.other.length} tool(s) of its own during the turn (listed under d_live_turn.kimiOtherTools).`)
  report.caveats.push('Kimi keeps its own sign-in and session records in its own folders; those are outside FundBun and are not isolated by this script.')
  report.caveats.push('The ledger is FundBun\'s in-memory app state with the sandbox bank (demo persona), not SQLite: FundBun has no SQLite ledger.')
}

async function finish(fatal?: string): Promise<void> {
  if (finished) return
  finished = true
  if (fatal) {
    report.fatal = fatal
    log(`FATAL: ${fatal}`)
  }
  try {
    await cleanup()
  } catch (e) {
    report.checks.push({ id: 'cleanup', title: 'Child processes stopped, server closed, temp home removed', ok: false, ms: 0, detail: {}, error: rawError(e) })
  }
  addCaveats()
  report.passed = report.checks.filter((c) => c.ok).length
  report.failed = report.checks.length - report.passed
  report.ok = !report.fatal && report.failed === 0 && report.checks.length > 0
  report.elapsedMs = elapsed()
  report.summary = `verify-kimi-live: ${report.ok ? 'PASS' : 'FAIL'} ${report.passed}/${report.checks.length} checks in ${report.elapsedMs} ms`
  process.stderr.write(`${report.summary}\n`)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`, () => process.exit(report.ok ? 0 : 1))
}

// a run that hangs is stopped: first an orderly finish, then, if even that hangs, a hard stop
const hardStop = setTimeout(() => {
  void finish(`The run did not finish within ${HARD_TIMEOUT_MS} ms`)
  setTimeout(() => {
    for (const pid of spawned) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }
    const summary = `verify-kimi-live: FAIL (hard stop) in ${elapsed()} ms`
    process.stderr.write(`${summary}\n`)
    process.stdout.write(`${JSON.stringify({ ...report, ok: false, summary, fatal: 'Cleanup hung after the deadline; child processes were killed', elapsedMs: elapsed() }, null, 2)}\n`)
    process.exit(1)
  }, 20_000).unref()
}, HARD_TIMEOUT_MS)
hardStop.unref()

process.once('SIGINT', () => void finish('Interrupted (SIGINT)'))
process.once('SIGTERM', () => void finish('Terminated (SIGTERM)'))
process.on('unhandledRejection', (e) => log(`unhandled rejection: ${e instanceof Error ? e.message : String(e)}`))

main()
  .then(() => finish())
  .catch((e: unknown) => finish(`Unexpected error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
