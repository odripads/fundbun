#!/usr/bin/env node
/**
 * Builds the FundBun desktop app.
 *   node scripts/desktop-build.mjs            → desktop/app (run it with `npx electron desktop/app`)
 *   node scripts/desktop-build.mjs --package  → also desktop/release/FundBun.app and a .dmg (macOS)
 * The app folder holds: main.mjs (Electron main + FundBun's server, one file), mcp-bridge.mjs, dist/ (the web app).
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const appDir = join(root, 'desktop', 'app')
const releaseDir = join(root, 'desktop', 'release')
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts })

if (!process.argv.includes('--skip-web')) run('npm', ['run', 'build'])
if (!existsSync(join(root, 'dist', 'index.html'))) throw new Error('dist/ is missing: run `npm run build` first')

rmSync(appDir, { recursive: true, force: true })
mkdirSync(appDir, { recursive: true })
await build({
  entryPoints: [join(root, 'desktop', 'main.ts')],
  outfile: join(appDir, 'main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron'],
  // packages written as CommonJS call require() for Node's own modules
  banner: { js: "import { createRequire as __fundbunRequire } from 'node:module'; const require = __fundbunRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
})
cpSync(join(root, 'server', 'agents', 'mcp-bridge.mjs'), join(appDir, 'mcp-bridge.mjs'))
cpSync(join(root, 'dist'), join(appDir, 'dist'), { recursive: true })
cpSync(join(root, 'LICENSE'), join(appDir, 'LICENSE'))
writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'fundbun', productName: 'FundBun', version: pkg.version, description: pkg.description, license: pkg.license, type: 'module', main: 'main.mjs' }, null, 2))
console.log(`[desktop] app folder ready: ${appDir}`)

if (process.argv.includes('--package')) {
  if (platform() !== 'darwin') throw new Error('Packaging is set up for macOS only so far.')
  const { packager } = await import('@electron/packager')
  rmSync(releaseDir, { recursive: true, force: true })
  const icon = makeIcns()
  const [out] = await packager({
    dir: appDir,
    out: releaseDir,
    name: 'FundBun',
    appBundleId: 'com.kalcerinstitute.fundbun',
    appCategoryType: 'public.app-category.finance',
    appCopyright: 'MIT licensed. Kalcer Institute.',
    platform: 'darwin',
    arch: arch(),
    // the agents run mcp-bridge.mjs as a plain file, so the app is not packed into an archive
    asar: false,
    overwrite: true,
    prune: false,
    ...(icon ? { icon } : {}),
  })
  const bundle = join(out, 'FundBun.app')
  // Apple silicon runs only signed code: an ad-hoc signature (no Apple Developer ID; Gatekeeper will still ask)
  run('codesign', ['--force', '--deep', '--sign', '-', bundle])
  const stage = join(releaseDir, 'dmg')
  mkdirSync(stage, { recursive: true })
  cpSync(bundle, join(stage, 'FundBun.app'), { recursive: true, verbatimSymlinks: true })
  symlinkSync('/Applications', join(stage, 'Applications'))
  const dmg = join(releaseDir, `FundBun-${pkg.version}-mac-${arch()}.dmg`)
  run('hdiutil', ['create', '-volname', 'FundBun', '-srcfolder', stage, '-ov', '-format', 'UDZO', dmg])
  rmSync(stage, { recursive: true, force: true })
  console.log(`[desktop] ${bundle}\n[desktop] ${dmg}`)
}

/** public/icon-512.png → an .icns file (macOS tools only); null when they are missing. */
function makeIcns() {
  try {
    const src = join(root, 'public', 'icon-512.png')
    const set = join(root, 'desktop', 'icon.iconset')
    rmSync(set, { recursive: true, force: true })
    mkdirSync(set, { recursive: true })
    for (const size of [16, 32, 128, 256, 512]) {
      execFileSync('sips', ['-z', String(size), String(size), src, '--out', join(set, `icon_${size}x${size}.png`)], { stdio: 'ignore' })
      if (size <= 256) execFileSync('sips', ['-z', String(size * 2), String(size * 2), src, '--out', join(set, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' })
    }
    const out = join(root, 'desktop', 'icon.icns')
    execFileSync('iconutil', ['-c', 'icns', set, '-o', out], { stdio: 'ignore' })
    rmSync(set, { recursive: true, force: true })
    return out
  } catch {
    return null
  }
}
