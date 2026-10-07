import { createAuditEntry } from '../security/audit'
import type { AppState, AuditActor, AuditType, ISODateTime } from '../types'

/**
 * Append a hash-chained audit entry to a (draft) state. Mutates `state.audit`.
 * createAuditEntry stores `data` as its canonical-JSON round-trip, so the hash survives save/load.
 */
export function appendAudit(
  state: AppState,
  ts: ISODateTime,
  actor: AuditActor,
  type: AuditType,
  summary: string,
  data: Record<string, unknown> = {},
): void {
  state.audit.push(createAuditEntry(state.audit, { actor, type, summary, data, ts }))
}
