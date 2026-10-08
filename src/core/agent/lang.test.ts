import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../types'
import { detectLang, replyLang } from './lang'

const user = (text: string): ChatMessage => ({ id: text, role: 'user', text, ts: '2026-10-22T02:00:00.000Z' })

describe('detectLang', () => {
  it.each([
    ['我这个月花了多少钱？', 'zh'],
    ['存500到包包', 'zh'],
    ['往macbook存300', 'zh'],
    ['bulan ini aku boros nggak', 'id'],
    ['berapa saldo saya?', 'id'],
    ['pindahkan 200 ke macbook', 'id'],
    ['batalkan langganan spotify', 'id'],
    ['How am I doing this month?', 'en'],
    ['Move ¥300 to Chengdu', 'en'],
    ['show 美团 orders', 'en'],
  ] as const)('%s → %s', (text, lang) => {
    expect(detectLang(text)).toBe(lang)
  })

  it('has no opinion on names, numbers and one-word answers', () => {
    for (const t of ['¥300', 'Birkin', 'QQ Music', '2580', '', '   ']) expect(detectLang(t), t).toBeNull()
  })
})

describe('replyLang', () => {
  it('keeps the language of the recent conversation for messages without a signal of their own', () => {
    const chat = [user('batalkan langganan spotify'), user('QQ Music')]
    expect(replyLang('QQ Music', { chat })).toBe('id')
    expect(replyLang('Birkin', { chat: [user('我想存钱'), user('Birkin')] })).toBe('zh')
    expect(replyLang('¥300', { chat: [] })).toBe('en')
    expect(replyLang('How am I doing?', { chat: [user('存500到包包')] })).toBe('en')
  })
})
