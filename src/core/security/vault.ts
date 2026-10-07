import { base64ToBytes, bytesToBase64, utf8Decode, utf8Encode } from './encoding'
import { randomBytes } from './sha256'

/**
 * Envelope: "fbv1:" + base64(salt[16] ‖ iv[12] ‖ AES-GCM ciphertext+tag). The version string is also bound
 * into the ciphertext as additional authenticated data, so a blob cannot be relabelled as another version.
 */
export const VAULT_PREFIX = 'fbv1:'
export const VAULT_PBKDF2_ITERATIONS = 150_000
const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16
const AAD = utf8Encode('fbv1')

export class VaultError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultError'
  }
}

/** Optional at-rest encryption of the local state: PBKDF2(PIN) → AES-GCM-256 via WebCrypto. */
export async function encryptJSON(data: unknown, pin: string): Promise<string> {
  assertPin(pin)
  const json = JSON.stringify(data)
  if (json === undefined) throw new VaultError('Nothing to encrypt: the value has no JSON form.')
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const key = await deriveKey(pin, salt, 'encrypt')
  const ciphertext = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, utf8Encode(json)))
  const envelope = new Uint8Array(SALT_BYTES + IV_BYTES + ciphertext.length)
  envelope.set(salt, 0)
  envelope.set(iv, SALT_BYTES)
  envelope.set(ciphertext, SALT_BYTES + IV_BYTES)
  return VAULT_PREFIX + bytesToBase64(envelope)
}

export async function decryptJSON<T>(blob: string, pin: string): Promise<T> {
  assertPin(pin)
  const envelope = parseEnvelope(blob)
  if (!envelope) throw new VaultError('This is not a FundBun vault (or it is damaged).')
  const key = await deriveKey(pin, envelope.salt, 'decrypt')
  let plaintext: ArrayBuffer
  try {
    plaintext = await subtle().decrypt({ name: 'AES-GCM', iv: envelope.iv, additionalData: AAD }, key, envelope.ciphertext)
  } catch {
    throw new VaultError('Wrong PIN, or the vault data was changed.')
  }
  return JSON.parse(utf8Decode(new Uint8Array(plaintext))) as T
}

export function isVaultBlob(raw: string): boolean {
  return parseEnvelope(raw) !== null
}

function parseEnvelope(raw: string): { salt: Uint8Array<ArrayBuffer>; iv: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> } | null {
  if (typeof raw !== 'string' || !raw.startsWith(VAULT_PREFIX)) return null
  const body = raw.slice(VAULT_PREFIX.length)
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = base64ToBytes(body)
  } catch {
    return null
  }
  if (bytes.length < SALT_BYTES + IV_BYTES + TAG_BYTES) return null
  return {
    salt: bytes.slice(0, SALT_BYTES),
    iv: bytes.slice(SALT_BYTES, SALT_BYTES + IV_BYTES),
    ciphertext: bytes.slice(SALT_BYTES + IV_BYTES),
  }
}

async function deriveKey(pin: string, salt: Uint8Array<ArrayBuffer>, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', utf8Encode(pin), 'PBKDF2', false, ['deriveKey'])
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: VAULT_PBKDF2_ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  )
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle
  if (!s) throw new VaultError('Encryption is unavailable here (WebCrypto needs a secure context).')
  return s
}

function assertPin(pin: string): void {
  if (typeof pin !== 'string' || pin.length === 0) throw new VaultError('A PIN is required to use the vault.')
}
