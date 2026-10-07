/**
 * Execution evidence: replays every scripted scenario in docs/SCENARIOS.md through the public AppApi on the
 * deterministic sandbox and writes evidence/latest/ (operations.jsonl, scenarios/<ID>.md, audit-C*.jsonl,
 * SUMMARY.md, REPRODUCE.md). Exits 1 if any assertion fails.
 *
 *   npm run evidence
 *   npm run evidence -- --only A1,B5 --out /tmp/evidence
 *   npx tsx scripts/run-scenarios.ts --verify-audit evidence/latest/audit-C1.jsonl
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SEED, DEMO_PIN, DEMO_TODAY, TEST_NOW } from '../src/core/controller/constants'
import { parseAuditJSONL, verifyAudit } from '../src/core/security/audit'
import { installDeterministicIds } from './evidence/determinism'
import { Scenario, type ScenarioResult } from './evidence/recorder'
import { computeMetrics, metricsTable, opLine, reproduceMarkdown, scenarioMarkdown, summaryMarkdown, type Environment, type Metrics } from './evidence/render'
import { SCENARIOS } from './evidence/scenarios'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

export interface EvidenceOptions {
  /** output directory (default evidence/latest) */
  out?: string
  /** scenario ids to run (default: all) */
  only?: string[]
  /** progress lines on stdout (default true) */
  log?: (line: string) => void
}

export interface EvidenceRun {
  results: ScenarioResult[]
  metrics: Metrics
  out: string
  pass: boolean
}

export async function runEvidence(opts: EvidenceOptions = {}): Promise<EvidenceRun> {
  const log = opts.log ?? ((line: string) => console.log(line))
  const out = resolve(opts.out ?? join(ROOT, 'evidence', 'latest'))
  const only = opts.only?.length ? opts.only.map((x) => x.trim().toUpperCase()).filter(Boolean) : null
  if (only) {
    const unknown = only.filter((id) => !SCENARIOS.some((s) => s.id === id))
    if (unknown.length) throw new Error(`Unknown scenario id(s): ${unknown.join(', ')} — known: ${SCENARIOS.map((s) => s.id).join(', ')}`)
  }
  const defs = only ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS
  const env: Environment = {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    commit: gitCommit(),
    seed: DEFAULT_SEED,
    sandboxDate: DEMO_TODAY,
    clockStart: TEST_NOW,
    pin: DEMO_PIN,
    subset: only ? defs.map((d) => d.id) : null,
  }

  const ids = installDeterministicIds(DEFAULT_SEED)
  const results: ScenarioResult[] = []
  try {
    for (const def of defs) {
      ids.reseed(def.id)
      const s = new Scenario(def, { start: TEST_NOW })
      let error: unknown
      try {
        await s.setup()
        await def.run(s)
      } catch (e) {
        error = e
      }
      const r = await s.finish(error)
      results.push(r)
      const failed = r.assertions.filter((a) => !a.pass)
      log(`${r.pass ? 'PASS' : 'FAIL'}  ${def.id.padEnd(4)} ${def.title}  (${r.assertions.length - failed.length}/${r.assertions.length})`)
      for (const a of failed) log(`        ✗ ${a.label} — observed: ${a.observed}`)
    }
  } finally {
    ids.restore()
  }

  const metrics = computeMetrics(results)
  write(out, results, metrics, env)
  return { results, metrics, out, pass: metrics.scenarios.passed === metrics.scenarios.total && results.length > 0 }
}

function write(out: string, results: ScenarioResult[], metrics: Metrics, env: Environment): void {
  mkdirSync(join(out, 'scenarios'), { recursive: true })
  // remove only files this runner generates
  for (const f of readdirSync(join(out, 'scenarios'))) if (/^[A-D]\d+\.md$/.test(f)) rmSync(join(out, 'scenarios', f))
  for (const f of readdirSync(out)) if (/^audit-C\d+(\.tampered)?\.jsonl$/.test(f) || ['operations.jsonl', 'SUMMARY.md', 'REPRODUCE.md'].includes(f)) rmSync(join(out, f))

  writeFileSync(join(out, 'operations.jsonl'), results.flatMap((r) => r.ops).map(opLine).join('\n') + '\n')
  for (const r of results) {
    writeFileSync(join(out, 'scenarios', `${r.def.id}.md`), scenarioMarkdown(r, env))
    if (r.def.category === 'C') writeFileSync(join(out, `audit-${r.def.id}.jsonl`), r.auditJsonl)
    for (const f of r.files) writeFileSync(join(out, f.path), f.content)
  }
  writeFileSync(join(out, 'SUMMARY.md'), summaryMarkdown(results, metrics, env))
  writeFileSync(join(out, 'REPRODUCE.md'), reproduceMarkdown(metrics, env, SCENARIOS.length))
}

function gitCommit(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return dirty ? `${sha} (+ uncommitted changes)` : sha
  } catch {
    return 'unknown (not a git checkout)'
  }
}

function verifyFile(path: string): boolean {
  const entries = parseAuditJSONL(readFileSync(path, 'utf8'))
  const v = verifyAudit(entries)
  console.log(JSON.stringify({ file: path, ...v }))
  return v.ok
}

function parseArgs(argv: string[]): { out?: string; only?: string[]; verify?: string; help?: boolean } {
  const args: { out?: string; only?: string[]; verify?: string; help?: boolean } = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const value = () => {
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i]
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`)
      return v
    }
    if (a === '--out' || a.startsWith('--out=')) args.out = value()
    else if (a === '--only' || a.startsWith('--only=')) args.only = value().split(',')
    else if (a === '--verify-audit' || a.startsWith('--verify-audit=')) args.verify = value()
    else if (a === '--help' || a === '-h') args.help = true
    else throw new Error(`Unknown argument: ${a}`)
  }
  return args
}

async function main(): Promise<number> {
  let args: ReturnType<typeof parseArgs>
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error((e as Error).message)
    return 2
  }
  if (args.help) {
    console.log('usage: tsx scripts/run-scenarios.ts [--out evidence/latest] [--only A1,B5] | --verify-audit <file.jsonl>')
    return 0
  }
  if (args.verify) return verifyFile(args.verify) ? 0 : 1
  let run: EvidenceRun
  try {
    run = await runEvidence({ out: args.out, only: args.only })
  } catch (e) {
    console.error((e as Error).message)
    return 2
  }
  console.log('')
  console.log(metricsTable(run.metrics))
  console.log('')
  console.log(`${run.pass ? 'ALL PASS' : 'FAILURES'} — ${run.metrics.scenarios.passed}/${run.metrics.scenarios.total} scenarios, ${run.metrics.assertions.passed}/${run.metrics.assertions.total} assertions → ${run.out}`)
  return run.pass ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code
  })
}
