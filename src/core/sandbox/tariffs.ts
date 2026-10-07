import type { BillLineItem, Minor, YearMonth } from '../types'
import type { BillQuote } from './script-types'

/**
 * Shenzhen residential utility tariffs (docs/research/05 §9). Rates are kept in 1/10,000 yuan so every line
 * item is computed in integers and rounded to the fen once.
 */

const ELECTRICITY_RATES = [6542, 7042, 9542] as const
/** sandbox "government surcharges" line, ¥0.0005/kWh (the published tariff is before surcharges) */
const ELECTRICITY_SURCHARGE = 5
const SUMMER_TIERS = [260, 600] as const
const WINTER_TIERS = [200, 400] as const

function isSummer(period: YearMonth): boolean {
  const month = Number(period.slice(5, 7))
  return month >= 5 && month <= 10
}

function fenFromRate(units: number, ratePer10k: number): Minor {
  return Math.round((units * ratePer10k) / 100)
}

function sumItems(items: BillLineItem[]): Minor {
  return items.reduce((s, it) => s + it.amount, 0)
}

export function electricityQuote(kwh: number, period: YearMonth): BillQuote {
  const [t1, t2] = isSummer(period) ? SUMMER_TIERS : WINTER_TIERS
  const tiers = [
    { label: `Tier 1 第一档 (0–${t1} kWh)`, units: Math.min(kwh, t1), rate: ELECTRICITY_RATES[0] },
    { label: `Tier 2 第二档 (${t1 + 1}–${t2} kWh)`, units: Math.max(0, Math.min(kwh, t2) - t1), rate: ELECTRICITY_RATES[1] },
    { label: `Tier 3 第三档 (${t2 + 1}+ kWh)`, units: Math.max(0, kwh - t2), rate: ELECTRICITY_RATES[2] },
  ]
  const lineItems: BillLineItem[] = tiers
    .filter((t) => t.units > 0)
    .map((t) => ({
      label: `${t.label} · ${t.units} kWh × ¥${(t.rate / 10_000).toFixed(4)}`,
      amount: fenFromRate(t.units, t.rate),
    }))
  lineItems.push({ label: 'Surcharges 附加费', amount: fenFromRate(kwh, ELECTRICITY_SURCHARGE) })
  return { amount: sumItems(lineItems), lineItems, usage: `${kwh} kWh` }
}

const WATER_RATES = [
  { label: 'Tap water 自来水费', fenPerM3: 267 },
  { label: 'Sewage 污水处理费', fenPerM3: 100 },
  { label: 'Garbage 垃圾处理费', fenPerM3: 59 },
] as const

/** `tenths` = usage in 0.1 m³ (meters report one decimal). */
export function waterQuote(tenths: number): BillQuote {
  const m3 = (tenths / 10).toFixed(1)
  const lineItems = WATER_RATES.map((r) => ({
    label: `${r.label} · ${m3} m³ × ¥${(r.fenPerM3 / 100).toFixed(2)}`,
    amount: Math.round((tenths * r.fenPerM3) / 10),
  }))
  return { amount: sumItems(lineItems), lineItems, usage: `${m3} m³` }
}

export function fixedQuote(label: string, amount: Minor): BillQuote {
  return { amount, lineItems: [{ label, amount }] }
}

/** "¥1,234.50" — bills always show two decimals. */
export function yuan(minor: Minor): string {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  const major = Math.floor(abs / 100).toLocaleString('en-US')
  return `${sign}¥${major}.${String(abs % 100).padStart(2, '0')}`
}
