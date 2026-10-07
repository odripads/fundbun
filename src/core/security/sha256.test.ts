import { createHash, createHmac, pbkdf2Sync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { bytesToHex } from './encoding'
import {
  constantTimeEqual,
  hmacSha256Bytes,
  hmacSha256Hex,
  pbkdf2Sha256Hex,
  randomBytes,
  randomHex,
  sha256Bytes,
  sha256Hex,
} from './sha256'

const nodeSha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const nodeHmac = (k: string, m: string) => createHmac('sha256', Buffer.from(k, 'utf8')).update(m, 'utf8').digest('hex')

/** Deterministic pseudo-random strings mixing ASCII, CJK, emoji and combining marks. */
function fuzzStrings(count: number): string[] {
  const alphabet = ['a', 'Z', '0', ' ', '\n', '¥', 'é', '你', '好', '账', '😀', '🎉', '́', '​', '\u0000', '"', '\\']
  let seed = 20261022
  const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31)
  return Array.from({ length: count }, () => {
    const len = next() % 200
    return Array.from({ length: len }, () => alphabet[next() % alphabet.length]).join('')
  })
}

const FIXED = [
  '',
  'a',
  'abc',
  'The quick brown fox jumps over the lazy dog',
  'a'.repeat(55),
  'a'.repeat(56),
  'a'.repeat(63),
  'a'.repeat(64),
  'a'.repeat(65),
  'a'.repeat(119),
  'a'.repeat(120),
  'a'.repeat(1000),
  '你好，世界',
  '深圳供电局 电费账单 本期应缴金额：486.20元',
  '😀🎉🏴‍☠️👩‍👩‍👧',
  'Mixed ¥3,450 — 38% · 中文 · emoji 🐷',
  '\u0000\u0001￿',
]

describe('sha256Hex', () => {
  it('matches the FIPS 180-2 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it.each(FIXED)('matches node:crypto for %j', (s) => {
    expect(sha256Hex(s)).toBe(nodeSha(s))
  })

  it('matches node:crypto on 300 fuzzed unicode strings (block-boundary lengths included)', () => {
    for (const s of fuzzStrings(300)) expect(sha256Hex(s)).toBe(nodeSha(s))
  })

  it('handles a 1 MB input', () => {
    const big = 'x'.repeat(1_000_000)
    expect(sha256Hex(big)).toBe(nodeSha(big))
  })

  it('hashes raw bytes', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff)
    expect(bytesToHex(sha256Bytes(bytes))).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('treats lone surrogates like TextEncoder (U+FFFD)', () => {
    expect(sha256Hex('\ud800')).toBe(createHash('sha256').update(Buffer.from(new TextEncoder().encode('\ud800'))).digest('hex'))
  })
})

describe('hmacSha256Hex', () => {
  it('matches RFC 4231 test case 2', () => {
    expect(hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
  })

  const cases: [string, string][] = [
    ['', ''],
    ['', 'message'],
    ['key', ''],
    ['k'.repeat(64), 'exactly one block key'],
    ['k'.repeat(65), 'key longer than a block is hashed first'],
    ['k'.repeat(500), 'm'.repeat(500)],
    ['密钥', '消息内容'],
    ['🔑', '💸 ¥4,800'],
  ]
  it.each(cases)('matches node:crypto for key %j', (key, msg) => {
    expect(hmacSha256Hex(key, msg)).toBe(nodeHmac(key, msg))
  })

  it('matches node:crypto on fuzzed key/message pairs', () => {
    const strings = fuzzStrings(120)
    for (let i = 0; i + 1 < strings.length; i += 2) expect(hmacSha256Hex(strings[i], strings[i + 1])).toBe(nodeHmac(strings[i], strings[i + 1]))
  })

  it('accepts raw bytes', () => {
    const key = Uint8Array.from([0, 1, 2, 255])
    const msg = Uint8Array.from([9, 8, 7])
    expect(bytesToHex(hmacSha256Bytes(key, msg))).toBe(createHmac('sha256', key).update(msg).digest('hex'))
  })
})

describe('pbkdf2Sha256Hex', () => {
  const nodePbkdf2 = (p: string, saltHex: string, it: number, len: number) =>
    pbkdf2Sync(Buffer.from(p, 'utf8'), Buffer.from(saltHex, 'hex'), it, len, 'sha256').toString('hex')

  const cases: [string, string, number, number][] = [
    ['password', '73616c74', 1, 32],
    ['password', '73616c74', 2, 32],
    ['password', '73616c74', 4096, 32],
    ['2580', '00112233445566778899aabbccddeeff', 1000, 32],
    ['', '', 3, 32],
    ['pin', 'ff', 10, 1],
    ['pin', 'ff', 10, 31],
    ['pin', 'ff', 10, 33],
    ['pin', 'ff', 10, 64],
    ['pin', 'ff', 10, 100],
    ['密码一二三', 'deadbeef', 50, 32],
    ['🐷💰', 'a1b2c3', 25, 48],
    ['p'.repeat(100), 'cafe', 5, 32],
  ]
  it.each(cases)('matches node:crypto for %j / salt %s / %i iterations / %i bytes', (p, salt, iterations, len) => {
    expect(pbkdf2Sha256Hex(p, salt, iterations, len)).toBe(nodePbkdf2(p, salt, iterations, len))
  })

  it('matches node:crypto at the PIN iteration count', () => {
    expect(pbkdf2Sha256Hex('2580', '0f1e2d3c4b5a69788796a5b4c3d2e1f0', 20_000)).toBe(nodePbkdf2('2580', '0f1e2d3c4b5a69788796a5b4c3d2e1f0', 20_000, 32))
  })

  it('defaults to 32 bytes', () => {
    expect(pbkdf2Sha256Hex('x', 'aa', 2)).toHaveLength(64)
  })

  it('rejects invalid salts and parameters', () => {
    expect(() => pbkdf2Sha256Hex('x', 'xyz', 1)).toThrow()
    expect(() => pbkdf2Sha256Hex('x', 'abc', 1)).toThrow()
    expect(() => pbkdf2Sha256Hex('x', 'aa', 0)).toThrow(RangeError)
    expect(() => pbkdf2Sha256Hex('x', 'aa', 1.5)).toThrow(RangeError)
    expect(() => pbkdf2Sha256Hex('x', 'aa', 1, 0)).toThrow(RangeError)
  })
})

describe('randomHex / randomBytes', () => {
  it('returns lower-case hex of the requested byte length', () => {
    for (const n of [0, 1, 16, 32, 100]) expect(randomHex(n)).toMatch(new RegExp(`^[0-9a-f]{${n * 2}}$`))
  })

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomHex(16)))
    expect(seen.size).toBe(200)
  })

  it('fills buffers larger than the 65,536-byte getRandomValues limit', () => {
    const bytes = randomBytes(70_000)
    expect(bytes.length).toBe(70_000)
    // the tail beyond the first chunk must be filled too (probability of all zero is negligible)
    expect(bytes.subarray(65_536).some((b) => b !== 0)).toBe(true)
  })

  it('rejects invalid sizes', () => {
    expect(() => randomHex(-1)).toThrow(RangeError)
    expect(() => randomHex(1.5)).toThrow(RangeError)
  })
})

describe('constantTimeEqual', () => {
  it('compares strings exactly', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('', '')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'ab')).toBe(false)
    expect(constantTimeEqual('ab', 'abc')).toBe(false)
    expect(constantTimeEqual('a\u0000', 'a')).toBe(false)
    expect(constantTimeEqual(sha256Hex('x'), sha256Hex('x'))).toBe(true)
  })

  it('returns false for non-strings', () => {
    expect(constantTimeEqual(undefined as unknown as string, 'a')).toBe(false)
    expect(constantTimeEqual('a', null as unknown as string)).toBe(false)
  })
})
