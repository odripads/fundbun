import type { ReactNode } from 'react'
import { SectionHeader } from '../../components/ds'
import { SECTION_IDS, type SectionKey } from './jump'
import styles from './sections.module.css'

export interface BillsSectionProps {
  section: SectionKey
  eyebrow?: ReactNode
  title: ReactNode
  /** right side of the header (a total, a badge) */
  aside?: ReactNode
  /** one short line under the header */
  lead?: ReactNode
  children: ReactNode
}

/** A titled landmark section; the h2 is the jump target for the hero tiles and deep links. */
export function BillsSection({ section, eyebrow, title, aside, lead, children }: BillsSectionProps) {
  const id = SECTION_IDS[section]
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={styles.section}>
      <SectionHeader id={`${id}-title`} eyebrow={eyebrow} title={title} action={aside} className={styles.head} />
      {lead ? <div className={styles.lead}>{lead}</div> : null}
      {children}
    </section>
  )
}
