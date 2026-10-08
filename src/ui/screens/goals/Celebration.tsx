import type { CSSProperties } from 'react'
import type { DreamItem } from '../../../core/types'
import { BunMascot, DreamImage } from '../../components/brand'
import { Button, Dialog } from '../../components/ds'
import type { Celebration as CelebrationCopy } from './model'
import styles from './Celebration.module.css'

const PARTICLES = 14

/** Steam puffs and gold coins bursting out from the dream once, then a slow sparkle. Decorative only. */
function Burst() {
  return (
    <span className={styles.burst} aria-hidden="true">
      {Array.from({ length: PARTICLES }, (_, i) => (
        <span
          key={i}
          className={i % 3 === 0 ? styles.puff : styles.coin}
          style={{ '--a': `${(360 / PARTICLES) * i + (i % 2 ? 8 : -6)}deg`, '--d': `${68 + (i % 4) * 12}px`, '--delay': `${(i % 5) * 40}ms` } as CSSProperties}
        />
      ))}
    </span>
  )
}

export interface CelebrationProps {
  item: DreamItem | null
  copy: CelebrationCopy | null
  onClose: () => void
}

/** Tasteful celebration for a dream reached through saving — never for a purchase. */
export function Celebration({ item, copy, onClose }: CelebrationProps) {
  return (
    <Dialog
      open={Boolean(item && copy)}
      onClose={onClose}
      title={copy?.title ?? ''}
      description={copy?.body}
      media={
        item ? (
          <span className={styles.stage}>
            <span className={styles.halo} />
            <Burst />
            <DreamImage image={item.image} alt="" size={104} glow className={styles.dream} />
            <span className={styles.bun}>
              <BunMascot mood="happy" size={64} />
            </span>
          </span>
        ) : null
      }
      actions={<Button onClick={onClose} fullWidth>Back to my dreams</Button>}
    />
  )
}
