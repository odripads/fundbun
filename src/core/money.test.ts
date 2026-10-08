import { describe, expect, it } from 'vitest'
import { fmt, parseAmount, roundMajor, toMinor } from './money'

describe('parseAmount — plain amounts', () => {
  it.each([
    ['¥2,000', 200_000],
    ['2000元', 200_000],
    ['$49.99', 4_999],
    ['RMB 300', 30_000],
    ['300 yuan', 30_000],
    ['500 kuai', 50_000],
    ['move ¥300 to Birkin', 30_000],
    ['2，500', 250_000],
  ])('%s → %i', (text, minor) => {
    expect(parseAmount(text)).toBe(minor)
  })

  it('returns null when there is no number', () => {
    expect(parseAmount('cancel Youku')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })
})

describe('parseAmount — magnitude suffixes', () => {
  it.each([
    ['2k', 200_000],
    ['2K', 200_000],
    ['2 k', 200_000],
    ['2k元', 200_000],
    ['1.5w', 1_500_000],
    ['1.2万', 1_200_000],
    ['1.2 万元', 1_200_000],
    ['3千', 300_000],
    ['3 thousand', 300_000],
    ['2 grand', 200_000],
    ['5m', 500_000_000],
    ['5mn', 500_000_000],
    ['5 million', 500_000_000],
    ['5million', 500_000_000],
    ['save 2k more', 200_000],
  ])('%s → %i', (text, minor) => {
    expect(parseAmount(text)).toBe(minor)
  })

  it.each([
    ['save 500 more', 50_000],
    ['1 week', 100],
    ['500 with bun', 50_000],
    ['save 500 more this month', 50_000],
    ['300 monthly', 30_000],
    ['5 mn', 500],
    ['5 m', 500],
    ['10 min walk', 1_000],
    ['5mins', 500],
    ['2kg of rice', 200],
    ['2 kids', 200],
    ['3 weeks', 300],
    ['500 thousandths', 50_000],
  ])('a following word is not a suffix: %s → %i', (text, minor) => {
    expect(parseAmount(text)).toBe(minor)
  })

  it('respects the currency\'s minor units', () => {
    expect(parseAmount('¥1.5k', 'JPY')).toBe(1_500)
    expect(parseAmount('1 week', 'JPY')).toBe(1)
  })
})

describe('money helpers', () => {
  it('fmt / toMinor / roundMajor', () => {
    expect(fmt(345_000)).toBe('¥3,450')
    expect(fmt(-48_620)).toBe('−¥486.20')
    expect(toMinor(12.34)).toBe(1_234)
    expect(roundMajor(12_345)).toBe(12_300)
  })
})
