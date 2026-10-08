import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { importCsv } from '../../core/sandbox/csv'
import { decodeCsvBytes, readCsvFile } from './csvFile'
import { encodeGbk } from './gbk.testutil'

const alipay = readFileSync(new URL('../../core/sandbox/__fixtures__/alipay-2026-09.csv', import.meta.url), 'utf8')
const opts = { accountId: 'chk_main', currency: 'CNY' as const }

describe('reading a GBK statement (F28: the Bills import had no GB18030 fallback)', () => {
  const gbk = encodeGbk(alipay)

  it('a lossy UTF-8 read (the old file.text() path) turns the Chinese headers into mojibake', () => {
    expect(importCsv(new TextDecoder('utf-8').decode(gbk), opts).format).toBe('unknown')
  })

  it('decodeCsvBytes falls back to GB18030 and the Alipay export imports', () => {
    const r = importCsv(decodeCsvBytes(gbk), opts)
    expect(r.format).toBe('alipay')
    expect(r.transactions.length).toBeGreaterThan(0)
  })

  it('readCsvFile reads the bytes (not text()) for any picked file', async () => {
    const text = await readCsvFile({ arrayBuffer: async () => gbk.slice().buffer })
    expect(text).toBe(decodeCsvBytes(gbk))
    expect(importCsv(text, opts).format).toBe('alipay')
  })

  it('UTF-8 files (with or without a BOM) still read as UTF-8', () => {
    const utf8 = new TextEncoder().encode(`﻿${alipay}`)
    expect(decodeCsvBytes(utf8)).toBe(alipay)
  })
})
