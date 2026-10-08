import { BookOpen, ChevronRight, CircleCheck, House, Receipt, Repeat, Shield, Smartphone, Zap } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { useProposeAction } from '../../components/agent'
import { Badge, Button, Money, buttonClass } from '../../components/ds'
import { href } from '../../router'
import { shallowEqual, useSnapshot } from '../../state'
import { billIcon, dueLabel, dueTone, nextBills, payAction, shortDate, type BillIcon } from './model'
import styles from './BillsStrip.module.css'

const ICON: Record<BillIcon, ReactNode> = {
  home: <House />,
  zap: <Zap />,
  phone: <Smartphone />,
  repeat: <Repeat />,
  shield: <Shield />,
  book: <BookOpen />,
  receipt: <Receipt />,
}

const selectBills = (s: AppSnapshot) => ({
  bills: s.derived.upcomingBills,
  today: s.state.bank.today,
  currency: s.state.profile?.currency ?? 'CNY',
})

/** The next three unpaid bills; Pay goes through the policy gate (T3: tap + PIN). */
export function BillsStrip() {
  const { bills, today, currency } = useSnapshot(selectBills, shallowEqual)
  const propose = useProposeAction()
  const headingId = useId()
  const [paying, setPaying] = useState<string | null>(null)
  const next = nextBills(bills, 3)

  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.title}>Coming up</h2>
        <a className={buttonClass('ghost', 'sm', false, styles.all)} href={href('bills')} aria-label="See all bills">
          See all <ChevronRight aria-hidden="true" />
        </a>
      </div>
      {next.length === 0 ? (
        <p className={styles.empty}>
          <CircleCheck aria-hidden="true" />
          Nothing due — every bill is paid.
        </p>
      ) : (
        <ul className={styles.strip} role="list">
          {next.map((b) => {
            const tone = dueTone(today, b.dueDate)
            const scheduled = b.status === 'scheduled'
            return (
              <li key={b.id} className={styles.bill} data-tone={tone}>
                <span className={styles.icon} aria-hidden="true">{ICON[billIcon(b.category, b.name)]}</span>
                <span className={styles.name}>{b.name}</span>
                <Money amount={b.amountDue} currency={currency} size="lg" className={styles.amount} />
                <span className={styles.due}>
                  {tone === 'neutral' ? (
                    <>
                      {dueLabel(today, b.dueDate)}
                      <span className={styles.date}> · {shortDate(b.dueDate)}</span>
                    </>
                  ) : (
                    <Badge size="sm" variant={tone === 'over' ? 'over' : 'warn'}>{dueLabel(today, b.dueDate)}</Badge>
                  )}
                </span>
                {scheduled ? (
                  <Badge size="sm" variant="info" className={styles.scheduled}>Scheduled</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    fullWidth
                    className={styles.pay}
                    loading={paying === b.id}
                    aria-label={`Pay ${b.name}, ${dueLabel(today, b.dueDate).toLowerCase()}`}
                    onClick={async () => {
                      setPaying(b.id)
                      try {
                        await propose(payAction(b, currency))
                      } finally {
                        setPaying(null)
                      }
                    }}
                  >
                    Pay
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
