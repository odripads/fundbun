/** Synchronous, dependency-free SHA-256 / HMAC / PBKDF2 (UTF-8 input) so audit hashing stays synchronous. */
export function sha256Hex(input: string): string {
  throw new Error('TODO sha256Hex ' + input.length)
}

export function hmacSha256Hex(key: string, message: string): string {
  throw new Error('TODO hmacSha256Hex ' + key.length + message.length)
}

export function pbkdf2Sha256Hex(password: string, saltHex: string, iterations: number, keyLenBytes = 32): string {
  throw new Error('TODO pbkdf2 ' + password.length + saltHex + iterations + keyLenBytes)
}

export function randomHex(bytes: number): string {
  throw new Error('TODO randomHex ' + bytes)
}
