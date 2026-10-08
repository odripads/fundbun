import { ChartPie, Gauge, Hand, Lock, PiggyBank, Receipt, Route, Scale } from 'lucide-react'
import { useId, type CSSProperties, type ReactNode } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { openApproval } from '../../components/agent'
import { BunMascot } from '../../components/brand'
import { AiBadge, Badge, Button, Callout } from '../../components/ds'
import { shallowEqual, useSnapshot } from '../../state'
import { firstName, greeting, starterPrompts, type StarterPrompt } from './model'
import styles from './ChatScreen.module.css'

const ICON: Record<StarterPrompt['id'], ReactNode> = {
  overview: <Gauge />,
  breakdown: <ChartPie />,
  bills: <Receipt />,
  afford: <Scale />,
  plan: <Route />,
  save: <PiggyBank />,
}

const select = (s: AppSnapshot) => ({
  tone: s.state.profile?.tone ?? 'gentle',
  name: firstName(s.state.profile?.name),
  currency: s.state.profile?.currency ?? 'CNY',
  dreams: s.state.dreams,
  status: s.derived.mirror?.status ?? null,
  engine: s.derived.engine,
  awaiting: s.derived.awaiting,
})

/** First open (or a cleared chat): Bun says hi, and six starters cover what Bun can actually do. */
export function EmptyChat({ onSend, busy }: { onSend: (text: string) => void; busy: boolean }) {
  const s = useSnapshot(select, shallowEqual)
  const titleId = useId()
  const hello = greeting(s.tone, s.name)
  const prompts = starterPrompts({ currency: s.currency, dreams: s.dreams, status: s.status })
  const waiting = s.awaiting[0]
  return (
    <section className={styles.empty} aria-labelledby={titleId}>
      <div className={styles.hero}>
        <div className={styles.heroArt}>
          <span className={styles.heroHalo} aria-hidden="true" />
          <BunMascot mood="happy" size={124} animated title="Bun, your money buddy" />
        </div>
        <h2 id={titleId} className={styles.heroTitle}>{hello.title}</h2>
        <p className={styles.heroBody}>{hello.body}</p>
        <div className={styles.heroBadges}>
          <AiBadge engine={s.engine} size="md" />
          <Badge variant="outline" icon={<Lock />}>Can’t pay strangers</Badge>
        </div>
      </div>

      {waiting ? (
        <Callout
          tone="info"
          icon={<Hand />}
          title={`${s.awaiting.length === 1 ? 'One action is' : `${s.awaiting.length} actions are`} waiting for your OK`}
          action={<Button size="sm" variant="secondary" onClick={() => openApproval(waiting.id)}>Review “{waiting.preview.title}”</Button>}
        >
          Nothing runs until you approve.
        </Callout>
      ) : null}

      <div className={styles.startersBlock}>
        <h3 className={styles.startersTitle}>Try asking</h3>
        <ul className={styles.starters}>
          {prompts.map((p, i) => (
            <li key={p.id} style={{ '--i': i } as CSSProperties}>
              <button type="button" className={styles.starter} onClick={() => onSend(p.text)} disabled={busy}>
                <span className={styles.starterIcon} aria-hidden="true">{ICON[p.id]}</span>
                <span className={styles.starterText}>{p.text}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
