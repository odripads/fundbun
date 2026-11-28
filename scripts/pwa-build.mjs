#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))

export function appFiles(distDir, prefix = '') {
  const entries = readdirSync(join(distDir, prefix), { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = prefix ? join(prefix, entry.name) : entry.name
    if (entry.isDirectory()) files.push(...appFiles(distDir, path))
    else if (entry.isFile() && path !== 'sw.js') files.push(path.split(sep).join('/'))
  }
  return files.sort()
}

export function renderServiceWorker(template, files, cacheName) {
  const source = template
    .replace('__FUNDBUN_CACHE_NAME__', cacheName)
    .replace('__FUNDBUN_PRECACHE__', JSON.stringify(files))
  if (source.includes('__FUNDBUN_')) throw new Error('The service worker template was not fully rendered.')
  return source
}

export function buildServiceWorker(distDir, templatePath) {
  const files = appFiles(distDir)
  if (!files.includes('index.html') || !files.includes('manifest.webmanifest')) {
    throw new Error('Build the web app before generating its offline service worker.')
  }
  const template = readFileSync(templatePath, 'utf8')
  const hash = createHash('sha256')
  hash.update(template)
  for (const path of files) {
    hash.update(path)
    hash.update(readFileSync(join(distDir, path)))
  }
  const cacheName = `fundbun-${hash.digest('hex').slice(0, 16)}`
  const source = renderServiceWorker(template, files, cacheName)
  writeFileSync(join(distDir, 'sw.js'), source)
  return { cacheName, fileCount: files.length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildServiceWorker(join(ROOT, 'dist'), join(ROOT, 'scripts', 'pwa-sw.template.js'))
  console.log(`[pwa] ${result.cacheName}: ${result.fileCount} files ready for offline use`)
}
