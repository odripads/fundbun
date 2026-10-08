import { describe, expect, it } from 'vitest'
import config from '../vite.config'

describe('vite.config test globs', () => {
  it('collects .test.ts and .test.tsx under src, plus tests/ and server/', async () => {
    const resolved = typeof config === 'function' ? await config({ mode: 'test', command: 'serve' }) : config
    expect(resolved.test?.include).toEqual(['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts', 'server/**/*.test.ts'])
  })
})
