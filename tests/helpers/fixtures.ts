import type { OnboardingInput } from '../../src/core/app-api'
import { createTestApp, memoryStorage, type CreateAppOptions, type StorageLike } from '../../src/core/app'
import { TEST_NOW } from '../../src/core/controller/constants'
import { fakeEngine, type FakeEngineKit, type FakeEngineOptions } from './fake-engine'

export const PIN = '2580'

/** A valid onboarding input; override any field. */
export function onboardingInput(over: Partial<OnboardingInput> = {}): OnboardingInput {
  return {
    name: 'Lin Test',
    currency: 'CNY',
    monthlyIncome: 1_500_000,
    targetSpend: 800_000,
    payday: 10,
    tone: 'gentle',
    consent: { financialData: true, llmProcessing: false, notifications: false },
    dreams: [
      { name: 'Trip to Japan', price: 1_200_000, image: 'preset:plane', kind: 'goal' },
      { name: 'Concert ticket', price: 48_000, image: 'preset:ticket', kind: 'treat' },
    ],
    autonomy: 'copilot',
    pin: '4826',
    dataSource: { kind: 'empty', startingBalance: 2_000_000 },
    ...over,
  }
}

/** Generic bank export: date, merchant, description, amount (major units, negative = outflow). */
export const SAMPLE_CSV = [
  'date,merchant,description,amount',
  '2026-09-02,Luckin Coffee,Luckin Coffee SZ,-18.50',
  '2026-09-05,Employer Ltd,Salary,15000.00',
  '2026-09-10,Meituan,Meituan delivery,-62.00',
  '2026-09-21,Didi,Ride,-35.00',
  '2026-10-03,Heytea,Heytea milk tea,-23.00',
  '2026-10-08,JD.com,JD purchase,-459.00',
].join('\n')

export interface TestKit {
  app: ReturnType<typeof createTestApp>
  engine: FakeEngineKit
  storage: StorageLike
  clock: { now: Date; advanceMinutes(m: number): void }
}

/** createTestApp + fake engine + shared storage + a movable clock (starts at TEST_NOW). */
export function kit(opts: { storage?: StorageLike; engine?: FakeEngineOptions; app?: CreateAppOptions } = {}): TestKit {
  const storage = opts.storage ?? memoryStorage()
  const engine = fakeEngine(opts.engine)
  const clock = {
    now: new Date(TEST_NOW),
    advanceMinutes(m: number) {
      clock.now = new Date(clock.now.getTime() + m * 60_000)
    },
  }
  const app = createTestApp({ storage, engineFactory: engine.factory, now: () => clock.now, ...opts.app })
  return { app, engine, storage, clock }
}

/** Mei demo loaded through the public API. */
export function demoKit(personaId = 'mei', opts: Parameters<typeof kit>[0] = {}): TestKit {
  const k = kit(opts)
  k.app.loadDemo(personaId)
  return k
}
