/**
 * Thin OCR wrapper around `tesseract.js`. It only turns an image into text — it never parses, and it never
 * does anything with the text. `parse.ts` consumes the text downstream, so the parser stays testable with
 * plain strings (tests never run real OCR here).
 *
 * Languages: Simplified Chinese (chi_sim), English (eng) and Indonesian (ind).
 *
 * Honest note on offline/bundling: tesseract.js loads its WASM core, worker script and `*.traineddata.gz`
 * language files at runtime. By default it fetches them from its CDN; a fully offline build must ship those
 * assets and pass `corePath` / `workerPath` / `langPath` pointing at them. That bundling is NOT done here —
 * the wrapper accepts the paths so it can be, and the rest of the feature is exercised against plain text.
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
    ...(opts.workerPath ? { workerPath: opts.workerPath } : {}),
    logger: (m: { progress: number }) => opts.onProgress?.(m.progress ?? 0),
  })
  try {
    const { data } = await worker.recognize(src)
    return { text: data.text ?? '' }
  } finally {
    await worker.terminate()
  }
}
