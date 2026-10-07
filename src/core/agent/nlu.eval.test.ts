import { describe, expect, it } from 'vitest'
import { isRefusalIntent, normalizeText, understand, type Intent, type NluContext } from './nlu'
import { TRAINING } from './nlu-data'
import { ARIF_CTX, HELD_OUT, MEI_CTX } from './nlu.fixtures'

/**
 * Held-out evaluation of the whole Bun Engine NLU (rules + TF-IDF classifier) on utterances that are not in
 * the training data. Prints a confusion summary so regressions are visible in CI logs.
 */

const ACTION_INTENTS: Intent[] = ['save_to_goal', 'withdraw_goal', 'set_budget', 'budget_plan', 'tripwire', 'pay_bill', 'cancel_sub', 'dispute']

/** Arif's goals (MacBook, flight home, concert, sneakers) only exist in his context. */
function contextFor(text: string): NluContext {
  return /macbook|medan|concert|sneakers/i.test(text) ? ARIF_CTX : MEI_CTX
}

interface Prediction { text: string; want: Intent; got: Intent; confidence: number; rule?: string }

const predictions: Prediction[] = HELD_OUT.map(([text, want]) => {
  const r = understand(text, contextFor(text))
  return { text, want, got: r.intent, confidence: r.confidence, rule: r.rule }
})

function confusionSummary(rows: Prediction[]): string {
  const byIntent = new Map<Intent, { n: number; ok: number }>()
  for (const r of rows) {
    const s = byIntent.get(r.want) ?? { n: 0, ok: 0 }
    s.n++
    if (r.got === r.want) s.ok++
    byIntent.set(r.want, s)
  }
  const pairs = new Map<string, number>()
  for (const r of rows) if (r.got !== r.want) pairs.set(`${r.want} → ${r.got}`, (pairs.get(`${r.want} → ${r.got}`) ?? 0) + 1)
  const correct = rows.filter((r) => r.got === r.want).length
  const lines = [
    `Bun Engine NLU · held-out accuracy ${correct}/${rows.length} = ${(correct / rows.length).toFixed(3)}`,
    `decided by rules: ${rows.filter((r) => r.rule).length} · by classifier: ${rows.filter((r) => !r.rule).length}`,
    'per intent:',
    ...[...byIntent].map(([intent, s]) => `  ${intent.padEnd(19)} ${s.ok}/${s.n}`),
    'confusions (want → got):',
    ...(pairs.size ? [...pairs].map(([k, n]) => `  ${k} ×${n}`) : ['  none']),
    ...rows.filter((r) => r.got !== r.want).map((r) => `  · ${JSON.stringify(r.text)} → ${r.got} (${r.confidence})`),
  ]
  return lines.join('\n')
}

describe('NLU held-out evaluation', () => {
  it('uses a held-out set of at least 120 labelled utterances covering every intent', () => {
    expect(HELD_OUT.length).toBeGreaterThanOrEqual(120)
    const covered = new Set(HELD_OUT.map(([, intent]) => intent))
    for (const intent of Object.keys(TRAINING)) expect(covered.has(intent as Intent), intent).toBe(true)
  })

  it('shares no utterance with the training data', () => {
    const training = new Set(Object.values(TRAINING).flat().map(normalizeText))
    const leaked = HELD_OUT.filter(([text]) => training.has(normalizeText(text))).map(([text]) => text)
    expect(leaked).toEqual([])
  })

  it('reaches at least 90% accuracy', () => {
    const summary = confusionSummary(predictions)
    console.log(summary)
    const accuracy = predictions.filter((p) => p.got === p.want).length / predictions.length
    expect(accuracy, summary).toBeGreaterThanOrEqual(0.9)
  })

  it('does not collapse any single intent', () => {
    const intents = [...new Set(predictions.map((p) => p.want))]
    for (const intent of intents) {
      const rows = predictions.filter((p) => p.want === intent)
      const accuracy = rows.filter((p) => p.got === intent).length / rows.length
      expect(accuracy, intent).toBeGreaterThanOrEqual(0.6)
    }
  })

  it('never turns a request FundBun must refuse into an action', () => {
    for (const p of predictions.filter((r) => isRefusalIntent(r.want))) {
      expect(ACTION_INTENTS, `${p.text} → ${p.got}`).not.toContain(p.got)
      expect(isRefusalIntent(p.got), `${p.text} → ${p.got}`).toBe(true)
    }
  })

  it('never turns out-of-scope chatter into an action', () => {
    for (const p of predictions.filter((r) => r.want === 'unknown')) expect(ACTION_INTENTS, p.text).not.toContain(p.got)
  })
})
