import { ChevronRight, Lightbulb, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import type { Insight } from '../../../core/types'
import { DreamImage } from '../../components/brand'
import { AiBadge, buttonClass } from '../../components/ds'
import { href } from '../../router'
import { useSnapshot } from '../../state'
import { peekInsights } from './model'
import styles from './InsightsPeek.module.css'

const selectInsights = (s: AppSnapshot) => s.derived.insights

const SEVERITY: Record<Insight['severity'], { label: string; icon: ReactNode }> = {
  warn: { label: 'Watch', icon: <TrendingUp /> },
  positive: { label: 'Nice', icon: <TrendingDown /> },
  neutral: { label: 'Noticed', icon: <Lightbulb /> },
}

/** The top two insights, each tied to a dream; the full list lives on Insights. */
export function InsightsPeek() {
  const insights = useSnapshot(selectInsights)
  const headingId = useId()
  const top = peekInsights(insights, 2)
  if (top.length === 0) return null

  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 id={headingId} className={styles.title}>Bun noticed</h2>
          <AiBadge engine="offline" />
        </div>
        <a className={buttonClass('ghost', 'sm', false, styles.all)} href={href('insights')} aria-label="See all insights">
          See all <ChevronRight aria-hidden="true" />
        </a>
      </div>
      <ul className={styles.list} role="list">
        {top.map((i) => {
          const sev = SEVERITY[i.severity]
          return (
            <li key={i.id}>
              <a className={styles.card} href={href('insights')} data-severity={i.severity}>
                <span className={styles.art} aria-hidden="true">
                  {i.dream ? <DreamImage image={i.dream.image} alt="" size={52} /> : <span className={styles.icon}><Sparkles /></span>}
                </span>
                <span className={styles.body}>
                  <span className={styles.tag}>
                    <span className={styles.tagIcon} aria-hidden="true">{sev.icon}</span>
                    {sev.label}
                  </span>
                  <span className={styles.cardTitle}>{i.title}</span>
                  <span className={styles.text}>{i.body}</span>
                  {i.dream ? <span className={styles.dream}>= {i.dream.label}</span> : null}
                </span>
                <ChevronRight className={styles.chev} aria-hidden="true" />
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
