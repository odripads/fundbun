import { CalendarClock, ChevronRight, Gift, Plus } from 'lucide-react'
import { useMemo } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { DreamImage } from '../../components/brand'
import { Badge, Button, ProgressBar, buttonClass } from '../../components/ds'
import { href, navigate } from '../../router'
import { shallowEqual, useSnapshot } from '../../state'
import { fmtWhole } from '../home/model'
import { DashCard } from './DashCard'
import { goalRows } from './model'
import styles from './Dashboard.module.css'

const selectGoals = (s: AppSnapshot) => ({
  dreams: s.state.dreams,
  goals: s.derived.goals,
  currency: s.state.profile?.currency ?? 'CNY',
})

/** Every open dream with what is saved toward it and its date: the user's own deadline, or the pace's estimate. */
export function GoalsCard({ area, onAddGoal }: { area: string; onAddGoal?: () => void }) {
  const { dreams, goals, currency } = useSnapshot(selectGoals, shallowEqual)
  const rows = useMemo(() => goalRows(dreams, goals, currency), [dreams, goals, currency])
  const addGoal = onAddGoal ?? (() => navigate('goals'))
  return (
    <DashCard
      area={area}
      title="Goals"
      action={
        <div className={styles.cardActionGroup}>
          <Button size="sm" variant="ghost" iconStart={<Plus />} onClick={addGoal}>
            Add
          </Button>
          <a className={buttonClass('ghost', 'sm', false, styles.seeAll)} href={href('goals')} aria-label="See all goals">
            All goals <ChevronRight aria-hidden="true" />
          </a>
        </div>
      }
    >
      {rows.length === 0 ? (
        <div className={styles.emptyBox}>
          <p className={styles.empty}>No goals or dreams yet. Add one whenever you like.</p>
          <Button size="sm" variant="secondary" iconStart={<Plus />} onClick={addGoal}>
            Add a goal or dream
          </Button>
        </div>
      ) : (
        <ul className={styles.rows}>
          {rows.map((g) => (
            <li key={g.id} className={styles.goal}>
              <DreamImage image={g.image} alt="" size={44} className={styles.goalArt} />
              <div className={styles.goalBody}>
                <p className={styles.goalTop}>
                  <a className={styles.goalName} href={href('goals')}>{g.name}</a>
                  {g.kind === 'treat' ? <Badge size="sm" icon={<Gift />}>Treat</Badge> : null}
                  <span className={styles.goalPct}>{g.funded ? 'Funded' : `${Math.floor(g.pct)}%`}</span>
                </p>
                <ProgressBar
                  value={g.saved}
                  max={Math.max(1, g.price)}
                  tone={g.funded ? 'accent' : 'under'}
                  size="sm"
                  ariaLabel={`${g.name} saved`}
                  valueText={`${fmtWhole(g.saved, currency)} of ${fmtWhole(g.price, currency)}, ${Math.floor(g.pct)}% saved`}
                />
                <p className={styles.goalMeta}>
                  <span className={styles.goalMoney}>
                    {fmtWhole(g.saved, currency)} of {fmtWhole(g.price, currency)}
                  </span>
                  <span className={styles.goalFact} data-on={g.onSchedule === true || undefined} data-late={g.onSchedule === false || undefined}>
                    {g.onSchedule !== undefined ? <CalendarClock aria-hidden="true" /> : null}
                    {g.factValue !== '–' ? <strong>{g.factValue}</strong> : null}
                    <span>{g.factSub}</span>
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </DashCard>
  )
}
