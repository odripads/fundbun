/**
 * Read any file a user picks into something Bun can add: a statement (rows) or one document (a receipt or a bill).
 * Everything runs on the device; the file itself is never kept, only the numbers the user confirms.
 *
 *   CSV / TSV / TXT with columns      → statement rows
 *   Excel (.xlsx)                      → statement rows
 *   PDF                                → its text (or, for a scan with no text, the first page read like a photo)
 *   Word (.docx)                       → its text
 *   photo (PNG, JPG, HEIC…)            → read like a receipt (OCR)
 *
 * A text with three or more dated amounts is a statement; otherwise it is one receipt or bill.
 */
import { looksLikeBill, ocrAssets, recognizeReceipt, rowsToCsv, statementFromText } from '../../../core/receipt'
import type { ISODate } from '../../../core/types'

export type FileRead =
  | { kind: 'statement'; csv: string; rows: number; source: string }
  | { kind: 'document'; text: string; source: string; bill: boolean }
  | { kind: 'error'; error: string }

/** Largest file read: big enough for a year of statements, small enough for a phone. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024
/** PDF pages read for text. */
const MAX_PDF_PAGES = 20

/** What the file input accepts. */
export const FILE_ACCEPT = 'image/*,.pdf,application/pdf,.csv,text/csv,.tsv,.txt,text/plain,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.xls,.doc'

export type FileKind = 'image' | 'pdf' | 'csv' | 'text' | 'xlsx' | 'docx' | 'xls' | 'doc' | 'other'

export function fileKind(file: Pick<File, 'name' | 'type'>): FileKind {
  const name = file.name.toLowerCase()
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'heic', 'heif', 'webp', 'gif', 'bmp'].includes(ext)) return 'image'
  if (ext === 'pdf' || file.type === 'application/pdf') return 'pdf'
  if (ext === 'csv' || ext === 'tsv' || file.type === 'text/csv') return 'csv'
  if (ext === 'txt' || file.type === 'text/plain') return 'text'
  if (ext === 'xlsx') return 'xlsx'
  if (ext === 'docx') return 'docx'
  if (ext === 'xls') return 'xls'
  if (ext === 'doc') return 'doc'
  return 'other'
}

const LABEL: Record<FileKind, string> = {
  image: 'Photo', pdf: 'PDF', csv: 'Spreadsheet', text: 'Text file', xlsx: 'Excel file', docx: 'Word file', xls: 'Excel file', doc: 'Word file', other: 'File',
}

export interface ReadOptions {
  today: ISODate
  /** the site's base path, for the app's own OCR files */
  base: string
  onProgress?: (p: number) => void
}

export async function readAnyFile(file: File, opts: ReadOptions): Promise<FileRead> {
  if (file.size > MAX_FILE_BYTES) return { kind: 'error', error: 'That file is over 20 MB. Try a shorter statement or one month at a time.' }
  const kind = fileKind(file)
  const source = `${LABEL[kind]} · ${file.name}`
  try {
    switch (kind) {
      case 'csv':
        return { kind: 'statement', csv: await file.text(), rows: countRows(await file.text()), source }
      case 'text':
        return route(await file.text(), source, opts.today)
      case 'xlsx': {
        // the first sheet with rows: a statement export usually has one
        const { readSheet } = await import('read-excel-file/browser')
        const rows = (await readSheet(file)) as unknown as unknown[][]
        const csv = rowsToCsv(rows)
        return { kind: 'statement', csv, rows: countRows(csv), source }
      }
      case 'docx': {
        const mammoth = await import('mammoth')
        const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
        return route(value, source, opts.today)
      }
      case 'pdf':
        return route(await pdfText(file, opts), source, opts.today)
      case 'image': {
        const { text } = await recognizeReceipt(file, { ...ocrAssets(opts.base), onProgress: opts.onProgress })
        return route(text, source, opts.today)
      }
      case 'xls':
        return { kind: 'error', error: 'Old Excel files (.xls) can’t be read. Save it as .xlsx or CSV and try again.' }
      case 'doc':
        return { kind: 'error', error: 'Old Word files (.doc) can’t be read. Save it as .docx or PDF and try again.' }
      default:
        return { kind: 'error', error: 'Bun reads photos, PDF, Excel (.xlsx), Word (.docx), CSV and text files.' }
    }
  } catch (e) {
    return { kind: 'error', error: e instanceof Error && e.message ? `Couldn’t read that file: ${e.message}` : 'Couldn’t read that file.' }
  }
}

function countRows(csv: string): number {
  return Math.max(0, csv.split(/\r?\n/).filter((l) => l.trim()).length - 1)
}

function route(text: string, source: string, today: ISODate): FileRead {
  const clean = text.replace(/\u0000/g, '').trim()
  if (!clean) return { kind: 'error', error: 'No text could be found in that file.' }
  const statement = statementFromText(clean, today)
  if (statement) return { kind: 'statement', csv: statement.csv, rows: statement.rows, source }
  return { kind: 'document', text: clean, source, bill: looksLikeBill(clean) }
}

/** The text of a PDF, line by line; a scan with no text has its first page read like a photo. */
async function pdfText(file: File, opts: ReadOptions): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useWasm: false }).promise
  const lines: string[] = []
  for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    // items on the same baseline make one line, left to right
    const rows = new Map<number, { x: number; s: string }[]>()
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const y = Math.round(item.transform[5])
      const row = rows.get(y) ?? []
      row.push({ x: item.transform[4], s: item.str })
      rows.set(y, row)
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) lines.push(rows.get(y)!.sort((a, b) => a.x - b.x).map((i) => i.s).join(' '))
  }
  if (lines.join('').trim().length >= 20) return lines.join('\n')
  // a scanned PDF: render the first page and read it like a photo
  const page = await doc.getPage(1)
  const viewport = page.getViewport({ scale: 2 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvas, viewport }).promise
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t render the page'))), 'image/png'))
  const { text } = await recognizeReceipt(blob, { ...ocrAssets(opts.base), onProgress: opts.onProgress })
  return text
}
