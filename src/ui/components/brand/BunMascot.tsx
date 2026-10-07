import { useId, useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react'
import type { BunMood } from '../../../core/types'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { cx } from '../ds/cx'
import {
  BODY_PATH,
  CUTS,
  FACES,
  GRIN_TONGUE,
  KEYLINE_EXTRA,
  KNOT_TWIST,
  MOUTHS,
  POCKET_STOPS,
  SMALL_BODY_TRANSFORM,
  SNORE,
  SPARKLE,
  SWEAT_DROP,
  VIEW,
  bodyStroke,
  browPath,
  closedEyePath,
  crumbPath,
  cutForSize,
  eyeHighlight,
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
}

interface SvgIds {
  body: string
  clip: string
  core: string
  glow: string
  halo: string
}

/** useId output can contain characters that break url(#…) references in some engines, so keep it to [\w-]. */
function useSvgIds(): SvgIds {
  const base = `fb${useId().replace(/[^\w-]/g, '')}`
  return { body: `${base}-body`, clip: `${base}-clip`, core: `${base}-core`, glow: `${base}-glow`, halo: `${base}-halo` }
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

export function BunMascot({ mood = 'calm', size = 96, animated = true, className, title, detail = 'auto' }: BunMascotProps) {
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
      data-animated={moving || undefined}
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <Defs ids={ids} />
      <Vapour cut={cut} kind={parts.vapour} />
      <g className={styles.bob}>
        <g ref={bodyRef} className={styles.squish}>
          <Body cut={cut} ids={ids} />
          <g ref={faceRef} className={styles.face}>
            <Face cut={cut} parts={parts} />
          </g>
          <Pocket cut={cut} ids={ids} />
          <Accessory cut={cut} kind={parts.accessory} />
        </g>
      </g>
    </svg>
  )
}

function Stops({ stops, prefix }: { stops: readonly (readonly [number, string, number])[]; prefix: 'core' | 'glow' }) {
  return stops.map(([offset], i) => <stop key={offset} offset={offset} className={styles[`${prefix}${i}`]} />)
}

function Defs({ ids }: { ids: SvgIds }) {
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
      {parts.brows ? <Brows cut={cut} /> : null}
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
    default:
      return (
        <g>
          <ellipse cx={x} cy={cy} rx={rx} ry={ry} className={styles.pupil} />
          <circle {...eyeHighlight(x, cy, rx)} className={styles.glint} />
        </g>
      )
  }
}

function Brows({ cut }: { cut: Cut }) {
  const e = CUTS[cut].eyes
  const lift = FACES[cut].browLift
  return (
    <g className={styles.lash} strokeWidth={CUTS[cut].mouthWidth}>
      <path d={browPath(e.left, e.cy, e.rx, e.ry, lift)} />
      <path d={browPath(e.right, e.cy, e.rx, e.ry, lift)} />
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
  const paths = kind === 'smoke' ? f.smoke : g.steam
  if (!paths.length) return null
  return (
    <g className={kind === 'smoke' ? styles.smoke : styles.steam} strokeWidth={kind === 'smoke' ? g.mouthWidth * 1.4 : g.steamWidth}>
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
