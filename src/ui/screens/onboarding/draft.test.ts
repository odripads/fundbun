import { describe, expect, it } from 'vitest'
import { clearDraft, DRAFT_KEY, emptyDraft, hasProgress, isStepId, loadDraft, MAX_CSV_CHARS, sanitizeDraft, saveDraft } from './draft'

/** Minimal Storage; `quota` makes setItem throw above that many characters. */
function memoryStore(quota = Infinity): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => {
      if (v.length > quota) throw new DOMException('quota', 'QuotaExceededError')
      data.set(k, v)
    },
  }
}

describe('emptyDraft', () => {
  it('pre-ticks nothing, starts gentle, low autonomy and the contract’s default caps', () => {
    const d = emptyDraft()
    expect(Object.values(d.consent)).toEqual([false, false, false])
    expect(d.tone).toBe('gentle')
    expect(d.autonomy).toBe('suggest')
    expect(d.currency).toBe('CNY')
    expect(d.caps).toEqual({ perAction: '500', daily: '1,000', monthly: '5,000' })
    expect(d.tripwires.map((t) => [t.key, t.enabled, t.threshold])).toEqual([
      ['month80', true, null],
      ['month100', true, null],
      ['single', true, null],
      ['pace', true, null],
    ])
  })

  it('has no PIN field at all — the PIN is never part of what is persisted', () => {
    expect(JSON.stringify(emptyDraft()).toLowerCase()).not.toContain('pin')
  })
})

describe('sanitizeDraft', () => {
  it('returns defaults for garbage and unknown versions', () => {
    expect(sanitizeDraft(null)).toEqual(emptyDraft())
    expect(sanitizeDraft('x')).toEqual(emptyDraft())
    expect(sanitizeDraft({ v: 2, name: 'x' })).toEqual(emptyDraft())
  })

  it('keeps valid fields and drops tampered ones', () => {
    const d = sanitizeDraft({
      v: 1,
      name: 'Mei',
      currency: 'XXX',
      payday: 31,
      tone: 'evil',
      autonomy: 'autopilot',
      consent: { financialData: 'yes', llmProcessing: true },
      dreams: [
        { key: 'a', name: 'Birkin', price: 100, image: 'https://evil.example/x.png', kind: 'goal' },
        { name: '', price: 5 },
        { name: 'Bad price', price: 1.5 },
      ],
      tripwires: [{ key: 'single', enabled: false, threshold: -4 }],
      data: { kind: 'persona', personaId: 'eve' },
    })
    expect(d.name).toBe('Mei')
    expect(d.currency).toBe('CNY')
    expect(d.payday).toBe(10)
    expect(d.tone).toBe('gentle')
    expect(d.autonomy).toBe('autopilot')
    expect(d.consent).toEqual({ financialData: false, llmProcessing: true, notifications: false })
    expect(d.dreams).toEqual([{ key: 'a', name: 'Birkin', price: 100, image: 'preset:gift', kind: 'goal' }])
    expect(d.tripwires.find((t) => t.key === 'single')).toEqual({ key: 'single', enabled: false, threshold: null })
    expect(d.data).toMatchObject({ kind: 'persona', personaId: null })
  })

  it('keeps on-device photo data URLs', () => {
    const photo = 'data:image/jpeg;base64,AAAA'
    const d = sanitizeDraft({ v: 1, dreams: [{ key: 'p', name: 'Mine', price: 10, image: photo, kind: 'treat' }] })
    expect(d.dreams[0].image).toBe(photo)
  })
})

describe('storage', () => {
  it('round-trips through sessionStorage-like storage', () => {
    const store = memoryStore()
    const d = { ...emptyDraft(), name: 'Arif', income: '4,800' }
    expect(saveDraft(d, store)).toBe(true)
    expect(loadDraft(store)).toEqual(d)
    clearDraft(store)
    expect(store.data.has(DRAFT_KEY)).toBe(false)
    expect(loadDraft(store)).toEqual(emptyDraft())
  })

  it('never throws: blocked storage and corrupt JSON fall back to an empty draft', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    } as unknown as Storage
    expect(loadDraft(blocked)).toEqual(emptyDraft())
    expect(saveDraft(emptyDraft(), blocked)).toBe(false)
    expect(() => clearDraft(blocked)).not.toThrow()
    expect(saveDraft(emptyDraft(), null)).toBe(false)
    const store = memoryStore()
    store.setItem(DRAFT_KEY, '{nope')
    expect(loadDraft(store)).toEqual(emptyDraft())
  })

  it('drops the CSV, then photos, before giving up when the quota is tight', () => {
    const photo = `data:image/jpeg;base64,${'A'.repeat(4000)}`
    const d = {
      ...emptyDraft(),
      name: 'Mei',
      dreams: [{ key: 'p', name: 'Mine', price: 10, image: photo, kind: 'goal' as const }],
      data: { ...emptyDraft().data, kind: 'csv' as const, csvName: 'big.csv', csvText: 'x'.repeat(6000) },
    }
    const store = memoryStore(3000)
    expect(saveDraft(d, store)).toBe(true)
    const saved = loadDraft(store)
    expect(saved.name).toBe('Mei')
    expect(saved.data.csvText).toBe('')
    expect(saved.dreams[0].image).toBe('preset:gift')
  })

  it('does not persist CSV text above the cap', () => {
    const store = memoryStore()
    const d = { ...emptyDraft(), data: { ...emptyDraft().data, kind: 'csv' as const, csvName: 'huge.csv', csvText: 'x'.repeat(MAX_CSV_CHARS + 1) } }
    expect(saveDraft(d, store)).toBe(true)
    expect(loadDraft(store).data.csvText).toBe('')
  })
})

describe('helpers', () => {
  it('knows when there is something to resume', () => {
    expect(hasProgress(emptyDraft())).toBe(false)
    expect(hasProgress({ ...emptyDraft(), name: 'Mei' })).toBe(true)
  })

  it('recognises step ids', () => {
    expect(isStepId('money')).toBe(true)
    expect(isStepId('admin')).toBe(false)
    expect(isStepId(undefined)).toBe(false)
  })
})
