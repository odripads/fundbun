import type { Tone } from '../types'
import { REFUSAL_INTENTS, type Intent } from './nlu'

/**
 * Bun's voice for the offline engine. Reply templates per intent × tone. Templates may only interpolate
 * numbers that come from tool results (so offline replies are grounded by construction).
 * `facts` are pre-formatted strings produced from tool results by the runtime.
 *
 * Template syntax: `{key}` inserts a fact; `[ … ]` is an optional segment dropped when any fact inside it is
 * missing. A variant whose required facts are missing is skipped, so every intent ends in a fact-free fallback.
 * Fact values are inserted once, verbatim — a merchant called "{x}" can never inject template syntax.
 *
 * Tone: 'gentle' is the default and never shames; 'cheeky' is the opt-in punchline voice — playful about the
 * spending, never about the person; 'numbers' is plain and terse. No copy ever pushes spending.
 */

/** Stage of an action intent, set by the runtime from the policy decision / execution result. */
export type ActionStage = 'confirm' | 'done' | 'blocked' | 'need_amount' | 'need_target'

export const ACTION_STAGES: readonly ActionStage[] = ['confirm', 'done', 'blocked', 'need_amount', 'need_target']

/**
 * Fact keys each intent's templates read (union across tones). Values are display strings
 * ("¥2,620", "34%", "Oct 28", "Weekend in Chengdu"). Keys with a fixed vocabulary:
 * - `status` (overview): 'over' | 'pace_over' | 'on_track' | 'under' | 'no_data' — MirrorState.status
 * - `verdict` (afford): 'go' | 'think' | 'skip' — AffordabilityResult.verdict; `stage` 'need_amount' when no price yet
 * - `stage` (action intents and xray): ActionStage; xray also accepts 'need_text'
 * - `count` (search, subscriptions, bills, insights, goals): a number as text; '0' selects the "nothing found" line
 * - `injection` (xray): 'yes' when the scanner flagged the pasted text
 * Every key is optional; missing keys drop their segment or fall back to a simpler line.
 */
export const FACT_KEYS: Record<Intent, string[]> = {
  greeting: ['name', 'headline'],
  help: [],
  thanks: ['name'],
  overview: ['status', 'month', 'spent', 'target', 'delta', 'remaining', 'projected', 'safeToSpend', 'itemName', 'goalName', 'goalDelayDays', 'headline'],
  breakdown: ['month', 'total', 'topCategory', 'topAmount', 'topShare', 'category', 'categorySpent', 'categoryLimit', 'categoryPct', 'categoryPrev', 'count', 'itemEquivalent'],
  search: ['count', 'query', 'month', 'total', 'largest'],
  subscriptions: ['count', 'monthlyTotal', 'annualTotal', 'priceHike', 'overlap'],
  bills: ['count', 'nextBill', 'duplicate', 'spike', 'priceHike', 'reminder'],
  insights: ['count', 'top', 'topWhy', 'itemEquivalent', 'second'],
  afford: ['verdict', 'stage', 'label', 'amount', 'remainingAfter', 'overTargetBy', 'hoursOfWork', 'goalName', 'goalDelayDays', 'equivalent'],
  goals: ['count', 'goalName', 'saved', 'price', 'pct', 'eta', 'monthlyRate', 'others'],
  save_to_goal: ['stage', 'amount', 'goalName', 'newPct', 'reason', 'options'],
  withdraw_goal: ['stage', 'amount', 'goalName', 'reason', 'options'],
  set_budget: ['stage', 'category', 'limit', 'previousLimit', 'lastMonth', 'reason'],
  budget_plan: ['stage', 'method', 'total', 'needs', 'wants', 'savings', 'rationale', 'reason'],
  tripwire: ['stage', 'label', 'itemName', 'reason'],
  pay_bill: ['stage', 'billName', 'amount', 'dueDate', 'payee', 'scheduledFor', 'reason', 'options'],
  cancel_sub: ['stage', 'merchant', 'amount', 'annualCost', 'reason', 'options'],
  dispute: ['stage', 'merchant', 'amount', 'date', 'reason', 'options'],
  xray: ['stage', 'injection', 'merchant', 'total', 'dueDate', 'lineCount', 'comparison', 'warning'],
  external_transfer: [],
  add_payee: [],
  invest: [],
  credit: [],
  change_permissions: [],
  sensitive_request: [],
  unknown: [],
}

interface Variant {
  /** fact values that select this variant (any of the listed values); null = the fact must be absent */
  when?: Record<string, string | string[] | null>
  t: string
}

type ToneTemplates = Partial<Record<Tone, Variant[]>> & { gentle: Variant[] }

const v = (t: string, when?: Variant['when']): Variant => ({ t, when })

const DONE: Record<Tone, string> = { gentle: 'Done — all taken care of.', cheeky: 'Done and dusted.', numbers: 'Done.' }

/**
 * Shared shape of the move/organise/pay intents: one line per stage, the confirm line when no stage is given,
 * a bare "done" line when its facts are missing, and a fact-free fallback for everything else.
 */
function stages(tone: Tone, s: Partial<Record<ActionStage, string>>, fallback: string): Variant[] {
  const order: ActionStage[] = ['need_amount', 'need_target', 'blocked', 'done', 'confirm']
  const out = order.filter((k) => s[k]).map((k) => v(s[k] as string, { stage: k }))
  out.push(v(DONE[tone], { stage: 'done' }))
  if (s.confirm) out.push(v(s.confirm, { stage: null }))
  out.push(v(fallback))
  return out
}

const GENERIC_BLOCKED = 'I couldn’t do that one.[ {reason}.] Nothing was changed.'

export const TEMPLATES: Record<Intent, ToneTemplates> = {
  greeting: {
    gentle: [v('Hi[ {name}]! [{headline} ]I’m Bun, your money sidekick. Ask me how your month is going, what’s due, or whether something fits your budget.')],
    cheeky: [v('Hey[ {name}]! [{headline} ]What are we poking at today — the month, the bills, or the dream fund?')],
    numbers: [v('Hello[ {name}]. [{headline} ]Ask for: month overview, categories, bills, subscriptions, goals.')],
  },
  help: {
    gentle: [v('Here’s what I can do: show how your month is going, break spending down by category, find transactions, review bills and subscriptions, check whether a purchase fits, and move money between your own goal pots — you always confirm first. I never send money to other people. If you’d rather talk to a person, tap “Talk to a human”.')],
    cheeky: [v('I’m Bun: part budget, part dumpling. I can mirror your month, sniff out sneaky subscriptions, x-ray bills, run the “should I buy it?” check, and stash money in your dream pots (with your OK). Sending money to other people? That’s your job, not mine. Need a human? Tap “Talk to a human”.')],
    numbers: [v('Capabilities: month overview, category breakdown, transaction search, bills and subscriptions review, affordability check, goal pots (own accounts only, with confirmation), budgets and tripwires. Not supported: transfers to others, investments, credit. Human support: “Talk to a human”.')],
  },
  thanks: {
    gentle: [v('Anytime[, {name}]! I’m here whenever you want a check-in.')],
    cheeky: [v('You’re welcome[, {name}]! Your dream pot says thanks too.')],
    numbers: [v('You’re welcome.')],
  },
  overview: {
    gentle: [
      v('You’ve spent {spent} of your {target} target for {month} — {delta} over.[ That’s about {itemName}.][ It nudges {goalName} back about {goalDelayDays} days.] No judgement: want to see which categories ran hot?', { status: 'over' }),
      v('So far you’ve spent {spent} of {target} for {month}.[ At this pace you’d finish around {projected}.][ Keeping to about {safeToSpend} a day brings you back on track.]', { status: 'pace_over' }),
      v('Nice work: {spent} of your {target} target so far[, heading for about {projected}].[ You’re on course to finish {delta} under.][ Want to stash it in {goalName}?]', { status: 'under' }),
      v('You’re on track: {spent} of {target} spent for {month}[, with {remaining} left][ — about {safeToSpend} a day].', { status: 'on_track' }),
      v('I don’t see any spending for {month} yet. Once transactions come in, I’ll mirror your month back to you.', { status: 'no_data' }),
      v('[{headline} ]You’ve spent {spent} of your {target} target[ for {month}][ — {remaining} left].'),
      v('I couldn’t load your month just now. Try again in a moment?'),
    ],
    cheeky: [
      v('[{headline} ]{spent} spent against a {target} target — {delta} over, and {month} isn’t done yet.[ {goalName} just slid about {goalDelayDays} days further away.] Shall we find the culprit?', { status: 'over' }),
      v('[{headline} ]{spent} down, {target} allowed.[ At this pace you’ll land near {projected}.][ Keep it under {safeToSpend} a day and your dreams stay safe.]', { status: 'pace_over' }),
      v('[{headline} ]{spent} of {target} — you’re {delta} under![ That’s {goalName} money.] Shall I stash it?', { status: 'under' }),
      v('Steady hands: {spent} of {target} spent[, {remaining} to go]. Bun approves.', { status: 'on_track' }),
      v('Nothing spent in {month} yet. Suspiciously saintly.', { status: 'no_data' }),
      v('[{headline} ]{spent} spent of {target}[ — {remaining} left].'),
      v('My crystal dumpling is cloudy — I couldn’t load your month. Try again?'),
    ],
    numbers: [
      v('{month}: spent {spent} of {target}. Over by {delta}.[ Projected: {projected}.][ Goal delay: {goalDelayDays} days.]', { status: 'over' }),
      v('{month}: spent {spent} of {target}.[ Projected: {projected}.][ Safe to spend per day: {safeToSpend}.]', { status: 'pace_over' }),
      v('{month}: spent {spent} of {target}.[ Projected: {projected}.][ Under by {delta}.]', { status: 'under' }),
      v('{month}: spent {spent} of {target}.[ Remaining: {remaining}.][ Safe to spend per day: {safeToSpend}.]', { status: 'on_track' }),
      v('{month}: no spending recorded.', { status: 'no_data' }),
      v('Spent {spent} of {target}.[ Remaining: {remaining}.]'),
      v('Month overview unavailable.'),
    ],
  },
  breakdown: {
    gentle: [
      v('{category} came to {categorySpent}[ in {month}][ across {count} purchases][ — {categoryPct} of its {categoryLimit} budget].[ Last month: {categoryPrev}.][ That’s {itemEquivalent}.]'),
      v('[In {month} you’ve spent {total}. ]Your biggest category is {topCategory} at {topAmount}[ ({topShare} of spending)]. Tap a category to dig in.'),
      v('Here’s your spending by category.'),
    ],
    cheeky: [
      v('{category}: {categorySpent}[ in {month}][, {count} purchases][, {categoryPct} of budget].[ That’s {itemEquivalent} — just saying.]'),
      v('{topCategory} is winning the month at {topAmount}[ ({topShare})].[ Total so far: {total}.]'),
      v('Here’s where the money wandered off to.'),
    ],
    numbers: [
      v('{category}: {categorySpent}[ ({month})][ · {count} transactions][ · {categoryPct} of {categoryLimit}][ · last month {categoryPrev}].'),
      v('[Total {total}. ]Top category: {topCategory}, {topAmount}[ ({topShare})].'),
      v('Spending by category.'),
    ],
  },
  search: {
    gentle: [
      v('I couldn’t find any transactions[ for {query}][ in {month}]. Want to try a different name or month?', { count: '0' }),
      v('I found {count} transactions[ for {query}][ in {month}][, totalling {total}].[ The largest: {largest}.]'),
      v('Here are the transactions I found.'),
    ],
    cheeky: [
      v('Nothing[ for {query}][ in {month}]. Either it never happened or it’s very good at hiding.', { count: '0' }),
      v('{count} hits[ for {query}][ in {month}][ — {total} all-in].[ Biggest: {largest}.]'),
      v('Here’s what I dug up.'),
    ],
    numbers: [
      v('0 transactions[ for {query}][ in {month}].', { count: '0' }),
      v('{count} transactions[ · {query}][ · {month}][ · total {total}][ · largest {largest}].'),
      v('Transactions found.'),
    ],
  },
  subscriptions: {
    gentle: [
      v('I don’t see any subscriptions right now.', { count: '0' }),
      v('You have {count} subscriptions[ costing about {monthlyTotal} a month][ ({annualTotal} a year)].[ Heads-up: {priceHike}.][ Also, {overlap} — worth keeping all of them?]'),
      v('Here are your subscriptions and recurring charges.'),
    ],
    cheeky: [
      v('Zero subscriptions. A rare and beautiful creature.', { count: '0' }),
      v('{count} subscriptions[, {annualTotal} a year].[ {priceHike} — sneaky.][ {overlap}. Do all of them still spark joy?]'),
      v('Here’s everything quietly charging you every month.'),
    ],
    numbers: [
      v('Subscriptions: 0.', { count: '0' }),
      v('Subscriptions: {count}[ · {monthlyTotal}/month][ · {annualTotal}/year][ · price change: {priceHike}][ · overlap: {overlap}].'),
      v('Subscriptions and recurring charges.'),
    ],
  },
  bills: {
    gentle: [
      v('Done — I’ll remind you {reminder}.'),
      v('Your bills look calm — nothing unusual[, and the next one is {nextBill}].', { count: '0' }),
      v('I checked your bills and found {count} things worth a look.[ {duplicate}.][ {spike}.][ {priceHike}.][ Next up: {nextBill}.]'),
      v('Next up: {nextBill}.'),
      v('Here’s what’s going on with your bills.'),
    ],
    cheeky: [
      v('Reminder set: I’ll nudge you {reminder}.'),
      v('Bills are behaving. Suspicious, but nice.[ Next up: {nextBill}.]', { count: '0' }),
      v('{count} things in your bills need eyes.[ {duplicate} — someone’s double-dipping.][ {spike}.][ {priceHike}.][ Next due: {nextBill}.]'),
      v('Next due: {nextBill}.'),
      v('Here’s the bill situation.'),
    ],
    numbers: [
      v('Reminder set: {reminder}.'),
      v('Bill findings: 0.[ Next due: {nextBill}.]', { count: '0' }),
      v('Bill findings: {count}.[ Duplicate: {duplicate}.][ Spike: {spike}.][ Price change: {priceHike}.][ Next due: {nextBill}.]'),
      v('Next due: {nextBill}.'),
      v('Bill analysis.'),
    ],
  },
  insights: {
    gentle: [
      v('Nothing unusual this month — your spending looks steady.', { count: '0' }),
      v('Here’s what stands out: {top}.[ {topWhy}.][ That’s {itemEquivalent}.][ Also: {second}.]'),
      v('Here are a few things I noticed about your spending.'),
    ],
    cheeky: [
      v('No juicy gossip this month. Your spending is behaving.', { count: '0' }),
      v('Spill the tea? {top}.[ That’s {itemEquivalent}.][ And: {second}.]'),
      v('A few things caught my eye.'),
    ],
    numbers: [
      v('Insights: 0.', { count: '0' }),
      v('Top insight: {top}.[ Why: {topWhy}.][ Equivalent: {itemEquivalent}.][ Next: {second}.]'),
      v('Spending insights.'),
    ],
  },
  afford: {
    gentle: [
      v('How much is {label}? Tell me the price and I’ll check it against your month.', { stage: 'need_amount' }),
      v('How much is it? Tell me the price and I’ll check it against your month.', { stage: 'need_amount' }),
      v('{label} at {amount}: that fits your budget — you’d still have {remainingAfter} left this month.[ It’s about {hoursOfWork} hours of work.][ If you skip it, that could go to {goalName} instead.] Your call.', { verdict: 'go' }),
      v('{label} at {amount} would fit, but only just — {remainingAfter} left for the rest of the month.[ It would push {goalName} back about {goalDelayDays} days.] Maybe sleep on it?', { verdict: 'think' }),
      v('I’d hold off on {label} for now: at {amount} it would take you {overTargetBy} over your target.[ {goalName} would wait about {goalDelayDays} days longer.][ It’s the same as {equivalent}.]', { verdict: 'skip' }),
      v('That fits your budget: you’d still have {remainingAfter} left this month.', { verdict: 'go' }),
      v('That would fit, but only just — {remainingAfter} left for the month. Maybe sleep on it?', { verdict: 'think' }),
      v('I’d hold off for now: it would take you {overTargetBy} over your target.', { verdict: 'skip' }),
      v('Here’s how that purchase lands in your month.'),
    ],
    cheeky: [
      v('Ooh, {label}! What’s the price tag? I’ll run the numbers.', { stage: 'need_amount' }),
      v('What’s the price tag? I’ll run the numbers.', { stage: 'need_amount' }),
      v('Good news — {label}? That fits. You’d still have {remainingAfter} left.[ Or it’s {equivalent} — your call.]', { verdict: 'go' }),
      v('Hmm, {label}? That squeezes in with {remainingAfter} to spare.[ {goalName} would wait about {goalDelayDays} more days.] Tempting — maybe sleep on it?', { verdict: 'think' }),
      v('Plot twist: {label} would put you {overTargetBy} over target.[ You could’ve gotten {equivalent} instead.][ {goalName} would slip about {goalDelayDays} days.] Future you says: maybe next month.', { verdict: 'skip' }),
      v('It fits! You’d still have {remainingAfter} left.', { verdict: 'go' }),
      v('It squeezes in with {remainingAfter} to spare. Tempting — maybe sleep on it?', { verdict: 'think' }),
      v('That one would put you {overTargetBy} over target. Future you says: maybe next month.', { verdict: 'skip' }),
      v('Here’s the damage report.'),
    ],
    numbers: [
      v('Price needed[ for {label}].', { stage: 'need_amount' }),
      v('Verdict: go. [{label}: {amount}. ]Remaining after: {remainingAfter}.[ Hours of work: {hoursOfWork}.]', { verdict: 'go' }),
      v('Verdict: think. [{label}: {amount}. ]Remaining after: {remainingAfter}.[ Goal delay: {goalDelayDays} days.]', { verdict: 'think' }),
      v('Verdict: skip. [{label}: {amount}. ]Over target by {overTargetBy}.[ Goal delay: {goalDelayDays} days.]', { verdict: 'skip' }),
      v('Affordability check.'),
    ],
  },
  goals: {
    gentle: [
      v('You haven’t added any dreams yet. Add one and I’ll keep it in view.', { count: '0' }),
      v('{goalName}: {saved} of {price} saved ({pct}).[ At your pace you’ll get there around {eta}.][ Other dreams: {others}.]'),
      v('Here’s how your dreams are coming along.'),
    ],
    cheeky: [
      v('No dreams on the board yet. Dream big — I’ll guard the pot.', { count: '0' }),
      v('{goalName} is {pct} there — {saved} of {price}.[ ETA {eta} — keep feeding the pot.][ Also cooking: {others}.]'),
      v('Your dreams, as of today.'),
    ],
    numbers: [
      v('Goals: 0.', { count: '0' }),
      v('{goalName}: {saved}/{price} ({pct}).[ Rate: {monthlyRate}/month.][ ETA: {eta}.][ Others: {others}.]'),
      v('Goal progress.'),
    ],
  },
  save_to_goal: {
    gentle: stages('gentle', {
      need_amount: 'How much would you like to move[ into {goalName}]?',
      need_target: 'Which dream should it go to?[ You have {options}.]',
      blocked: GENERIC_BLOCKED,
      done: 'Done — {amount} is now in {goalName}.[ That’s {newPct} of the way there!]',
      confirm: 'Ready to move {amount} into {goalName}. Check the card and tap to confirm.',
    }, 'Check the card below to confirm the move.'),
    cheeky: stages('cheeky', {
      need_amount: 'How much are we feeding[ {goalName}] today?',
      need_target: 'Which dream gets the snack?[ Options: {options}.]',
      blocked: 'Couldn’t do that one.[ {reason}.] Nothing moved.',
      done: '{amount} tucked into {goalName}.[ {newPct} there — look at you go!]',
      confirm: '{amount} → {goalName}. One tap and it’s done.',
    }, 'One tap on the card and it’s done.'),
    numbers: stages('numbers', {
      need_amount: 'Amount needed[ for {goalName}].',
      need_target: 'Goal needed.[ Options: {options}.]',
      blocked: 'Not executed.[ Reason: {reason}.]',
      done: 'Moved {amount} to {goalName}.[ Progress: {newPct}.]',
      confirm: 'Pending: move {amount} to {goalName}. Confirm to execute.',
    }, 'Pending action. Confirm to execute.'),
  },
  withdraw_goal: {
    gentle: stages('gentle', {
      need_amount: 'How much would you like to take out[ of {goalName}]?',
      need_target: 'Which pot should it come from?[ You have {options}.]',
      blocked: GENERIC_BLOCKED,
      done: 'Done — {amount} is back in your checking account.',
      confirm: 'Ready to move {amount} from {goalName} back to checking. Plans change — that’s okay. Tap to confirm.',
    }, 'Check the card below to confirm.'),
    cheeky: stages('cheeky', {
      need_amount: 'How much are we borrowing from future you[ and {goalName}]?',
      need_target: 'Which pot are we raiding?[ Options: {options}.]',
      blocked: 'Couldn’t do that one.[ {reason}.] Nothing moved.',
      done: '{amount} is back in checking. The dream is paused, not cancelled.',
      confirm: '{amount} out of {goalName}? Dream on pause, not cancelled. Tap to confirm.',
    }, 'Tap the card to confirm.'),
    numbers: stages('numbers', {
      need_amount: 'Amount needed[ from {goalName}].',
      need_target: 'Pot needed.[ Options: {options}.]',
      blocked: 'Not executed.[ Reason: {reason}.]',
      done: 'Moved {amount} to checking.',
      confirm: 'Pending: move {amount} from {goalName} to checking. Confirm to execute.',
    }, 'Pending action. Confirm to execute.'),
  },
  set_budget: {
    gentle: stages('gentle', {
      need_amount: 'What monthly limit should {category} have?',
      need_target: 'Which category should I set a budget for?',
      blocked: GENERIC_BLOCKED,
      done: 'Done — {category} is now capped at {limit} a month.[ Last month you spent {lastMonth} there.]',
      confirm: 'Set {category} to {limit} a month?[ It was {previousLimit}.] Tap to confirm.',
    }, 'What monthly limit would you like?'),
    cheeky: stages('cheeky', {
      need_amount: 'How tight are we going on {category}?',
      need_target: 'Which category are we putting on a diet?',
      blocked: 'Couldn’t do that one.[ {reason}.]',
      done: '{category} is now on a {limit} leash.[ Last month it ran to {lastMonth}.]',
      confirm: '{category} capped at {limit}?[ (Was {previousLimit}.)] Tap to confirm.',
    }, 'What limit are we setting?'),
    numbers: stages('numbers', {
      need_amount: 'Limit needed for {category}.',
      need_target: 'Category needed.',
      blocked: 'Not executed.[ Reason: {reason}.]',
      done: 'Budget set: {category} {limit}/month.[ Last month: {lastMonth}.]',
      confirm: 'Pending: {category} budget {limit}/month.[ Previous: {previousLimit}.]',
    }, 'Budget limit needed.'),
  },
  budget_plan: {
    gentle: stages('gentle', {
      blocked: GENERIC_BLOCKED,
      done: 'Your new budget is in: {total} a month[ using {method}].[ Needs {needs}, wants {wants}, savings {savings}.][ {rationale}.]',
      confirm: 'Here’s a plan[ based on {method}]: {total} a month.[ Needs {needs}, wants {wants}, savings {savings}.] Tap to apply it.',
    }, 'I’ve drafted a budget plan for you — take a look below.'),
    cheeky: stages('cheeky', {
      blocked: 'Couldn’t do that one.[ {reason}.]',
      done: 'New budget, who dis? {total} a month[ ({method})].[ Needs {needs} · wants {wants} · savings {savings}.]',
      confirm: 'Fresh plan, hot from the steamer: {total} a month[ ({method})]. Tap to apply.',
    }, 'Fresh plan below — tap to apply.'),
    numbers: stages('numbers', {
      blocked: 'Not executed.[ Reason: {reason}.]',
      done: 'Budget applied: {total}/month[ · method {method}][ · needs {needs} · wants {wants} · savings {savings}].',
      confirm: 'Proposed budget: {total}/month[ · method {method}][ · needs {needs} · wants {wants} · savings {savings}].',
    }, 'Budget plan proposed.'),
  },
  tripwire: {
    gentle: stages('gentle', {
      need_amount: 'What should trip it — a share of your target (like 80%) or an amount for a single purchase?',
      blocked: GENERIC_BLOCKED,
      done: 'Tripwire set: {label}.[ When it fires, I’ll show you {itemName} so you remember what you’re saving for.]',
      confirm: 'Set a tripwire for {label}? Tap to confirm.',
    }, 'Tell me the threshold and I’ll set the tripwire.'),
    cheeky: stages('cheeky', {
      need_amount: 'Where do I string the wire — 80% of your target? Purchases over a certain amount?',
      blocked: 'Couldn’t do that one.[ {reason}.]',
      done: 'Tripwire armed: {label}.[ {itemName} will be watching.]',
      confirm: 'Arm a tripwire for {label}? Tap to confirm.',
    }, 'Give me a threshold and I’ll arm it.'),
    numbers: stages('numbers', {
      need_amount: 'Threshold needed (percent of target or amount).',
      blocked: 'Not executed.[ Reason: {reason}.]',
      done: 'Tripwire created: {label}.',
      confirm: 'Pending: tripwire {label}.',
    }, 'Threshold needed.'),
  },
  pay_bill: {
    gentle: stages('gentle', {
      need_target: 'Which bill should I pay?[ I can see {options}.]',
      blocked: 'I couldn’t pay that bill.[ {reason}.] I can only pay verified payees, and always with your PIN.',
      done: 'Done — {billName}[ ({amount})] is taken care of.[ It goes out on {scheduledFor}.]',
      confirm: 'Ready to pay {billName}[ — {amount}][ to {payee}][, due {dueDate}]. You’ll confirm with your PIN.',
    }, 'Check the card below and confirm with your PIN.'),
    cheeky: stages('cheeky', {
      need_target: 'Which bill are we slaying?[ Options: {options}.]',
      blocked: 'Couldn’t pay that one.[ {reason}.] Verified payees only, PIN always.',
      done: '{billName}: paid[ ({amount})]. One less thing.[ Goes out {scheduledFor}.]',
      confirm: '{billName}[ — {amount}][, due {dueDate}]. PIN to confirm and it’s handled.',
    }, 'PIN on the card and it’s handled.'),
    numbers: stages('numbers', {
      need_target: 'Bill needed.[ Options: {options}.]',
      blocked: 'Not executed.[ Reason: {reason}.]',
      done: 'Paid: {billName}[ {amount}][ · scheduled {scheduledFor}].',
      confirm: 'Pending: pay {billName}[ {amount}][ to {payee}][ · due {dueDate}]. PIN required.',
    }, 'Pending payment. PIN required.'),
  },
  cancel_sub: {
    gentle: stages('gentle', {
      need_target: 'Which subscription should I cancel?[ You have {options}.]',
      blocked: GENERIC_BLOCKED,
      done: 'Cancelled {merchant}.[ That’s {annualCost} a year back in your pocket.]',
      confirm: 'Ready to cancel {merchant}[ ({amount} a month)].[ That frees up {annualCost} a year.] You’ll confirm with your PIN.',
    }, 'Check the card below and confirm with your PIN.'),
    cheeky: stages('cheeky', {
      need_target: 'Who are we breaking up with?[ Options: {options}.]',
      blocked: 'Couldn’t do that one.[ {reason}.]',
      done: '{merchant}: cancelled.[ {annualCost} a year, reclaimed.]',
      confirm: 'Say goodbye to {merchant}?[ That’s {annualCost} a year.] PIN to confirm.',
    }, 'PIN on the card to confirm.'),
    numbers: stages('numbers', {
      need_target: 'Subscription needed.[ Options: {options}.]',
      blocked: 'Not executed.[ Reason: {reason}.]',
      done: 'Cancelled: {merchant}.[ Annual saving: {annualCost}.]',
      confirm: 'Pending: cancel {merchant}[ · {amount}/month][ · {annualCost}/year]. PIN required.',
    }, 'Pending cancellation. PIN required.'),
  },
  dispute: {
    gentle: stages('gentle', {
      need_target: 'Which charge would you like to dispute?[ {options}.]',
      blocked: GENERIC_BLOCKED,
      done: 'Dispute opened for {amount} from {merchant}. I’ll let you know when the bank responds.',
      confirm: 'Ready to dispute {amount} from {merchant}[ on {date}]. You’ll confirm with your PIN, then the bank reviews it.',
    }, 'Check the card below and confirm with your PIN.'),
    cheeky: stages('cheeky', {
      need_target: 'Which charge are we taking to court?[ {options}.]',
      blocked: 'Couldn’t do that one.[ {reason}.]',
      done: 'Dispute filed: {amount} from {merchant}. The bank has been summoned.',
      confirm: 'Dispute {amount} from {merchant}[ on {date}]? PIN to confirm.',
    }, 'PIN on the card to confirm.'),
    numbers: stages('numbers', {
      need_target: 'Transaction needed.[ Options: {options}.]',
      blocked: 'Not executed.[ Reason: {reason}.]',
      done: 'Dispute opened: {merchant} {amount}.',
      confirm: 'Pending: dispute {merchant} {amount}[ · {date}]. PIN required.',
    }, 'Pending dispute. PIN required.'),
  },
  xray: {
    gentle: [
      v('Paste the bill text and I’ll x-ray it — I’ll pull out the total, due date and line items.', { stage: 'need_text' }),
      v('I read the bill[ from {merchant}][: {total}][, due {dueDate}]. Heads-up: it contains text that tries to give me instructions, like moving money. I ignored it — bills are data, never commands.[ {comparison}.]', { injection: 'yes' }),
      v('Here’s the x-ray[ of {merchant}]: total {total}[, due {dueDate}][, {lineCount} line items].[ {comparison}.][ {warning}.]'),
      v('I couldn’t find a total in that text. Could you paste the full bill?'),
    ],
    cheeky: [
      v('Hand it over — paste the bill and I’ll x-ray it.', { stage: 'need_text' }),
      v('Nice try, bill[ from {merchant}]. It hid instructions in the small print, like moving money. I ignored them — I only take orders from you.[ Total {total}.][ Due {dueDate}.][ {comparison}.]', { injection: 'yes' }),
      v('X-ray complete[: {merchant}]. Total {total}[, due {dueDate}][, {lineCount} line items].[ {comparison}.][ {warning}.]'),
      v('That bill is playing hard to get — I couldn’t find a total. Paste the whole thing?'),
    ],
    numbers: [
      v('Paste bill text to analyse.', { stage: 'need_text' }),
      v('Warning: embedded instructions detected and ignored.[ Merchant: {merchant}.][ Total: {total}.][ Due: {dueDate}.][ {comparison}.]', { injection: 'yes' }),
      v('[Merchant: {merchant}. ]Total: {total}.[ Due: {dueDate}.][ Line items: {lineCount}.][ {comparison}.][ {warning}.]'),
      v('No total found.'),
    ],
  },
  external_transfer: { gentle: [] },
  add_payee: { gentle: [] },
  invest: { gentle: [] },
  credit: { gentle: [] },
  change_permissions: { gentle: [] },
  sensitive_request: { gentle: [] },
  unknown: {
    gentle: [v('I’m not sure I understood that. I can check how your month is going, find transactions, review bills and subscriptions, or move money into your goal pots. Try “How am I doing this month?”')],
    cheeky: [v('That one went over my bun. Try “How am I doing this month?”, “Any bills due?” or “Should I buy new shoes?”')],
    numbers: [v('Not understood. Try: “How am I doing this month?”, “Where did my money go?”, “Any bills due?”')],
  },
}

// ───────────────────────────── refusals ─────────────────────────────

type Refusal = { title: string; text: string }

export const REFUSALS: Partial<Record<Intent, Record<Tone, Refusal>>> = {
  external_transfer: {
    gentle: { title: 'Only you can send money to others', text: 'Sending money to other people is something only you can do, in your banking app. I can move money between your own pots, or pay a verified bill with your PIN.' },
    cheeky: { title: 'Not my department', text: 'Nice try — sending money to other people is strictly a you-thing, in your banking app. I can shuffle money between your own pots, or pay a verified bill with your PIN.' },
    numbers: { title: 'Transfer not permitted', text: 'Transfers to other people are not available to the agent (tier T4). Available: moves between your own pots; verified bill payments with PIN.' },
  },
  add_payee: {
    gentle: { title: 'New payees are yours to add', text: 'Adding a new payee is something only you can do, in your banking app — I can only ever pay payees you’ve already verified. I can show your upcoming bills or set a reminder instead.' },
    cheeky: { title: 'No new friends for me', text: 'I don’t make new payee friends — only you can add one, in your banking app. I’ll happily handle bills from payees you’ve already verified.' },
    numbers: { title: 'Adding payees not permitted', text: 'Adding payees is not available to the agent (tier T4). Available: payments to verified payees with PIN; bill reminders.' },
  },
  invest: {
    gentle: { title: 'No investment advice', text: 'I can’t buy investments or give personalised investment advice — I’m not a licensed adviser. I can help you build savings instead: move money into a goal pot, or see how much you could set aside each month.' },
    cheeky: { title: 'Not a stock picker', text: 'I’m a dumpling, not a licensed adviser — no investments and no personalised investment advice from me. Want to feed a goal pot instead?' },
    numbers: { title: 'Investments not permitted', text: 'Investment purchases and personalised investment advice are not available (not a licensed adviser; tier T4). Available: goal pot savings, monthly savings capacity.' },
  },
  credit: {
    gentle: { title: 'No credit applications', text: 'I can’t apply for loans, credit cards or credit limits for you. I can look at your budget to see what fits, or set a tripwire so a big purchase doesn’t sneak up on you.' },
    cheeky: { title: 'Borrowing is off the menu', text: 'Loans and credit cards are off my menu. I can check what actually fits your budget, or set a tripwire before a big purchase sneaks up on you.' },
    numbers: { title: 'Credit not permitted', text: 'Loan and credit applications are not available to the agent (tier T4). Available: affordability check, budgets, tripwires.' },
  },
  change_permissions: {
    gentle: { title: 'Only you can change my permissions', text: 'Only you can change what I’m allowed to do — in Settings → Permissions, with your PIN. Tightening my limits or pausing me is always one tap, no PIN needed.' },
    cheeky: { title: 'Nice try', text: 'I can’t promote myself — only you can change my permissions, in Settings → Permissions with your PIN. Want me on a shorter leash? That’s one tap, no PIN.' },
    numbers: { title: 'Permission change not permitted', text: 'The agent cannot change its own mandate (tier T4). Loosening: Settings → Permissions + PIN. Tightening or pausing: one tap, no PIN.' },
  },
  sensitive_request: {
    gentle: { title: 'I keep secrets secret', text: 'I never reveal your PIN, passwords or full card and ID numbers, I never send your data to anyone else, and I don’t switch off my safety rules — even when asked. I can show masked account details (last 4 digits) or a summary right here in the app.' },
    cheeky: { title: 'My lips are sealed', text: 'Not even for dumplings: I never reveal PINs, passwords or full card numbers, I never send your data anywhere, and my safety rules stay on no matter who asks. Masked details (last 4 digits) and in-app summaries are fine.' },
    numbers: { title: 'Request refused', text: 'Not available: PINs, passwords, full card/ID numbers, sending data to third parties, disabling safety rules. Available: masked numbers (last 4), in-app summaries.' },
  },
}

const GENERIC_REFUSAL: Record<Tone, Refusal> = {
  gentle: { title: 'I can’t do that', text: 'That’s outside what I’m allowed to do. I can check your month, review bills and subscriptions, or move money between your own pots — always with your OK.' },
  cheeky: { title: 'Not in my job description', text: 'That’s above my pay grade. I can mirror your month, review bills and subscriptions, or move money between your own pots — with your OK.' },
  numbers: { title: 'Not permitted', text: 'Not available to the agent. Available: overview, bills, subscriptions, own-pot transfers with confirmation.' },
}

/** Standard refusals: external transfers, new payees, investment advice, credit, permission changes. */
export function refusal(intent: Intent, tone: Tone): { title: string; text: string } {
  const set = REFUSALS[intent] ?? GENERIC_REFUSAL
  return { ...(set[tone] ?? set.gentle) }
}

// ───────────────────────────── rendering ─────────────────────────────

type Node = { kind: 'text'; value: string } | { kind: 'key'; key: string } | { kind: 'optional'; nodes: Node[] }

function parseSegment(s: string): Node[] {
  const nodes: Node[] = []
  const re = /\{(\w+)\}/g
  let last = 0
  for (const m of s.matchAll(re)) {
    if ((m.index ?? 0) > last) nodes.push({ kind: 'text', value: s.slice(last, m.index) })
    nodes.push({ kind: 'key', key: m[1] })
    last = (m.index ?? 0) + m[0].length
  }
  if (last < s.length) nodes.push({ kind: 'text', value: s.slice(last) })
  return nodes
}

/** Parses `[ … ]` optional groups (one level) around `{key}` placeholders. */
export function parseTemplate(t: string): Node[] {
  const nodes: Node[] = []
  const re = /\[([^[\]]*)\]/g
  let last = 0
  for (const m of t.matchAll(re)) {
    if ((m.index ?? 0) > last) nodes.push(...parseSegment(t.slice(last, m.index)))
    nodes.push({ kind: 'optional', nodes: parseSegment(m[1]) })
    last = (m.index ?? 0) + m[0].length
  }
  if (last < t.length) nodes.push(...parseSegment(t.slice(last)))
  return nodes
}

/** Every fact key a template string reads. */
export function templateKeys(t: string): string[] {
  const keys: string[] = []
  const walk = (nodes: Node[]) => nodes.forEach((n) => {
    if (n.kind === 'key') keys.push(n.key)
    if (n.kind === 'optional') walk(n.nodes)
  })
  walk(parseTemplate(t))
  return keys
}

const parsed = new Map<string, Node[]>()

function nodesOf(t: string): Node[] {
  let nodes = parsed.get(t)
  if (!nodes) {
    nodes = parseTemplate(t)
    parsed.set(t, nodes)
  }
  return nodes
}

/** Renders nodes or returns null when a required fact is missing. Values are never re-parsed. */
function renderNodes(nodes: Node[], facts: Record<string, string>): string | null {
  let out = ''
  for (const n of nodes) {
    if (n.kind === 'text') out += n.value
    else if (n.kind === 'key') {
      const value = facts[n.key]
      if (!value) return null
      out += value
    } else out += renderNodes(n.nodes, facts) ?? ''
  }
  return out
}

const MAX_FACT_LENGTH = 160

/** Facts are display strings from tool results: trimmed, single-line, bounded; empty means missing. */
function cleanFacts(facts: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, raw] of Object.entries(facts ?? {})) {
    if (raw === undefined || raw === null) continue
    let value = String(raw).replace(/[\u0000-\u001F\u007F\u200B-\u200F\u2060\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim()
    if (value.length > MAX_FACT_LENGTH) value = value.slice(0, MAX_FACT_LENGTH - 1).trimEnd() + '…'
    if (value) out[k] = value
  }
  return out
}

function matchesWhen(when: Variant['when'], facts: Record<string, string>): boolean {
  if (!when) return true
  return Object.entries(when).every(([k, allowed]) => {
    const value = facts[k]
    if (allowed === null) return value === undefined
    return value !== undefined && (Array.isArray(allowed) ? allowed.includes(value) : allowed === value)
  })
}

/** Tidy spacing left behind by dropped optional segments, and avoid doubled sentence punctuation. */
function tidy(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/([.!?])\.+/g, '$1')
    .replace(/,\./g, '.')
    .trim()
    // "a Switch 2: ¥2,299" opening a sentence; brand casing like "iQIYI" or "iCloud" is left alone
    .replace(/(^|[.!?]\s+)([a-z])(?=[a-z\s])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase())
}

function variantsFor(intent: Intent, tone: Tone): Variant[] {
  const set = TEMPLATES[intent] ?? TEMPLATES.unknown
  return set[tone] ?? set.gentle
}

export function composeReply(intent: Intent, facts: Record<string, string>, tone: Tone): string {
  if (REFUSAL_INTENTS.includes(intent)) return refusal(intent, tone).text
  const clean = cleanFacts(facts)
  for (const variant of variantsFor(intent, tone)) {
    if (!matchesWhen(variant.when, clean)) continue
    const text = renderNodes(nodesOf(variant.t), clean)
    if (text !== null) return tidy(text)
  }
  return refusal('unknown', tone).text
}

// ───────────────────────────── suggestion chips ─────────────────────────────

const CHIPS = {
  month: 'How am I doing this month?',
  where: 'Where did my money go?',
  bills: 'Any bills due?',
  goals: 'Show my goals',
  tips: 'Any tips to cut back?',
  subs: 'List my subscriptions',
  hikes: 'Any price hikes?',
  dupes: 'Any duplicate charges?',
  cancel: 'Cancel a subscription',
  stash: 'Move money to my goal',
  tripwire: 'Alert me at 80% of my target',
  plan: 'Make me a budget plan',
  payBill: 'Pay a bill',
  xray: 'X-ray a bill',
  recent: 'Show my recent transactions',
  help: 'What can you do?',
  delivery: 'Set a delivery budget',
} as const

const SUGGESTIONS: Record<Intent, string[]> = {
  greeting: [CHIPS.month, CHIPS.bills, CHIPS.goals],
  help: [CHIPS.month, CHIPS.where, CHIPS.bills, CHIPS.subs],
  thanks: [CHIPS.month, CHIPS.goals, CHIPS.tips],
  overview: [CHIPS.where, CHIPS.tips, CHIPS.goals, CHIPS.bills],
  breakdown: [CHIPS.tips, CHIPS.delivery, CHIPS.recent],
  search: [CHIPS.where, CHIPS.dupes, CHIPS.subs],
  subscriptions: [CHIPS.hikes, CHIPS.cancel, CHIPS.bills],
  bills: [CHIPS.payBill, CHIPS.dupes, CHIPS.subs, CHIPS.xray],
  insights: [CHIPS.where, CHIPS.tripwire, CHIPS.goals],
  afford: [CHIPS.goals, CHIPS.month, CHIPS.tripwire],
  goals: [CHIPS.stash, CHIPS.month, CHIPS.tips],
  save_to_goal: [CHIPS.goals, CHIPS.month, CHIPS.tripwire],
  withdraw_goal: [CHIPS.goals, CHIPS.month, CHIPS.tips],
  set_budget: [CHIPS.where, CHIPS.tripwire, CHIPS.plan],
  budget_plan: [CHIPS.where, CHIPS.tripwire, CHIPS.goals],
  tripwire: [CHIPS.month, CHIPS.goals, CHIPS.where],
  pay_bill: [CHIPS.bills, CHIPS.dupes, CHIPS.month],
  cancel_sub: [CHIPS.subs, CHIPS.hikes, CHIPS.goals],
  dispute: [CHIPS.dupes, CHIPS.recent, CHIPS.bills],
  xray: [CHIPS.bills, CHIPS.payBill, CHIPS.subs],
  external_transfer: [CHIPS.stash, CHIPS.payBill, CHIPS.month],
  add_payee: [CHIPS.bills, CHIPS.payBill, CHIPS.month],
  invest: [CHIPS.stash, CHIPS.goals, CHIPS.tips],
  credit: [CHIPS.month, CHIPS.plan, CHIPS.goals],
  change_permissions: [CHIPS.help, CHIPS.month, CHIPS.goals],
  sensitive_request: [CHIPS.help, CHIPS.month, CHIPS.bills],
  unknown: [CHIPS.month, CHIPS.where, CHIPS.bills, CHIPS.help],
}

/** Quick-reply suggestion chips to show after a reply for the given intent. */
export function suggestionsFor(intent: Intent): string[] {
  return [...(SUGGESTIONS[intent] ?? SUGGESTIONS.unknown)]
}
