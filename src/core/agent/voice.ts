import type { Tone } from '../types'
import type { Lang } from './lang'
import { REFUSAL_INTENTS, type Intent } from './nlu'
import { CHIPS_I18N, I18N_TEMPLATES, LINES, REFUSALS_I18N } from './voice-i18n'

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
  help: ['focus', 'target', 'income', 'label', 'amount'],
  thanks: ['name'],
  overview: [
    'status', 'month', 'spent', 'target', 'delta', 'remaining', 'projected', 'safeToSpend', 'goalName', 'goalDelay',
    'focus', 'account', 'checking', 'pots', 'overBy', 'daysLeft', 'perDayLeft', 'nextMonth', 'nextMonthDaily', 'savingsRate', 'income', 'savedToGoals',
  ],
  breakdown: [
    'month', 'total', 'topCategory', 'topAmount', 'topShare', 'category', 'categorySpent', 'categoryLimit', 'categoryPct', 'categoryPrev', 'count', 'itemEquivalent',
    'focus', 'likeForLike', 'prevMonth', 'prevTotal', 'prevToDate', 'change', 'movers', 'categoryPrevFull', 'monthsCount', 'rangeList', 'rangeTotal',
    'groupLabel', 'groupSpent', 'groupParts', 'groupPrev',
  ],
  search: ['count', 'query', 'month', 'total', 'largest', 'focus', 'transfers', 'second'],
  subscriptions: ['count', 'monthlyTotal', 'annualTotal', 'priceHike', 'overlap', 'focus', 'recommend', 'saving'],
  bills: [
    'count', 'nextBill', 'duplicate', 'spike', 'priceHike', 'reminder',
    'focus', 'billName', 'amount', 'dueDate', 'dueIn', 'windowDays', 'windowList', 'actionable', 'fyi', 'dupMerchant', 'dupAmount', 'dupDate',
  ],
  insights: ['count', 'top', 'topWhy', 'itemEquivalent', 'second'],
  afford: ['verdict', 'stage', 'label', 'amount', 'remainingAfter', 'overTargetBy', 'hoursOfWork', 'goalName', 'goalDelay', 'equivalent'],
  goals: ['count', 'goalName', 'saved', 'price', 'pct', 'eta', 'monthlyRate', 'others', 'focus', 'monthly', 'months', 'sooner', 'currentRate'],
  save_to_goal: ['stage', 'amount', 'goalName', 'newPct', 'reason', 'options'],
  withdraw_goal: ['stage', 'amount', 'goalName', 'reason', 'options'],
  set_budget: ['stage', 'category', 'limit', 'previousLimit', 'lastMonth', 'reason', 'loosens'],
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
  unknown: ['focus', 'topic', 'amount'],
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

const HELP_FOCUS: Variant[] = [
  v('Of course — open the ⋯ menu and tap “Talk to a human”. A person gets a short summary of our chat (never your PIN or full card numbers), and you can pause me while they help.', { focus: 'handoff' }),
  v('Your data is yours: Settings → Privacy → Export downloads everything as a file on this device. I never send it anywhere.', { focus: 'export' }),
  v('Your target and income are yours to set: Settings → Profile, no PIN needed.[ Right now your target is {target}][ and your income {income}].[ Change it to {amount} there and I’ll use the new number straight away.]', { focus: 'profile' }),
  v('I can’t add dreams from chat yet — open Dreams → Add a dream[ to put {label} on your wishlist][ ({amount})], with a photo if you like. I’ll start mirroring it right away.', { focus: 'add_dream' }),
]

const OVERVIEW_FOCUS: Record<Tone, Variant[]> = {
  gentle: [
    v('{account} has {checking}.[ Your pots: {pots}.]', { focus: 'balance' }),
    v('Your {target} target for {month} is used up — you’re {overBy} over with {daysLeft} days to go, so there’s nothing safe left to spend this month.[ From {nextMonth}, about {nextMonthDaily} a day keeps you on target.]', { focus: 'safe_to_spend' }),
    v('You have {remaining} left of your {target} target for {month}[ — about {perDayLeft} a day for the {daysLeft} days left].[ Safe to spend today: {safeToSpend}.]', { focus: 'safe_to_spend' }),
    v('You’ve kept {savingsRate} of this month’s income so far ({income} in, {spent} spent).[ {savedToGoals} of it went into your pots.]', { focus: 'savings_rate' }),
    v('This month: {income} in, {spent} spent so far.', { focus: 'savings_rate' }),
  ],
  cheeky: [
    v('{account}: {checking}.[ Tucked away in pots: {pots}.]', { focus: 'balance' }),
    v('The {target} for {month} is spent — {overBy} over with {daysLeft} days to go, so the safe-to-spend jar is empty.[ From {nextMonth}, about {nextMonthDaily} a day keeps the dream on schedule.]', { focus: 'safe_to_spend' }),
    v('{remaining} left of your {target} for {month}[ — about {perDayLeft} a day for {daysLeft} days].[ Safe today: {safeToSpend}.]', { focus: 'safe_to_spend' }),
    v('You’re keeping {savingsRate} of this month’s pay ({income} in, {spent} out).[ {savedToGoals} already went to your pots.]', { focus: 'savings_rate' }),
    v('This month: {income} in, {spent} out so far.', { focus: 'savings_rate' }),
  ],
  numbers: [
    v('{account}: {checking}.[ Pots: {pots}.]', { focus: 'balance' }),
    v('{month}: target {target} used; over by {overBy}; {daysLeft} days left; safe to spend: none.[ {nextMonth}: {nextMonthDaily}/day.]', { focus: 'safe_to_spend' }),
    v('{month}: {remaining} of {target} left[ · {perDayLeft}/day for {daysLeft} days][ · today {safeToSpend}].', { focus: 'safe_to_spend' }),
    v('Savings rate: {savingsRate} (income {income}, spent {spent}).[ To pots: {savedToGoals}.]', { focus: 'savings_rate' }),
    v('Income {income}, spent {spent}.', { focus: 'savings_rate' }),
  ],
}

const BREAKDOWN_FOCUS: Variant[] = [
  v('{category}: {categorySpent} so far in {month} vs {categoryPrev} by this point in {prevMonth} ({change}).[ All of {prevMonth}: {categoryPrevFull}.]', { focus: 'compare', likeForLike: 'yes' }),
  v('{category}: {categorySpent} in {month} vs {categoryPrev} in {prevMonth} ({change}).', { focus: 'compare' }),
  v('{month} so far: {total} vs {prevToDate} by the same day of {prevMonth} ({change}).[ Biggest moves: {movers}.][ All of {prevMonth}: {prevTotal}.]', { focus: 'compare', likeForLike: 'yes' }),
  v('{month}: {total} vs {prevTotal} in {prevMonth} ({change}).[ Biggest moves: {movers}.]', { focus: 'compare' }),
  v('{category} over the last {monthsCount} months: {rangeList}[ — {rangeTotal} in total].'),
  v('{groupLabel} overall[ in {month}]: {groupSpent} — {groupParts}.[ Last month: {groupPrev}.]'),
]

const SEARCH_FOCUS: Variant[] = [
  v('No late-night orders[ in {month}] — nice.', { focus: 'late_night', count: '0' }),
  v('{count} late-night orders[ in {month}][ — {total} in total].[ The biggest: {largest}.]', { focus: 'late_night' }),
  v('Your biggest purchase[ in {month}]: {largest}.[ Next: {second}.]', { focus: 'largest' }),
]

const SUBS_FOCUS: Variant[] = [
  v('I’d cancel {recommend}.[ Together that’s {saving} a year back.] Tap one below to cancel it — you’ll confirm with your PIN.', { focus: 'recommend' }),
  v('Nothing stands out to cancel: no overlaps, price hikes or double charges.[ Your subscriptions cost {annualTotal} a year.]', { focus: 'recommend' }),
]

const BILLS_FOCUS: Variant[] = [
  v('{billName}: {amount}, due {dueDate}[ ({dueIn})].', { focus: 'due' }),
  v('Due in the next {windowDays} days: {windowList}.'),
  v('Nothing is due in the next {windowDays} days.[ Next up: {nextBill}.]'),
  v('{dupMerchant} charged you {dupAmount} twice on {dupDate}. Want me to dispute the second one? You’d confirm with your PIN.', { focus: 'duplicate' }),
  v('No duplicate charges.[ Next up: {nextBill}.]', { focus: 'duplicate' }),
]

const UNKNOWN_FOCUS: Variant[] = [
  v('I only handle your money[, so I can’t help with {topic}]. Want to see what’s safe to spend today?', { focus: 'out_of_scope' }),
  v('What’s {amount} for? I can move it to a goal, check whether a purchase that size fits, or alert you when a single purchase goes over it.', { focus: 'bare_amount' }),
]

export const TEMPLATES: Record<Intent, ToneTemplates> = {
  greeting: {
    gentle: [v('Hi[ {name}]! [{headline} ]I’m Bun, your money sidekick. Ask me how your month is going, what’s due, or whether something fits your budget.')],
    cheeky: [v('Hey[ {name}]! [{headline} ]What are we poking at today — the month, the bills, or the dream fund?')],
    numbers: [v('Hello[ {name}]. [{headline} ]Ask for: month overview, categories, bills, subscriptions, goals.')],
  },
  help: {
    gentle: [...HELP_FOCUS, v('Here’s what I can do: show how your month is going, break spending down by category, find transactions, review bills and subscriptions, check whether a purchase fits, and move money between your own goal pots — you always confirm first. I never send money to other people. If you’d rather talk to a person, tap “Talk to a human”.')],
    cheeky: [...HELP_FOCUS, v('I’m Bun: part budget, part dumpling. I can mirror your month, sniff out sneaky subscriptions, x-ray bills, run the “should I buy it?” check, and stash money in your dream pots (with your OK). Sending money to other people? That’s your job, not mine. Need a human? Tap “Talk to a human”.')],
    numbers: [...HELP_FOCUS, v('Capabilities: month overview, category breakdown, transaction search, bills and subscriptions review, affordability check, goal pots (own accounts only, with confirmation), budgets and tripwires. Not supported: transfers to others, investments, credit. Human support: “Talk to a human”.')],
  },
  thanks: {
    gentle: [v('Anytime[, {name}]! I’m here whenever you want a check-in.')],
    cheeky: [v('You’re welcome[, {name}]! Your dream pot says thanks too.')],
    numbers: [v('You’re welcome.')],
  },
  overview: {
    gentle: [
      ...OVERVIEW_FOCUS.gentle,
      v('You’ve spent {spent} of your {target} target for {month} — {delta} over. No judgement: want to see which categories ran hot?', { status: 'over' }),
      v('So far you’ve spent {spent} of {target} for {month}.[ At this pace you’d finish around {projected}.][ Keeping to about {safeToSpend} a day brings you back on track.]', { status: 'pace_over' }),
      v('Nice work: {spent} of your {target} target so far[, heading for about {projected}].[ You’re on course to finish {delta} under.][ Want to stash it in {goalName}?]', { status: 'under' }),
      v('You’re on track: {spent} of {target} spent for {month}[, with {remaining} left][ — about {safeToSpend} a day].', { status: 'on_track' }),
      v('I don’t see any spending for {month} yet. Once transactions come in, I’ll mirror your month back to you.', { status: 'no_data' }),
      v('You’ve spent {spent} of your {target} target[ for {month}][ — {remaining} left].'),
      v('I couldn’t load your month just now. Try again in a moment?'),
    ],
    cheeky: [
      ...OVERVIEW_FOCUS.cheeky,
      v('{spent} spent against a {target} target, and {month} still has {daysLeft} days to go. Shall we find the culprit?', { status: 'over' }),
      v('{spent} spent against a {target} target[ in {month}]. Shall we find the culprit?', { status: 'over' }),
      v('{spent} down, {target} allowed.[ At this pace you’ll land near {projected}.][ Keep it under {safeToSpend} a day and your dreams stay safe.]', { status: 'pace_over' }),
      v('{spent} of {target} — you’re {delta} under![ That’s {goalName} money.] Shall I stash it?', { status: 'under' }),
      v('Steady hands: {spent} of {target} spent[, {remaining} to go]. Bun approves.', { status: 'on_track' }),
      v('Nothing spent in {month} yet. Suspiciously saintly.', { status: 'no_data' }),
      v('{spent} spent of {target}[ — {remaining} left].'),
      v('My crystal dumpling is cloudy — I couldn’t load your month. Try again?'),
    ],
    numbers: [
      ...OVERVIEW_FOCUS.numbers,
      v('{month}: spent {spent} of {target}. Over by {delta}.[ Projected: {projected}.][ Goal delay: {goalDelay}.]', { status: 'over' }),
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
      ...BREAKDOWN_FOCUS,
      v('{category} came to {categorySpent}[ in {month}][ across {count} purchases][ — {categoryPct} of its {categoryLimit} budget].[ Last month: {categoryPrev}.][ That’s {itemEquivalent}.]'),
      v('[In {month} you’ve spent {total}. ]Your biggest category is {topCategory} at {topAmount}[ ({topShare} of spending)]. Tap a category to dig in.'),
      v('Here’s your spending by category.'),
    ],
    cheeky: [
      ...BREAKDOWN_FOCUS,
      v('{category}: {categorySpent}[ in {month}][, {count} purchases][, {categoryPct} of budget].[ That’s {itemEquivalent} — just saying.]'),
      v('{topCategory} is winning[ {month}] at {topAmount}[ ({topShare})].[ Total: {total}.]'),
      v('Here’s where the money wandered off to.'),
    ],
    numbers: [
      ...BREAKDOWN_FOCUS,
      v('{category}: {categorySpent}[ ({month})][ · {count} transactions][ · {categoryPct} of {categoryLimit}][ · last month {categoryPrev}].'),
      v('[Total {total}. ]Top category: {topCategory}, {topAmount}[ ({topShare})].'),
      v('Spending by category.'),
    ],
  },
  search: {
    gentle: [
      ...SEARCH_FOCUS,
      v('I couldn’t find any transactions[ for {query}][ in {month}]. Want to try a different name or month?', { count: '0' }),
      v('I found {count} transactions[ for {query}][ in {month}][ — {total} of spending].[ Another {transfers} went to your own pots or transfers.][ The largest: {largest}.]'),
      v('Here are the transactions I found.'),
    ],
    cheeky: [
      ...SEARCH_FOCUS,
      v('Nothing[ for {query}][ in {month}]. Either it never happened or it’s very good at hiding.', { count: '0' }),
      v('{count} hits[ for {query}][ in {month}][ — {total} spent].[ Another {transfers} went to your pots and transfers.][ Biggest: {largest}.]'),
      v('Here’s what I dug up.'),
    ],
    numbers: [
      ...SEARCH_FOCUS,
      v('0 transactions[ for {query}][ in {month}].', { count: '0' }),
      v('{count} transactions[ · {query}][ · {month}][ · spent {total}][ · to pots/transfers {transfers}][ · largest {largest}].'),
      v('Transactions found.'),
    ],
  },
  subscriptions: {
    gentle: [
      ...SUBS_FOCUS,
      v('I don’t see any subscriptions right now.', { count: '0' }),
      v('You have {count} subscriptions[ costing about {monthlyTotal} a month][ ({annualTotal} a year)].[ Heads-up: {priceHike}.][ Also, {overlap} — worth keeping all of them?]'),
      v('Here are your subscriptions and recurring charges.'),
    ],
    cheeky: [
      ...SUBS_FOCUS,
      v('Zero subscriptions. A rare and beautiful creature.', { count: '0' }),
      v('{count} subscriptions[, {annualTotal} a year].[ {priceHike} — sneaky.][ {overlap}. Do all of them still spark joy?]'),
      v('Here’s everything quietly charging you every month.'),
    ],
    numbers: [
      ...SUBS_FOCUS,
      v('Subscriptions: 0.', { count: '0' }),
      v('Subscriptions: {count}[ · {monthlyTotal}/month][ · {annualTotal}/year][ · price change: {priceHike}][ · overlap: {overlap}].'),
      v('Subscriptions and recurring charges.'),
    ],
  },
  bills: {
    gentle: [
      v('Done — I’ll remind you {reminder}.'),
      ...BILLS_FOCUS,
      v('Your bills look calm — nothing unusual[, and the next one is {nextBill}].', { count: '0' }),
      v('I checked your bills — {actionable} to look at[ and {fyi} just FYI].[ {duplicate}.][ {spike}.][ {priceHike}.][ Next up: {nextBill}.]'),
      v('I checked your bills and found {count} things worth a look.[ {duplicate}.][ {spike}.][ {priceHike}.][ Next up: {nextBill}.]'),
      v('Next up: {nextBill}.'),
      v('Here’s what’s going on with your bills.'),
    ],
    cheeky: [
      v('Reminder set: I’ll nudge you {reminder}.'),
      ...BILLS_FOCUS,
      v('Bills are behaving. Suspicious, but nice.[ Next up: {nextBill}.]', { count: '0' }),
      v('Bill check — {actionable} to look at[, plus {fyi} FYI].[ {duplicate} — someone’s double-dipping.][ {spike}.][ {priceHike}.][ Next due: {nextBill}.]'),
      v('{count} things in your bills need eyes.[ {duplicate} — someone’s double-dipping.][ {spike}.][ {priceHike}.][ Next due: {nextBill}.]'),
      v('Next due: {nextBill}.'),
      v('Here’s the bill situation.'),
    ],
    numbers: [
      v('Reminder set: {reminder}.'),
      ...BILLS_FOCUS,
      v('Bill findings: 0.[ Next due: {nextBill}.]', { count: '0' }),
      v('Bill findings: {actionable} to act on[, {fyi} FYI].[ Duplicate: {duplicate}.][ Spike: {spike}.][ Price change: {priceHike}.][ Next due: {nextBill}.]'),
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
      v('{label} at {amount} would fit, but only just — {remainingAfter} left for the rest of the month.[ It would push {goalName} back {goalDelay}.] Maybe sleep on it?', { verdict: 'think' }),
      v('I’d hold off on {label} for now: at {amount} it would take you {overTargetBy} over your target.[ {goalName} would wait {goalDelay} longer.][ It’s the same as {equivalent}.]', { verdict: 'skip' }),
      v('That fits your budget: you’d still have {remainingAfter} left this month.', { verdict: 'go' }),
      v('That would fit, but only just — {remainingAfter} left for the month. Maybe sleep on it?', { verdict: 'think' }),
      v('I’d hold off for now: it would take you {overTargetBy} over your target.', { verdict: 'skip' }),
      v('Here’s how that purchase lands in your month.'),
    ],
    cheeky: [
      v('Ooh, {label}! What’s the price tag? I’ll run the numbers.', { stage: 'need_amount' }),
      v('What’s the price tag? I’ll run the numbers.', { stage: 'need_amount' }),
      v('Good news — {label}? That fits. You’d still have {remainingAfter} left.[ Or it’s {equivalent} — your call.]', { verdict: 'go' }),
      v('Hmm, {label}? That squeezes in with {remainingAfter} to spare.[ {goalName} would wait {goalDelay} longer.] Tempting — maybe sleep on it?', { verdict: 'think' }),
      v('Plot twist: {label} would put you {overTargetBy} over target.[ You could’ve gotten {equivalent} instead.][ {goalName} would slip {goalDelay}.] Future you says: maybe next month.', { verdict: 'skip' }),
      v('It fits! You’d still have {remainingAfter} left.', { verdict: 'go' }),
      v('It squeezes in with {remainingAfter} to spare. Tempting — maybe sleep on it?', { verdict: 'think' }),
      v('That one would put you {overTargetBy} over target. Future you says: maybe next month.', { verdict: 'skip' }),
      v('Here’s the damage report.'),
    ],
    numbers: [
      v('Price needed[ for {label}].', { stage: 'need_amount' }),
      v('Verdict: go. [{label}: {amount}. ]Remaining after: {remainingAfter}.[ Hours of work: {hoursOfWork}.]', { verdict: 'go' }),
      v('Verdict: think. [{label}: {amount}. ]Remaining after: {remainingAfter}.[ Goal delay: {goalDelay}.]', { verdict: 'think' }),
      v('Verdict: skip. [{label}: {amount}. ]Over target by {overTargetBy}.[ Goal delay: {goalDelay}.]', { verdict: 'skip' }),
      v('Affordability check.'),
    ],
  },
  goals: {
    gentle: [
      v('Saving {monthly} a month, {goalName} is about {months} months away — around {eta}.[ That’s {sooner} months sooner than your current {currentRate} a month.]', { focus: 'what_if' }),
      v('You haven’t added any dreams yet. Add one and I’ll keep it in view.', { count: '0' }),
      v('{goalName}: {saved} of {price} saved ({pct}).[ At your pace you’ll get there around {eta}.][ Other dreams: {others}.]'),
      v('Here’s how your dreams are coming along.'),
    ],
    cheeky: [
      v('At {monthly} a month, {goalName} lands in about {months} months — around {eta}.[ That’s {sooner} months sooner than your current {currentRate} a month.]', { focus: 'what_if' }),
      v('No dreams on the board yet. Dream big — I’ll guard the pot.', { count: '0' }),
      v('{goalName} is {pct} there — {saved} of {price}.[ ETA {eta} — keep feeding the pot.][ Also cooking: {others}.]'),
      v('Your dreams, as of today.'),
    ],
    numbers: [
      v('{goalName} at {monthly}/month: {months} months (ETA {eta}).[ {sooner} months sooner than {currentRate}/month.]', { focus: 'what_if' }),
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
      done: 'Done — {category} is now capped at {limit} a month.[ Last month you spent {lastMonth} there.][ Heads-up: {loosens}.]',
      confirm: 'Set {category} to {limit} a month?[ It was {previousLimit}.] Tap to confirm.',
    }, 'What monthly limit would you like?'),
    cheeky: stages('cheeky', {
      need_amount: 'How tight are we going on {category}?',
      need_target: 'Which category are we putting on a diet?',
      blocked: 'Couldn’t do that one.[ {reason}.]',
      done: '{category} is now on a {limit} leash.[ Last month it ran to {lastMonth}.][ Heads-up: {loosens}.]',
      confirm: '{category} capped at {limit}?[ (Was {previousLimit}.)] Tap to confirm.',
    }, 'What limit are we setting?'),
    numbers: stages('numbers', {
      need_amount: 'Limit needed for {category}.',
      need_target: 'Category needed.',
      blocked: 'Not executed.[ Reason: {reason}.]',
      done: 'Budget set: {category} {limit}/month.[ Last month: {lastMonth}.][ Note: {loosens}.]',
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
    gentle: [...UNKNOWN_FOCUS, v('I’m not sure I understood that. I can check how your month is going, find transactions, review bills and subscriptions, or move money into your goal pots. Try “How am I doing this month?”')],
    cheeky: [...UNKNOWN_FOCUS, v('That one went over my bun. Try “How am I doing this month?”, “Any bills due?” or “Should I buy new shoes?”')],
    numbers: [...UNKNOWN_FOCUS, v('Not understood. Try: “How am I doing this month?”, “Where did my money go?”, “Any bills due?”')],
  },
}

// ───────────────────────────── refusals ─────────────────────────────

type Refusal = { title: string; text: string }

export const REFUSALS: Partial<Record<Intent, Record<Tone, Refusal>>> = {
  external_transfer: {
    gentle: { title: 'Only you can send money to others', text: 'Sending money to other people is something only you can do, in your banking app. I can move money between your own pots, or pay a verified bill with your PIN.' },
    cheeky: { title: 'Not my department', text: 'Sending money to other people is strictly a you-thing, in your banking app. I can shuffle money between your own pots, or pay a verified bill with your PIN.' },
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
    cheeky: { title: 'Not my call', text: 'I can’t promote myself — only you can change my permissions, in Settings → Permissions with your PIN. Want me on a shorter leash? That’s one tap, no PIN.' },
    numbers: { title: 'Permission change not permitted', text: 'The agent cannot change its own mandate (tier T4). Loosening: Settings → Permissions + PIN. Tightening or pausing: one tap, no PIN.' },
  },
  sensitive_request: {
    gentle: { title: 'I keep secrets secret', text: 'I never reveal your PIN, passwords or full card and ID numbers, I never send your data to anyone else, and I don’t switch off my safety rules — even when asked. I can show masked account details (last 4 digits) or a summary right here in the app.' },
    cheeky: { title: 'My lips are sealed', text: 'Not even for dumplings: I never reveal PINs, passwords or full card numbers, I never send your data anywhere, and my safety rules stay on no matter who asks. Masked details (last 4 digits) and in-app summaries are fine.' },
    numbers: { title: 'Request refused', text: 'Not available: PINs, passwords, full card/ID numbers, sending data to third parties, disabling safety rules. Available: masked numbers (last 4), in-app summaries.' },
  },
}

/** A message that tried to switch off FundBun's rules ("ignore your instructions…") with nothing else to act on. */
export const OVERRIDE_REFUSAL: Record<Tone, Refusal> = {
  gentle: { title: 'Safety rules stay on', text: 'My safety rules can’t be switched off from chat. Money only moves between your own pots, within your caps, and only after you tap Approve. Want to move some to a goal?' },
  cheeky: { title: 'Nice try', text: 'My safety rules don’t have an off switch in chat. Money only moves between your own pots, within your caps, with your tap. Want to feed a dream pot instead?' },
  numbers: { title: 'Override refused', text: 'Safety rules cannot be disabled from chat. Allowed: moves between your own pots, within caps, after your approval.' },
}

export interface RefusalOptions {
  /** the turn looks like an attack (override attempt, account number, outside text) — cheeky may tease it */
  attack?: boolean
  /** the message tried to override the rules and asks for nothing else */
  override?: boolean
  lang?: Lang
}

const GENERIC_REFUSAL: Record<Tone, Refusal> = {
  gentle: { title: 'I can’t do that', text: 'That’s outside what I’m allowed to do. I can check your month, review bills and subscriptions, or move money between your own pots — always with your OK.' },
  cheeky: { title: 'Not in my job description', text: 'That’s above my pay grade. I can mirror your month, review bills and subscriptions, or move money between your own pots — with your OK.' },
  numbers: { title: 'Not permitted', text: 'Not available to the agent. Available: overview, bills, subscriptions, own-pot transfers with confirmation.' },
}

/**
 * Standard refusals: external transfers, new payees, investment advice, credit, permission changes, secrets —
 * and the instruction-override reply. "Nice try" is kept for turns that look like an attack: a plain request
 * (paying a friend back) is never treated as one.
 */
export function refusal(intent: Intent, tone: Tone, opts: RefusalOptions = {}): { title: string; text: string } {
  const lang = opts.lang ?? 'en'
  if (lang !== 'en') {
    const local = REFUSALS_I18N[lang][opts.override && intent === 'sensitive_request' ? 'override' : intent]
    if (local) return { ...local }
  }
  if (opts.override && intent === 'sensitive_request') return { ...(OVERRIDE_REFUSAL[tone] ?? OVERRIDE_REFUSAL.gentle) }
  const set = REFUSALS[intent] ?? GENERIC_REFUSAL
  const base = { ...(set[tone] ?? set.gentle) }
  if (opts.attack && tone === 'cheeky' && REFUSALS[intent] && !/^nice try/i.test(base.text)) {
    base.text = `Nice try — ${base.text.charAt(0).toLowerCase()}${base.text.slice(1)}`
    if (intent === 'change_permissions') base.title = 'Nice try'
  }
  return base
}

/** An engine one-liner (notes, warnings, undo, disambiguation) in the reply language, facts interpolated safely. */
export function line(key: string, lang: Lang = 'en', facts: Record<string, string> = {}): string {
  const set = LINES[key]
  if (!set) return ''
  const clean = cleanFacts(facts)
  return tidy(renderNodes(nodesOf(set[lang] ?? set.en), clean) ?? renderNodes(nodesOf(set.en), clean) ?? '')
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
/** Code-built policy reasons carry the next step ("tap Pay on the bill in Bills …") — never cut them mid-sentence. */
const LONG_FACTS: Record<string, number> = { reason: 320, recommend: 320 }

/** Facts are display strings from tool results: trimmed, single-line, bounded; empty means missing. */
function cleanFacts(facts: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, raw] of Object.entries(facts ?? {})) {
    if (raw === undefined || raw === null) continue
    let value = String(raw).replace(/[\u0000-\u001F\u007F\u200B-\u200F\u2060\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim()
    const max = LONG_FACTS[k] ?? MAX_FACT_LENGTH
    if (value.length > max) value = value.slice(0, max - 1).trimEnd() + '…'
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

export function composeReply(intent: Intent, facts: Record<string, string>, tone: Tone, lang: Lang = 'en'): string {
  if (REFUSAL_INTENTS.includes(intent)) return refusal(intent, tone, { lang }).text
  const clean = cleanFacts(facts)
  if (lang !== 'en') {
    const local = renderFirst(I18N_TEMPLATES[lang]?.[intent] ?? [], clean)
    if (local !== null) return local
  }
  return renderFirst(variantsFor(intent, tone), clean) ?? refusal('unknown', tone).text
}

/** True when the intent has hand-written copy in that language (otherwise the reply falls back to English). */
export function hasLocalCopy(intent: Intent, lang: Lang): boolean {
  if (lang === 'en') return true
  return REFUSAL_INTENTS.includes(intent) || Boolean(I18N_TEMPLATES[lang]?.[intent]?.length)
}

function renderFirst(variants: readonly Variant[], clean: Record<string, string>): string | null {
  for (const variant of variants) {
    if (!matchesWhen(variant.when, clean)) continue
    const text = renderNodes(nodesOf(variant.t), clean)
    if (text !== null) return tidy(text)
  }
  return null
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

/** The same chips in the reply language, when there are hand-written ones (Chinese / Indonesian); else English. */
export function suggestionsIn(intent: Intent, lang: Lang): string[] {
  if (lang !== 'en') {
    const local = CHIPS_I18N[lang]?.[intent]
    if (local?.length) return [...local]
  }
  return suggestionsFor(intent)
}
