/** A tiny global store: which pending action the single approval sheet shows. */
import { useSyncExternalStore } from 'react'

let openId: string | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function openApproval(pendingId: string): void {
  openId = pendingId
  emit()
}

export function closeApproval(): void {
  if (openId === null) return
  openId = null
  emit()
}

export function currentApproval(): string | null {
  return openId
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useApprovalTarget(): string | null {
  return useSyncExternalStore(subscribe, currentApproval, () => null)
}
