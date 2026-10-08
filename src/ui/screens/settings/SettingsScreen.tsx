/**
 * Settings: the user's control room. Kill switch first, then profile, Bun's permissions, tripwires, security,
 * privacy & data, display, sandbox controls and about.
 */
import { BadgeInfo, Bot, ChevronRight, ExternalLink, FlaskConical, GitBranch, Info, Landmark, ScrollText, Sparkles, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { Logo } from '../../components/brand'
import { Badge, Card, SectionHeader, Sheet, Toggle } from '../../components/ds'
import { SandboxPanel } from '../../components/sandbox'
import { useRoute } from '../../router'
import { shallowEqual, useApp, useSnapshot } from '../../state'
import { KillSwitch } from './KillSwitch'
import { APP_LICENCE, APP_VERSION, LICENCES, REPO_URL, repoLabel, teamLine } from './logic'
import { PermissionsSection } from './PermissionsSection'
import { PrivacySection } from './PrivacySection'
import { ProfileSection } from './ProfileSection'
import { SecuritySection } from './SecuritySection'
import { TripwiresSection } from './TripwiresSection'
import styles from './Settings.module.css'

const JUMPS = [
  { id: 'set-profile', label: 'Profile' },
  { id: 'set-perms', label: 'Permissions' },
  { id: 'set-tripwires', label: 'Tripwires' },
  { id: 'set-security', label: 'Security' },
  { id: 'set-privacy', label: 'Privacy' },
  { id: 'set-sandbox', label: 'Sandbox' },
  { id: 'set-about', label: 'About' },
] as const

function jump(id: string, behavior: ScrollBehavior = 'smooth') {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView?.({ behavior, block: 'start' })
  const heading = el.querySelector<HTMLElement>('h2')
  if (heading) {
    heading.tabIndex = -1
    heading.focus({ preventScroll: true })
  }
}

/** `#/settings?s=tripwires` → the section id to open at, when it names one of the jump targets (or the kill switch). */
export function sectionFromQuery(query: Record<string, string>): string | null {
  const id = query.s ? `set-${query.s}` : ''
  return id === 'set-kill' || JUMPS.some((j) => j.id === id) ? id : null
}

export function SettingsScreen() {
  const { query } = useRoute()
  const section = sectionFromQuery(query)
  useEffect(() => {
    if (!section) return
    // after the shell's own "new page: scroll to top, focus <main>" effect, which runs after this one
    const t = setTimeout(() => jump(section, 'auto'), 0)
    return () => clearTimeout(t)
  }, [section])

  return (
    <div className={styles.page}>
      <KillSwitch />
      <nav className={styles.jumps} aria-label="Settings sections">
        {JUMPS.map((j) => (
          <button key={j.id} type="button" className={styles.jump} onClick={() => jump(j.id)}>
            {j.label}
          </button>
        ))}
      </nav>
      <ProfileSection />
      <PermissionsSection />
      <TripwiresSection />
      <SecuritySection />
      <PrivacySection />
      <DisplaySection />
      <SandboxSection />
      <AboutSection />
    </div>
  )
}

function selectDisplay(s: AppSnapshot) {
  return { glassBox: s.state.settings.glassBox, reducedMotion: s.state.settings.reducedMotion }
}

function DisplaySection() {
  const app = useApp()
  const d = useSnapshot(selectDisplay, shallowEqual)
  return (
    <section aria-labelledby="set-display-h" className={styles.section}>
      <SectionHeader id="set-display-h" eyebrow="Look & feel" title="Display" />
      <Card padding="none">
        <div className={styles.toggleRow}>
          <Toggle
            label="Glass box beside the app"
            description="On wide screens, show what Bun sees, decides and records, live."
            checked={d.glassBox}
            onChange={(glassBox) => app.setSettings({ glassBox })}
            tone="accent"
          />
        </div>
        <div className={styles.toggleRow}>
          <Toggle
            label="Reduce motion"
            description="Calms the steam, bobbing and transitions. Your device setting is always respected too."
            checked={d.reducedMotion}
            onChange={(reducedMotion) => app.setSettings({ reducedMotion })}
            tone="accent"
          />
        </div>
      </Card>
    </section>
  )
}

function SandboxSection() {
  return (
    <section id="set-sandbox" aria-labelledby="set-sandbox-h" className={styles.section}>
      <SectionHeader id="set-sandbox-h" eyebrow="Demo only" title="Sandbox controls" action={<Badge variant="accent" icon={<FlaskConical />}>Simulated</Badge>} />
      <Card className={styles.card}>
        <p className={styles.sandboxLead}>
          Play the month forward. Purchases here go through the same tripwires and audit log as real data.
        </p>
        <SandboxPanel />
      </Card>
    </section>
  )
}

const ABOUT_FACTS = [
  { icon: <Landmark />, title: 'Sandbox bank', body: 'All accounts, balances and payments here are simulated. No real money moves.' },
  { icon: <Sparkles />, title: 'AI-generated content is labelled', body: 'Every message from Bun carries an AI badge and names its engine: on-device or LLM.' },
  { icon: <Info />, title: 'Not financial or investment advice', body: 'Bun explains your own numbers. It never recommends investments or credit.' },
  { icon: <Bot />, title: 'The model proposes, the policy engine decides', body: 'Permissions are enforced by code on this device, never by the AI.' },
  { icon: <Users />, title: 'Made by Team FundBun', body: `${teamLine()}. FinTechathon 2026 · International Track, Topic A.` },
]

function AboutSection() {
  const [licences, setLicences] = useState(false)
  return (
    <section id="set-about" aria-labelledby="set-about-h" className={styles.section}>
      <SectionHeader id="set-about-h" eyebrow="FundBun" title="About" />
      <Card className={styles.about}>
        <div className={styles.aboutHead}>
          <Logo size={40} withWordmark />
          <span className={styles.version}>Version {APP_VERSION}</span>
        </div>
        <p className={styles.aboutLead}>An AI money buddy that shows you the dream behind every overspend, and never moves a fen without your say-so.</p>
      </Card>
      <Card padding="none">
        <ul className={styles.facts} role="list">
          {ABOUT_FACTS.map((f) => (
            <li key={f.title} className={styles.fact}>
              <span className={styles.rowIcon} aria-hidden="true">{f.icon}</span>
              <span className={styles.factText}>
                <span className={styles.factTitle}>{f.title}</span>
                <span className={styles.factBody}>{f.body}</span>
              </span>
            </li>
          ))}
          <li className={styles.fact}>
            <a className={styles.factButton} href={REPO_URL} target="_blank" rel="noopener noreferrer">
              <span className={styles.rowIcon} aria-hidden="true"><GitBranch /></span>
              <span className={styles.factText}>
                <span className={styles.factTitle}>Source code · {APP_LICENCE} licence</span>
                <span className={styles.factBody}>{repoLabel()}</span>
              </span>
              <ExternalLink className={styles.factChevron} aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
          <li className={styles.fact}>
            <button type="button" className={styles.factButton} onClick={() => setLicences(true)}>
              <span className={styles.rowIcon} aria-hidden="true"><ScrollText /></span>
              <span className={styles.factText}>
                <span className={styles.factTitle}>Open-source licences</span>
                <span className={styles.factBody}>FundBun is {APP_LICENCE}-licensed and credits {LICENCES.length} open-source components.</span>
              </span>
              <ChevronRight className={styles.factChevron} aria-hidden="true" />
            </button>
          </li>
        </ul>
      </Card>
      <Sheet open={licences} onClose={() => setLicences(false)} title="Open-source licences" description="FundBun is released under the MIT licence and stands on these projects.">
        <ul className={styles.licences} role="list">
          {LICENCES.map((l) => (
            <li key={l.name}>
              <span className={styles.licName}>{l.name}</span>
              <span className={styles.licUse}>{l.use}</span>
              <Badge variant="outline" size="sm" icon={<BadgeInfo />}>{l.licence}</Badge>
            </li>
          ))}
        </ul>
      </Sheet>
    </section>
  )
}
