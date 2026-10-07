import { describe, expect, it } from 'vitest'
import type { AuditEntry } from '../types'
import { GENESIS_HASH, auditToJSONL, canonicalJSON, createAuditEntry, hashAuditEntry, parseAuditJSONL, verifyAudit } from './audit'
import { sha256Hex } from './sha256'

const TS = '2026-10-22T10:00:00.000Z'

function buildLog(n: number): AuditEntry[] {
  const log: AuditEntry[] = []
  for (let i = 0; i < n; i++) {
    log.push(
      createAuditEntry(log, {
        actor: i % 2 ? 'agent' : 'policy',
        type: i % 2 ? 'tool_call' : 'policy_decision',
        summary: `step ${i + 1}`,
        data: { i, amount: 1000 * i, nested: { b: 2, a: [1, { z: true, y: null }] } },
        ts: `2026-10-22T10:00:${String(i).padStart(2, '0')}.000Z`,
      }),
    )
  }
  return log
}

const clone = (log: AuditEntry[]): AuditEntry[] => JSON.parse(JSON.stringify(log))

describe('canonicalJSON', () => {
  it('sorts keys recursively and has no whitespace', () => {
    expect(canonicalJSON({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,{"x":2,"y":1}]},"b":1}')
  })

  it('is independent of key insertion order', () => {
    expect(canonicalJSON({ x: 1, y: { p: 1, q: 2 } })).toBe(canonicalJSON({ y: { q: 2, p: 1 }, x: 1 }))
  })

  it('drops undefined in objects and turns it into null in arrays (JSON semantics)', () => {
    expect(canonicalJSON({ a: undefined, b: 1, f: () => 1 })).toBe('{"b":1}')
    expect(canonicalJSON([undefined, 1, () => 1])).toBe('[null,1,null]')
    expect(canonicalJSON(undefined)).toBe('null')
  })

  it('serialises primitives like JSON.stringify', () => {
    expect(canonicalJSON(null)).toBe('null')
    expect(canonicalJSON(true)).toBe('true')
    expect(canonicalJSON(-0)).toBe('0')
    expect(canonicalJSON(1e21)).toBe('1e+21')
    expect(canonicalJSON(NaN)).toBe('null')
    expect(canonicalJSON(Infinity)).toBe('null')
    expect(canonicalJSON('line\n"quote" \\ 中文 😀')).toBe(JSON.stringify('line\n"quote" \\ 中文 😀'))
    expect(canonicalJSON(new String('s'))).toBe('"s"')
  })

  it('honours toJSON (dates)', () => {
    expect(canonicalJSON({ when: new Date('2026-10-22T00:00:00.000Z') })).toBe('{"when":"2026-10-22T00:00:00.000Z"}')
  })

  it('sorts keys by UTF-16 code unit, like JSON canonicalisation (RFC 8785)', () => {
    expect(canonicalJSON({ b: 1, B: 2, 中: 3, a: 4 })).toBe('{"B":2,"a":4,"b":1,"中":3}')
  })

  it('throws on circular structures and BigInt', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    expect(() => canonicalJSON(a)).toThrow(TypeError)
    expect(() => canonicalJSON({ n: 1n })).toThrow(TypeError)
  })

  it('allows the same object twice when it is not a cycle', () => {
    const shared = { k: 1 }
    expect(canonicalJSON({ a: shared, b: shared })).toBe('{"a":{"k":1},"b":{"k":1}}')
  })

  it('keeps __proto__ as an ordinary key', () => {
    expect(canonicalJSON(JSON.parse('{"__proto__":{"x":1},"a":1}'))).toBe('{"__proto__":{"x":1},"a":1}')
  })
})

describe('createAuditEntry', () => {
  it('starts the chain at seq 1 from the genesis hash', () => {
    const e = createAuditEntry([], { actor: 'system', type: 'session_start', summary: 'start', ts: TS })
    expect(e.seq).toBe(1)
    expect(e.prevHash).toBe(GENESIS_HASH)
    expect(e.data).toEqual({})
    expect(e.hash).toBe(sha256Hex(GENESIS_HASH + canonicalJSON({ seq: 1, ts: TS, actor: 'system', type: 'session_start', summary: 'start', data: {} })))
    expect(e.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('links each entry to the previous hash and increments seq', () => {
    const log = buildLog(3)
    expect(log.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(log[1].prevHash).toBe(log[0].hash)
    expect(log[2].prevHash).toBe(log[1].hash)
  })

  it('does not mutate the log and snapshots data', () => {
    const log = buildLog(1)
    const data: Record<string, unknown> = { amount: 500, skip: undefined }
    const e = createAuditEntry(log, { actor: 'agent', type: 'tool_call', summary: 's', data, ts: TS })
    expect(log).toHaveLength(1)
    data.amount = 999_999
    expect(e.data).toEqual({ amount: 500 })
    expect(verifyAudit([...log, e]).ok).toBe(true)
  })

  it('falls back to a wall-clock timestamp when none is given', () => {
    const e = createAuditEntry([], { actor: 'system', type: 'session_start', summary: 's' })
    expect(Number.isFinite(Date.parse(e.ts))).toBe(true)
  })

  it('stores Chinese and emoji summaries verifiably', () => {
    const e = createAuditEntry([], { actor: 'user', type: 'user_action', summary: '支付电费 ¥486.20 ✅', ts: TS })
    expect(verifyAudit([e]).ok).toBe(true)
  })
})

describe('verifyAudit', () => {
  it('accepts an intact chain, including after a JSON round trip', () => {
    const log = buildLog(10)
    expect(verifyAudit(log)).toEqual({ ok: true, count: 10 })
    expect(verifyAudit(clone(log))).toEqual({ ok: true, count: 10 })
  })

  it('accepts an empty log', () => {
    expect(verifyAudit([])).toEqual({ ok: true, count: 0 })
  })

  it('detects edited data', () => {
    const log = clone(buildLog(5))
    ;(log[2].data as Record<string, unknown>).amount = 1
    expect(verifyAudit(log)).toMatchObject({ ok: false, brokenAt: 3 })
    expect(verifyAudit(log).reason).toMatch(/changed/)
  })

  it('detects edited summary, actor, type and timestamp', () => {
    for (const field of ['summary', 'actor', 'type', 'ts'] as const) {
      const log = clone(buildLog(4))
      ;(log[1] as unknown as Record<string, string>)[field] = 'user'
      expect(verifyAudit(log)).toMatchObject({ ok: false, brokenAt: 2 })
    }
  })

  it('detects an edit even when the attacker recomputed that entry hash', () => {
    const log = clone(buildLog(5))
    log[2].summary = 'nothing to see here'
    log[2].hash = hashAuditEntry(log[2].prevHash, log[2])
    expect(verifyAudit(log)).toMatchObject({ ok: false, brokenAt: 4 })
  })

  it('detects reordered entries', () => {
    const log = clone(buildLog(5))
    ;[log[1], log[2]] = [log[2], log[1]]
    const result = verifyAudit(log)
    expect(result.ok).toBe(false)
    expect(result.brokenAt).toBe(3)
    expect(result.reason).toMatch(/removed, inserted or reordered/)
  })

  it('detects a deleted middle entry', () => {
    const log = clone(buildLog(5))
    log.splice(2, 1)
    expect(verifyAudit(log)).toMatchObject({ ok: false, brokenAt: 4 })
  })

  it('detects a deleted first entry', () => {
    const log = clone(buildLog(5)).slice(1)
    expect(verifyAudit(log)).toMatchObject({ ok: false, brokenAt: 2 })
  })

  it('detects an inserted forged entry', () => {
    const log = clone(buildLog(4))
    const forged = createAuditEntry(log.slice(0, 2), { actor: 'user', type: 'action_confirmed', summary: 'user approved transfer', ts: TS })
    log.splice(2, 0, forged)
    expect(verifyAudit(log)).toMatchObject({ ok: false, brokenAt: 3 })
  })

  it('detects a sequence gap even when the hashes link', () => {
    const log: AuditEntry[] = buildLog(2)
    const bad = createAuditEntry(log, { actor: 'agent', type: 'tool_call', summary: 'x', ts: TS })
    bad.seq = 7
    bad.hash = hashAuditEntry(bad.prevHash, bad)
    expect(verifyAudit([...log, bad])).toMatchObject({ ok: false, brokenAt: 7 })
  })

  it('detects truncation of the newest entries when the head hash is anchored', () => {
    const log = buildLog(6)
    const head = log[5].hash
    expect(verifyAudit(log, { expectedHeadHash: head }).ok).toBe(true)
    expect(verifyAudit(log.slice(0, 4), { expectedHeadHash: head })).toMatchObject({ ok: false, brokenAt: 5 })
    expect(verifyAudit([], { expectedHeadHash: GENESIS_HASH }).ok).toBe(true)
  })

  it('verifies a log pruned from the front when allowed', () => {
    const tail = buildLog(8).slice(3)
    expect(verifyAudit(tail).ok).toBe(false)
    expect(verifyAudit(tail, { allowPrunedPrefix: true })).toEqual({ ok: true, count: 5 })
  })

  it('never throws on garbage', () => {
    expect(verifyAudit(null as unknown as AuditEntry[])).toMatchObject({ ok: false })
    expect(verifyAudit([null] as unknown as AuditEntry[])).toMatchObject({ ok: false, brokenAt: 1 })
    expect(verifyAudit([{ seq: 1 }] as unknown as AuditEntry[])).toMatchObject({ ok: false, brokenAt: 1 })
    const log = clone(buildLog(2))
    ;(log[1] as unknown as Record<string, unknown>).data = [1, 2]
    expect(verifyAudit(log)).toMatchObject({ ok: false, brokenAt: 2 })
  })
})

describe('auditToJSONL / parseAuditJSONL', () => {
  it('writes one canonical JSON object per line', () => {
    const log = buildLog(3)
    const jsonl = auditToJSONL(log)
    const lines = jsonl.split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[3]).toBe('')
    expect(lines[0]).toBe(canonicalJSON(log[0]))
    expect(JSON.parse(lines[1]).hash).toBe(log[1].hash)
  })

  it('returns an empty string for an empty log', () => {
    expect(auditToJSONL([])).toBe('')
  })

  it('round-trips and still verifies', () => {
    const log = buildLog(5)
    const parsed = parseAuditJSONL(auditToJSONL(log))
    expect(parsed).toEqual(log)
    expect(verifyAudit(parsed).ok).toBe(true)
  })

  it('reports the line number of invalid JSON', () => {
    expect(() => parseAuditJSONL('{"seq":1}\nnot json\n')).toThrow(/line 2/)
  })
})
