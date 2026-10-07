import type { AuditActor, AuditEntry, AuditType, ISODateTime } from '../types'

export const GENESIS_HASH = '0'.repeat(64)

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJSON(value: unknown): string {
  throw new Error('TODO canonicalJSON ' + typeof value)
}

/**
 * Create the next hash-chained entry for `log` (does NOT mutate `log`; caller appends).
 * hash = sha256(prevHash + canonicalJSON({ seq, ts, actor, type, summary, data })).
 */
export function createAuditEntry(
  log: readonly AuditEntry[],
  e: { actor: AuditActor; type: AuditType; summary: string; data?: Record<string, unknown>; ts?: ISODateTime },
): AuditEntry {
  throw new Error('TODO createAuditEntry ' + log.length + e.type)
}

/** Recompute the chain; reports the first broken sequence number. */
export function verifyAudit(log: readonly AuditEntry[]): { ok: boolean; count: number; brokenAt?: number; reason?: string } {
  throw new Error('TODO verifyAudit ' + log.length)
}

export function auditToJSONL(log: readonly AuditEntry[]): string {
  throw new Error('TODO auditToJSONL ' + log.length)
}
