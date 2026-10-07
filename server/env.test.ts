import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadEnvFile, parseDotenv } from './env'

describe('parseDotenv', () => {
  it('parses plain pairs, export prefixes, comments and blank lines', () => {
    const text = '# comment\n\nA=1\nexport B=two\n  C = spaced  \n'
    expect(parseDotenv(text)).toEqual({ A: '1', B: 'two', C: 'spaced' })
  })

  it('keeps empty values (ANTHROPIC_API_KEY= in .env.example)', () => {
    expect(parseDotenv('ANTHROPIC_API_KEY=\nX=')).toEqual({ ANTHROPIC_API_KEY: '', X: '' })
  })

  it('handles quoted values, escapes in double quotes and literal single quotes', () => {
    const text = `D="hello # not a comment"\nE='raw \\n stays'\nF="line\\nbreak \\"q\\""`
    expect(parseDotenv(text)).toEqual({ D: 'hello # not a comment', E: 'raw \\n stays', F: 'line\nbreak "q"' })
  })

  it('strips trailing comments only after whitespace in unquoted values', () => {
    expect(parseDotenv('URL=https://x.test/#frag\nN=30 # per minute')).toEqual({ URL: 'https://x.test/#frag', N: '30' })
  })

  it('keeps everything after the first = (base64 keys, URLs with query strings)', () => {
    expect(parseDotenv('K=abc==\nQ=https://a.test/?x=1&y=2')).toEqual({ K: 'abc==', Q: 'https://a.test/?x=1&y=2' })
  })

  it('handles CRLF line endings and a BOM', () => {
    expect(parseDotenv('﻿A=1\r\nB=2\r\n')).toEqual({ A: '1', B: '2' })
  })

  it('skips malformed lines instead of throwing', () => {
    expect(parseDotenv('=novalue\n1BAD=x\nno equals\nbad-key=1\nOK=yes')).toEqual({ OK: 'yes' })
  })

  it('treats an unterminated quote as a literal value', () => {
    expect(parseDotenv('A="open')).toEqual({ A: '"open' })
  })
})

describe('loadEnvFile', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('applies new keys but never overrides the real environment', () => {
    dir = mkdtempSync(join(tmpdir(), 'fundbun-env-'))
    const file = join(dir, '.env')
    writeFileSync(file, 'A=from-file\nB=from-file\n')
    const env: Record<string, string | undefined> = { A: 'from-env' }
    expect(loadEnvFile(file, env)).toEqual(['B'])
    expect(env).toEqual({ A: 'from-env', B: 'from-file' })
  })

  it('treats an explicitly empty env var as set', () => {
    dir = mkdtempSync(join(tmpdir(), 'fundbun-env-'))
    const file = join(dir, '.env')
    writeFileSync(file, 'A=from-file\n')
    const env: Record<string, string | undefined> = { A: '' }
    loadEnvFile(file, env)
    expect(env.A).toBe('')
  })

  it('is a no-op when the file does not exist', () => {
    const env: Record<string, string | undefined> = {}
    expect(loadEnvFile('/nonexistent/fundbun/.env', env)).toEqual([])
    expect(env).toEqual({})
  })
})
