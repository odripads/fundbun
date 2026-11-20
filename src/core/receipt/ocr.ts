/**
 * Thin OCR wrapper around `tesseract.js`. It only turns an image into text — it never parses, and it never
 * does anything with the text. `parse.ts` consumes the text downstream, so the parser stays testable with
 * plain strings (tests never run real OCR here).
 *
 * Languages: Simplified Chinese (chi_sim), English (eng) and Indonesian (ind).
 *
 * Offline: tesseract.js loads its WASM core, worker script and `*.traineddata.gz` language files at runtime.
 * The app ships them itself (scripts/ocr-assets.mjs copies them into public/ocr at every build) and the UI passes
 * `ocrAssets(base)` so nothing is fetched from a CDN: CDNs are blocked in mainland China and the CSP allows only
 * the app's own origin. The worker is loaded by URL (not as a blob), so the CSP needs no blob: for workers.
 */
export type ReceiptOcrLang = 'chi_sim' | 'eng' | 'ind'

/** The languages we OCR with (combined into a single worker). */
export const RECEIPT_OCR_LANGS: readonly ReceiptOcrLang[] = ['chi_sim', 'eng', 'ind']

export interface OcrOptions {
  /** base URL/URL for `*.traineddata.gz` files (unset → tesseract.js fetches from its CDN) */
  langPath?: string
  /** URL to `tesseract.js-core` WASM (unset → CDN) */
  corePath?: string
  /** URL to the tesseract worker script (unset → CDN) */
  workerPath?: string
  /** progress callback, 0..1 */
  onProgress?: (progress: number) => void
}

/** The app's own copies of the reader (public/ocr), under the site's base path ('/' or '/fundbun/'). */
export function ocrAssets(base: string): Required<Pick<OcrOptions, 'workerPath' | 'corePath' | 'langPath'>> {
  const root = `${base.replace(/\/?$/, '/')}ocr/`
  return { workerPath: `${root}worker.min.js`, corePath: `${root}core/`, langPath: `${root}lang` }
}

export interface ReceiptOcrResult {
  text: string
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('Could not read the photo.'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Recognise the text of a receipt photo. Accepts a `File`, `Blob` or an already-resolved image URL/data-URL.
 * Throws on failure; the caller decides how to surface it. The worker is terminated on every call so no OCR
 * stays resident in memory between scans.
 */
export async function recognizeReceipt(image: Blob | File | string, opts: OcrOptions = {}): Promise<ReceiptOcrResult> {
  const src = typeof image === 'string' ? image : await blobToDataUrl(image)
  const tesseract = await import('tesseract.js')
  const worker = await tesseract.createWorker(RECEIPT_OCR_LANGS.join('+'), 1, {
    ...(opts.langPath ? { langPath: opts.langPath } : {}),
    ...(opts.corePath ? { corePath: opts.corePath } : {}),
    ...(opts.workerPath ? { workerPath: opts.workerPath, workerBlobURL: false } : {}),
    logger: (m: { progress: number }) => opts.onProgress?.(m.progress ?? 0),
  })
  try {
    const { data } = await worker.recognize(src)
    return { text: data.text ?? '' }
  } finally {
    await worker.terminate()
  }
}
