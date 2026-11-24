import { Check, LoaderCircle, ShieldCheck, Square, TriangleAlert, Wrench } from 'lucide-react'
import type { LiveReply } from '../../../core/ai/types'
import { Button, cx } from '../ds'
import { useApp } from '../../state'
import { Markdown } from './Markdown'
import styles from './Ai.module.css'

/** Words for an agent's permission choices: its own labels are kept, the kind decides the button's weight. */
function optionVariant(kind: string): 'primary' | 'secondary' | 'ghost' {
  if (kind === 'allow_once') return 'primary'
  if (kind.startsWith('reject')) return 'ghost'
  return 'secondary'
}

/**
 * The reply while it is still being written: what the AI has said so far, the steps it took (FundBun's tools
 * are marked: they went through the rules), and, when an agent wants to use one of its own tools, the question.
 */
export function LiveReplyView({ live }: { live: LiveReply }) {
  const app = useApp()
  const p = live.permission
  return (
    <div className={styles.live}>
      {live.steps.length ? (
        <ul className={styles.steps} aria-label="Steps so far">
          {live.steps.map((s) => (
            <li key={s.id} className={cx(styles.step, s.mine && styles.stepMine, s.status === 'failed' && styles.stepFailed)}>
              {s.status === 'running' ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : s.status === 'failed' ? <TriangleAlert aria-hidden="true" /> : s.mine ? <ShieldCheck aria-hidden="true" /> : <Check aria-hidden="true" />}
              {!s.mine ? <Wrench aria-hidden="true" /> : null}
              <span className={styles.stepTitle}>{s.title}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {live.text ? <Markdown text={live.text} /> : null}
      {p ? (
        <div className={styles.ask} role="group" aria-label={`${live.via} asks for permission`}>
          <p className={styles.askTitle}>{live.via} wants to use one of its own tools</p>
          <p className={styles.askDetail}>{p.detail || p.title}</p>
          <div className={styles.askActions}>
            {p.options.map((o) => (
              <Button key={o.id} size="sm" variant={optionVariant(o.kind)} onClick={() => app.answerPermission(p.requestId, o.id)}>
                {o.name}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <Button size="sm" variant="ghost" iconStart={<Square />} onClick={() => app.stopReply()}>Stop</Button>
        </div>
      )}
    </div>
  )
}
