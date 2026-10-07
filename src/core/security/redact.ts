import type { RedactionReport } from '../types'

/**
 * Mask PII before anything leaves the device: emails, phone numbers (CN mobile 1[3-9]x{9}, +country
 * formats), PRC resident ID (18 chars), Indonesian NIK (16 digits), passport-like ids, bank card numbers
 * (13–19 digits, Luhn-valid; keep last 4), IBANs, and any `extraNames` (e.g. the user's name) → [NAME].
 * Amounts like "¥2,000" or "2000.50" must NOT be redacted.
 */
export function redactText(text: string, extraNames: string[] = []): RedactionReport {
  throw new Error('TODO redactText ' + text.length + extraNames.length)
}

/** Deep-redact all string values in a JSON-like value. */
export function redactDeep<T>(value: T, extraNames: string[] = []): { value: T; counts: Record<string, number> } {
  throw new Error('TODO redactDeep ' + typeof value + extraNames.length)
}
