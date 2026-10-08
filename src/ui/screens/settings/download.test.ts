import { describe, expect, it } from 'vitest'
import { byteSize, downloadText, exportFileName, prettyJson } from './download'

describe('download helpers', () => {
  it('names exports by kind and local date', () => {
    expect(exportFileName('data', 'json', new Date(2026, 9, 2, 23, 59))).toBe('fundbun-data-2026-10-02.json')
    expect(exportFileName('audit-log', 'jsonl', new Date(2026, 0, 31))).toBe('fundbun-audit-log-2026-01-31.jsonl')
  })

  it('pretty-prints JSON and leaves other text alone', () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(prettyJson('not json')).toBe('not json')
  })

  it('sizes payloads in UTF-8 bytes', () => {
    expect(byteSize('abc')).toBe('3 B')
    expect(byteSize('¥')).toBe('2 B')
    expect(byteSize('x'.repeat(2048))).toBe('2.0 KB')
    expect(byteSize('x'.repeat(3 * 1024 * 1024))).toBe('3.0 MB')
  })

  it('reports that downloads are unavailable outside a browser', () => {
    expect(downloadText('a.json', '{}')).toBe(false)
  })
})
