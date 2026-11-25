// Copies the receipt reader (tesseract.js) into public/ocr so the app reads photos with no CDN: nothing is fetched
// from outside the app's own origin (CDNs are blocked in mainland China, and the CSP allows only 'self').
// Run before every dev server and build (package.json pre-scripts). public/ocr is generated, not committed.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
// fileURLToPath, not URL.pathname: on Windows the pathname is /C:/... and breaks every path below
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const out = join(root, 'public', 'ocr')
const pkg = (name) => dirname(require.resolve(`${name}/package.json`))

const files = [
  [join(pkg('tesseract.js'), 'dist', 'worker.min.js'), 'worker.min.js'],
  // the LSTM engine in three builds; the worker picks the one the browser supports
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'].map((f) => [join(pkg('tesseract.js-core'), f), `core/${f}`]),
  // English, Simplified Chinese and Indonesian
  ...['eng', 'chi_sim', 'ind'].map((l) => [join(pkg(`@tesseract.js-data/${l}`), '4.0.0_best_int', `${l}.traineddata.gz`), `lang/${l}.traineddata.gz`]),
]

let copied = 0
for (const [from, to] of files) {
  const dest = join(out, to)
  mkdirSync(dirname(dest), { recursive: true })
  if (!existsSync(from)) throw new Error(`OCR asset missing: ${from}`)
  copyFileSync(from, dest)
  copied++
}
console.log(`ocr-assets: ${copied} files → public/ocr`)
