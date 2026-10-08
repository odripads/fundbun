import { Bell, BellRing, CreditCard, TrendingUp, X } from 'lucide-react'
import { useState } from 'react'
import { dateLabel, diffDays, weekday } from '../../../core/dates'
import { fmt } from '../../../core/money'
import type { Bill, BillFinding, Currency, ISODate, Payee, PendingAction } from '../../../core/types'
import { Badge, Chip, EmptyState, Money, cx } from '../../components/ds'
import { PinHint, ProposeButton, type ActionRunner } from './actions'
import {
  billIcon,
  billStatusMeta,
  calendarDays,
  displayStatus,
  dueLine,
  groupBills,
  isOpen,
  overdueBills,
  payAction,
  payeeOf,
  rangeLabel,
  reminderAction,
  REMINDER_DAYS,
  scheduleAction,
  scheduleDate,
  shortMoney,
  spikeFor,
  type CalendarDay,
} from './billsView'
import { BILL_ICON, STATUS_ICON, VERIFIED_ICON } from './icons'
import { BillsSection } from './Section'
import shared from './sections.module.css'
import styles from './upcoming.module.css'

const URGENT_DAYS = 7
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export interface UpcomingSectionProps {
  currency: Currency
  today: ISODate
  bills: Bill[]
  payees: Payee[]
  findings: BillFinding[]
  reminders: Record<string, number>
  awaiting: PendingAction[]
  runner: ActionRunner
}

/** The next 14 days: a two-week calendar and the bill list with Pay / Schedule / Remind me. */
export function UpcomingSection({ currency, today, bills, payees, findings, reminders, awaiting, runner }: UpcomingSectionProps) {
  const [selected, setSelected] = useState<ISODate | null>(null)
  const days = calendarDays(bills, today)
  const { soon, later } = groupBills(bills, today)
  const open = soon.filter(isOpen)
  const windowTotal = open.reduce((s, b) => s + b.amountDue, 0)
  const shown = selected ? soon.filter((b) => b.dueDate === selected) : soon
  const overdue = overdueBills(bills, today)

  return (
    <BillsSection
      section="upcoming"
      eyebrow={`Next 14 days · ${rangeLabel(days)}`}
      title="Coming up"
      aside={
        open.length > 0 ? (
          <span className={shared.asideMoney}>
            <Money amount={windowTotal} currency={currency} size="md" />
            <span className={shared.asideLabel}>
              {open.length} {open.length === 1 ? 'bill' : 'bills'} to pay
            </span>
          </span>
        ) : undefined
      }
    >
      <Calendar days={days} today={today} currency={currency} selected={selected} onSelect={setSelected} />

      {overdue.length > 0 && !selected ? (
        <p className={styles.overdueNote}>
          {STATUS_ICON.overdue}
          {overdue.length === 1 ? `${overdue[0].name} is past its due date` : `${overdue.length} bills are past their due date`} — paying now avoids late fees.
        </p>
      ) : null}

      {selected ? (
        <div className={styles.filterBar} role="status">
          <span>
            Showing {dateLabel(selected)} · {shown.length} {shown.length === 1 ? 'bill' : 'bills'}
          </span>
          <Chip size="sm" icon={<X />} onClick={() => setSelected(null)}>
            Show all
          </Chip>
        </div>
      ) : null}

      {soon.length === 0 ? (
        <div className={styles.empty}>
          <EmptyState compact mood="happy" title="Nothing due for two weeks" body="Bun will nudge you before anything is due." />
        </div>
      ) : (
        <>
          {shown.some((b) => isOpen(b) && b.status !== 'scheduled') ? <PinHint tool="pay_bill">Paying or scheduling needs your PIN — Bun never pays on its own</PinHint> : null}
          <ul className={shared.list} aria-label={selected ? `Bills due ${dateLabel(selected)}` : 'Bills due in the next 14 days'}>
            {shown.map((bill) => (
              <BillRow
                key={bill.id}
                bill={bill}
                today={today}
                currency={currency}
                payee={payeeOf(bill, payees)}
                spike={spikeFor(bill, findings)}
                reminder={reminders[bill.id]}
                awaiting={awaiting}
                runner={runner}
              />
            ))}
          </ul>
        </>
      )}

      {later.length > 0 && !selected ? (
        <details className={styles.later}>
          <summary>
            Later · {later.length} more {later.length === 1 ? 'bill' : 'bills'}
          </summary>
          <ul className={shared.list}>
            {later.map((bill) => (
              <BillRow
                key={bill.id}
                bill={bill}
                today={today}
                currency={currency}
                payee={payeeOf(bill, payees)}
                spike={spikeFor(bill, findings)}
                reminder={reminders[bill.id]}
                awaiting={awaiting}
                runner={runner}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </BillsSection>
  )
}

// ───────────────────────────── calendar ─────────────────────────────

interface CalendarProps {
  days: CalendarDay[]
  today: ISODate
  currency: Currency
  selected: ISODate | null
  onSelect: (date: ISODate | null) => void
}

function dayLabel(day: CalendarDay, currency: Currency, today: ISODate): string {
  const when = `${day.isToday ? 'Today, ' : ''}${WEEKDAY_LONG[weekday(day.date)]} ${dateLabel(day.date)}`
  const what = day.bills.map((b) => `${b.name} ${fmt(b.amountDue, currency)}, ${billStatusMeta(b, today).label.toLowerCase()}`).join('; ')
  return `${when}: ${what}`
}

function Calendar({ days, today, currency, selected, onSelect }: CalendarProps) {
  return (
    <div className={styles.calendar}>
      <div className={styles.calHead} aria-hidden="true">
        {days.slice(0, 7).map((d) => (
          <span key={d.date} data-weekend={weekday(d.date) % 6 === 0 || undefined}>
            {WEEKDAY_LONG[weekday(d.date)].slice(0, 3)}
          </span>
        ))}
      </div>
      <div className={styles.calGrid} role="group" aria-label="Bills calendar, next 14 days">
        {days.map((d) => {
          const has = d.bills.length > 0
          const month = d.isToday ? 'Today' : d.isMonthStart ? d.top : null
          const body = (
            <>
              <span className={styles.calTop}>{month}</span>
              <span className={styles.calDay}>{d.day}</span>
              {has ? (
                <span className={styles.calAmt} data-status={d.status} data-soon={d.soon || undefined}>
                  {d.status === 'paid' ? STATUS_ICON.paid : null}
                  {shortMoney(d.total, currency)}
                </span>
              ) : (
                <span className={styles.calAmtEmpty} />
              )}
              {d.bills.length > 1 ? <span className={styles.calCount}>{d.bills.length}</span> : null}
            </>
          )
          const common = cx(styles.cell, d.isToday && styles.today, has && styles.hasBills, selected === d.date && styles.selected)
          return has ? (
            <button
              key={d.date}
              type="button"
              className={common}
              aria-pressed={selected === d.date}
              aria-label={dayLabel(d, currency, today)}
              onClick={() => onSelect(selected === d.date ? null : d.date)}
            >
              {body}
            </button>
          ) : (
            <div key={d.date} className={common} aria-hidden="true">
              {body}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ───────────────────────────── bill row ─────────────────────────────

interface BillRowProps {
  bill: Bill
  today: ISODate
  currency: Currency
  payee?: Payee
  spike?: BillFinding
  reminder?: number
  awaiting: PendingAction[]
  runner: ActionRunner
}

function BillRow({ bill, today, currency, payee, spike, reminder, awaiting, runner }: BillRowProps) {
  const status = displayStatus(bill, today)
  const meta = billStatusMeta(bill, today)
  const payable = status === 'upcoming' || status === 'overdue'
  const when = scheduleDate(bill, today)
  // only what's due within a week gets the gold button, so the list has one clear order of attention
  const urgent = status === 'overdue' || diffDays(today, bill.dueDate) <= URGENT_DAYS
  const pct = spike && typeof spike.evidence.pct === 'number' ? Math.round(spike.evidence.pct) : undefined
  const usual = spike && typeof spike.evidence.average === 'number' ? spike.evidence.average : undefined

  return (
    <li className={styles.bill} data-status={status}>
      <div className={styles.billMain}>
        <span className={styles.billIcon} data-icon={billIcon(bill)} aria-hidden="true">
          {BILL_ICON[billIcon(bill)]}
        </span>
        <div className={styles.billText}>
          <p className={styles.billName}>{bill.name}</p>
          <p className={styles.billPayee}>
            <span className={styles.payeeName}>{payee?.name ?? 'Unknown payee'}</span>
            {payee?.verified ? (
              <span className={styles.verified}>
                {VERIFIED_ICON}
                Verified
              </span>
            ) : (
              <span className={styles.unverified}>Not verified</span>
            )}
          </p>
          <p className={styles.billDue}>{dueLine(bill, today)}</p>
          {reminder !== undefined && status !== 'paid' ? (
            <p className={styles.reminderOn}>
              <BellRing aria-hidden="true" />
              Reminder {reminder === 0 ? 'on the day' : `${reminder} ${reminder === 1 ? 'day' : 'days'} before`}
            </p>
          ) : null}
        </div>
        <div className={styles.billEnd}>
          <Money amount={bill.amountDue} currency={currency} size="lg" tone={status === 'paid' ? 'muted' : 'neutral'} />
          <Badge size="sm" variant={meta.tone} icon={STATUS_ICON[meta.icon]}>
            {meta.label}
          </Badge>
        </div>
      </div>

      {pct !== undefined && status !== 'paid' ? (
        <p className={styles.flag}>
          <TrendingUp aria-hidden="true" />
          <span>
            {pct}% above your usual{usual !== undefined ? ` ${fmt(usual, currency)}` : ''} — worth a look before it’s due
          </span>
        </p>
      ) : null}

      {status !== 'paid' && (payable || reminder === undefined) ? (
        <div className={styles.actions}>
          {payable ? (
            <ProposeButton
              action={payAction(bill, currency)}
              awaiting={awaiting}
              run={runner.run}
              busy={runner.busy}
              variant={urgent ? 'primary' : 'soft'}
              size="sm"
              icon={<CreditCard />}
              className={styles.grow}
              ariaLabel={`Pay ${bill.name} ${fmt(bill.amountDue, currency)}`}
            />
          ) : null}
          {payable && when ? (
            <ProposeButton
              action={scheduleAction(bill, when)}
              awaiting={awaiting}
              run={runner.run}
              busy={runner.busy}
              variant="secondary"
              size="sm"
              label="Schedule"
              ariaLabel={`Schedule ${bill.name} for ${dateLabel(when)}`}
            />
          ) : null}
          {reminder === undefined ? (
            <ProposeButton
              action={reminderAction(bill)}
              awaiting={awaiting}
              run={runner.run}
              busy={runner.busy}
              variant={payable ? 'secondary' : 'ghost'}
              size="sm"
              icon={<Bell />}
              label={`Remind me ${REMINDER_DAYS} days before`}
              ariaLabel={`Remind me ${REMINDER_DAYS} days before ${bill.name} is due`}
              iconOnly={payable}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
