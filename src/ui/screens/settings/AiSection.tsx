/**
 * "Your AI" in Settings: who answers Bun's messages, and the way in to connect your own.
 */
import { Bot, Cpu, KeyRound, Laptop } from 'lucide-react'
import { useState } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { AiSheet, answeringLabel } from '../../components/ai'
import { Badge, Button, Card, SectionHeader } from '../../components/ds'
import { shallowEqual, useSnapshot } from '../../state'
import styles from './Settings.module.css'

const selectAnswering = (s: AppSnapshot) => ({ llm: s.derived.llm, engine: s.derived.engine })

export function AiSection() {
  const { llm, engine } = useSnapshot(selectAnswering, shallowEqual)
  const [open, setOpen] = useState(false)
  const own = engine === 'llm' && llm.local === true
  const icon = !own ? <Cpu /> : llm.kind === 'agent' ? <Bot /> : llm.onDevice ? <Laptop /> : <KeyRound />
  const sub = !own
    ? 'Rules on this device. Connect your own AI for open questions and longer answers.'
    : llm.kind === 'agent'
      ? 'An agent on this computer, with your own sign-in. FundBun’s rules still decide.'
      : llm.onDevice
        ? 'A model running on this computer. Nothing is sent anywhere.'
        : 'Your own key. Names and account numbers are masked before anything is sent.'
  return (
    <section id="set-ai" aria-labelledby="set-ai-h" className={styles.section}>
      <SectionHeader id="set-ai-h" eyebrow="Bring your own" title="Your AI" />
      <Card padding="none">
        <div className={styles.consentRow}>
          <span className={styles.rowIcon} aria-hidden="true">{icon}</span>
          <span className={styles.consentText}>
            <span className={styles.consentTitle}>{answeringLabel(llm, engine)}</span>
            <span className={styles.consentSub}>{sub}</span>
          </span>
          <Badge variant={own ? 'under' : 'neutral'} size="sm">{own ? 'Connected' : 'Built in'}</Badge>
        </div>
        <div className={styles.toggleRow}>
          <Button variant="secondary" fullWidth onClick={() => setOpen(true)}>{own ? 'Change your AI' : 'Connect your AI'}</Button>
        </div>
      </Card>
      <AiSheet open={open} onClose={() => setOpen(false)} />
    </section>
  )
}
