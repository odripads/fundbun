/**
 * Brand components — PLACEHOLDERS. The brand builder replaces the internals; the props interfaces are the contract.
 */
import type { BunMood } from '../../../core/types'

export interface BunMascotProps {
  mood?: BunMood
  /** px */
  size?: number
  /** continuous idle motion (steam + bob); auto-disabled under prefers-reduced-motion */
  animated?: boolean
  className?: string
  /** accessible label; decorative when omitted */
  title?: string
}

export function BunMascot({ size = 96, className, title }: BunMascotProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <ellipse cx="50" cy="58" rx="40" ry="30" fill="var(--bun)" stroke="var(--c-soy-800)" strokeWidth="3" />
      <text x="50" y="68" textAnchor="middle" fontSize="28" fontWeight="700" fill="var(--accent)">¥</text>
    </svg>
  )
}

export interface LogoProps {
  size?: number
  withWordmark?: boolean
  className?: string
}

export function Logo({ size = 32, withWordmark = false, className }: LogoProps) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <BunMascot size={size} title="FundBun" />
      {withWordmark ? <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: size * 0.6 }}>FundBun</span> : null}
    </span>
  )
}

export interface DreamImageProps {
  /** 'preset:<key>' or a data: URL */
  image: string
  alt: string
  size?: number
  className?: string
}

export function DreamImage({ image, alt, size = 96, className }: DreamImageProps) {
  if (image.startsWith('data:')) {
    return <img src={image} alt={alt} width={size} height={size} className={className} style={{ objectFit: 'cover', borderRadius: 16 }} />
  }
  return (
    <div role="img" aria-label={alt} className={className} style={{ width: size, height: size, borderRadius: 16, background: 'var(--surface-2)', display: 'grid', placeItems: 'center', fontSize: size * 0.4 }}>
      🎁
    </div>
  )
}

export const PRESET_KEYS = ['bag', 'sneakers', 'earbuds', 'headphones', 'plane', 'laptop', 'phone', 'console', 'camera', 'watch', 'ticket', 'ring', 'car', 'home', 'guitar', 'gift'] as const
export type PresetKey = (typeof PRESET_KEYS)[number]
