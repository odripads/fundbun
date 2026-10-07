/** PIN entry state machine (pure). Digits live only in component state, never in storage or the DOM. */

export type PinInput = { type: 'digit'; digit: string } | { type: 'backspace' } | { type: 'clear' }

export function applyPinInput(digits: string, input: PinInput, maxLength: number): string {
  switch (input.type) {
    case 'digit':
      return /^[0-9]$/.test(input.digit) && digits.length < maxLength ? digits + input.digit : digits
    case 'backspace':
      return digits.slice(0, -1)
    case 'clear':
      return ''
  }
}

export type PinKeyCommand = PinInput | { type: 'submit' } | { type: 'cancel' }

/** Map a KeyboardEvent.key to a PIN command (digits, numpad digits, Backspace/Delete, Enter, Escape). */
export function keyToPinCommand(key: string): PinKeyCommand | null {
  if (/^[0-9]$/.test(key)) return { type: 'digit', digit: key }
  if (key === 'Backspace' || key === 'Delete') return { type: 'backspace' }
  if (key === 'Enter') return { type: 'submit' }
  if (key === 'Escape') return { type: 'cancel' }
  return null
}

export interface PinLengths {
  min: number
  max: number
  /** fixed length → submit automatically when full */
  auto: boolean
}

/** Normalise length props into 4..6 bounds. */
export function pinLengths(length?: number, minLength = 4, maxLength = 6): PinLengths {
  const clamp = (n: number) => Math.min(6, Math.max(4, Math.round(n)))
  if (length !== undefined) {
    const n = clamp(length)
    return { min: n, max: n, auto: true }
  }
  const min = clamp(minLength)
  return { min, max: Math.max(min, clamp(maxLength)), auto: false }
}

export function canSubmitPin(digits: string, lengths: PinLengths): boolean {
  return digits.length >= lengths.min && digits.length <= lengths.max
}
