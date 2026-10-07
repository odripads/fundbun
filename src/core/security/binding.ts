import { canonicalJSON } from './audit'
import { constantTimeEqual, hmacSha256Hex, sha256Hex } from './sha256'

/**
 * What-you-see-is-what-executes binding (AP2 cart mandate / PSD2 dynamic linking): the action card shows
 * exactly these fields, the hash is stored on PendingAction.bindingHash, and execution recomputes it.
 */
export interface BindingInput {
  id: string
  tool: string
  args: Record<string, unknown>
  amount: number
  to?: string
}

/** sha256(canonicalJSON({ id, tool, args, amount, to })) — `to` is omitted when undefined. */
export function computeBindingHash(p: BindingInput): string {
  return sha256Hex(canonicalJSON({ id: p.id, tool: p.tool, args: p.args, amount: p.amount, to: p.to }))
}

/** Re-check at execution time that the action about to run is the one the user saw. */
export function verifyBindingHash(p: BindingInput, expected: string): boolean {
  return constantTimeEqual(computeBindingHash(p), expected)
}

const APPROVAL_CONTEXT = 'fundbun-approval:v1:'

/**
 * PIN-bound approval token: HMAC keyed with the stored PIN hash over the binding hash. Created only after
 * checkPin succeeds; verifying it at execution proves the PIN approved THIS exact amount and destination.
 */
export function signApproval(bindingHash: string, pinHash: string): string {
  return hmacSha256Hex(pinHash, APPROVAL_CONTEXT + bindingHash)
}

export function verifyApproval(token: string, bindingHash: string, pinHash: string): boolean {
  return constantTimeEqual(signApproval(bindingHash, pinHash), token)
}
