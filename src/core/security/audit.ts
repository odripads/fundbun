import { nowISO } from '../dates'
import type { AuditActor, AuditEntry, AuditType, ISODateTime } from '../types'
import { sha256Hex } from './sha256'

export const GENESIS_HASH = '0'.repeat(64)

/**
 * Deterministic JSON: object keys sorted recursively, no whitespace.
 * Follows JSON.stringify semantics otherwise: `undefined`, functions and symbols are dropped from objects
 * (and become null in arrays), non-finite numbers become null, `toJSON` is honoured.
 * Throws on BigInt and circular structures (they have no canonical JSON form).
 */
export function canonicalJSON(value: unknown): string {
  return serialize(value, new Set()) ?? 'null'
}

function serialize(value: unknown, stack: Set<object>): string | undefined {
  let v = value
  if (v !== null && typeof v === 'object' && typeof (v as { toJSON?: unknown }).toJSON === 'function') {
    v = (v as { toJSON: (key: string) => unknown }).toJSON('')
  }
  if (v instanceof Number || v instanceof String || v instanceof Boolean) v = v.valueOf()
  switch (typeof v) {
    case 'string':
      return JSON.stringify(v)
    case 'number':
      return Number.isFinite(v) ? JSON.stringify(v) : 'null'
    case 'boolean':
      return v ? 'true' : 'false'
    case 'bigint':
      throw new TypeError('canonicalJSON: BigInt values are not supported')
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined
  }
  if (v === null) return 'null'
  const obj = v as object
  if (stack.has(obj)) throw new TypeError('canonicalJSON: circular structure')
  stack.add(obj)
  try {
    if (Array.isArray(obj)) return `[${obj.map((item) => serialize(item, stack) ?? 'null').join(',')}]`
    const record = obj as Record<string, unknown>
    const parts: string[] = []
    for (const key of Object.keys(record).sort()) {
      const s = serialize(record[key], stack)
      if (s !== undefined) parts.push(`${JSON.stringify(key)}:${s}`)
    }
    return `{${parts.join(',')}}`
  } finally {
    stack.delete(obj)
  }
}

type HashedFields = Pick<AuditEntry, 'seq' | 'ts' | 'actor' | 'type' | 'summary' | 'data'>

/** sha256(prevHash + canonicalJSON({ seq, ts, actor, type, summary, data })) */
export function hashAuditEntry(prevHash: string, e: HashedFields): string {
  const { seq, ts, actor, type, summary, data } = e
  return sha256Hex(prevHash + canonicalJSON({ seq, ts, actor, type, summary, data }))
}

/**
 * Create the next hash-chained entry for `log` (does NOT mutate `log`; caller appends).
 * hash = sha256(prevHash + canonicalJSON({ seq, ts, actor, type, summary, data })).
 * Sequence numbers start at 1. `data` is stored as its canonical JSON round-trip, so the entry verifies
 * identically after persistence and later mutation of the caller's object cannot break the chain.
 * Pass `ts` from the controller's clock; the wall clock is only a fallback.
 */
export function createAuditEntry(
  log: readonly AuditEntry[],
  e: { actor: AuditActor; type: AuditType; summary: string; data?: Record<string, unknown>; ts?: ISODateTime },
): AuditEntry {
  const prev = log.length > 0 ? log[log.length - 1] : undefined
  const seq = prev ? prev.seq + 1 : 1
  const prevHash = prev ? prev.hash : GENESIS_HASH
  const fields: HashedFields = {
    seq,
    ts: e.ts ?? nowISO(),
    actor: e.actor,
    type: e.type,
    summary: e.summary,
    data: JSON.parse(canonicalJSON(e.data ?? {})) as Record<string, unknown>,
  }
  return { ...fields, prevHash, hash: hashAuditEntry(prevHash, fields) }
}

export interface VerifyAuditOptions {
  /**
   * The log was pruned from the front (e.g. capped for storage): trust the first entry's prevHash and seq
   * as the anchor instead of requiring the genesis entry.
   */
  allowPrunedPrefix?: boolean
  /**
   * Hash of the newest entry as recorded elsewhere (e.g. shown in evidence). A plain hash chain cannot detect
   * deletion of its newest entries; comparing the head against this anchor can.
   */
  expectedHeadHash?: string
}

export interface AuditVerification {
  ok: boolean
  count: number
  brokenAt?: number
  reason?: string
}

/** Recompute the chain; reports the first broken sequence number. Never throws, even on garbage input. */
export function verifyAudit(log: readonly AuditEntry[], opts: VerifyAuditOptions = {}): AuditVerification {
  const count = Array.isArray(log) ? log.length : 0
  const broken = (brokenAt: number, reason: string): AuditVerification => ({ ok: false, count, brokenAt, reason })
  if (!Array.isArray(log)) return broken(1, 'The audit log is not a list of entries.')
  for (let i = 0; i < log.length; i++) {
    const e = log[i]
    if (!isEntryShape(e)) return broken(i + 1, `Entry at position ${i + 1} is malformed.`)
    const prev = i > 0 ? log[i - 1] : undefined
    const expectedSeq = prev ? prev.seq + 1 : 1
    if (!safeHashMatches(e)) return broken(e.seq, `Entry #${e.seq} was changed after it was written (its hash no longer matches).`)
    if (prev && e.prevHash !== prev.hash) {
      return broken(e.seq, `Entry #${e.seq} does not link to entry #${prev.seq}: an entry was removed, inserted or reordered.`)
    }
    if (!prev && !opts.allowPrunedPrefix && e.prevHash !== GENESIS_HASH) {
      return broken(e.seq, `The log does not start at the first entry: earlier entries were removed or this one was inserted.`)
    }
    if ((prev || !opts.allowPrunedPrefix) && e.seq !== expectedSeq) {
      return broken(e.seq, `Entry #${e.seq} is out of order: expected #${expectedSeq}.`)
    }
  }
  if (opts.expectedHeadHash !== undefined) {
    const head = log.length > 0 ? log[log.length - 1] : undefined
    if ((head?.hash ?? GENESIS_HASH) !== opts.expectedHeadHash) {
      return broken((head?.seq ?? 0) + 1, 'The newest entries of the log are missing (the head does not match its recorded hash).')
    }
  }
  return { ok: true, count }
}

function isEntryShape(e: unknown): e is AuditEntry {
  if (!e || typeof e !== 'object') return false
  const x = e as Record<string, unknown>
  return (
    Number.isSafeInteger(x.seq) &&
    typeof x.ts === 'string' &&
    typeof x.actor === 'string' &&
    typeof x.type === 'string' &&
    typeof x.summary === 'string' &&
    !!x.data && typeof x.data === 'object' && !Array.isArray(x.data) &&
    typeof x.prevHash === 'string' &&
    typeof x.hash === 'string'
  )
}

function safeHashMatches(e: AuditEntry): boolean {
  try {
    return hashAuditEntry(e.prevHash, e) === e.hash
  } catch {
    return false
  }
}

/** One canonical JSON object per line (newline-terminated) — the export format for evidence and PIPL access requests. */
export function auditToJSONL(log: readonly AuditEntry[]): string {
  return log.map((e) => canonicalJSON(e) + '\n').join('')
}

/** Inverse of auditToJSONL. Throws with the line number on invalid JSON; run verifyAudit on the result. */
export function parseAuditJSONL(text: string): AuditEntry[] {
  const out: AuditEntry[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '') return
    try {
      out.push(JSON.parse(line) as AuditEntry)
    } catch {
      throw new SyntaxError(`Audit JSONL line ${i + 1} is not valid JSON`)
    }
  })
  return out
}
