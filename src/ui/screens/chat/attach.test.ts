import { describe, expect, it } from 'vitest'
import { MAX_FILES, canAttach, leftOutNote, pickFiles } from './attach'

const f = (name: string, size = 10) => new File(['x'.repeat(size)], name)

describe('chat attachments', () => {
  it('takes readable files and skips hidden, empty, huge and unknown ones', () => {
    expect(canAttach(f('receipt.pdf'))).toBe(true)
    expect(canAttach(f('scan.JPG'))).toBe(true)
    expect(canAttach(f('.DS_Store'))).toBe(false)
    expect(canAttach(f('app.exe'))).toBe(false)
    expect(canAttach(f('empty.txt', 0))).toBe(false)
    expect(canAttach({ name: 'big.pdf', size: 21 * 1024 * 1024 })).toBe(false)
  })

  it('cuts a big folder to the room left and says why files were left out', () => {
    const files = [...Array.from({ length: MAX_FILES + 3 }, (_, i) => f(`r${String(i).padStart(2, '0')}.txt`)), f('.DS_Store'), f('tool.exe')]
    const r = pickFiles(files, MAX_FILES)
    expect(r.take).toHaveLength(MAX_FILES)
    expect(r).toMatchObject({ unreadable: 2, overLimit: 3 })
    expect(leftOutNote(true, r.take.length, r.unreadable, r.overLimit)).toBe(`3 more left out: up to ${MAX_FILES} files at a time. 2 skipped that Bun can't read.`)
    expect(leftOutNote(true, 2, 1, 0)).toBe("1 skipped that Bun can't read.")
    expect(leftOutNote(false, 1, 0, 0)).toBeNull()
    expect(leftOutNote(true, 0, 4, 0)).toMatch(/Nothing in that folder/)
  })
})
