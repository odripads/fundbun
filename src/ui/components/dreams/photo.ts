/**
 * On-device photo handling for dream items: decode the picked file, scale it to fit 512 × 512 on a canvas and
 * re-encode it as a JPEG data: URL. The file never leaves the device — no upload, no network request.
 */
import { fitWithin } from './logic'

export const MAX_PHOTO_PX = 512
/** refuse absurdly large files before decoding them (phones produce ~3–12 MB) */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024
const JPEG_QUALITY = 0.84

export class PhotoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhotoError'
  }
}

/** A user-facing reason the file can't be used, or null when it looks like an image we can try. */
export function photoFileProblem(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith('image/')) return 'That file isn’t a photo — pick a JPG, PNG or WebP.'
  if (file.size > MAX_PHOTO_BYTES) return 'That photo is too large — try one under 25 MB.'
  return null
}

interface Decoded {
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() }
    } catch {
      // fall through to <img> (some engines reject the options bag)
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new PhotoError('Couldn’t read that photo — try a JPG or PNG.')
  }
}

function plateColour(): string {
  const token = getComputedStyle(document.documentElement).getPropertyValue('--c-cream-50').trim()
  return token || 'white'
}

/** Resize a picked photo to fit max × max and return a JPEG data: URL. Throws PhotoError with friendly copy. */
export async function photoToDataUrl(file: File, max = MAX_PHOTO_PX): Promise<string> {
  const problem = photoFileProblem(file)
  if (problem) throw new PhotoError(problem)
  const img = await decode(file)
  try {
    const { width, height } = fitWithin(img.width, img.height, max)
    if (!width || !height) throw new PhotoError('That photo looks empty — try another one.')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new PhotoError('This browser can’t resize photos — pick a picture instead.')
    // JPEG has no alpha: give transparent PNGs the cream dough plate instead of black
    ctx.fillStyle = plateColour()
    ctx.fillRect(0, 0, width, height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img.source, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  } finally {
    img.release()
  }
}
