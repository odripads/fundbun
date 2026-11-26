import { useId, useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react'
import type { BunMood, MascotHat } from '../../../core/types'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { cx } from '../ds/cx'
import { useShellAppearance } from '../plugins/shellAppearance'
import {
  ANGER_VEIN,
  BODY_PATH,
  CUTS,
  FACES,
  GRIN_TONGUE,
  KEYLINE_EXTRA,
  KNOT_TWIST,
  MOUTHS,
  POCKET_STOPS,
  SHOUT,
  SHOUT_TEETH,
  SMALL_BODY_TRANSFORM,
  SNORE,
  SPARKLE,
  SWEAT_DROP,
  VIEW,
  angryBrowPath,
  bodyStroke,
  browPath,
  closedEyePath,
  crumbPath,
  cutForSize,
  eyeHighlight,
  glareEyePath,
  spiralPath,
  yenPath,
  zPath,
  type Cut,
} from './geometry'
import { DEFAULT_MOOD, isBunMood, moodParts, type EyeStyle, type MoodParts, type MouthStyle } from './moods'
import styles from './BunMascot.module.css'

export interface BunMascotProps {
  mood?: BunMood
  /** px */
  size?: number
  /** continuous idle motion (steam + bob); auto-disabled under prefers-reduced-motion */
  animated?: boolean
  className?: string
  /** accessible label; decorative when omitted */
  title?: string
  /** drawing detail; 'auto' picks the bold small cut at ≤56px */
  detail?: 'auto' | Cut
  /**
   * Headwear. Left out, Bun wears what the user chose in Creator Mode (a shell appearance plugin), which is
   * nothing by default. Pass a value to force it, as the chat card's preview does.
   */
  hat?: MascotHat
}

interface SvgIds {
  body: string
  clip: string
  core: string
  glow: string
  halo: string
  hatEye: string
  hatHex: string
}

/** useId output can contain characters that break url(#…) references in some engines, so keep it to [\w-]. */
function useSvgIds(): SvgIds {
  const base = `fb${useId().replace(/[^\w-]/g, '')}`
  return {
    body: `${base}-body`,
    clip: `${base}-clip`,
    core: `${base}-core`,
    glow: `${base}-glow`,
    halo: `${base}-halo`,
    hatEye: `${base}-hat-eye`,
    hatHex: `${base}-hat-hex`,
  }
}

const SQUISH: Keyframe[] = [
  { transform: 'scale(1, 1)' },
  { transform: 'scale(1.07, 0.9)' },
  { transform: 'scale(0.96, 1.05)' },
  { transform: 'scale(1, 1)' },
]
const FACE_IN: Keyframe[] = [
  { opacity: 0.15, transform: 'scale(0.85)' },
  { opacity: 1, transform: 'scale(1)' },
]

/** A springy squash on the body and a pop on the new face whenever the mood changes (never on first render). */
function useMoodChange(mood: string, enabled: boolean, body: RefObject<SVGGElement | null>, face: RefObject<SVGGElement | null>) {
  const previous = useRef(mood)
  useLayoutEffect(() => {
    if (previous.current === mood) return
    previous.current = mood
    if (!enabled) return
    body.current?.animate?.(SQUISH, { duration: 560, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' })
    face.current?.animate?.(FACE_IN, { duration: 380, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
  }, [mood, enabled, body, face])
}

export function BunMascot({ mood = 'calm', size = 96, animated = true, className, title, detail = 'auto', hat }: BunMascotProps) {
  const chosenHat = useShellAppearance().mascotHat
  const wearing: MascotHat = hat ?? chosenHat
  const px = Number.isFinite(size) && size > 0 ? size : 96
  const cut: Cut = detail === 'auto' ? cutForSize(px) : detail
  const moodKey = isBunMood(mood) ? mood : DEFAULT_MOOD
  const parts = moodParts(moodKey)
  const reduced = useReducedMotion()
  const moving = animated && !reduced
  const ids = useSvgIds()
  const bodyRef = useRef<SVGGElement>(null)
  const faceRef = useRef<SVGGElement>(null)
  useMoodChange(moodKey, moving, bodyRef, faceRef)

  return (
    <svg
      width={px}
      height={px}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={cx(styles.root, moving && styles.animated, className)}
      style={{ '--fb-breath': `${parts.breath}s` } as CSSProperties}
      data-mood={moodKey}
      data-cut={cut}
      data-pocket={parts.pocket}
      data-toasted={parts.toasted || undefined}
      data-flush={parts.flush || undefined}
      data-animated={moving || undefined}
      data-hat={wearing === 'none' ? undefined : wearing}
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <Defs ids={ids} hat={wearing} />
      {/* plain steam would rise through the headwear; mood vapour (smoke, fumes, zzz) still shows */}
      {wearing !== 'none' && parts.vapour === 'steam' ? null : <Vapour cut={cut} kind={parts.vapour} />}
      <g className={parts.shake ? styles.shake : undefined}>
        <g className={styles.bob}>
          <g ref={bodyRef} className={styles.squish}>
            <Body cut={cut} ids={ids} />
            <g ref={faceRef} className={styles.face}>
              <Face cut={cut} parts={parts} />
            </g>
            {wearing === 'kamen_rider' ? <RiderScarf cut={cut} ids={ids} /> : null}
            <Pocket cut={cut} ids={ids} />
            <Hat cut={cut} ids={ids} hat={wearing} />
            <Accessory cut={cut} kind={parts.accessory} />
          </g>
        </g>
      </g>
    </svg>
  )
}

function Stops({ stops, prefix }: { stops: readonly (readonly [number, string, number])[]; prefix: 'core' | 'glow' }) {
  return stops.map(([offset], i) => <stop key={offset} offset={offset} className={styles[`${prefix}${i}`]} />)
}

function Defs({ ids, hat }: { ids: SvgIds; hat: MascotHat }) {
  return (
    <defs>
      <path id={ids.body} d={BODY_PATH} />
      <clipPath id={ids.clip}>
        <use href={`#${ids.body}`} />
      </clipPath>
      <radialGradient id={ids.core}>
        <Stops stops={POCKET_STOPS.core} prefix="core" />
      </radialGradient>
      <radialGradient id={ids.glow}>
        <Stops stops={POCKET_STOPS.glow} prefix="glow" />
      </radialGradient>
      <radialGradient id={ids.halo}>
        <stop offset={0.55} className={styles.haloIn} />
        <stop offset={1} className={styles.haloOut} />
      </radialGradient>
      {hat === 'kamen_rider' ? (
        <>
          <radialGradient id={ids.hatEye} cx={0.38} cy={0.32} r={0.8}>
            <stop offset={0} stopColor={HAT.eyeLight} />
            <stop offset={0.55} stopColor={HAT.eye} />
            <stop offset={1} stopColor={HAT.eyeDeep} />
          </radialGradient>
          <pattern id={ids.hatHex} width={28} height={49} patternUnits="userSpaceOnUse" patternTransform="scale(0.5)">
            <path d={HEX_TILE} fill={HAT.eyeCell} fillOpacity={0.55} />
          </pattern>
        </>
      ) : null}
    </defs>
  )
}

function Body({ cut, ids }: { cut: Cut; ids: SvgIds }) {
  const g = CUTS[cut]
  const href = `#${ids.body}`
  const bodySpace = cut === 'small' ? SMALL_BODY_TRANSFORM : undefined
  return (
    <>
      <g transform={bodySpace}>
        <use href={href} className={styles.keyline} strokeWidth={bodyStroke(cut, g.outline + KEYLINE_EXTRA)} />
        <use href={href} className={styles.dough} />
        <g clipPath={`url(#${ids.clip})`}>
          <ellipse cx={256} cy={536} rx={300} ry={136} className={styles.shade} />
          {g.shine ? <path d={g.shine} className={styles.shine} /> : null}
          <g className={styles.toast}>
            {FACES[cut].toastSpots.map((s) => (
              <ellipse key={`${s.cx}-${s.cy}`} {...s} />
            ))}
          </g>
        </g>
        <path d={KNOT_TWIST} className={styles.pleat} strokeWidth={bodyStroke(cut, g.pleatWidth)} />
      </g>
      <g className={styles.pleat} strokeWidth={g.pleatWidth}>
        {g.pleats.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <use href={href} transform={bodySpace} className={styles.outline} strokeWidth={bodyStroke(cut, g.outline)} />
    </>
  )
}

function Face({ cut, parts }: { cut: Cut; parts: MoodParts }) {
  const b = CUTS[cut].blush
  return (
    <>
      <g className={styles.blush} style={{ opacity: parts.blush }}>
        <ellipse cx={b.left} cy={b.cy} rx={b.rx} ry={b.ry} />
        <ellipse cx={b.right} cy={b.cy} rx={b.rx} ry={b.ry} />
      </g>
      <Eyes cut={cut} style={parts.eyes} blink={parts.blink} />
      {parts.brows !== 'none' ? <Brows cut={cut} angry={parts.brows === 'angry'} /> : null}
      <Mouth cut={cut} style={parts.mouth} />
    </>
  )
}

function Eyes({ cut, style, blink }: { cut: Cut; style: EyeStyle; blink: boolean }) {
  const e = CUTS[cut].eyes
  return (
    <g className={cx(blink && styles.blink)} style={{ transformOrigin: `256px ${e.cy}px` }}>
      {[e.left, e.right].map((x) => (
        <Eye key={x} cut={cut} x={x} style={style} />
      ))}
    </g>
  )
}

function Eye({ cut, x, style }: { cut: Cut; x: number; style: EyeStyle }) {
  const { cy, rx, ry } = CUTS[cut].eyes
  const line = CUTS[cut].mouthWidth
  switch (style) {
    case 'sparkle':
      return (
        <g>
          <ellipse cx={x} cy={cy} rx={rx * 1.14} ry={ry * 1.1} className={styles.pupil} />
          <path d={SPARKLE} transform={`translate(${x + rx * 0.32} ${cy - ry * 0.3}) scale(${(rx * 0.62) / 6})`} className={styles.glint} />
          <circle cx={x - rx * 0.4} cy={cy + ry * 0.45} r={rx * 0.2} className={styles.glint} />
        </g>
      )
    case 'dizzy':
      return (
        <path
          d={spiralPath(x, cy, rx * 1.35)}
          className={cx(styles.lash, styles.spin)}
          strokeWidth={line * 0.8}
          style={{ transformOrigin: `${x}px ${cy}px` }}
        />
      )
    case 'closed':
      return <path d={closedEyePath(x, cy, rx, ry)} className={styles.lash} strokeWidth={line} />
    case 'glare': {
      const inner = x < VIEW / 2 ? 1 : -1
      return (
        <g>
          <path d={glareEyePath(x, cy, rx, ry)} className={styles.pupil} />
          <circle cx={x - inner * rx * 0.3} cy={cy + ry * 0.12} r={rx * 0.2} className={styles.glint} />
        </g>
      )
    }
    default:
      return (
        <g>
          <ellipse cx={x} cy={cy} rx={rx} ry={ry} className={styles.pupil} />
          <circle {...eyeHighlight(x, cy, rx)} className={styles.glint} />
        </g>
      )
  }
}

function Brows({ cut, angry }: { cut: Cut; angry: boolean }) {
  const e = CUTS[cut].eyes
  const lift = FACES[cut].browLift
  const brow = (x: number) => (angry ? angryBrowPath(x, e.cy, e.rx, e.ry) : browPath(x, e.cy, e.rx, e.ry, lift))
  return (
    <g className={styles.lash} strokeWidth={CUTS[cut].mouthWidth * (angry ? 1.3 : 1)}>
      <path d={brow(e.left)} />
      <path d={brow(e.right)} />
    </g>
  )
}

function Mouth({ cut, style }: { cut: Cut; style: MouthStyle }) {
  const m = CUTS[cut].mouth
  const width = CUTS[cut].mouthWidth / m.scale
  return (
    <g transform={`translate(${m.x} ${m.y}) scale(${m.scale})`}>
      {style === 'grin' ? (
        <>
          <path d={MOUTHS.grin} className={styles.mouthFill} strokeWidth={width * 0.6} />
          <ellipse {...GRIN_TONGUE} className={styles.tongue} />
        </>
      ) : style === 'snore' ? (
        <ellipse {...SNORE} className={styles.mouthFill} />
      ) : style === 'shout' ? (
        <>
          <path d={SHOUT} className={styles.mouthFill} strokeWidth={width * 0.6} />
          <path d={SHOUT_TEETH} className={styles.teeth} />
        </>
      ) : (
        <path d={MOUTHS[style]} className={styles.lash} strokeWidth={width} />
      )}
    </g>
  )
}

function Pocket({ cut, ids }: { cut: Cut; ids: SvgIds }) {
  const g = CUTS[cut]
  const full = cut === 'full'
  const yen = yenPath(g.yen)
  const halo = g.crumb ?? g.pocket
  return (
    <g>
      <ellipse cx={halo.cx} cy={halo.cy} rx={halo.rx * 1.3} ry={halo.ry * 1.36} fill={`url(#${ids.halo})`} className={styles.halo} />
      {g.crumb ? <path d={crumbPath(g.crumb)} className={styles.crumb} strokeWidth={g.crumbWidth} /> : null}
      <ellipse {...g.pocket} fill={full ? `url(#${ids.core})` : undefined} className={cx(!full && styles.pocketSolid)} />
      {full ? <ellipse {...g.pocket} fill={`url(#${ids.glow})`} className={styles.glowLayer} /> : null}
      <ellipse {...g.pocket} className={styles.rim} strokeWidth={g.rimWidth} />
      <g className={styles.yen}>
        {g.yenUnderlay > g.yenWidth ? <path d={yen} className={styles.yenUnder} strokeWidth={g.yenUnderlay} /> : null}
        <path d={yen} className={styles.yenGold} strokeWidth={g.yenWidth} />
      </g>
    </g>
  )
}

function Vapour({ cut, kind }: { cut: Cut; kind: MoodParts['vapour'] }) {
  const g = CUTS[cut]
  const f = FACES[cut]
  if (kind === 'zzz') {
    return (
      <g className={styles.zzz} strokeWidth={g.mouthWidth}>
        {f.zzz.map(([x, y, s]) => (
          <path key={`${x}-${y}`} d={zPath(x, y, s)} className={styles.z} />
        ))}
      </g>
    )
  }
  const paths = kind === 'smoke' ? f.smoke : kind === 'fume' ? f.fume : g.steam
  if (!paths.length) return null
  return (
    <g
      className={kind === 'smoke' ? styles.smoke : kind === 'fume' ? styles.fume : styles.steam}
      strokeWidth={kind === 'smoke' ? g.mouthWidth * 1.4 : kind === 'fume' ? Math.max(g.steamWidth, g.mouthWidth * 1.3) : g.steamWidth}
    >
      {paths.map((d) => (
        <path key={d} d={d} className={styles.wisp} />
      ))}
    </g>
  )
}

function Accessory({ cut, kind }: { cut: Cut; kind: MoodParts['accessory'] }) {
  const f = FACES[cut]
  if (kind === 'sparkles') {
    return (
      <g>
        {f.sparkles.map(([x, y, s]) => (
          <g key={`${x}-${y}`} transform={`translate(${x} ${y}) scale(${s})`}>
            <path d={SPARKLE} className={styles.sparkle} />
          </g>
        ))}
      </g>
    )
  }
  if (kind === 'vein') {
    const [x, y, s] = f.vein
    return (
      <g transform={`translate(${x} ${y}) scale(${s})`}>
        <path d={ANGER_VEIN} className={styles.vein} strokeWidth={4.4} />
      </g>
    )
  }
  if (kind === 'sweat') {
    const [x, y, s] = f.sweat
    return (
      <g transform={`translate(${x} ${y}) scale(${s})`}>
        <g className={styles.sweat}>
          <path d={SWEAT_DROP} className={styles.drop} strokeWidth={5} />
          <path d="M-6 1Q-7 7-3 10" className={styles.dropShine} strokeWidth={3.5} />
        </g>
      </g>
    )
  }
  return null
}

// ───────────────────────────── headwear (Creator Mode shell appearance) ─────────────────────────────

/** Headwear colours are fixed costume colours, so a hat reads the same on every theme. */
const HAT = {
  ink: '#24180f',
  shell: '#1f7a55',
  shellShine: '#5fc79b',
  silver: '#eef1f5',
  silverShade: '#c3cad4',
  eye: '#e3243b',
  eyeLight: '#ff7a85',
  eyeDeep: '#a31026',
  eyeCell: '#7a0d1f',
  signal: '#ff4d5e',
  scarf: '#e02d3c',
  scarfShade: '#a81e2b',
  gold: '#f2bd3d',
  goldDeep: '#b97f09',
  capBlue: '#2f7fd6',
  capDeep: '#1f5aa0',
} as const

/** A honeycomb tile (28 by 49): the facets of the helmet's compound eyes. */
const HEX_TILE =
  'M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'

/** One compound eye of the rider helmet (the left one; the right is its mirror). */
const RIDER_EYE = 'M228 150C196 158 150 156 126 140C120 108 146 80 186 78C214 78 232 98 232 126C232 136 231 144 228 150Z'
const RIDER_SHELL = 'M98 186C92 96 160 40 256 40C352 40 420 96 414 186C380 170 330 160 256 160C182 160 132 170 98 186Z'

/** Headwear is drawn for the full cut; the small cut widens it with the body and keeps the fins inside the frame. */
function hatSpace(cut: Cut): string | undefined {
  return cut === 'small' ? 'matrix(1.12 0 0 1 -30.72 -4)' : undefined
}

/** The red scarf of the rider costume: tied round Bun under the face, behind the pocket, tails flying to the right. */
function RiderScarf({ cut, ids }: { cut: Cut; ids: SvgIds }) {
  return (
    <g transform={hatSpace(cut)} data-hat-part="scarf" stroke={HAT.ink} strokeWidth={8}>
      <g clipPath={cut === 'full' ? `url(#${ids.clip})` : undefined}>
        <path d="M40 236C120 270 392 270 472 236L476 268C392 304 120 304 36 268Z" fill={HAT.scarf} />
        <path d="M60 262C140 290 372 290 452 262" fill="none" stroke={HAT.scarfShade} strokeWidth={6} opacity={0.7} />
      </g>
      <path d="M410 262C440 240 470 246 500 228C494 252 498 270 508 284C478 292 452 282 432 290Z" fill={HAT.scarf} />
      <path d="M404 268C420 290 438 306 462 318C450 330 444 344 446 358C420 346 398 322 386 292Z" fill={HAT.scarfShade} />
      <ellipse cx={406} cy={270} rx={17} ry={15} fill={HAT.scarf} />
    </g>
  )
}

function Hat({ cut, ids, hat }: { cut: Cut; ids: SvgIds; hat: MascotHat }) {
  if (hat === 'none') return null
  return (
    <g transform={hatSpace(cut)} data-hat-part={hat} stroke={HAT.ink} strokeWidth={8}>
      {hat === 'kamen_rider' ? <RiderHelmet ids={ids} /> : hat === 'crown' ? <Crown /> : hat === 'cap' ? <Cap /> : <Halo />}
    </g>
  )
}

/**
 * The rider helmet, worn visor-up so Bun's own face (and its mood) stays in view: a green shell, two crimson
 * compound eyes with honeycomb facets, a silver faceplate ridge and jaw guards, V-fin antennae and a red signal.
 */
function RiderHelmet({ ids }: { ids: SvgIds }) {
  const eye = (
    <>
      <path d={RIDER_EYE} fill={`url(#${ids.hatEye})`} />
      <path d={RIDER_EYE} fill={`url(#${ids.hatHex})`} stroke="none" />
      <ellipse cx={160} cy={102} rx={14} ry={8} fill="#ffffff" opacity={0.75} stroke="none" transform="rotate(-24 160 102)" />
    </>
  )
  return (
    <>
      <path data-hat-part="antenna" d="M226 86C202 66 182 40 164 8C198 22 232 42 254 62Z" fill={HAT.silver} strokeWidth={7} />
      <path data-hat-part="antenna" d="M286 86C310 66 330 40 348 8C314 22 280 42 258 62Z" fill={HAT.silver} strokeWidth={7} />
      <path data-hat-part="shell" d={RIDER_SHELL} fill={HAT.shell} strokeWidth={12} />
      <path d="M130 120C148 82 190 60 240 56" fill="none" stroke={HAT.shellShine} strokeWidth={10} opacity={0.7} />
      <path data-hat-part="jaw" d="M98 180C84 200 80 226 90 250C104 246 116 236 122 222C116 206 112 192 112 178Z" fill={HAT.silver} />
      <path data-hat-part="jaw" d="M414 180C428 200 432 226 422 250C408 246 396 236 390 222C396 206 400 192 400 178Z" fill={HAT.silver} />
      <path data-hat-part="faceplate" d="M244 64L268 64L274 160L238 160Z" fill={HAT.silver} />
      <path d="M262 70L266 154" fill="none" stroke={HAT.silverShade} strokeWidth={5} />
      <g data-hat-part="eye">{eye}</g>
      <g data-hat-part="eye" transform="translate(512 0) scale(-1 1)">{eye}</g>
      <circle data-hat-part="signal" cx={256} cy={76} r={11} fill={HAT.signal} strokeWidth={7} />
    </>
  )
}

function Crown() {
  return (
    <g transform="rotate(-6 256 110)">
      <path d="M172 152L156 66L214 112L256 44L298 112L356 66L340 152Z" fill={HAT.gold} strokeWidth={10} />
      <path d="M176 134H336" fill="none" stroke={HAT.goldDeep} strokeWidth={8} />
      <circle cx={256} cy={104} r={10} fill={HAT.signal} strokeWidth={6} />
      <circle cx={204} cy={122} r={7} fill="#ffffff" strokeWidth={5} />
      <circle cx={308} cy={122} r={7} fill="#ffffff" strokeWidth={5} />
    </g>
  )
}

function Cap() {
  return (
    <>
      <path d="M352 150C404 146 452 160 480 186C442 196 396 190 362 178Z" fill={HAT.capDeep} strokeWidth={10} />
      <path d="M122 176C114 98 176 52 256 52C336 52 398 98 390 176C350 162 310 156 256 156C202 156 162 162 122 176Z" fill={HAT.capBlue} strokeWidth={12} />
      <path d="M256 54V154M190 68C178 96 172 126 172 160M322 68C334 96 340 126 340 160" fill="none" stroke={HAT.capDeep} strokeWidth={6} />
      <circle cx={256} cy={52} r={10} fill={HAT.capDeep} strokeWidth={6} />
    </>
  )
}

function Halo() {
  return (
    <>
      <ellipse cx={256} cy={44} rx={96} ry={24} fill="none" strokeWidth={26} />
      <ellipse cx={256} cy={44} rx={96} ry={24} fill="none" stroke={HAT.gold} strokeWidth={14} />
    </>
  )
}
