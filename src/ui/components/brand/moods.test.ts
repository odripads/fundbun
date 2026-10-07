import { describe, expect, it } from 'vitest'
import type { BunMood } from '../../../core/types'
import { BUN_MOODS, DEFAULT_MOOD, MOODS, isBunMood, moodParts } from './moods'

const ALL: BunMood[] = ['happy', 'calm', 'worried', 'burnt', 'sleepy']

describe('mood kit', () => {
  it('covers every BunMood exactly once', () => {
    expect([...BUN_MOODS].sort()).toEqual([...ALL].sort())
    expect(Object.keys(MOODS).sort()).toEqual([...ALL].sort())
  })

  it('happy: sparkly eyes, sparkles and a bright pocket whose ¥ hops', () => {
    expect(MOODS.happy).toMatchObject({ eyes: 'sparkle', accessory: 'sparkles', pocket: 'bright', mouth: 'grin' })
  })

  it('calm: the default face with steady steam', () => {
    expect(MOODS.calm).toMatchObject({ eyes: 'round', mouth: 'smile', vapour: 'steam', accessory: 'none', pocket: 'glow' })
    expect(DEFAULT_MOOD).toBe('calm')
  })

  it('worried: brows and a sweat drop', () => {
    expect(MOODS.worried).toMatchObject({ brows: true, accessory: 'sweat', mouth: 'wobble' })
  })

  it('burnt: toasted crust, smoke, dizzy eyes and a dimmed pocket — yet still blushing, not sad', () => {
    expect(MOODS.burnt).toMatchObject({ toasted: true, vapour: 'smoke', eyes: 'dizzy', pocket: 'dim', blink: false })
    expect(MOODS.burnt.blush).toBeGreaterThan(0.3)
    expect(MOODS.burnt.mouth).not.toBe('wobble')
  })

  it('sleepy: closed eyes, z’s instead of steam, slow breathing', () => {
    expect(MOODS.sleepy).toMatchObject({ eyes: 'closed', vapour: 'zzz', blink: false })
    expect(MOODS.sleepy.breath).toBeGreaterThan(Math.max(...ALL.filter((m) => m !== 'sleepy').map((m) => MOODS[m].breath)))
  })

  it('only toasts and smokes when burnt', () => {
    for (const m of ALL.filter((x) => x !== 'burnt')) {
      expect(MOODS[m].toasted).toBe(false)
      expect(MOODS[m].vapour).not.toBe('smoke')
    }
  })

  it('keeps every part in range with a distinct description', () => {
    for (const m of ALL) {
      expect(MOODS[m].blush).toBeGreaterThanOrEqual(0)
      expect(MOODS[m].blush).toBeLessThanOrEqual(1)
      expect(MOODS[m].breath).toBeGreaterThan(1)
      // open-eyed moods blink; closed or spinning eyes do not
      expect(MOODS[m].blink).toBe(MOODS[m].eyes === 'round' || MOODS[m].eyes === 'sparkle')
    }
    expect(new Set(ALL.map((m) => MOODS[m].label)).size).toBe(ALL.length)
  })
})

describe('isBunMood / moodParts', () => {
  it('recognises the moods', () => {
    for (const m of ALL) expect(isBunMood(m)).toBe(true)
  })

  it('rejects anything else, including prototype keys', () => {
    for (const v of ['', 'Happy', 'angry', 'toString', '__proto__', 'constructor', 'hasOwnProperty', 1, null, undefined, {}]) {
      expect(isBunMood(v)).toBe(false)
    }
  })

  it('falls back to calm for unknown moods', () => {
    expect(moodParts('furious')).toBe(MOODS.calm)
    expect(moodParts(undefined)).toBe(MOODS.calm)
    expect(moodParts('__proto__')).toBe(MOODS.calm)
    expect(moodParts('burnt')).toBe(MOODS.burnt)
  })
})
