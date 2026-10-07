import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes, utf8Decode, utf8Encode } from './encoding'

describe('hex', () => {
  it('round-trips bytes', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes)
    expect(bytesToHex(Uint8Array.from([0, 15, 16, 255]))).toBe('000f10ff')
  })

  it('accepts upper case and rejects malformed hex', () => {
    expect(hexToBytes('ABcd')).toEqual(Uint8Array.from([0xab, 0xcd]))
    expect(() => hexToBytes('abc')).toThrow(TypeError)
    expect(() => hexToBytes('zz')).toThrow(TypeError)
    expect(hexToBytes('')).toEqual(new Uint8Array(0))
  })
})

describe('base64', () => {
  it('matches Node Buffer for every length 0..64', () => {
    for (let n = 0; n <= 64; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff)
      const b64 = Buffer.from(bytes).toString('base64')
      expect(bytesToBase64(bytes)).toBe(b64)
      expect(base64ToBytes(b64)).toEqual(bytes)
      expect(base64ToBytes(b64.replace(/=+$/, ''))).toEqual(bytes)
    }
  })

  it('accepts the URL-safe alphabet', () => {
    const bytes = Uint8Array.from([251, 255, 191])
    expect(base64ToBytes(Buffer.from(bytes).toString('base64url'))).toEqual(bytes)
  })

  it('rejects malformed input', () => {
    expect(() => base64ToBytes('a')).toThrow(TypeError)
    expect(() => base64ToBytes('ab$d')).toThrow(TypeError)
    expect(() => base64ToBytes('abc==')).toThrow(TypeError)
  })
})

describe('utf8', () => {
  it('round-trips Chinese and emoji', () => {
    const s = '电费 ¥486.20 😀'
    expect(utf8Decode(utf8Encode(s))).toBe(s)
  })

  it('rejects invalid UTF-8', () => {
    expect(() => utf8Decode(Uint8Array.from([0xff, 0xfe]))).toThrow()
  })
})
