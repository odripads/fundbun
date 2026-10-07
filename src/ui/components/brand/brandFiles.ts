/**
 * Every static SVG brand file and the markSvg() call that produces it (paths relative to the repo root).
 * brandFiles.test.ts fails when a file drifts from its recipe; regenerate with
 *   UPDATE_BRAND=1 npx vitest run src/ui/components/brand/brandFiles.test.ts
 */
import { markSvg } from './markSvg'

const NAME = 'FundBun'
const DESC = 'Bun, a pleated baozi with a twisted top knot, a kawaii face and a torn belly showing a glowing gold yuan filling.'
const DESC_SMALL = 'Bun, small-size cut: bold pleats, eyes and a gold-rimmed pocket holding a yuan sign.'

export const BRAND_SVG_FILES: Readonly<Record<string, string>> = {
  'src/ui/assets/logo.svg': markSvg({ cut: 'full', title: NAME, desc: DESC }),
  'src/ui/assets/logo-mono.svg': markSvg({ cut: 'full', variant: 'mono', title: NAME, desc: 'One-colour FundBun mark (soy ink, ¥ knocked out).' }),
  'public/favicon.svg': markSvg({ cut: 'small', keyline: 'media', title: NAME }),
  'docs/assets/brand/fundbun-mark.svg': markSvg({ cut: 'full', title: NAME, desc: DESC }),
  'docs/assets/brand/fundbun-mark-sm.svg': markSvg({ cut: 'small', title: NAME, desc: DESC_SMALL }),
  'docs/assets/brand/fundbun-mark-dark.svg': markSvg({ cut: 'full', keyline: 'always', title: NAME, desc: `${DESC} Cream keyline for dark UIs.` }),
  'docs/assets/brand/fundbun-mark-sm-dark.svg': markSvg({ cut: 'small', keyline: 'always', title: NAME, desc: `${DESC_SMALL} Cream keyline for dark UIs.` }),
  'docs/assets/brand/fundbun-mark-mono.svg': markSvg({ cut: 'full', variant: 'mono', title: NAME }),
  'docs/assets/brand/fundbun-mark-sm-mono.svg': markSvg({ cut: 'small', variant: 'mono', title: NAME }),
}
