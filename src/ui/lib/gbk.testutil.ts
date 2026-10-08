/** Test-only: build GBK/GB18030 statement bytes (Node has no GBK encoder). */

/** GB18030 bytes for `text`: ASCII as is, every other character looked up by brute force in the 2-byte GBK range. */
export function encodeGbk(text: string): Uint8Array {
  const decoder = new TextDecoder('gb18030')
  const table = new Map<string, [number, number]>()
  for (let a = 0x81; a <= 0xfe; a++) {
    for (let b = 0x40; b <= 0xfe; b++) {
      if (b === 0x7f) continue
      const ch = decoder.decode(new Uint8Array([a, b]))
      if (ch.length === 1 && !table.has(ch)) table.set(ch, [a, b])
    }
  }
  const out: number[] = []
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (code < 0x80) out.push(code)
    else {
      const pair = table.get(ch)
      if (!pair) throw new Error(`no GBK code for ${ch}`)
      out.push(...pair)
    }
  }
  return new Uint8Array(out)
}
