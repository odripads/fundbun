import type { InjectionReport } from '../types'

/**
 * Heuristic prompt-injection scanner for untrusted text (bills, memos, CSV fields): instruction overrides
 * ("ignore previous instructions", "忽略之前的指令"), role spoofing ("SYSTEM:", "assistant:", "</untrusted>"),
 * payment/transfer instructions with account numbers, urgency + authority claims, requests to change
 * permissions, hidden/zero-width characters, base64 blobs. Score 0..1; suspicious when score >= 0.5.
 */
export function scanForInjection(text: string): InjectionReport {
  throw new Error('TODO scanForInjection ' + text.length)
}

/**
 * Wrap untrusted content for an LLM prompt: strips zero-width/control chars, neutralises any
 * <untrusted…> / </untrusted> tags inside, and wraps as
 * <untrusted source="…">…</untrusted> with a reminder that it is data, not instructions.
 */
export function wrapUntrusted(source: string, text: string): string {
  throw new Error('TODO wrapUntrusted ' + source + text.length)
}
