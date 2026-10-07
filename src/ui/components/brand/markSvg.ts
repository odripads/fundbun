/**
 * Static SVG markup for Bun (default calm face) — generates logo.svg, logo-mono.svg, favicon.svg and the brand
 * exports from the same geometry the React mascot draws, so the files can never drift from the component.
 * Output uses presentation attributes only, so rsvg, Figma, Illustrator and icon pipelines render it identically;
 * the one exception is the opt-in `keyline: 'media'` (favicons), which adds a dark-scheme rule browsers honour.
 */
import {
  BODY_PATH,
  CUTS,
  KEYLINE_EXTRA,
  KNOT_TWIST,
  PALETTE,
  POCKET_STOPS,
  SMALL_BODY_TRANSFORM,
  bodyStroke,
  crumbPath,
  eyeHighlight,
  yenPath,
  type Cut,
} from './geometry'

/** color — full colour · mono — one ink, body unfilled, ¥ and eye glints knocked out */
export type MarkVariant = 'color' | 'mono'

/**
 * Cream sticker keyline outside the soy outline, so the silhouette stays sharp on near-black UIs.
 * none · always (the dark-UI file) · media (only under prefers-color-scheme: dark — favicons)
 */
export type KeylineMode = 'none' | 'always' | 'media'

export interface MarkOptions {
  cut?: Cut
  variant?: MarkVariant
  keyline?: KeylineMode
  /** accessible name; the image is decorative when omitted */
  title?: string
  desc?: string
  /** ink for the mono variant */
  ink?: string
  /** id prefix, so several inlined marks cannot collide */
  idPrefix?: string
}

type Attrs = Record<string, string | number | undefined>

function attrs(a: Attrs): string {
  return Object.entries(a)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('')
}

const el = (tag: string, a: Attrs, children?: string) => (children === undefined ? `<${tag}${attrs(a)}/>` : `<${tag}${attrs(a)}>${children}</${tag}>`)

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function inBodySpace(cut: Cut, markup: string): string {
  return cut === 'small' ? el('g', { transform: SMALL_BODY_TRANSFORM }, markup) : markup
}

function strokes(paths: readonly string[], stroke: string, width: number, extra: Attrs = {}): string {
  if (!paths.length) return ''
  return el('g', { fill: 'none', stroke, 'stroke-width': width, ...extra }, paths.map((d) => el('path', { d })).join(''))
}

function eyes(cut: Cut, fill: string, glint?: string): string {
  const g = CUTS[cut].eyes
  return [g.left, g.right]
    .map((x) => {
      const eye = el('ellipse', { cx: x, cy: g.cy, rx: g.rx, ry: g.ry, fill })
      return glint ? eye + el('circle', { ...eyeHighlight(x, g.cy, g.rx), fill: glint }) : eye
    })
    .join('')
}

function glints(cut: Cut, fill: string): string {
  const g = CUTS[cut].eyes
  return [g.left, g.right].map((x) => el('circle', { ...eyeHighlight(x, g.cy, g.rx), fill })).join('')
}

function blush(cut: Cut): string {
  const b = CUTS[cut].blush
  const cheeks = [b.left, b.right].map((cx) => el('ellipse', { cx, cy: b.cy, rx: b.rx, ry: b.ry })).join('')
  return el('g', { fill: PALETTE.blush, opacity: 0.45 }, cheeks)
}

function gradient(id: string, stops: readonly (readonly [number, string, number])[]): string {
  const children = stops.map(([offset, color, opacity]) => el('stop', { offset, 'stop-color': color, 'stop-opacity': opacity === 1 ? undefined : opacity }))
  return el('radialGradient', { id, cx: '50%', cy: '50%', r: '50%' }, children.join(''))
}

function keylineUse(cut: Cut, href: string, mode: KeylineMode): string {
  if (mode === 'none') return ''
  const width = bodyStroke(cut, CUTS[cut].outline + KEYLINE_EXTRA)
  const stroke = mode === 'always' ? PALETTE.dough : 'none'
  return el('use', { href, class: mode === 'media' ? 'fb-keyline' : undefined, fill: 'none', stroke, 'stroke-width': width })
}

function colorMark(cut: Cut, id: (s: string) => string, keyline: KeylineMode): { defs: string; body: string } {
  const g = CUTS[cut]
  const full = cut === 'full'
  const body = `#${id('body')}`
  const defs = [
    el('path', { id: id('body'), d: BODY_PATH }),
    el('clipPath', { id: id('clip') }, el('use', { href: body })),
    full ? gradient(id('core'), POCKET_STOPS.core) + gradient(id('glow'), POCKET_STOPS.glow) : '',
  ].join('')

  const pocket = full
    ? el('ellipse', { ...g.pocket, fill: `url(#${id('core')})` }) +
      el('ellipse', { ...g.pocket, fill: `url(#${id('glow')})` }) +
      el('ellipse', { ...g.pocket, fill: 'none', stroke: PALETTE.rim, 'stroke-width': g.rimWidth })
    : el('ellipse', { ...g.pocket, fill: PALETTE.ink, stroke: PALETTE.rim, 'stroke-width': g.rimWidth })

  const markup = [
    strokes(g.steam, PALETTE.bamboo, g.steamWidth),
    inBodySpace(
      cut,
      [
        keylineUse(cut, body, keyline),
        el('use', { href: body, fill: PALETTE.dough }),
        el(
          'g',
          { 'clip-path': `url(#${id('clip')})` },
          el('ellipse', { cx: 256, cy: 536, rx: 300, ry: 136, fill: PALETTE.doughShade }) +
            (g.shine ? strokes([g.shine], PALETTE.highlight, 16, { opacity: 0.85 }) : ''),
        ),
        strokes([KNOT_TWIST], PALETTE.bamboo, bodyStroke(cut, g.pleatWidth)),
      ].join(''),
    ),
    strokes(g.pleats, PALETTE.bamboo, g.pleatWidth),
    inBodySpace(cut, el('use', { href: body, fill: 'none', stroke: PALETTE.ink, 'stroke-width': bodyStroke(cut, g.outline) })),
    eyes(cut, PALETTE.inkDeep, PALETTE.highlight),
    blush(cut),
    strokes([g.smile], PALETTE.inkDeep, g.mouthWidth),
    g.crumb ? el('path', { d: crumbPath(g.crumb), fill: PALETTE.crumb, stroke: PALETTE.ink, 'stroke-width': g.crumbWidth }) : '',
    pocket,
    g.yenUnderlay > g.yenWidth ? strokes([yenPath(g.yen)], PALETTE.ink, g.yenUnderlay) : '',
    strokes([yenPath(g.yen)], PALETTE.yen, g.yenWidth),
  ].join('')
  return { defs, body: markup }
}

function monoMark(cut: Cut, id: (s: string) => string, ink: string): { defs: string; body: string } {
  const g = CUTS[cut]
  const body = `#${id('body')}`
  const knockout = el(
    'mask',
    { id: id('ko'), maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 512, height: 512 },
    el('rect', { width: 512, height: 512, fill: '#fff' }) + strokes([yenPath(g.yen)], '#000', g.yenWidth) + glints(cut, '#000'),
  )
  const markup = [
    strokes(g.steam, ink, g.steamWidth),
    inBodySpace(
      cut,
      el('use', { href: body, fill: 'none', stroke: ink, 'stroke-width': bodyStroke(cut, g.outline) }) +
        strokes([KNOT_TWIST], ink, bodyStroke(cut, g.pleatWidth)),
    ),
    strokes(g.pleats, ink, g.pleatWidth),
    strokes([g.smile], ink, g.mouthWidth),
    g.crumb ? el('path', { d: crumbPath(g.crumb), fill: 'none', stroke: ink, 'stroke-width': g.crumbWidth }) : '',
    el('g', { mask: `url(#${id('ko')})`, fill: ink }, eyes(cut, ink) + el('ellipse', { ...g.pocket })),
  ].join('')
  return { defs: el('path', { id: id('body'), d: BODY_PATH }) + knockout, body: markup }
}

const MEDIA_STYLE = `<style>@media (prefers-color-scheme: dark){.fb-keyline{stroke:${PALETTE.dough}}}</style>`

export function markSvg(options: MarkOptions = {}): string {
  const { cut = 'full', variant = 'color', keyline = 'none', title, desc, ink = PALETTE.ink, idPrefix = 'fb' } = options
  const id = (s: string) => `${idPrefix}-${s}`
  const { defs, body } = variant === 'mono' ? monoMark(cut, id, ink) : colorMark(cut, id, keyline)
  const label = title ? `<title>${escapeXml(title)}</title>${desc ? `<desc>${escapeXml(desc)}</desc>` : ''}` : ''
  const a11y: Attrs = title ? { role: 'img' } : { 'aria-hidden': 'true' }
  const style = variant === 'color' && keyline === 'media' ? MEDIA_STYLE : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"${attrs(a11y)} stroke-linecap="round" stroke-linejoin="round">` +
    `${label}${style}<defs>${defs}</defs>${body}</svg>\n`
  )
}
