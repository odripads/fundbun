import type { CSSProperties } from 'react'
import { cx } from './cx'
import styles from './Skeleton.module.css'

export interface SkeletonProps {
  width?: number | string
  height?: number | string
  /** 'text' lines are rounded and sized to the font; 'circle' for avatars */
  shape?: 'rect' | 'text' | 'circle'
  radius?: number
  className?: string
  style?: CSSProperties
}

/** Loading placeholder. Decorative: mark the loading region with aria-busy on its container. */
export function Skeleton({ width, height, shape = 'rect', radius, className, style }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(styles.skeleton, styles[shape], className)}
      style={{ width, height: shape === 'circle' ? (height ?? width) : height, borderRadius: radius, ...style }}
    />
  )
}

/** Paragraph placeholder; the last line is shorter so it reads as text. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={cx(styles.lines, className)} aria-hidden="true">
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <Skeleton key={i} shape="text" width={i === lines - 1 && lines > 1 ? '62%' : '100%'} />
      ))}
    </span>
  )
}
