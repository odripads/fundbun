/** Reading statement files picked by the user (onboarding and the Bills import card share this). On-device only. */

/** Decode a CSV file's bytes: UTF-8 first; Alipay and many bank exports are GBK, so fall back to GB18030. */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(view).replace(/^﻿/, '')
  } catch {
    try {
      return new TextDecoder('gb18030').decode(view)
    } catch {
      return new TextDecoder('utf-8').decode(view)
    }
  }
}

/** Minimal shape of a picked file (a DOM File, or a Blob-like in tests). */
export interface ByteSource {
  arrayBuffer(): Promise<ArrayBuffer>
}

/** Read a picked CSV file with the same UTF-8 → GB18030 fallback (never the lossy `file.text()`). */
export async function readCsvFile(file: ByteSource): Promise<string> {
  return decodeCsvBytes(await file.arrayBuffer())
}
