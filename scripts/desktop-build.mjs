#!/usr/bin/env node
/**
 * Builds the FundBun desktop app.
 *   node scripts/desktop-build.mjs            → desktop/app (run it with `npx electron desktop/app`)
 *   node scripts/desktop-build.mjs --package  → also a packaged app for the computer it runs on, in desktop/release:
 *     macOS   FundBun-darwin-<arch>/FundBun.app + FundBun-<version>-mac-<arch>.dmg
 *     Windows FundBun-win32-<arch>/ + FundBun-<version>-win-<arch>.zip
 *     Linux   FundBun-linux-<arch>/ + FundBun-<version>-linux-<arch>.tar.gz
 *   Each platform packages only for itself (the GitHub Actions workflow desktop-release.yml builds all three).
 * The app folder holds: main.mjs (Electron main + FundBun's server, one file), mcp-bridge.mjs, dist/ (the web app).
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const appDir = join(root, 'desktop', 'app')
const releaseDir = join(root, 'desktop', 'release')
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts })
// npm is npm.cmd on Windows, which Node starts only through a shell (fixed arguments, nothing from outside)
const npm = (args) => run('npm', args, { shell: platform() === 'win32' })

if (!process.argv.includes('--skip-web')) npm(['run', 'build'])
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
  const os = platform()
  if (!['darwin', 'win32', 'linux'].includes(os)) throw new Error(`Packaging is set up for macOS, Windows and Linux, not ${os}.`)
  const { packager } = await import('@electron/packager')
  rmSync(releaseDir, { recursive: true, force: true })
  const icon = os === 'darwin' ? makeIcns() : null
  const [out] = await packager({
    dir: appDir,
    out: releaseDir,
    name: 'FundBun',
    appBundleId: 'com.kalcerinstitute.fundbun',
    appCategoryType: 'public.app-category.finance',
    appCopyright: 'MIT licensed. Kalcer Institute.',
    platform: os,
    arch: arch(),
    // the agents run mcp-bridge.mjs as a plain file, so the app is not packed into an archive
    asar: false,
    overwrite: true,
    prune: false,
    ...(icon ? { icon } : {}),
    ...(os === 'win32' ? { win32metadata: { CompanyName: 'Kalcer Institute', ProductName: 'FundBun', FileDescription: 'FundBun' } } : {}),
  })
  if (os === 'darwin') packageMac(out)
  else if (os === 'win32') packageWindows(out)
  else packageLinux(out)
}

const LOCAL_MAC_CERT = 'FundBun Local Dev'

/**
 * Picks the macOS signing identity:
 * 1. Explicit FUNDBUN_MAC_SIGN_IDENTITY env var (e.g. Apple Developer ID or a custom cert name/hash).
 * 2. A locally trusted self-signed "FundBun Local Dev" code-signing certificate in the login Keychain so macOS
 *    Keychain "Always Allow" persists across rebuilds instead of breaking on a new ad-hoc CDHash every build.
 * 3. Ad-hoc ('-') fallback for CI and machines without a code-signing certificate.
 */
function resolveMacSignIdentity() {
  const explicit = process.env.FUNDBUN_MAC_SIGN_IDENTITY?.trim()
  if (explicit) return { identity: explicit, label: explicit }
  try {
    const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    for (const line of out.split('\n')) {
      const m = /^\s*\d+\)\s+([0-9A-Fa-f]{40})\s+"([^"]+)"/.exec(line)
      if (m && m[2] === LOCAL_MAC_CERT) return { identity: m[1], label: `${LOCAL_MAC_CERT} (${m[1].slice(0, 8)})` }
    }
  } catch {
    // security CLI unavailable or keychain locked: fall back to ad-hoc signing
  }
  return { identity: '-', label: 'ad-hoc (-)' }
}

function packageMac(out) {
  const bundle = join(out, 'FundBun.app')
  // Apple silicon runs only signed code. A persistent signing identity keeps macOS Keychain "Always Allow"
  // working across rebuilds; ad-hoc ('-') is the fallback when no certificate is installed.
  const { identity, label } = resolveMacSignIdentity()
  console.log(`[desktop] signing FundBun.app with ${label}`)
  run('codesign', ['--force', '--deep', '--sign', identity, bundle])
  const stage = join(releaseDir, 'dmg')
  mkdirSync(stage, { recursive: true })
  cpSync(bundle, join(stage, 'FundBun.app'), { recursive: true, verbatimSymlinks: true })
  symlinkSync('/Applications', join(stage, 'Applications'))
  const dmg = join(releaseDir, `FundBun-${pkg.version}-mac-${arch()}.dmg`)
  run('hdiutil', ['create', '-volname', 'FundBun', '-srcfolder', stage, '-ov', '-format', 'UDZO', dmg])
  rmSync(stage, { recursive: true, force: true })
  console.log(`[desktop] ${bundle}\n[desktop] ${dmg}`)
}

function packageWindows(out) {
  // unsigned: Windows SmartScreen will ask "Run anyway" on first start
  const zip = join(releaseDir, `FundBun-${pkg.version}-win-${arch()}.zip`)
  rmSync(zip, { force: true })
  // the folder name stays inside the zip, so it unpacks to FundBun-win32-<arch>\FundBun.exe
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Compress-Archive -LiteralPath $env:FUNDBUN_SRC -DestinationPath $env:FUNDBUN_DEST -Force'], {
    env: { ...process.env, FUNDBUN_SRC: out, FUNDBUN_DEST: zip },
  })
  console.log(`[desktop] ${join(out, 'FundBun.exe')}\n[desktop] ${zip}`)
}

function packageLinux(out) {
  const tarball = join(releaseDir, `FundBun-${pkg.version}-linux-${arch()}.tar.gz`)
  run('tar', ['-czf', tarball, '-C', releaseDir, basename(out)])
  console.log(`[desktop] ${join(out, 'FundBun')}\n[desktop] ${tarball}`)
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
