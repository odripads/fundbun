import type { CSSProperties } from 'react'
import { cx } from '../ds/cx'
import { dreamSource } from './dreamSource'
import styles from './DreamImage.module.css'

export interface DreamImageProps {
  /** 'preset:<key>' or a data: URL */
  image: string
  alt: string
  size?: number
  className?: string
  /** soft gold glow behind the picture (hero / goal moments) */
  glow?: boolean
}

export function DreamImage({ image, alt, size = 96, className, glow = false }: DreamImageProps) {
  const px = Number.isFinite(size) && size > 0 ? size : 96
  const source = dreamSource(image)
  return (
    <span
      className={cx(styles.frame, source.kind === 'photo' ? styles.photo : styles.preset, glow && styles.glow, className)}
      style={{ '--dream-size': `${px}px` } as CSSProperties}
      data-kind={source.kind}
      data-preset={source.kind === 'preset' ? source.key : undefined}
    >
      <img src={source.src} alt={alt} width={px} height={px} className={styles.img} loading="lazy" decoding="async" draggable={false} />
    </span>
  )
}
