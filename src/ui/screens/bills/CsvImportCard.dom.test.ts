// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement as h } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestApp } from '../../../core/app'
import { ToastProvider } from '../../components/ds'
import { cleanup, flush, render } from '../../components/ds/testing'
import { encodeGbk } from '../../lib/gbk.testutil'
import { AppProvider, type EngineStatus } from '../../state'
import { CsvImportCard } from './CsvImportCard'

afterEach(async () => {
  await cleanup()
  vi.restoreAllMocks()
})

describe('Bills › Import a statement (F28)', () => {
  it('reads a GBK Alipay export through the GB18030 fallback, not a lossy file.text()', async () => {
    const app = createTestApp()
    app.loadDemo('mei')
    const spy = vi.spyOn(app, 'importCsv')
    const status: EngineStatus = { ready: true, app }
    const { container } = await render(h(AppProvider, { status, children: h(ToastProvider, { children: h(CsvImportCard) }) }))
    const text = readFileSync(resolve(process.cwd(), 'src/core/sandbox/__fixtures__/alipay-2026-09.csv'), 'utf8')
    const bytes = encodeGbk(text)
    const file = {
      name: 'alipay.csv',
      size: bytes.length,
      arrayBuffer: async () => bytes.slice().buffer,
      // what the old code used: a UTF-8 read that garbles GBK
      text: async () => new TextDecoder('utf-8').decode(bytes),
    }
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush(10)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toContain('交易时间,交易分类,交易对方')
    expect(container.textContent).not.toMatch(/Could not find a header row/)
  })
})
