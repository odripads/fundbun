import { ArrowRight, ShieldCheck, TrendingDown, TrendingUp } from 'lucide-react'
import type { RefObject } from 'react'
import { BunMascot, DreamImage, Logo } from '../../../components/brand'
import { Badge, Button, Spinner } from '../../../components/ds'
import type { PersonaId } from '../draft'
import { DreamOrbit, type OrbitItem } from './DreamOrbit'
import styles from './Welcome.module.css'

export interface WelcomeStepProps {
  headingRef: RefObject<HTMLHeadingElement | null>
  /** a draft is in progress: offer to resume */
  resumable: boolean
  /** already set up (someone opened #/onboarding again) */
  onboarded: boolean
  demoLoading: PersonaId | null
  onStart: () => void
  onRestart: () => void
  onDemo: (id: PersonaId) => void
  onHome: () => void
}

interface DemoCard {
  id: PersonaId
  name: string
  age: number
  role: string
  image: string
  status: 'over' | 'under'
  /** their Mirror, in one line */
  mirror: string
}

const DEMOS: readonly DemoCard[] = [
  { id: 'mei', name: 'Mei', age: 26, role: 'UX designer', image: 'preset:plane', status: 'over', mirror: 'Could’ve had a weekend in Chengdu.' },
  { id: 'arif', name: 'Arif', age: 23, role: 'Grad student', image: 'preset:laptop', status: 'under', mirror: 'Closer to his MacBook — or a concert, guilt-free.' },
]

/** the dreams that drift around Bun, at evenly spaced angles */
const ORBIT: readonly OrbitItem[] = [
  { image: 'preset:bag', size: 54, glow: true },
  { image: 'preset:plane', size: 46 },
  { image: 'preset:earbuds', size: 40 },
  { image: 'preset:laptop', size: 50 },
  { image: 'preset:ticket', size: 42 },
  { image: 'preset:sneakers', size: 48 },
]

export function WelcomeStep({ headingRef, resumable, onboarded, demoLoading, onStart, onRestart, onDemo, onHome }: WelcomeStepProps) {
  return (
    <div className={styles.welcome}>
      <div className={styles.top}>
        <Logo size={30} withWordmark />
      </div>

      <DreamOrbit items={ORBIT} mascotSize={128} radius={104} height={244} className={styles.stage} />

      <div className={styles.copy}>
        <p className={styles.kicker}>Meet Bun</p>
        <h1 ref={headingRef} tabIndex={-1} className={styles.promise}>
          See what your spending <em>could have been.</em>
        </h1>
        <p className={styles.lede}>
          Bun mirrors your month as the things you’re dreaming of — and helps you get there. Gently, and on this device.
        </p>
      </div>

      <div className={styles.cta}>
        {onboarded ? (
          <Button size="lg" fullWidth onClick={onHome} iconEnd={<ArrowRight />}>
            Back to my mirror
          </Button>
        ) : (
          <Button size="lg" fullWidth onClick={onStart} iconEnd={<ArrowRight />}>
            {resumable ? 'Pick up where I left off' : 'Set up my own'}
          </Button>
        )}
        {resumable && !onboarded ? (
          <Button variant="ghost" onClick={onRestart}>
            Start fresh instead
          </Button>
        ) : null}
      </div>

      <section className={styles.demoSection} aria-labelledby="ob-demo-title">
        <h2 id="ob-demo-title" className={styles.divider}>
          <span>or try the demo</span>
        </h2>
        <ul className={styles.demos}>
          {DEMOS.map((d) => {
            const loading = demoLoading === d.id
            const Trend = d.status === 'over' ? TrendingUp : TrendingDown
            return (
              <li key={d.id}>
                <button
                  type="button"
                  className={styles.demo}
                  data-status={d.status}
                  onClick={() => onDemo(d.id)}
                  disabled={demoLoading !== null}
                  aria-busy={loading || undefined}
                  aria-describedby="ob-demo-note"
                >
                  <span className={styles.demoHead}>
                    <span className={styles.avatar}>
                      <DreamImage image={d.image} alt="" size={48} />
                      <BunMascot mood={d.status === 'over' ? 'burnt' : 'happy'} size={28} className={styles.avatarBun} animated={false} />
                    </span>
                    <span className={styles.who}>
                      <span className={styles.demoName}>
                        {d.name}, {d.age}
                      </span>
                      <span className={styles.role}>{d.role}</span>
                    </span>
                  </span>
                  <Badge variant={d.status} size="sm" icon={<Trend />}>
                    {d.status === 'over' ? 'Over target' : 'Under target'}
                  </Badge>
                  <span className={styles.mirror}>{d.mirror}</span>
                  <span className={styles.open}>
                    {loading ? <Spinner size={16} label={`Loading ${d.name}’s demo`} /> : <ArrowRight aria-hidden="true" />}
                    {loading ? 'Opening…' : `Explore as ${d.name}`}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <p id="ob-demo-note" className={styles.fine}>
          <ShieldCheck aria-hidden="true" />
          Demos run on a simulated bank{onboarded ? ' and replace the data on this device' : ''}. Nothing real moves.
        </p>
      </section>
    </div>
  )
}
