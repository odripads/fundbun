import { bytesToHex, hexToBytes, utf8Encode } from './encoding'

/** Synchronous, dependency-free SHA-256 / HMAC / PBKDF2 (UTF-8 input) so audit hashing stays synchronous. */

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const IV = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])

const BLOCK = 64
const DIGEST = 32

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n))

/** One SHA-256 compression round over data[off..off+64), updating `h` in place. `w` is scratch space. */
function compress(h: Uint32Array, data: Uint8Array, off: number, w: Uint32Array): void {
  for (let i = 0; i < 16; i++) {
    const j = off + i * 4
    w[i] = (data[j] << 24) | (data[j + 1] << 16) | (data[j + 2] << 8) | data[j + 3]
  }
  for (let i = 16; i < 64; i++) {
    const x = w[i - 15]
    const y = w[i - 2]
    const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)
    const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)
    w[i] = w[i - 16] + s0 + w[i - 7] + s1
  }
  let a = h[0]
  let b = h[1]
  let c = h[2]
  let d = h[3]
  let e = h[4]
  let f = h[5]
  let g = h[6]
  let k = h[7]
  for (let i = 0; i < 64; i++) {
    const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0
    const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
    k = g
    g = f
    f = e
    e = (d + t1) | 0
    d = c
    c = b
    b = a
    a = (t1 + t2) | 0
  }
  h[0] += a
  h[1] += b
  h[2] += c
  h[3] += d
  h[4] += e
  h[5] += f
  h[6] += g
  h[7] += k
}

/** Absorb `data` (after `prefixLen` bytes already compressed into `h`), pad, and return the digest. */
function finish(h: Uint32Array, data: Uint8Array, prefixLen: number, w: Uint32Array): Uint8Array<ArrayBuffer> {
  const full = data.length - (data.length % BLOCK)
  for (let off = 0; off < full; off += BLOCK) compress(h, data, off, w)
  const rem = data.length - full
  const tail = new Uint8Array(rem < 56 ? BLOCK : BLOCK * 2)
  tail.set(data.subarray(full))
  tail[rem] = 0x80
  const bitLen = (prefixLen + data.length) * 8
  writeU32(tail, tail.length - 8, Math.floor(bitLen / 0x100000000))
  writeU32(tail, tail.length - 4, bitLen >>> 0)
  for (let off = 0; off < tail.length; off += BLOCK) compress(h, tail, off, w)
  const out = new Uint8Array(DIGEST)
  for (let i = 0; i < 8; i++) writeU32(out, i * 4, h[i])
  return out
}

function writeU32(buf: Uint8Array, off: number, v: number): void {
  buf[off] = v >>> 24
  buf[off + 1] = (v >>> 16) & 0xff
  buf[off + 2] = (v >>> 8) & 0xff
  buf[off + 3] = v & 0xff
}

export function sha256Bytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return finish(IV.slice(), data, 0, new Uint32Array(64))
}

export function sha256Hex(input: string): string {
  return bytesToHex(sha256Bytes(utf8Encode(input)))
}

/** HMAC key with the ipad/opad blocks pre-compressed, so each HMAC costs only the message blocks. */
interface HmacState {
  inner: Uint32Array
  outer: Uint32Array
}

function hmacState(key: Uint8Array, w: Uint32Array): HmacState {
  const k = key.length > BLOCK ? sha256Bytes(key) : key
  const ipad = new Uint8Array(BLOCK).fill(0x36)
  const opad = new Uint8Array(BLOCK).fill(0x5c)
  for (let i = 0; i < k.length; i++) {
    ipad[i] ^= k[i]
    opad[i] ^= k[i]
  }
  const inner = IV.slice()
  const outer = IV.slice()
  compress(inner, ipad, 0, w)
  compress(outer, opad, 0, w)
  return { inner, outer }
}

function hmacWith(state: HmacState, message: Uint8Array, w: Uint32Array): Uint8Array<ArrayBuffer> {
  const innerHash = finish(state.inner.slice(), message, BLOCK, w)
  return finish(state.outer.slice(), innerHash, BLOCK, w)
}

export function hmacSha256Bytes(key: Uint8Array, message: Uint8Array): Uint8Array<ArrayBuffer> {
  const w = new Uint32Array(64)
  return hmacWith(hmacState(key, w), message, w)
}

export function hmacSha256Hex(key: string, message: string): string {
  return bytesToHex(hmacSha256Bytes(utf8Encode(key), utf8Encode(message)))
}

/** RFC 8018 PBKDF2 with HMAC-SHA-256. */
export function pbkdf2Sha256Bytes(password: Uint8Array, salt: Uint8Array, iterations: number, keyLenBytes = 32): Uint8Array<ArrayBuffer> {
  if (!Number.isSafeInteger(iterations) || iterations < 1) throw new RangeError('PBKDF2 iterations must be a positive integer')
  if (!Number.isSafeInteger(keyLenBytes) || keyLenBytes < 1 || keyLenBytes > 1024) throw new RangeError('PBKDF2 key length must be 1..1024 bytes')
  const w = new Uint32Array(64)
  const state = hmacState(password, w)
  const out = new Uint8Array(keyLenBytes)
  const saltBlock = new Uint8Array(salt.length + 4)
  saltBlock.set(salt)
  const blocks = Math.ceil(keyLenBytes / DIGEST)
  for (let i = 1; i <= blocks; i++) {
    writeU32(saltBlock, salt.length, i)
    let u = hmacWith(state, saltBlock, w)
    const t = u.slice()
    for (let j = 1; j < iterations; j++) {
      u = hmacWith(state, u, w)
      for (let x = 0; x < DIGEST; x++) t[x] ^= u[x]
    }
    const offset = (i - 1) * DIGEST
    out.set(t.subarray(0, Math.min(DIGEST, keyLenBytes - offset)), offset)
  }
  return out
}

export function pbkdf2Sha256Hex(password: string, saltHex: string, iterations: number, keyLenBytes = 32): string {
  return bytesToHex(pbkdf2Sha256Bytes(utf8Encode(password), hexToBytes(saltHex), iterations, keyLenBytes))
}

/** Cryptographically secure random bytes. Never falls back to Math.random. */
export function randomBytes(bytes: number): Uint8Array<ArrayBuffer> {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('randomBytes: byte count must be a non-negative integer')
  const cryptoObj = globalThis.crypto
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') throw new Error('No secure random source (crypto.getRandomValues) available')
  const out = new Uint8Array(bytes)
  // getRandomValues refuses more than 65,536 bytes per call
  for (let off = 0; off < bytes; off += 65_536) cryptoObj.getRandomValues(out.subarray(off, Math.min(bytes, off + 65_536)))
  return out
}

export function randomHex(bytes: number): string {
  return bytesToHex(randomBytes(bytes))
}

/** Compare two strings without short-circuiting on the first differing character (timing-safe for equal lengths). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0)
  return diff === 0
}
