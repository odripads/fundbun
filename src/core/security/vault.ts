/** Optional at-rest encryption of the local state: PBKDF2(PIN) → AES-GCM-256 via WebCrypto. */
export async function encryptJSON(data: unknown, pin: string): Promise<string> {
  throw new Error('TODO encryptJSON ' + typeof data + pin.length)
}

export async function decryptJSON<T>(blob: string, pin: string): Promise<T> {
  throw new Error('TODO decryptJSON ' + blob.length + pin.length)
}

export function isVaultBlob(raw: string): boolean {
  throw new Error('TODO isVaultBlob ' + raw.length)
}
