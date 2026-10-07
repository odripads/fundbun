/** Byte/string encodings shared by the security modules (UTF-8, hex, base64). Pure TS, no Node Buffer. */

const encoder = new TextEncoder()

export function utf8Encode(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text)
}

/** Strict UTF-8 decode: throws on malformed byte sequences. */
export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

const HEX = '0123456789abcdef'

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15]
  return out
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new TypeError('Invalid hex string')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INDEX: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]))

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    parts.push(B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63])
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i] << 16
    parts.push(B64[n >> 18] + B64[(n >> 12) & 63] + '==')
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    parts.push(B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=')
  }
  return parts.join('')
}

/**
 * Strict standard base64 decode (padding optional, URL-safe '-' '_' accepted). Throws on any character
 * outside the alphabet or an impossible length.
 */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const clean = b64.replace(/-/g, '+').replace(/_/g, '/')
  const body = clean.replace(/={1,2}$/, '')
  if (body.length % 4 === 1) throw new TypeError('Invalid base64 length')
  if (clean.length !== body.length && clean.length % 4 !== 0) throw new TypeError('Invalid base64 padding')
  const out = new Uint8Array(Math.floor((body.length * 3) / 4))
  let bits = 0
  let acc = 0
  let o = 0
  for (const ch of body) {
    const v = B64_INDEX[ch]
    if (v === undefined) throw new TypeError('Invalid base64 character')
    acc = ((acc << 6) | v) & 0xffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 0xff
    }
  }
  return out
}
