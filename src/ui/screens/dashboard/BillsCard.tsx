import { BookOpen, ChevronRight, CircleCheck, House, Info, Receipt, Repeat, Shield, ShieldCheck, Smartphone, Zap } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { fmt } from '../../../core/money'
import { useProposeAction } from '../../components/agent'
import { Badge, Button, Money, buttonClass, useToast } from '../../components/ds'
import { href } from '../../router'
import { sandboxToday, shallowEqual, useApp, useSnapshot } from '../../state'
import { billIcon, dueLabel, dueTone, nextBills, payAction, shortDate, type BillIcon } from '../home/model'
import { DashCard } from './DashCard'
import styles from './Dashboard.module.css'

const ICON: Record<BillIcon, ReactNode> = {
  home: <House />,
  zap: <Zap />,
  phone: <Smartphone />,
  repeat: <Repeat />,
  shield: <Shield />,
  book: <BookOpen />,
  receipt: <Receipt />,
}

/** how many bills the card lists before "All bills" */
export const BILLS_SHOWN = 5

const selectBills = (s: AppSnapshot) => ({
  bills: s.derived.upcomingBills,
  hasAnyBill: s.state.bank.bills.length > 0,
  today: sandboxToday(s),
  currency: s.state.profile?.currency ?? 'CNY',
})

/**
 * The next few unpaid bills with the Bills screen's own rules: with a bank connected "Pay" goes through the policy
 * gate (tap and PIN); a bill Bun predicted, or one the user added, is paid in the bank app and then marked as paid.
 */
export function BillsCard({ area }: { area: string }) {
  const { bills, hasAnyBill, today, currency } = useSnapshot(selectBills, shallowEqual)
  const propose = useProposeAction()
  const app = useApp()
  const toast = useToast()
  const [paying, setPaying] = useState<string | null>(null)
  const open = bills.filter((b) => b.status !== 'paid')
  const next = nextBills(bills, BILLS_SHOWN)
  const expected = (b: (typeof next)[number]) => b.source === 'expected' || !b.payeeId
  const anyBank = next.some((b) => b.status !== 'scheduled' && !expected(b))
  const anyExpected = next.some((b) => b.status !== 'scheduled' && expected(b))

  function markPaid(id: string, name: string) {
    const r = app.markBillPaid(id)
    toast.show(
      r.ok
        ? { tone: 'success', title: `${name} marked as paid`, message: 'Counted in this month.', actions: [{ label: 'Undo', onClick: () => app.unmarkBillPaid(id) }] }
        : { tone: 'danger', title: 'Could not mark it as paid', message: r.reason ?? 'Try again.' },
    )
  }

  return (
    <DashCard
      area={area}
      title="Upcoming bills"
      sub={open.length > next.length ? `Next ${next.length} of ${open.length}` : undefined}
      action={
        <a className={buttonClass('ghost', 'sm', false, styles.seeAll)} href={href('bills')} aria-label="See all bills">
          All bills <ChevronRight aria-hidden="true" />
        </a>
      }
    >
      {next.length === 0 ? (
        <p className={styles.empty} data-good={hasAnyBill || undefined}>
          {hasAnyBill ? <CircleCheck aria-hidden="true" /> : null}
          {/* a brand-new user has no bills at all: "every bill is paid" would be a claim about nothing */}
          {hasAnyBill ? 'Nothing due. Every bill is paid.' : 'No bills yet. Import a statement in Bills and Bun will spot them.'}
        </p>
      ) : (
        <ul className={styles.rows}>
          {next.map((b) => {
            const tone = dueTone(today, b.dueDate)
            const due = dueLabel(today, b.dueDate)
            return (
              <li key={b.id} className={styles.row}>
                <span className={styles.rowIcon} aria-hidden="true">{ICON[billIcon(b.category, b.name)]}</span>
                <div className={styles.rowText}>
                  <p className={styles.rowName}>{b.name}</p>
                  <p className={styles.rowMeta}>
                    {tone === 'neutral' ? due : <Badge size="sm" variant={tone === 'over' ? 'over' : 'warn'}>{due}</Badge>}
                    <span className={styles.rowDate}>{shortDate(b.dueDate)}</span>
                  </p>
                </div>
                <Money amount={b.amountDue} currency={currency} size="md" className={styles.rowAmount} />
                <div className={styles.rowAction}>
                  {b.status === 'scheduled' ? (
                    <Badge size="sm" variant="info">Scheduled</Badge>
                  ) : expected(b) ? (
                    <Button size="sm" variant="secondary" aria-label={`Mark ${b.name} as paid`} onClick={() => markPaid(b.id, b.name)}>
                      Mark as paid
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant={tone === 'neutral' ? 'secondary' : 'primary'}
                      loading={paying === b.id}
                      aria-label={`Pay ${b.name} ${fmt(b.amountDue, currency)}, ${due.toLowerCase()}`}
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
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {anyBank ? (
        <p className={styles.footnote}>
          <ShieldCheck aria-hidden="true" />
          Paying needs your tap and your PIN. Bun never pays on its own.
        </p>
      ) : null}
      {anyExpected ? (
        <p className={styles.footnote}>
          <Info aria-hidden="true" />
          No bank is connected, so Bun watches and reminds. Pay in your bank app, then mark it as paid.
        </p>
      ) : null}
    </DashCard>
  )
}
