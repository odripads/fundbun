import type { CSSProperties } from 'react'
import type { BunMood } from '../../../../core/types'
import { BunMascot, DreamImage } from '../../../components/brand'
import styles from './DreamOrbit.module.css'

export interface OrbitItem {
  image: string
  /** px */
  size: number
  glow?: boolean
}

export interface DreamOrbitProps {
  items: readonly OrbitItem[]
  mood?: BunMood
  mascotSize?: number
  /** orbit radius, px */
  radius?: number
  /** stage height, px */
  height?: number
  className?: string
}

/** Degrees for item i of n (0° = right, −90° = top). One or two items sit in the upper corners, not above/below Bun. */
export function orbitAngle(i: number, n: number): number {
  if (n <= 1) return -40
  if (n === 2) return -150 + i * 120
  return -90 + (360 / n) * i
}

/**
 * Bun with dream pictures drifting around it like steam: the ring turns very slowly, each picture stays upright
 * and bobs on its own rhythm. Purely decorative (aria-hidden); everything settles under reduced motion.
 */
export function DreamOrbit({ items, mood = 'happy', mascotSize = 148, radius = 118, height = 286, className }: DreamOrbitProps) {
  return (
    <div
      className={[styles.stage, className].filter(Boolean).join(' ')}
      style={{ '--orbit-r': `${radius}px`, '--stage-h': `${height}px`, '--halo': `${Math.round(mascotSize * 1.7)}px` } as CSSProperties}
      aria-hidden="true"
    >
      <span className={styles.halo} />
      <div className={styles.ring}>
        {items.map((item, i) => (
          <span key={`${item.image.slice(0, 64)}-${i}`} className={styles.orbiter} style={{ '--i': i, '--angle': `${orbitAngle(i, items.length)}deg` } as CSSProperties}>
            <span className={styles.drift} style={{ '--d': `${5.4 + (i % 3) * 0.9}s`, '--delay': `${i * -0.7}s` } as CSSProperties}>
              <DreamImage image={item.image} alt="" size={item.size} glow={item.glow} />
            </span>
          </span>
        ))}
      </div>
      <BunMascot mood={mood} size={mascotSize} className={styles.bun} />
    </div>
  )
}
