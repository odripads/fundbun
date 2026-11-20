import { describe, expect, it } from 'vitest'
import { FILE_ACCEPT, fileKind } from './readFile'

describe('fileKind — which reader a file goes to', () => {
  const f = (name: string, type = '') => ({ name, type })
  it('by extension or type', () => {
    expect(fileKind(f('IMG_2041.HEIC'))).toBe('image')
    expect(fileKind(f('photo', 'image/jpeg'))).toBe('image')
    expect(fileKind(f('BCA statement Oct.pdf'))).toBe('pdf')
    expect(fileKind(f('wechat.csv'))).toBe('csv')
    expect(fileKind(f('notes.txt'))).toBe('text')
    expect(fileKind(f('budget.xlsx'))).toBe('xlsx')
    expect(fileKind(f('invoice.docx'))).toBe('docx')
    expect(fileKind(f('old.xls'))).toBe('xls')
    expect(fileKind(f('old.doc'))).toBe('doc')
    expect(fileKind(f('archive.zip'))).toBe('other')
  })
  it('the picker offers every readable type', () => {
    for (const ext of ['.pdf', '.csv', '.xlsx', '.docx', '.txt', 'image/*']) expect(FILE_ACCEPT).toContain(ext)
  })
})
