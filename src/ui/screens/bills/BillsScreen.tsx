/**
 * #/bills — Topic A "bill analysis": what's due, what Bun found, subscriptions, the Bill X-ray and CSV import.
 * Every money / organise button goes through useProposeAction, so the policy engine decides (T3 → PIN sheet);
 * nothing on this screen executes by itself. Deep links: #/bills/xray · /findings · /subscriptions · /upcoming.
 */
import { useCallback, useEffect } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useRoute } from '../../router'
import { shallowEqual, useSnapshot } from '../../state'
import { useActionRunner } from './actions'
import { BillsHero } from './BillsHero'
import { CsvImportCard } from './CsvImportCard'
import { FindingsSection } from './FindingsSection'
import { isSectionKey, jumpTo, type SectionKey } from './jump'
import { SubscriptionsSection } from './SubscriptionsSection'
import { UpcomingSection } from './UpcomingSection'
import { XraySection } from './XraySection'
import styles from './BillsScreen.module.css'

function selectBills(s: AppSnapshot) {
  return {
    profile: s.state.profile,
    today: s.state.bank.today,
    bills: s.state.bank.bills,
    payees: s.state.bank.payees,
    dreams: s.state.dreams,
    reminders: s.state.billReminders,
    findings: s.derived.findings,
    recurring: s.derived.recurring,
    awaiting: s.derived.awaiting,
  }
}

export type BillsData = ReturnType<typeof selectBills>

export function BillsScreen() {
  const data = useSnapshot(selectBills, shallowEqual)
  const runner = useActionRunner()
  const reduced = useReducedMotion()
  const { params } = useRoute()
  const deepLink = params[0]
  const jump = useCallback((key: SectionKey) => jumpTo(key, !reduced), [reduced])

  useEffect(() => {
    if (!isSectionKey(deepLink)) return
    // a landing, not a jump: scroll only (the shell already put focus on <main>)
    const t = window.setTimeout(() => jumpTo(deepLink, false, false), 80)
    return () => window.clearTimeout(t)
  }, [deepLink])

  if (!data.profile) return null
  const currency = data.profile.currency
  const tone = data.profile.tone

  return (
    <div className={styles.page}>
      <BillsHero
        currency={currency}
        tone={tone}
        today={data.today}
        bills={data.bills}
        findings={data.findings}
        recurring={data.recurring}
        dreams={data.dreams}
        onJump={jump}
      />
      <UpcomingSection
        currency={currency}
        today={data.today}
        bills={data.bills}
        payees={data.payees}
        findings={data.findings}
        reminders={data.reminders}
        awaiting={data.awaiting}
        runner={runner}
      />
      <FindingsSection
        currency={currency}
        tone={tone}
        findings={data.findings}
        dreams={data.dreams}
        awaiting={data.awaiting}
        runner={runner}
        onJump={jump}
      />
      <SubscriptionsSection currency={currency} tone={tone} recurring={data.recurring} awaiting={data.awaiting} runner={runner} />
      <XraySection
        currency={currency}
        profileName={data.profile.name}
        today={data.today}
        bills={data.bills}
        payees={data.payees}
        findings={data.findings}
        reminders={data.reminders}
        awaiting={data.awaiting}
        runner={runner}
      />
      <CsvImportCard />
    </div>
  )
}
