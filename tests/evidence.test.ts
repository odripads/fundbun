import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseAuditJSONL, verifyAudit } from '../src/core/security/audit'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SUBSET = ['A1', 'B5', 'C1', 'C3']
const exec = promisify(execFile)

/** the runner as judges run it: a separate Node process via tsx */
function runner(...args: string[]) {
  return exec(process.execPath, ['--import', 'tsx', 'scripts/run-scenarios.ts', ...args], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 })
}

const read = (dir: string, file: string) => readFileSync(join(dir, file), 'utf8')

function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`])).sort()
}

describe('npm run evidence — subset A1, B5, C1, C3', () => {
  let tmp = ''
  let out = ''
  let again = ''
  let stdout = ''

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'fundbun-evidence-'))
    out = join(tmp, 'first')
    again = join(tmp, 'second')
    ;({ stdout } = await runner('--out', out, '--only', SUBSET.join(',')))
    await runner('--out', again, '--only', SUBSET.join(','))
  }, 120_000)

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true })
  })

  it('exits 0 and reports every scenario PASS', () => {
    for (const id of SUBSET) expect(stdout).toMatch(new RegExp(`^PASS\\s+${id}\\s`, 'm'))
    expect(stdout).not.toMatch(/^FAIL/m)
    expect(stdout).toMatch(/ALL PASS — 4\/4 scenarios/)
  })

  it('writes exactly the evidence files', () => {
    expect(listFiles(out)).toEqual([
      'REPRODUCE.md',
      'SUMMARY.md',
      'audit-C1.jsonl',
      'audit-C3.jsonl',
      'operations.jsonl',
      ...SUBSET.map((id) => `scenarios/${id}.md`),
    ].sort())
  })

  it('operations.jsonl: one JSON operation per line, in order, with the required fields and no raw account numbers', () => {
    const text = read(out, 'operations.jsonl')
    const ops = text.trim().split('\n').map((l) => JSON.parse(l))
    expect(ops.length).toBeGreaterThan(40)
    for (const op of ops) {
      expect(Object.keys(op).slice(0, 5)).toEqual(['ts', 'scenario', 'step', 'actor', 'action'])
      expect(op).toHaveProperty('result')
      expect(['user', 'agent', 'policy', 'bank', 'system']).toContain(op.actor)
      expect(SUBSET).toContain(op.scenario)
      expect(op.ts.startsWith('2026-10-22T02:')).toBe(true)
    }
    expect([...new Set(ops.map((o) => o.scenario))]).toEqual(SUBSET)
    const actions = new Set(ops.map((o) => o.action))
    for (const a of ['user_turn', 'tool_call', 'policy_decision', 'approval', 'execution', 'audit', 'balance_change']) expect(actions).toContain(a)
    // C1's denial carries its rule id; B5's execution carries balances before/after
    expect(ops.some((o) => o.scenario === 'C1' && o.action === 'pending_action' && o.decision === 'deny' && o.ruleIds?.includes('P-T4-PROHIBITED'))).toBe(true)
    expect(ops.some((o) => o.scenario === 'B5' && o.action === 'balance_change' && o.balancesBefore.chk_main - o.balancesAfter.chk_main === 48_620)).toBe(true)
    // inputs are redacted before they are written
    expect(text).not.toContain('6222 0210 0112 3456 789')
  })

  it('each transcript has the goal, the steps, and only passing assertions', () => {
    for (const id of SUBSET) {
      const md = read(out, `scenarios/${id}.md`)
      expect(md).toMatch(new RegExp(`^# ${id} · .* — PASS$`, 'm'))
      expect(md).toContain('| Task |')
      expect(md).toContain('| Expected |')
      expect(md).toContain('## Transcript')
      expect(md).toContain('## Assertions')
      expect(md).toMatch(/\| PASS \|/)
      expect(md).not.toContain('FAIL')
    }
    const b5 = read(out, 'scenarios/B5.md')
    expect(b5).toMatch(/Policy: \*\*STEP_UP · pay_bill\*\*/)
    expect(b5).toContain('Binding hash verified')
    expect(b5).toMatch(/Balances: chk_main .*−¥486\.20/)
  })

  it('security scenarios ship a hash-chained audit log that verifies, also through the CLI', async () => {
    for (const id of ['C1', 'C3']) {
      const entries = parseAuditJSONL(read(out, `audit-${id}.jsonl`))
      expect(entries.length).toBeGreaterThan(3)
      expect(verifyAudit(entries)).toEqual({ ok: true, count: entries.length })
    }
    const types = parseAuditJSONL(read(out, 'audit-C3.jsonl')).map((e) => e.type)
    expect(types).toContain('injection_detected')
    const { stdout: v } = await runner('--verify-audit', join(out, 'audit-C1.jsonl'))
    expect(JSON.parse(v)).toMatchObject({ ok: true })
  }, 60_000)

  it('SUMMARY.md has the scenario table, the metrics and the environment', () => {
    const md = read(out, 'SUMMARY.md')
    for (const id of SUBSET) expect(md).toMatch(new RegExp(`\\| \\[${id}\\]\\(scenarios/${id}\\.md\\) \\|.*\\| PASS \\|`))
    expect(md).toContain('**4/4 (100%)**')
    for (const metric of ['Task success rate', 'Average user turns per task', 'Attack block rate', 'False-refusal rate', 'Grounding violations caught', 'Circuit-breaker trips', 'Audit chain verification']) expect(md).toContain(metric)
    expect(md).toMatch(/seed\s+20261020/)
    expect(md).toMatch(/sandbox date\s+2026-10-22/)
    expect(md).toContain('subset: A1, B5, C1, C3')
    expect(read(out, 'REPRODUCE.md')).toContain('npm run evidence')
  })

  it('is byte-for-byte reproducible run to run (except the git commit line)', () => {
    const stable = (text: string) => text.replace(/^git commit .*$/m, 'git commit <ignored>')
    expect(listFiles(again)).toEqual(listFiles(out))
    for (const f of listFiles(out)) expect(stable(read(again, f)), f).toBe(stable(read(out, f)))
  })

  it('rejects unknown scenario ids with exit code 2 and writes nothing', async () => {
    const dir = join(tmp, 'bad')
    const err = await runner('--out', dir, '--only', 'Z9').catch((e: { code: number; stderr: string }) => e)
    expect(err).toMatchObject({ code: 2 })
    expect((err as { stderr: string }).stderr).toMatch(/Unknown scenario id/)
    expect(existsSync(dir)).toBe(false)
  }, 60_000)
})
