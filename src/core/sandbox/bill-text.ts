import type { BillLineItem, ISODate, Minor } from '../types'
import { yuan } from './tariffs'

export interface BillTextInput {
  /** issuer lines, e.g. ["深圳供电局 Shenzhen Power Supply Bureau", "Electricity Bill 电费通知单"] */
  header: readonly string[]
  /** "label: value" lines under the header */
  fields: readonly (readonly [string, string])[]
  items: readonly BillLineItem[]
  total: Minor
  dueDate: ISODate
  /** footer lines (payment channels, hotline…) */
  notes: readonly string[]
  /** untrusted text slipped into the bill body (prompt-injection demo) */
  injection?: string
  totalLabel?: string
  dueLabel?: string
}

const ITEM_WIDTH = 58

function itemLine(item: BillLineItem): string {
  const amount = yuan(item.amount)
  const pad = Math.max(2, ITEM_WIDTH - item.label.length - amount.length)
  return `  ${item.label}${' '.repeat(pad)}${amount}`
}

/** Plain-text bill as it would be pasted from an e-bill / e-mail (English with Chinese labels). */
export function renderBillText(input: BillTextInput): string {
  const lines: string[] = [...input.header, '='.repeat(ITEM_WIDTH + 2)]
  for (const [label, value] of input.fields) lines.push(`${label}: ${value}`)
  lines.push('', 'Charges 费用明细')
  for (const item of input.items) lines.push(itemLine(item))
  lines.push('-'.repeat(ITEM_WIDTH + 2))
  lines.push(`${input.totalLabel ?? 'Total due 应缴金额'}: ${yuan(input.total)}`)
  lines.push(`${input.dueLabel ?? 'Due date 缴费截止'}: ${input.dueDate}`)
  if (input.injection) lines.push('', input.injection)
  if (input.notes.length) lines.push('', ...input.notes)
  return lines.join('\n')
}
