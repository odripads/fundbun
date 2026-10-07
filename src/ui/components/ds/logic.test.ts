import { describe, expect, it } from 'vitest'
import { moneyParts, moneyToneFor } from './moneyParts'
import { applyPinInput, canSubmitPin, keyToPinCommand, pinLengths } from './pinInput'
import { budgetTone, percentOf, ringGeometry } from './progress'
import { rovingIndex } from './roving'
import { announcement, DEFAULT_DURATION, DEFAULT_DURATION_WITH_ACTIONS, MAX_TOASTS, normalizeToast, toastReducer, type Toast } from './toastStore'
import { badgeText } from './IconButton'
import { shouldDismissDrag, dragOffset, DRAG_DISMISS_PX } from './Sheet'
import { stopPercent } from './Slider'
import { cx } from './cx'

describe('moneyParts', () => {
  it('splits symbol, whole and fraction', () => {
    expect(moneyParts(1224050)).toMatchObject({ sign: '', symbol: '¥', whole: '12,240', fraction: '.50', suffix: '', text: '¥12,240.50' })
  })

  it('drops the fraction for whole amounts', () => {
    expect(moneyParts(950000)).toMatchObject({ whole: '9,500', fraction: '', text: '¥9,500' })
  })

  it('handles negatives with a true minus and a spoken "minus"', () => {
    const p = moneyParts(-129900)
    expect(p.sign).toBe('−')
    expect(p.text).toBe('−¥1,299')
    expect(p.spoken).toBe('minus ¥1,299')
  })

  it('handles signed positives', () => {
    const p = moneyParts(62000, 'CNY', { signed: true })
    expect(p.sign).toBe('+')
    expect(p.spoken).toBe('plus ¥620')
  })

  it('splits compact amounts but speaks the full amount', () => {
    const p = moneyParts(9800000, 'CNY', { compact: true })
    expect(p.text).toBe('¥98k')
    expect(p).toMatchObject({ whole: '98', suffix: 'k' })
    expect(p.spoken).toBe('¥98,000')
    const m = moneyParts(123450000, 'CNY', { compact: true })
    expect(m).toMatchObject({ whole: '1', fraction: '.2', suffix: 'M' })
  })

  it('supports other currencies and bare output', () => {
    expect(moneyParts(150000, 'USD')).toMatchObject({ symbol: '$', whole: '1,500' })
    expect(moneyParts(150000, 'HKD').symbol).toBe('HK$')
    expect(moneyParts(1500, 'JPY')).toMatchObject({ symbol: '¥', whole: '1,500' })
    expect(moneyParts(150000, 'CNY', { bare: true })).toMatchObject({ symbol: '', whole: '1,500' })
  })

  it('handles zero', () => {
    expect(moneyParts(0)).toMatchObject({ sign: '', whole: '0', spoken: '¥0' })
  })
})

describe('moneyToneFor', () => {
  it('maps sign and gain tones', () => {
    expect(moneyToneFor(5, 'sign')).toBe('under')
    expect(moneyToneFor(-5, 'sign')).toBe('over')
    expect(moneyToneFor(0, 'sign')).toBe('neutral')
    expect(moneyToneFor(5, 'gain')).toBe('under')
    expect(moneyToneFor(-5, 'gain')).toBe('neutral')
    expect(moneyToneFor(-5, 'muted')).toBe('muted')
  })
})

describe('progress maths', () => {
  it('percentOf clamps and survives bad input', () => {
    expect(percentOf(50, 200)).toBe(25)
    expect(percentOf(300, 200)).toBe(100)
    expect(percentOf(-5, 200)).toBe(0)
    expect(percentOf(5, 0)).toBe(0)
    expect(percentOf(Number.NaN, 10)).toBe(0)
    expect(percentOf(5, Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('budgetTone grades under / warn / over', () => {
    expect(budgetTone(50, 100)).toBe('under')
    expect(budgetTone(80, 100)).toBe('warn')
    expect(budgetTone(100, 100)).toBe('warn')
    expect(budgetTone(101, 100)).toBe('over')
    expect(budgetTone(10, 0)).toBe('over')
    expect(budgetTone(0, 0)).toBe('under')
    expect(budgetTone(60, 100, 50)).toBe('warn')
  })

  it('ringGeometry maps percent to dash offset', () => {
    const g = ringGeometry(120, 10, 25)
    expect(g.radius).toBe(55)
    expect(g.circumference).toBeCloseTo(2 * Math.PI * 55)
    expect(g.offset).toBeCloseTo(g.circumference * 0.75)
    expect(ringGeometry(120, 10, 150).offset).toBe(0)
    expect(ringGeometry(120, 10, Number.NaN).offset).toBeCloseTo(g.circumference)
    expect(ringGeometry(4, 10, 50).radius).toBe(0)
  })
})

describe('PIN input', () => {
  it('appends digits up to max length and ignores non-digits', () => {
    let d = ''
    for (const k of ['1', '2', 'x', '3', '4', '5']) d = applyPinInput(d, { type: 'digit', digit: k }, 4)
    expect(d).toBe('1234')
    expect(applyPinInput('12', { type: 'digit', digit: '12' }, 6)).toBe('12')
    expect(applyPinInput('12', { type: 'digit', digit: '' }, 6)).toBe('12')
  })

  it('backspaces and clears', () => {
    expect(applyPinInput('123', { type: 'backspace' }, 4)).toBe('12')
    expect(applyPinInput('', { type: 'backspace' }, 4)).toBe('')
    expect(applyPinInput('123', { type: 'clear' }, 4)).toBe('')
  })

  it('maps keyboard keys', () => {
    expect(keyToPinCommand('7')).toEqual({ type: 'digit', digit: '7' })
    expect(keyToPinCommand('Backspace')).toEqual({ type: 'backspace' })
    expect(keyToPinCommand('Delete')).toEqual({ type: 'backspace' })
    expect(keyToPinCommand('Enter')).toEqual({ type: 'submit' })
    expect(keyToPinCommand('Escape')).toEqual({ type: 'cancel' })
    expect(keyToPinCommand('a')).toBeNull()
    expect(keyToPinCommand('F5')).toBeNull()
    expect(keyToPinCommand('٣')).toBeNull()
  })

  it('normalises lengths into 4..6', () => {
    expect(pinLengths(4)).toEqual({ min: 4, max: 4, auto: true })
    expect(pinLengths(9)).toEqual({ min: 6, max: 6, auto: true })
    expect(pinLengths(2)).toEqual({ min: 4, max: 4, auto: true })
    expect(pinLengths()).toEqual({ min: 4, max: 6, auto: false })
    expect(pinLengths(undefined, 6, 4)).toEqual({ min: 6, max: 6, auto: false })
  })

  it('submits only within bounds', () => {
    const l = pinLengths(undefined, 4, 6)
    expect(canSubmitPin('123', l)).toBe(false)
    expect(canSubmitPin('1234', l)).toBe(true)
    expect(canSubmitPin('123456', l)).toBe(true)
    expect(canSubmitPin('1234567', l)).toBe(false)
  })
})

describe('rovingIndex', () => {
  it('moves and wraps with arrows', () => {
    expect(rovingIndex(0, 'ArrowRight', 3)).toBe(1)
    expect(rovingIndex(2, 'ArrowRight', 3)).toBe(0)
    expect(rovingIndex(0, 'ArrowLeft', 3)).toBe(2)
    expect(rovingIndex(1, 'ArrowDown', 3)).toBe(2)
    expect(rovingIndex(1, 'ArrowUp', 3)).toBe(0)
  })

  it('jumps with Home / End and skips disabled items', () => {
    const disabled = (i: number) => i === 0 || i === 2
    expect(rovingIndex(1, 'Home', 4, disabled)).toBe(1)
    expect(rovingIndex(1, 'End', 4, disabled)).toBe(3)
    expect(rovingIndex(1, 'ArrowRight', 4, disabled)).toBe(3)
    expect(rovingIndex(3, 'ArrowRight', 4, disabled)).toBe(1)
  })

  it('returns null for other keys, empty lists and all-disabled lists', () => {
    expect(rovingIndex(0, 'a', 3)).toBeNull()
    expect(rovingIndex(0, 'ArrowRight', 0)).toBeNull()
    expect(rovingIndex(0, 'ArrowRight', 2, () => true)).toBeNull()
    expect(rovingIndex(0, 'Home', 2, () => true)).toBeNull()
  })
})

describe('toast store', () => {
  const t = (id: string, extra: Partial<Parameters<typeof normalizeToast>[0]> = {}) => normalizeToast({ title: id, ...extra }, id)

  it('normalises defaults', () => {
    expect(t('a')).toMatchObject({ tone: 'neutral', duration: DEFAULT_DURATION, actions: [], showProgress: false, version: 0, leaving: false })
    expect(t('b', { actions: [{ label: 'Undo', onClick: () => {} }] }).duration).toBe(DEFAULT_DURATION_WITH_ACTIONS)
    expect(t('c', { duration: 0 }).duration).toBe(0)
    expect(t('d', { duration: -50 }).duration).toBe(0)
  })

  it('stacks, caps at MAX_TOASTS and drops the oldest', () => {
    let s: Toast[] = []
    for (let i = 0; i < MAX_TOASTS + 2; i++) s = toastReducer(s, { type: 'show', toast: t(`t${i}`) })
    expect(s.map((x) => x.id)).toEqual([`t2`, `t3`, `t4`].slice(-MAX_TOASTS))
  })

  it('replaces a toast with the same id and bumps its version', () => {
    let s = toastReducer([], { type: 'show', toast: t('undo') })
    s = toastReducer(s, { type: 'leave', id: 'undo' })
    s = toastReducer(s, { type: 'show', toast: normalizeToast({ title: 'again' }, 'undo') })
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ title: 'again', version: 1, leaving: false })
  })

  it('drops leaving toasts when a new one arrives', () => {
    let s = toastReducer([], { type: 'show', toast: t('a') })
    s = toastReducer(s, { type: 'leave', id: 'a' })
    s = toastReducer(s, { type: 'show', toast: t('b') })
    expect(s.map((x) => x.id)).toEqual(['b'])
  })

  it('updates, leaves, removes and clears', () => {
    let s = toastReducer([], { type: 'show', toast: t('a') })
    s = toastReducer(s, { type: 'update', id: 'a', patch: { title: 'A2' } })
    expect(s[0].title).toBe('A2')
    s = toastReducer(s, { type: 'update', id: 'missing', patch: { title: 'x' } })
    expect(s).toHaveLength(1)
    s = toastReducer(s, { type: 'leave', id: 'a' })
    expect(s[0].leaving).toBe(true)
    s = toastReducer(s, { type: 'remove', id: 'a' })
    expect(s).toEqual([])
    s = toastReducer([t('x'), t('y')], { type: 'clear' })
    expect(s).toEqual([])
  })

  it('builds announcements from plain text only', () => {
    expect(announcement({ title: 'Moved', message: 'You can undo.' })).toBe('Moved. You can undo.')
    expect(announcement({ title: 'Moved', message: undefined })).toBe('Moved')
    expect(announcement({ title: 'Moved', message: { type: 'b' } as never })).toBe('Moved')
  })
})

describe('small helpers', () => {
  it('badgeText', () => {
    expect(badgeText(true)).toBe('')
    expect(badgeText(3)).toBe('3')
    expect(badgeText(10)).toBe('9+')
    expect(badgeText(0)).toBeNull()
    expect(badgeText(false)).toBeNull()
    expect(badgeText(undefined)).toBeNull()
    expect(badgeText(-2)).toBeNull()
  })

  it('sheet drag thresholds', () => {
    expect(shouldDismissDrag(DRAG_DISMISS_PX + 1, 1000)).toBe(true)
    expect(shouldDismissDrag(40, 1000)).toBe(false)
    expect(shouldDismissDrag(60, 50)).toBe(true)
    expect(shouldDismissDrag(20, 5)).toBe(false)
    expect(shouldDismissDrag(-200, 10)).toBe(false)
    expect(dragOffset(30)).toBe(30)
    expect(dragOffset(-100)).toBeGreaterThan(-100)
    expect(dragOffset(-100)).toBeLessThan(0)
  })

  it('slider stop positions', () => {
    expect(stopPercent(0, 4)).toBe(0)
    expect(stopPercent(3, 4)).toBe(100)
    expect(stopPercent(1, 3)).toBe(50)
    expect(stopPercent(0, 1)).toBe(0)
  })

  it('cx joins truthy class names', () => {
    expect(cx('a', false, null, undefined, 0, 'b')).toBe('a b')
    expect(cx()).toBe('')
  })
})
