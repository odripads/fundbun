import { Palette, RefreshCw } from 'lucide-react'
import { href } from '../../router'
import { BunMascot } from '../brand'
import { Button } from '../ds/Button'
import styles from './StatusScreens.module.css'

export interface EngineNotReadyProps {
  error: string
  onRetry: () => void
  title?: string
}

/** Shown instead of a white screen when the engine can't boot (or a screen crashes). */
export function EngineNotReady({ error, onRetry, title = 'Bun is still warming up' }: EngineNotReadyProps) {
  return (
    <div className={styles.screen} role="alert">
      <div className={styles.hero}>
        <BunMascot size={112} mood="sleepy" animated />
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.body}>The money engine didn’t start, so nothing was changed. Your data stays on this device.</p>
      </div>
      <div className={styles.actions}>
        <Button iconStart={<RefreshCw />} onClick={onRetry}>Try again</Button>
        <Button variant="ghost" href={href('gallery')} iconStart={<Palette />}>Open the design system</Button>
      </div>
      <details className={styles.details}>
        <summary>Technical details</summary>
        <code>{error}</code>
      </details>
    </div>
  )
}
