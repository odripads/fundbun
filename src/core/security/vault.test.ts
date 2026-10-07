import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64 } from './encoding'
import { VAULT_PREFIX, VaultError, decryptJSON, encryptJSON, isVaultBlob } from './vault'

const STATE = {
  version: 1,
  profile: { name: 'Mei Lin', currency: 'CNY', monthlyIncome: 1_850_000 },
  notes: '电费 ¥486.20 · 😀',
  list: [1, null, true, { nested: 'x' }],
}

describe('vault', () => {
  it('round-trips JSON with the right PIN', async () => {
    const blob = await encryptJSON(STATE, '2580')
    expect(blob.startsWith(VAULT_PREFIX)).toBe(true)
    expect(isVaultBlob(blob)).toBe(true)
    expect(await decryptJSON<typeof STATE>(blob, '2580')).toEqual(STATE)
  })

  it('never contains the plaintext and is salted (same input → different blobs)', async () => {
    const a = await encryptJSON(STATE, '2580')
    const b = await encryptJSON(STATE, '2580')
    expect(a).not.toBe(b)
    expect(a).not.toContain('Mei')
    expect(Buffer.from(a.slice(VAULT_PREFIX.length), 'base64').toString('latin1')).not.toContain('Mei Lin')
  })

  it('lays out salt(16) + iv(12) + ciphertext + tag(16)', async () => {
    const blob = await encryptJSON('x', '2580')
    const bytes = base64ToBytes(blob.slice(VAULT_PREFIX.length))
    expect(bytes.length).toBe(16 + 12 + JSON.stringify('x').length + 16)
  })

  it('rejects a wrong PIN', async () => {
    const blob = await encryptJSON(STATE, '2580')
    await expect(decryptJSON(blob, '2581')).rejects.toBeInstanceOf(VaultError)
    await expect(decryptJSON(blob, '2581')).rejects.toThrow(/Wrong PIN/)
  })

  it('detects tampering with the ciphertext, the IV or the salt', async () => {
    const blob = await encryptJSON(STATE, '2580')
    const bytes = base64ToBytes(blob.slice(VAULT_PREFIX.length))
    for (const index of [0, 20, bytes.length - 1, 40]) {
      const tampered = bytes.slice()
      tampered[index] ^= 0x01
      await expect(decryptJSON(VAULT_PREFIX + bytesToBase64(tampered), '2580')).rejects.toBeInstanceOf(VaultError)
    }
  })

  it('refuses a blob relabelled with another version prefix', async () => {
    const blob = await encryptJSON(STATE, '2580')
    expect(isVaultBlob(blob.replace('fbv1:', 'fbv2:'))).toBe(false)
    await expect(decryptJSON(blob.replace('fbv1:', 'fbv2:'), '2580')).rejects.toThrow(/not a FundBun vault/)
  })

  it('recognises only well-formed vault blobs', () => {
    expect(isVaultBlob('{"version":1}')).toBe(false)
    expect(isVaultBlob('fbv1:')).toBe(false)
    expect(isVaultBlob('fbv1:not base64!')).toBe(false)
    expect(isVaultBlob('fbv1:' + bytesToBase64(new Uint8Array(43)))).toBe(false)
    expect(isVaultBlob('fbv1:' + bytesToBase64(new Uint8Array(44)))).toBe(true)
    expect(isVaultBlob(null as unknown as string)).toBe(false)
  })

  it('requires a PIN and a JSON-serialisable value', async () => {
    await expect(encryptJSON(STATE, '')).rejects.toBeInstanceOf(VaultError)
    await expect(encryptJSON(undefined, '2580')).rejects.toBeInstanceOf(VaultError)
    await expect(decryptJSON('fbv1:AAAA', '')).rejects.toBeInstanceOf(VaultError)
  })

  it('encrypts primitives and large states', async () => {
    expect(await decryptJSON(await encryptJSON(42, '2580'), '2580')).toBe(42)
    const big = { rows: Array.from({ length: 5000 }, (_, i) => ({ id: `txn_${i}`, amount: -(i + 1), memo: '外卖 delivery' })) }
    expect(await decryptJSON(await encryptJSON(big, '135790'), '135790')).toEqual(big)
  })
})
