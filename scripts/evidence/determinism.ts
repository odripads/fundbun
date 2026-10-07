import { createRng } from '../../src/core/rng'

/**
 * Runtime ids (`uid()` in src/core/ids.ts) come from crypto.randomUUID(). They are not security-relevant, but they
 * end up in pending ids, binding hashes and therefore audit hashes — so the evidence runner swaps randomUUID for a
 * seeded generator, re-seeded per scenario. Same seed + scenario id → byte-identical evidence, and `--only` yields the
 * same per-scenario output as a full run. crypto.getRandomValues (PIN salts, vault IVs) stays truly random; nothing
 * derived from it is written to the evidence.
 */
export interface DeterministicIds {
  /** re-seed for one scenario */
  reseed(scenarioId: string): void
  /** put the real randomUUID back */
  restore(): void
}

export function installDeterministicIds(seed: number): DeterministicIds {
  const target = globalThis.crypto as Crypto & { randomUUID: () => string }
  const own = Object.getOwnPropertyDescriptor(target, 'randomUUID')
  let rng = createRng(seed)
  const randomUUID = (): `${string}-${string}-${string}-${string}-${string}` => {
    let hex = ''
    for (let i = 0; i < 8; i++) hex += rng.int(0, 0xffff).toString(16).padStart(4, '0')
    const v4 = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17)}`
    return `${v4.slice(0, 8)}-${v4.slice(8, 12)}-${v4.slice(12, 16)}-${v4.slice(16, 20)}-${v4.slice(20, 32)}`
  }
  Object.defineProperty(target, 'randomUUID', { value: randomUUID, configurable: true, writable: true, enumerable: true })
  return {
    reseed(scenarioId) {
      rng = createRng((seed ^ hashString(scenarioId)) >>> 0)
    },
    restore() {
      if (own) Object.defineProperty(target, 'randomUUID', own)
      else delete (target as { randomUUID?: unknown }).randomUUID
    },
  }
}

/** FNV-1a, 32-bit */
export function hashString(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
