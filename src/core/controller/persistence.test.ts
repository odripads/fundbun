import { describe, expect, it } from 'vitest'
import { createAuditEntry } from '../security/audit'
import type { AppState, AuditEntry } from '../types'
import { verifyAuditAnchored } from './audit'
import { createPersistence, extendsHead, memoryStorage } from './persistence'
import { emptyState } from './state'

const TS = '2026-10-22T02:00:00.000Z'

function chain(n: number, from: AuditEntry[] = []): AuditEntry[] {
  const log = [...from]
  for (let i = 0; i < n; i++) log.push(createAuditEntry(log, { actor: 'user', type: 'user_action', summary: `step ${log.length + 1}`, data: { i }, ts: TS }))
  return log
}

function stateWith(audit: AuditEntry[]): AppState {
  return { ...emptyState('2026-10-22'), audit }
}

describe('audit head anchor (persistence)', () => {
  it('is written after each plaintext save under <key>.audit-head', () => {
    const storage = memoryStorage()
    const p = createPersistence(storage, 'k')
    expect(p.auditHead()).toBeNull()
    const log = chain(3)
    p.save(stateWith(log))
    expect(p.auditHead()).toEqual({ hash: log[2].hash, count: 3, seq: 3 })
    expect(JSON.parse(storage.getItem('k.audit-head')!)).toEqual({ hash: log[2].hash, count: 3, seq: 3 })
  })

  it('only moves forward along the same chain', () => {
    const p = createPersistence(memoryStorage(), 'k')
    const log = chain(5)
    p.save(stateWith(log))
    p.save(stateWith(log.slice(0, 2)))
    expect(p.auditHead()?.count).toBe(5)
    p.save(stateWith(chain(1, log.slice(0, 2))))
    expect(p.auditHead()?.count).toBe(5)
    const longer = chain(2, log)
    p.save(stateWith(longer))
    expect(p.auditHead()).toMatchObject({ count: 7, hash: longer[6].hash })
  })

  it('resetAuditHead and wipe forget the anchor; garbage reads as none', () => {
    const storage = memoryStorage()
    const p = createPersistence(storage, 'k')
    p.save(stateWith(chain(2)))
    p.resetAuditHead()
    expect(p.auditHead()).toBeNull()
    p.save(stateWith(chain(2)))
    p.wipe()
    expect(storage.getItem('k.audit-head')).toBeNull()
    storage.setItem('k.audit-head', '{"hash":"nope","count":1,"seq":1}')
    expect(p.auditHead()).toBeNull()
    storage.setItem('k.audit-head', 'not json')
    expect(p.auditHead()).toBeNull()
  })

  it('extendsHead', () => {
    const log = chain(4)
    const head = { hash: log[2].hash, count: 3, seq: 3 }
    expect(extendsHead(log, head)).toBe(true)
    expect(extendsHead(log.slice(0, 2), head)).toBe(false)
    const other = chain(2, log.slice(0, 2))
    other[2] = createAuditEntry(log.slice(0, 2), { actor: 'system', type: 'session_start', summary: 'other', data: {}, ts: TS })
    expect(extendsHead(other, head)).toBe(false)
  })
})

describe('verifyAuditAnchored', () => {
  const log = chain(6)
  const head = { hash: log[5].hash, count: 6, seq: 6 }

  it('passes for the anchored chain and for entries appended after the anchor', () => {
    expect(verifyAuditAnchored(log, head)).toEqual({ ok: true, count: 6 })
    expect(verifyAuditAnchored(chain(2, log), head)).toEqual({ ok: true, count: 8 })
    expect(verifyAuditAnchored(log, null)).toEqual({ ok: true, count: 6 })
  })

  it('fails when the newest entries are gone, at the first missing seq', () => {
    const v = verifyAuditAnchored(log.slice(0, 3), head)
    expect(v).toMatchObject({ ok: false, count: 3, brokenAt: 4 })
    expect(v.reason).toMatch(/newest entries/)
  })

  it('still reports edits first (the plain chain check runs before the anchor)', () => {
    const edited = structuredClone(log)
    edited[1].summary = 'edited'
    expect(verifyAuditAnchored(edited, head)).toMatchObject({ ok: false, brokenAt: 2 })
  })
})
