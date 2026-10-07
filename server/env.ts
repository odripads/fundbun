import { existsSync, readFileSync } from 'node:fs'

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Tiny .env parser (no dotenv dependency). Supports `KEY=value`, `export KEY=value`, blank lines,
 * `#` comments, single/double-quoted values (double quotes understand \n \r \t \" \\) and trailing
 * ` # comments` after unquoted values. Invalid lines are skipped, never thrown on.
 */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  for (const raw of lines) {
    const entry = parseLine(raw)
    if (entry) out[entry[0]] = entry[1]
  }
  return out
}

function parseLine(raw: string): [string, string] | null {
  const line = raw.trim()
  if (!line || line.startsWith('#')) return null
  const body = line.startsWith('export ') ? line.slice(7).trimStart() : line
  const eq = body.indexOf('=')
  if (eq <= 0) return null
  const key = body.slice(0, eq).trim()
  if (!KEY.test(key)) return null
  return [key, parseValue(body.slice(eq + 1).trim())]
}

function parseValue(value: string): string {
  const quote = value[0]
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1)
    const closing = quote === '"' ? findClosingDoubleQuote(value) : end
    if (closing > 0) {
      const inner = value.slice(1, closing)
      return quote === '"' ? unescapeDouble(inner) : inner
    }
  }
  const hash = value.search(/\s#/)
  return (hash >= 0 ? value.slice(0, hash) : value).trim()
}

function findClosingDoubleQuote(value: string): number {
  for (let i = 1; i < value.length; i++) {
    if (value[i] === '\\') i++
    else if (value[i] === '"') return i
  }
  return -1
}

function unescapeDouble(inner: string): string {
  const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' }
  return inner.replace(/\\(.)/g, (_m, ch: string) => map[ch] ?? `\\${ch}`)
}

/**
 * Load a .env file into `env` without overriding variables that are already set (the real
 * environment always wins). Returns the keys that were applied. Missing file → no-op.
 */
export function loadEnvFile(path: string, env: Record<string, string | undefined> = process.env): string[] {
  if (!existsSync(path)) return []
  const parsed = parseDotenv(readFileSync(path, 'utf8'))
  const applied: string[] = []
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] !== undefined) continue
    env[key] = value
    applied.push(key)
  }
  return applied
}
