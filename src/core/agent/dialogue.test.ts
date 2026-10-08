import { describe, expect, it } from 'vitest'
import { fakeHost } from '../../../tests/helpers/fake-host'
import {
  choicesOf,
  detectDialogueAct,
  fillClarification,
  makeClarification,
  pickChoice,
  slotHints,
  thresholdFromChoice,
} from './dialogue'
import { nluContextOf } from './support'

const host = fakeHost()
const ctx = nluContextOf(host.state(), host.recurring())

describe('detectDialogueAct', () => {
  it.each(['stop', 'Stop!', 'wait', 'cancel that', 'never mind', 'nevermind', 'hold on', 'forget it', 'stop the plan', 'okay stop', 'actually, stop', '算了', 'batal'])(
    'interrupt: %s',
    (t) => expect(detectDialogueAct(t)).toEqual({ act: 'interrupt', soft: false }),
  )

  it.each(['no', 'nope', 'no thanks', 'not now'])('negation is a soft interrupt: %s', (t) => {
    expect(detectDialogueAct(t)).toEqual({ act: 'interrupt', soft: true })
  })

  it.each(['yes', 'Yes please', 'do it', 'go ahead', 'ok', 'sure!', 'confirm', 'approve', 'sounds good', '好的'])('affirm: %s', (t) => {
    expect(detectDialogueAct(t)).toEqual({ act: 'affirm' })
  })

  it.each([
    ['actually make it ¥150', 'make it ¥150'],
    ['no, the Chengdu one', 'the Chengdu one'],
    ['I meant 200', '200'],
    ['wait, make it 150', 'make it 150'],
  ])('correction: %s', (t, body) => {
    expect(detectDialogueAct(t)).toEqual({ act: 'correction', body })
  })

  it('a bare "the X one" is a correction hint', () => {
    expect(detectDialogueAct('the Chengdu one')).toEqual({ act: 'correction', body: 'the Chengdu one' })
  })

  it.each(['get me back on track', 'Help me get back on track this month', 'fix my month', 'help me save faster for my Birkin', 'make a plan', 'Make me a plan please'])(
    'plan_recovery: %s',
    (t) => expect(detectDialogueAct(t)).toEqual({ act: 'plan_recovery' }),
  )

  it.each(['explain my electricity bill', 'why is my electricity bill so high?', 'what\'s in my water bill'])('explain_bill: %s', (t) => {
    expect(detectDialogueAct(t)).toEqual({ act: 'explain_bill' })
  })

  it.each(['Cancel Youku', 'Make me a budget plan', 'check my bills', 'How am I doing this month?', 'Move ¥300 to Chengdu', 'stop paying for Youku', '', 'x'.repeat(300)])(
    'leaves ordinary requests to the NLU: %s',
    (t) => expect(detectDialogueAct(t)).toBeNull(),
  )
})

describe('slot hints and clarification filling', () => {
  it('extracts amounts, goals, bills and categories from short answers', () => {
    expect(slotHints('make it ¥150', ctx).amount).toBe(15_000)
    expect(slotHints('200', ctx).amount).toBe(20_000)
    expect(slotHints('the Chengdu one', ctx).goalId).toBe('dream_chengdu')
    expect(slotHints('the electricity one', ctx).billId).toBe('bill_electricity_2026-09')
    expect(slotHints('delivery', ctx).category).toBe('delivery')
    expect(slotHints('80%', ctx).percent).toBe(80)
  })

  it('picks a stored choice by exact label, id, NLU hint or fuzzy name', () => {
    const choices = [{ label: 'Birkin 25', id: 'dream_birkin' }, { label: 'Weekend in Chengdu', id: 'dream_chengdu' }]
    expect(pickChoice('Weekend in Chengdu', choices)?.id).toBe('dream_chengdu')
    expect(pickChoice('dream_birkin', choices)?.id).toBe('dream_birkin')
    expect(pickChoice('the trip', choices, 'dream_chengdu')?.id).toBe('dream_chengdu')
    expect(pickChoice('chengdu', choices)?.id).toBe('dream_chengdu')
    expect(pickChoice('pizza', choices)).toBeUndefined()
  })

  it('fills a goal clarification and keeps the original slots', () => {
    const clar = makeClarification('save_to_goal', { amount: 20_000 }, 'goalId', [{ label: 'Birkin 25', id: 'dream_birkin' }, { label: 'Weekend in Chengdu', id: 'dream_chengdu' }], '2026-10-22T02:00:00.000Z')
    expect(choicesOf(clar)).toHaveLength(2)
    expect(fillClarification(clar, 'Chengdu', ctx)).toEqual({ amount: 20_000, goalId: 'dream_chengdu' })
    expect(fillClarification(clar, 'what is the weather', ctx)).toBeNull()
  })

  it('fills an amount clarification from free text', () => {
    const clar = makeClarification('save_to_goal', { goalId: 'dream_chengdu' }, 'amount', [], '2026-10-22T02:00:00.000Z')
    expect(fillClarification(clar, '¥300 please', ctx)).toEqual({ goalId: 'dream_chengdu', amount: 30_000 })
    expect(fillClarification(clar, 'no idea', ctx)).toBeNull()
  })

  it('fills a tripwire threshold from a chip or a typed percent/amount', () => {
    const clar = makeClarification('tripwire', {}, 'threshold', [{ label: 'If I’m on pace to overshoot', id: 'pace_over:100' }], '2026-10-22T02:00:00.000Z')
    expect(fillClarification(clar, 'If I’m on pace to overshoot', ctx)).toEqual({ tripwireKind: 'pace_over', percent: 100 })
    expect(fillClarification(clar, '90%', ctx)).toEqual({ percent: 90 })
    expect(fillClarification(clar, '¥250', ctx)).toEqual({ amount: 25_000 })
  })

  it('thresholdFromChoice parses kind:value ids only', () => {
    expect(thresholdFromChoice('single_over:30000')).toEqual({ tripwireKind: 'single_over', amount: 30_000 })
    expect(thresholdFromChoice('month_pct:80')).toEqual({ tripwireKind: 'month_pct', percent: 80 })
    expect(thresholdFromChoice('dream_birkin')).toBeUndefined()
  })
})

describe('detectDialogueAct · undo and recategorize', () => {
  it.each(['undo', 'undo that', 'Undo it please', 'revert that', 'take it back', 'cancel that payment', 'cancel the transfer', 'cancel my last transfer', '撤销', '撤销刚才的转账', 'batalkan yang tadi'])(
    'undo: %s',
    (t) => expect(detectDialogueAct(t)).toEqual({ act: 'undo' }),
  )

  it('keeps "cancel that" an interrupt and "cancel youku" a request', () => {
    expect(detectDialogueAct('cancel that')).toEqual({ act: 'interrupt', soft: false })
    expect(detectDialogueAct('cancel youku')).toBeNull()
  })

  it.each([
    ['Recategorize the Tony Hair Studio charge as personal care', 'the Tony Hair Studio charge', 'personal care'],
    ['mark the Heytea purchase as groceries', 'the Heytea purchase', 'groceries'],
    ['move the Taobao order to the gifts category', 'the Taobao order', 'gifts'],
  ])('recategorize: %s', (t, subject, target) => {
    expect(detectDialogueAct(t)).toEqual({ act: 'recategorize', subject, target })
  })

  it('does not read a money move as a recategorisation', () => {
    expect(detectDialogueAct('move 300 to birkin')).toBeNull()
    expect(detectDialogueAct('put ¥200 into the Chengdu pot')).toBeNull()
  })
})
