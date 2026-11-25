import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lintRepository, lintSource } from '../scripts/lint-agents'

const ROOT = resolve(__dirname, '..')

describe('scripts/lint-agents (anti-slop + Factory rules)', () => {
  it('flags chained type assertions and allows single assertions', () => {
    expect(lintSource('const x = input as unknown as number', 'src/core/a.ts').map((v) => v.rule)).toContain(
      'anti-slop/no-chained-type-assertions',
    )
    expect(lintSource('const x = [1, 2] as const', 'src/core/a.ts')).toEqual([])
  })

  it('flags "as any" in production files', () => {
    expect(lintSource('const x = y as any', 'server/a.ts').map((v) => v.rule)).toContain('anti-slop/no-as-any')
  })

  it('flags bare "object" parameter types and allows Record<string, unknown> or unknown', () => {
    expect(lintSource('function f(x: object) { return x }', 'src/core/a.ts').map((v) => v.rule)).toContain(
      'anti-slop/no-object-parameters',
    )
    expect(lintSource('function f(x: unknown): x is Record<string, unknown> { return !!x }', 'src/core/a.ts')).toEqual([])
  })

  it('flags Reflect.get and Reflect.apply', () => {
    expect(lintSource('const v = Reflect.get(a, "b")', 'src/core/a.ts').map((v) => v.rule)).toContain(
      'anti-slop/no-reflect-apply-or-get',
    )
  })

  it('flags copying accumulators inside reduce() and allows in-place mutation', () => {
    expect(
      lintSource('items.reduce((acc, x) => ({ ...acc, [x]: 1 }), {} as Record<string, number>)', 'src/core/a.ts').map((v) => v.rule),
    ).toContain('anti-slop/no-reduce-accumulator-copy')
    expect(
      lintSource('items.reduce((acc, x) => acc.concat([x]), [] as number[])', 'src/core/a.ts').map((v) => v.rule),
    ).toContain('anti-slop/no-reduce-accumulator-copy')
    expect(
      lintSource('items.reduce((acc, x) => { acc.push(x); return acc }, [] as number[])', 'src/core/a.ts'),
    ).toEqual([])
  })

  it('flags "shape" in local symbol names and allows domain names', () => {
    expect(lintSource('function isRowShape(v: unknown) { return !!v }', 'src/core/a.ts').map((v) => v.rule)).toContain(
      'anti-slop/no-shape-in-symbol-names',
    )
    expect(lintSource('function isAuditEntry(v: unknown) { return !!v }', 'src/core/a.ts')).toEqual([])
  })

  it('flags module mocking (vi.mock / jest.mock) even in test files', () => {
    expect(lintSource('vi.mock("./dep", () => ({}))', 'src/core/a.test.ts').map((v) => v.rule)).toContain(
      'anti-slop/no-module-mocking',
    )
  })

  it('flags @ts-ignore / @ts-nocheck comments in production files', () => {
    expect(lintSource('// @ts-ignore\nconst x = 1', 'src/core/a.ts').map((v) => v.rule)).toContain(
      'anti-slop/no-ts-suppression',
    )
  })

  it('enforces FundBun architectural layer boundaries', () => {
    expect(lintSource('import { x } from "../ui/App"', 'src/core/a.ts').map((v) => v.rule)).toContain('fundbun/layer-boundaries')
    expect(lintSource('import { y } from "../../server/app"', 'src/ui/App.tsx').map((v) => v.rule)).toContain('fundbun/layer-boundaries')
    expect(lintSource('import { z } from "../core/money"', 'src/ui/App.tsx')).toEqual([])
  })

  it('flags dangerouslySetInnerHTML, eval(), and new Function()', () => {
    expect(lintSource('const E = () => <div dangerouslySetInnerHTML={{ __html: "x" }} />', 'src/ui/A.tsx').map((v) => v.rule)).toContain(
      'fundbun/no-dangerous-html-or-eval',
    )
    expect(lintSource('const x = eval("1")', 'server/a.ts').map((v) => v.rule)).toContain('fundbun/no-dangerous-html-or-eval')
  })

  it('flags console logging right before throwing', () => {
    expect(
      lintSource('function f() { try {} catch (e) { console.error(e); throw e } }', 'server/a.ts').map((v) => v.rule),
    ).toContain('fundbun/no-log-before-throw')
  })

  it('flags silent empty catch blocks while allowing documented ones', () => {
    expect(lintSource('try { a() } catch {}', 'src/core/a.ts').map((v) => v.rule)).toContain('fundbun/no-empty-catch')
    expect(lintSource('try { a() } catch { /* storage unavailable */ }', 'src/core/a.ts')).toEqual([])
  })

  it('flags em dashes and forbidden phrasing in production UI strings', () => {
    expect(lintSource('const label = "Under target \u2014 nice"', 'src/ui/A.tsx').map((v) => v.rule)).toContain(
      'fundbun/no-forbidden-ui-copy',
    )
    expect(lintSource('const label = "On target, with money left over."', 'src/ui/A.tsx')).toEqual([])
  })

  it('passes cleanly across the entire FundBun repository (src/ and server/)', () => {
    const report = lintRepository(ROOT)
    expect(report.filesScanned).toBeGreaterThan(500)
    expect(report.violations).toEqual([])
  })
})
