import type { CategoryId, Currency, ISODate, Minor, ToolName, TripwireKind, YearMonth } from '../types'
import { parseAmount } from '../money'
import { shiftMonth } from '../dates'
import {
  AMOUNT_CUES,
  BILL_CONCEPTS,
  BRAND_ALIASES,
  CATEGORY_SYNONYMS,
  ENTITY_LEXICON,
  GENERIC_NAME_TOKENS,
  GOAL_CONCEPTS,
  HAN_STOP,
  NON_PERSON,
  RECURRING_CONCEPTS,
  RELATION_WORDS,
  STOPWORDS,
  TRAINING,
} from './nlu-data'

/**
 * On-device natural-language understanding for the offline "Bun Engine" (no LLM, no network).
 * Intent classification = TF-IDF over word + character-trigram features, cosine nearest-centroid
 * against a built-in set of example utterances per intent (English + a few Chinese/Indonesian phrasings),
 * combined with high-precision regex overrides. Slot extraction is rule-based.
 */
export type Intent =
  | 'greeting'
  | 'help'
  | 'thanks'
  | 'overview'
  | 'breakdown'
  | 'search'
  | 'subscriptions'
  | 'bills'
  | 'insights'
  | 'afford'
  | 'goals'
  | 'save_to_goal'
  | 'withdraw_goal'
  | 'set_budget'
  | 'budget_plan'
  | 'tripwire'
  | 'pay_bill'
  | 'cancel_sub'
  | 'dispute'
  | 'xray'
  | 'external_transfer'
  | 'add_payee'
  | 'invest'
  | 'credit'
  | 'change_permissions'
  /** asks for PIN / full card or ID numbers / to send data to a third party — always refused */
  | 'sensitive_request'
  | 'unknown'

export interface NluSlots {
  amount?: Minor
  percent?: number
  category?: CategoryId
  month?: YearMonth
  /** merchant / subscription name as matched against known merchants */
  merchant?: string
  goalId?: string
  billId?: string
  recurringId?: string
  /** free-text item label for affordability ("a Switch 2") */
  label?: string
  /** person named in a transfer request */
  person?: string
  /** for xray: the pasted bill text */
  text?: string
  /** create_tripwire kind implied by the wording ("any purchase over ¥500" → single_over) */
  tripwireKind?: TripwireKind
  /** bills: the user asked to be reminded about a bill (→ set_bill_reminder) */
  reminder?: boolean
  /** bills: days before the due date for the reminder ("3 days before") */
  daysBefore?: number
  /** create_budget_plan method implied by the wording */
  budgetMethod?: 'fifty_thirty_twenty' | 'history'
  /** account number from a transfer request, masked to the last 4 digits ("•••• 5678") */
  account?: string
}

export interface NluContext {
  currency: Currency
  today: ISODate
  /** known goal items */
  goals: { id: string; name: string }[]
  /** known bills */
  bills: { id: string; name: string }[]
  /** known recurring series */
  recurring: { id: string; merchant: string }[]
  /** known merchant names (for search) */
  merchants: string[]
}

export interface NluResult {
  intent: Intent
  /** 0..1 */
  confidence: number
  slots: NluSlots
  alternatives: { intent: Intent; confidence: number }[]
  /** id of the high-precision rule that decided the intent; absent when the classifier decided */
  rule?: string
}

/** Classifier confidence below this → 'unknown'. */
export const UNKNOWN_THRESHOLD = 0.35
/** Below this confidence the message must also contain at least one word FundBun knows. */
const VOCABULARY_GATE = 0.75

/** Intents FundBun always refuses (T4 tools or sensitive data); the runtime answers with voice.refusal(). */
export const REFUSAL_INTENTS: readonly Intent[] = [
  'external_transfer', 'add_payee', 'invest', 'credit', 'change_permissions', 'sensitive_request',
]

export function isRefusalIntent(intent: Intent): boolean {
  return REFUSAL_INTENTS.includes(intent)
}

/** The tool the runtime calls for each intent (null = conversational, no tool). T4 tools are called only to be denied and logged. */
export const INTENT_TOOL: Record<Intent, ToolName | null> = {
  greeting: null,
  help: null,
  thanks: null,
  overview: 'get_overview',
  breakdown: 'get_spending_breakdown',
  search: 'search_transactions',
  subscriptions: 'list_recurring',
  bills: 'analyze_bills',
  insights: 'get_insights',
  afford: 'check_affordability',
  goals: 'get_goals',
  save_to_goal: 'transfer_to_goal',
  withdraw_goal: 'withdraw_from_goal',
  set_budget: 'set_category_budget',
  budget_plan: 'create_budget_plan',
  tripwire: 'create_tripwire',
  pay_bill: 'pay_bill',
  cancel_sub: 'cancel_subscription',
  dispute: 'dispute_transaction',
  xray: 'xray_bill',
  external_transfer: 'transfer_external',
  add_payee: 'add_payee',
  invest: 'invest',
  credit: 'apply_credit',
  change_permissions: 'change_mandate',
  sensitive_request: null,
  unknown: null,
}

const MAX_INPUT = 8000
const MAX_CLASSIFY = 1000

// ───────────────────────────── text normalisation ─────────────────────────────

const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g
const HAN = /\p{Script=Han}/u
const WORD_RE = /\p{Script=Han}|[^\s\p{P}\p{S}\p{Script=Han}]+/gu

/** Lowercase, NFKC (full-width → ASCII), diacritics stripped, zero-width removed, whitespace collapsed. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‘’‛`´]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Same clean-up but case preserved — names and labels keep the user's spelling. */
function displayText(text: string): string {
  return text.normalize('NFKC').replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim()
}

function wordsOf(s: string): string[] {
  return s.match(WORD_RE) ?? []
}

function isHan(s: string): boolean {
  return HAN.test(s)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

function round2(x: number): number {
  return Math.round(x * 100) / 100
}

// ───────────────────────────── TF-IDF classifier ─────────────────────────────

type Vec = Map<string, number>

export interface ClassifierOptions {
  /**
   * Relative weight of each feature family: word unigrams (w), word bigrams (b), character trigrams (c),
   * and entity-class tokens (a) / bigrams (A) such as "xxshop" for any known merchant.
   */
  weights: Record<'w' | 'b' | 'c' | 'a' | 'A', number>
  /** how many nearest examples per intent are averaged */
  knn: number
  /** share of the centroid similarity in the blended score (the rest is kNN) */
  centroidMix: number
  /** blended similarity at which confidence starts rising / saturates */
  simFloor: number
  simCeil: number
  /** score gap to the runner-up that counts as a clear win */
  marginScale: number
  /** how much of the top intent's confidence depends on that gap (the rest on absolute similarity) */
  marginShare: number
}

/** Calibrated by 5-fold cross-validation on TRAINING (minimum Brier score of confidence vs. correctness). */
export const DEFAULT_CLASSIFIER_OPTIONS: ClassifierOptions = {
  weights: { w: 1, b: 0.8, c: 0.45, a: 1, A: 0.8 },
  knn: 2,
  centroidMix: 0.5,
  simFloor: 0,
  simCeil: 0.3,
  marginScale: 0.12,
  marginShare: 0.45,
}

type EntityClass = keyof typeof ENTITY_LEXICON

const CLASS_TOKEN: Record<EntityClass, string> = { '@sub': 'xxsub', '@shop': 'xxshop', '@bill': 'xxbill', '@goal': 'xxgoal' }
const CLASS_TOKENS = new Set(Object.values(CLASS_TOKEN))

interface TermTable {
  re: RegExp | null
  classOf: Map<string, EntityClass>
}

/** One alternation, longest term first; Han terms match anywhere, latin terms on word boundaries. */
function buildTermTable(extra: [string, EntityClass][] = []): TermTable {
  const classOf = new Map<string, EntityClass>()
  const add = (term: string, cls: EntityClass) => {
    const t = normalizeText(term)
    if (t.length < 2 || /^\d+$/.test(t) || classOf.has(t)) return
    classOf.set(t, cls)
  }
  for (const [cls, terms] of Object.entries(ENTITY_LEXICON) as [EntityClass, string[]][]) for (const t of terms) add(t, cls)
  for (const [t, cls] of extra) add(t, cls)
  const sorted = [...classOf.keys()].sort((a, b) => b.length - a.length)
  const han = sorted.filter((t) => isHan(t)).map(escapeRe)
  const latin = sorted.filter((t) => !isHan(t)).map(escapeRe)
  const parts = [
    ...(han.length ? [`(?:${han.join('|')})`] : []),
    ...(latin.length ? [`(?<![\\p{L}\\p{N}])(?:${latin.join('|')})(?![\\p{L}\\p{N}])`] : []),
  ]
  return { classOf, re: parts.length ? new RegExp(parts.join('|'), 'gu') : null }
}

const LEXICON_TABLE = buildTermTable()

function abstractText(norm: string, table: TermTable): string {
  if (!table.re) return norm
  return norm.replace(table.re, (m) => {
    const cls = table.classOf.get(m)
    return cls ? ` ${CLASS_TOKEN[cls]} ` : m
  })
}

/** Amounts, currencies and percents become placeholder tokens so "¥500" and "800 yuan" look alike. */
function featureText(norm: string): string {
  return norm
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' email ')
    .replace(/[¥$€£]/g, ' cur ')
    .replace(/%/g, ' pct ')
    .replace(/\d+(?:[.,]\d+)*(?:\s?[kw](?![a-z]))?/g, ' 0 ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Han characters are joined without spaces so their trigrams read like the original phrase. */
function charStream(tokens: string[]): string {
  let out = ' '
  tokens.forEach((t, i) => {
    const glue = i > 0 && isHan(t) && isHan(tokens[i - 1]) ? '' : ' '
    out += (i > 0 ? glue : '') + t
  })
  return out + ' '
}

function rawFeatures(text: string, table: TermTable = LEXICON_TABLE): Map<string, number> {
  const norm = normalizeText(text)
  const tokens = wordsOf(featureText(norm))
  const counts = new Map<string, number>()
  const add = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1)
  for (const t of tokens) add('w:' + t)
  for (let i = 0; i + 1 < tokens.length; i++) add('b:' + tokens[i] + ' ' + tokens[i + 1])
  const chars = [...charStream(tokens)]
  for (let i = 0; i + 3 <= chars.length; i++) add('c:' + chars[i] + chars[i + 1] + chars[i + 2])
  const abstract = wordsOf(featureText(abstractText(norm, table)))
  abstract.forEach((t, i) => {
    if (CLASS_TOKENS.has(t)) add('a:' + t)
    const next = abstract[i + 1]
    if (next && (CLASS_TOKENS.has(t) || CLASS_TOKENS.has(next))) add('A:' + t + ' ' + next)
  })
  return counts
}

interface Model {
  options: ClassifierOptions
  intents: Intent[]
  docs: { intent: Intent; vec: Vec }[]
  centroids: Map<Intent, Vec>
  idf: Map<string, number>
  /** idf for features never seen in training — the maximum, so out-of-vocabulary text lowers similarity */
  unseenIdf: number
}

function weigh(counts: Map<string, number>, model: Pick<Model, 'idf' | 'unseenIdf' | 'options'>): Vec {
  const v: Vec = new Map()
  let norm = 0
  const weights = model.options.weights as Record<string, number>
  for (const [k, c] of counts) {
    const w = (1 + Math.log(c)) * (model.idf.get(k) ?? model.unseenIdf) * weights[k[0]]
    v.set(k, w)
    norm += w * w
  }
  const len = Math.sqrt(norm) || 1
  for (const [k, w] of v) v.set(k, w / len)
  return v
}

function dot(a: Vec, b: Vec): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  let s = 0
  for (const [k, w] of small) {
    const o = big.get(k)
    if (o !== undefined) s += w * o
  }
  return s
}

function normalizeVec(v: Vec): Vec {
  let n = 0
  for (const w of v.values()) n += w * w
  const len = Math.sqrt(n) || 1
  const out: Vec = new Map()
  for (const [k, w] of v) out.set(k, w / len)
  return out
}

function trainModel(data: Partial<Record<Intent, string[]>>, options: ClassifierOptions): Model {
  const intents = (Object.keys(data) as Intent[]).filter((i) => (data[i] ?? []).length > 0)
  const examples = intents.flatMap((intent) => (data[intent] ?? []).map((text) => ({ intent, counts: rawFeatures(text) })))
  const df = new Map<string, number>()
  for (const e of examples) for (const k of e.counts.keys()) df.set(k, (df.get(k) ?? 0) + 1)
  const n = examples.length
  const idf = new Map<string, number>()
  for (const [k, d] of df) idf.set(k, Math.log((1 + n) / (1 + d)) + 1)
  const base = { idf, unseenIdf: Math.log(1 + n) + 1, options }
  const docs = examples.map((e) => ({ intent: e.intent, vec: weigh(e.counts, base) }))
  const centroids = new Map<Intent, Vec>()
  for (const intent of intents) {
    const sum: Vec = new Map()
    for (const d of docs) {
      if (d.intent !== intent) continue
      for (const [k, w] of d.vec) sum.set(k, (sum.get(k) ?? 0) + w)
    }
    centroids.set(intent, normalizeVec(sum))
  }
  return { intents, docs, centroids, ...base }
}

const MODEL = trainModel(TRAINING, DEFAULT_CLASSIFIER_OPTIONS)

function hanBigrams(text: string): string[] {
  const out: string[] = []
  for (const run of text.match(/\p{Script=Han}+/gu) ?? []) {
    for (let i = 0; i + 2 <= run.length; i++) out.push(run.slice(i, i + 2))
  }
  return out
}

/** Every content word and Han bigram seen in in-scope training examples. */
function buildVocabulary(data: Record<Intent, string[]>): Set<string> {
  const vocab = new Set<string>()
  for (const intent of Object.keys(data) as Intent[]) {
    if (intent === 'unknown') continue
    for (const text of data[intent]) {
      const norm = featureText(normalizeText(text))
      for (const w of wordsOf(norm)) if (!isHan(w) && !STOPWORDS.has(w)) vocab.add(w)
      for (const b of hanBigrams(norm)) if (!HAN_STOP.has(b)) vocab.add(b)
    }
  }
  for (const [, synonyms] of CATEGORY_SYNONYMS) for (const syn of synonyms) for (const w of wordsOf(normalizeText(syn))) vocab.add(w)
  for (const [, synonyms] of CATEGORY_SYNONYMS) for (const syn of synonyms) for (const b of hanBigrams(syn)) vocab.add(b)
  return vocab
}

const VOCABULARY = buildVocabulary(TRAINING)
const LATIN_VOCAB = [...VOCABULARY].filter((w) => !isHan(w))

/** Does the message contain at least one word FundBun knows (typos within one edit count)? */
function hasDomainContent(norm: string, table: TermTable): boolean {
  if (wordsOf(abstractText(norm, table)).some((t) => CLASS_TOKENS.has(t))) return true
  const text = featureText(norm)
  if (hanBigrams(text).some((b) => !HAN_STOP.has(b) && VOCABULARY.has(b))) return true
  return wordsOf(text).some((w) => {
    if (isHan(w) || STOPWORDS.has(w) || w.length < 2) return false
    if (VOCABULARY.has(w)) return true
    return w.length >= 5 && LATIN_VOCAB.some((v) => Math.abs(v.length - w.length) <= 1 && editDistance(v, w) <= 1)
  })
}

export interface IntentScore {
  intent: Intent
  /** calibrated 0..1 */
  confidence: number
  /** raw blended cosine similarity */
  score: number
}

function intentScores(text: string, table: TermTable, model: Model): { intent: Intent; score: number }[] {
  const q = weigh(rawFeatures(text.slice(0, MAX_CLASSIFY), table), model)
  const sims = new Map<Intent, number[]>()
  for (const d of model.docs) {
    const list = sims.get(d.intent) ?? []
    list.push(dot(q, d.vec))
    sims.set(d.intent, list)
  }
  const { knn: k, centroidMix } = model.options
  return model.intents.map((intent) => {
    const top = (sims.get(intent) ?? []).sort((a, b) => b - a).slice(0, k)
    const knn = top.reduce((a, b) => a + b, 0) / Math.max(1, top.length)
    const centroid = dot(q, model.centroids.get(intent) ?? new Map())
    return { intent, score: centroidMix * centroid + (1 - centroidMix) * knn }
  })
}

/** Classifier only (no rules): every intent with a calibrated confidence, best first. */
export function classify(text: string, ctx?: NluContext): IntentScore[] {
  return classifyWith(text, ctx ? ctxTermTable(matchersFor(ctx, makeQuery(normalizeText(text)))) : LEXICON_TABLE)
}

/** A standalone classifier over custom training data (used for evaluation and tuning). */
export function createClassifier(
  data: Partial<Record<Intent, string[]>>,
  options: Partial<ClassifierOptions> = {},
): (text: string) => IntentScore[] {
  const model = trainModel(data, { ...DEFAULT_CLASSIFIER_OPTIONS, ...options })
  return (text) => classifyWith(normalizeText(text), LEXICON_TABLE, model)
}

function classifyWith(text: string, table: TermTable, model: Model = MODEL): IntentScore[] {
  const scored = intentScores(text, table, model).sort((a, b) => b.score - a.score)
  const best = scored[0]?.score ?? 0
  const second = scored[1]?.score ?? 0
  const { simFloor, simCeil, marginScale, marginShare } = model.options
  return scored.map((s, i) => {
    const absolute = clamp01((s.score - simFloor) / (simCeil - simFloor))
    const margin = i === 0 ? clamp01((best - second) / marginScale) : 0
    return { intent: s.intent, score: s.score, confidence: round2(absolute * (1 - marginShare + marginShare * margin)) }
  })
}

// ───────────────────────────── entity matching ─────────────────────────────

interface Query {
  norm: string
  tokens: string[]
  tokenSet: Set<string>
  /** latin tokens joined with single spaces and padded, for phrase lookups */
  spaced: string
}

function makeQuery(norm: string): Query {
  const tokens = wordsOf(norm).filter((t) => !isHan(t))
  return { norm, tokens, tokenSet: new Set(tokens), spaced: ` ${tokens.join(' ')} ` }
}

/** Does the query contain this term? Han terms match as substrings, latin terms on word boundaries. */
function hasTerm(q: Query, term: string): boolean {
  const t = normalizeText(term)
  if (!t) return false
  if (isHan(t)) return q.norm.includes(t)
  const toks = wordsOf(t)
  if (toks.length === 1) return q.tokenSet.has(toks[0])
  return q.spaced.includes(` ${toks.join(' ')} `)
}

interface Entity {
  id: string
  phrases: string[]
  tokens: string[]
  generic: string[]
  han: string[]
  concepts: string[]
}

function brandAliases(name: string): string[] {
  const q = makeQuery(normalizeText(name))
  const out: string[] = []
  for (const [key, aliases] of Object.entries(BRAND_ALIASES)) {
    if (hasTerm(q, key) || aliases.some((a) => hasTerm(q, a))) out.push(key, ...aliases)
  }
  return out
}

function buildEntity(id: string, names: string[], concepts: Record<string, string[]>): Entity {
  const all = new Set<string>()
  for (const n of names) {
    if (!n) continue
    all.add(n)
    for (const a of brandAliases(n)) all.add(a)
  }
  const e: Entity = { id, phrases: [], tokens: [], generic: [], han: [], concepts: [] }
  const add = (list: string[], v: string) => { if (!list.includes(v)) list.push(v) }
  for (const name of all) {
    const nn = normalizeText(name)
    for (const run of nn.match(/\p{Script=Han}+/gu) ?? []) if (run.length >= 2) add(e.han, run)
    const latin = wordsOf(nn).filter((t) => !isHan(t))
    if (latin.length >= 2) add(e.phrases, latin.join(' '))
    for (const t of latin) {
      if (/^\d+$/.test(t)) continue
      if (t.length >= 3 && !GENERIC_NAME_TOKENS.has(t)) add(e.tokens, t)
      else if (t.length >= 2) add(e.generic, t)
    }
  }
  const nameQuery = makeQuery([...all].map(normalizeText).join(' '))
  for (const [group, words] of Object.entries(concepts)) {
    if (words.some((w) => hasTerm(nameQuery, w))) e.concepts.push(group)
  }
  return e
}

/** Optimal-string-alignment distance (Damerau–Levenshtein with adjacent transpositions). */
export function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (Math.abs(m - n) > 2) return 3
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[m][n]
}

function fuzzyHit(token: string, q: Query): boolean {
  if (token.length < 5) return false
  const allowed = token.length >= 8 ? 2 : 1
  return q.tokens.some((t) => t.length >= 4 && Math.abs(t.length - token.length) <= allowed && editDistance(t, token) <= allowed)
}

function conceptHits(q: Query, concepts: Record<string, string[]>): Set<string> {
  const hits = new Set<string>()
  for (const [group, words] of Object.entries(concepts)) if (words.some((w) => hasTerm(q, w))) hits.add(group)
  return hits
}

function scoreEntity(e: Entity, q: Query, hits: Set<string>): number {
  let best = 0
  for (const p of e.phrases) if (q.spaced.includes(` ${p} `)) best = Math.max(best, 1)
  for (const h of e.han) if (q.norm.includes(h)) best = Math.max(best, 0.95)
  for (const t of e.tokens) {
    if (q.tokenSet.has(t)) best = Math.max(best, 0.9)
    else if (fuzzyHit(t, q)) best = Math.max(best, 0.75)
  }
  if (e.concepts.some((c) => hits.has(c))) best = Math.max(best, 0.7)
  for (const g of e.generic) if (q.tokenSet.has(g)) best = Math.max(best, 0.5)
  return best
}

const ENTITY_THRESHOLD = 0.6

/** Best-matching entity id, or undefined when nothing matches or two entities tie on a weak match. */
function matchEntity(entities: Entity[], q: Query, concepts: Record<string, string[]>): { id: string; score: number } | undefined {
  const hits = conceptHits(q, concepts)
  const scored = entities.map((e) => ({ id: e.id, score: scoreEntity(e, q, hits) })).sort((a, b) => b.score - a.score)
  const [first, second] = scored
  if (!first || first.score < ENTITY_THRESHOLD) return undefined
  if (second && second.score === first.score && first.score < 0.9) return undefined
  return first
}

function goalEntities(ctx: NluContext): Entity[] {
  return ctx.goals.map((g) => buildEntity(g.id, [g.name, g.id.replace(/^dream_/, '').replace(/_/g, ' ')], GOAL_CONCEPTS))
}

function billEntities(ctx: NluContext): Entity[] {
  return ctx.bills.map((b) => buildEntity(b.id, [b.name], BILL_CONCEPTS))
}

function recurringEntities(ctx: NluContext): Entity[] {
  return ctx.recurring.map((r) => buildEntity(r.id, [r.merchant], RECURRING_CONCEPTS))
}

function merchantEntities(ctx: NluContext): Entity[] {
  return ctx.merchants.map((m) => buildEntity(m, [m], RECURRING_CONCEPTS))
}

interface Matchers {
  q: Query
  goals: Entity[]
  bills: Entity[]
  recurring: Entity[]
  merchants: Entity[]
}

function matchersFor(ctx: NluContext, q: Query): Matchers {
  return { q, goals: goalEntities(ctx), bills: billEntities(ctx), recurring: recurringEntities(ctx), merchants: merchantEntities(ctx) }
}

/** The user's own entity names feed the classifier's entity-class tokens (subscriptions win over shops). */
function ctxTermTable(m: Matchers): TermTable {
  const extra: [string, EntityClass][] = []
  const push = (entities: Entity[], cls: EntityClass) => {
    for (const e of entities) for (const t of [...e.phrases, ...e.tokens, ...e.han]) extra.push([t, cls])
  }
  push(m.recurring, '@sub')
  push(m.merchants, '@shop')
  push(m.bills, '@bill')
  push(m.goals, '@goal')
  return buildTermTable(extra)
}

// ───────────────────────────── slot extraction ─────────────────────────────

const MONTHS: [RegExp, number][] = [
  [/\bjan(?:uary|uari)?\b/, 1], [/\bfeb(?:ruary|ruari)?\b/, 2], [/\bmar(?:ch|et)?\b/, 3], [/\bapr(?:il)?\b/, 4],
  [/\b(?:in|for|during|of|since|from|last|bulan) may\b|\bmay \d{4}\b/, 5], [/\bjun(?:e|i)?\b/, 6], [/\bjul(?:y|i)?\b/, 7],
  [/\baug(?:ust|ustus)?\b|\bagustus\b/, 8], [/\bsep(?:t|tember)?\b/, 9], [/\boct(?:ober)?\b|\boktober\b/, 10],
  [/\bnov(?:ember)?\b|\bnopember\b/, 11], [/\bdec(?:ember)?\b|\bdesember\b/, 12],
  [/\bbulan mei\b|\bmei \d{4}\b/, 5],
]

const HAN_MONTH: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12,
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** A month without a year means its most recent occurrence up to today's month. */
function resolveMonth(month: number, today: ISODate, year?: number): YearMonth | undefined {
  if (month < 1 || month > 12) return undefined
  const ty = Number(today.slice(0, 4))
  const tm = Number(today.slice(5, 7))
  const y = year ?? (month <= tm ? ty : ty - 1)
  return `${y}-${pad2(month)}`
}

export function extractMonth(norm: string, today: ISODate): YearMonth | undefined {
  const current = today.slice(0, 7)
  if (/\b(?:two|2) months ago\b|上上个月|前两个月|\bdua bulan (?:lalu|yang lalu)\b/.test(norm)) return shiftMonth(current, -2)
  if (/\b(?:last|previous|past|prior) month\b|\bmonth before\b|上个月|上月|\bbulan (?:lalu|kemarin|sebelumnya)\b/.test(norm)) return shiftMonth(current, -1)
  if (/\bnext month\b|下个月|下月|\bbulan depan\b/.test(norm)) return shiftMonth(current, 1)
  if (/\b(?:this|current) month\b|\bso far\b|本月|这个月|这月|\bbulan ini\b/.test(norm)) return current
  const iso = norm.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])(?![\d])/)
  if (iso) return resolveMonth(Number(iso[2]), today, Number(iso[1]))
  const mmyyyy = norm.match(/\b(0?[1-9]|1[0-2])[/.-](20\d{2})\b/)
  if (mmyyyy) return resolveMonth(Number(mmyyyy[1]), today, Number(mmyyyy[2]))
  const han = norm.match(/(?:(\d{4})\s*年\s*)?(\d{1,2}|十[一二]?|[一二三四五六七八九十])\s*月/u)
  if (han && !/个月/.test(han[0])) {
    const m = /^\d+$/.test(han[2]) ? Number(han[2]) : HAN_MONTH[han[2]]
    return resolveMonth(m, today, han[1] ? Number(han[1]) : undefined)
  }
  for (const [re, m] of MONTHS) {
    const hit = norm.match(re)
    if (!hit) continue
    const year = norm.slice(hit.index ?? 0).match(/^\D{0,12}?(\d{4})\b/)
    return resolveMonth(m, today, year ? Number(year[1]) : undefined)
  }
  return undefined
}

export function extractPercent(norm: string): number | undefined {
  const m = norm.match(/(\d{1,4}(?:\.\d+)?)\s?(?:%|percent\b|per cent\b|pct\b|persen\b)/)
  if (m) return Number(m[1])
  const zh = norm.match(/百分之\s*(\d{1,3})/)
  return zh ? Number(zh[1]) : undefined
}

/** Spans that look like numbers but are not money: dates, times, percents, durations, ids, ratios. */
const NON_AMOUNT_PATTERNS: RegExp[] = [
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /\+?\d(?:[\s-]?\d){7,}(?:\.{2,}|…)?/g,
  /\b\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?\b/g,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  /\b\d{1,2}[-.]\d{4}\b/g,
  /(?:\d{4}\s*年)?\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*[日号])?/g,
  /\d{4}\s*年/g,
  /\d{1,2}\s*[日号](?![元块])/g,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b(?:,?\s*\d{4})?/g,
  /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b(?:\s+\d{4})?/g,
  /\b(?:january|february|march|april|june|july|august|september|october|november|december)\s+\d{4}\b/g,
  /\b\d{1,2}(?:st|nd|rd|th)\b/g,
  /\b\d{1,2}:\d{2}\b/g,
  /\b\d{1,2}\s?(?:am|pm)\b/g,
  /\d+(?:\.\d+)?\s?(?:%|percent\b|per cent\b|pct\b|persen\b)/g,
  /百分之\s*\d+/g,
  /\b\d+\s*(?:days?|weeks?|months?|years?|yrs?|hours?|hrs?|mins?|minutes?|seconds?|times?|x|hari|minggu|bulan|tahun|jam|kali)\b/g,
  /\d+\s*(?:天|周|个月|年|小时|次)/g,
  /\b\d+\s*\/\s*\d+(?:\s*\/\s*\d+)?\b/g,
]

const AMOUNT_RE = /(?<![a-z\d.,])(¥|\$|€|£|rmb|cny|usd|rp|rm)?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?:\s?(k|w|万|千|thousand|grand|million|mil|juta|jt|ribu|rb)(?![a-z]))?(?:\s?(元|块|yuan|rmb|cny|kuai|dollars?|bucks?|quid|rupiah))?(?![a-z\d])/g

interface AmountCandidate { value: Minor; score: number; index: number }

function maskEntityNames(text: string, ctx: NluContext): string {
  let out = text
  const names = [...ctx.goals.map((g) => g.name), ...ctx.bills.map((b) => b.name), ...ctx.recurring.map((r) => r.merchant), ...ctx.merchants]
  for (const name of names) {
    const nn = normalizeText(name)
    if (!/\d/.test(nn) || nn.length < 3) continue
    out = out.replace(new RegExp(escapeRe(nn), 'g'), (m) => ' '.repeat(m.length))
  }
  return out
}

function maskNonAmounts(norm: string, ctx: NluContext): string {
  let out = maskEntityNames(norm, ctx)
  for (const re of NON_AMOUNT_PATTERNS) out = out.replace(re, (m) => ' '.repeat(m.length))
  return out
}

function canonicalSuffix(s: string | undefined): string {
  if (!s) return ''
  if (['k', '千', 'thousand', 'grand', 'ribu', 'rb'].includes(s)) return 'k'
  if (['w', '万'].includes(s)) return 'w'
  return ' million'
}

function previousWord(text: string, index: number): string {
  const m = text.slice(0, index).match(/([\p{L}\d']+)\s*$/u)
  return m ? m[1] : ''
}

export function extractAmount(norm: string, ctx: NluContext): Minor | undefined {
  const masked = maskNonAmounts(norm, ctx)
  const candidates: AmountCandidate[] = []
  for (const m of masked.matchAll(AMOUNT_RE)) {
    const [, prefix, int, frac, suffix, unit] = m
    const marked = Boolean(prefix || unit)
    const prev = previousWord(masked, m.index ?? 0)
    const hanBefore = isHan(prev.slice(-1))
    const cue = hanBefore || AMOUNT_CUES.has(prev)
    // "Switch 2", "Birkin 25", "iPhone 17": a short bare number after a plain word is a model number
    if (!marked && !suffix && int.length <= 2 && prev && !cue && /^[a-z]/.test(prev)) continue
    const value = parseAmount(`${int}${frac ? '.' + frac : ''}${canonicalSuffix(suffix)}`, ctx.currency)
    if (value === null || value <= 0) continue
    const score = (marked ? 3 : 0) + (suffix ? 2 : 0) + (frac ? 0.5 : 0) + (cue ? 1 : 0)
    candidates.push({ value, score, index: m.index ?? 0 })
  }
  if (!candidates.length) return undefined
  candidates.sort((a, b) => b.score - a.score || a.index - b.index)
  return candidates[0].value
}

/** Han synonyms match as substrings; latin ones on word boundaries with an optional plural. */
const CATEGORY_MATCHERS: { category: CategoryId; re: RegExp; length: number }[] = CATEGORY_SYNONYMS.flatMap(([category, synonyms]) =>
  synonyms.map((syn) => {
    const s = normalizeText(syn)
    const re = isHan(s) ? new RegExp(escapeRe(s)) : new RegExp(`(?<![a-z0-9])${escapeRe(s)}(?:s|es)?(?![a-z0-9])`)
    return { category, re, length: s.length }
  }),
)

export function extractCategory(norm: string): CategoryId | undefined {
  let best: { category: CategoryId; index: number; length: number } | undefined
  for (const { category, re, length } of CATEGORY_MATCHERS) {
    const m = norm.match(re)
    if (!m || m.index === undefined) continue
    if (!best || m.index < best.index || (m.index === best.index && length > best.length)) best = { category, index: m.index, length }
  }
  return best?.category
}

const RELATION_RE = new RegExp(`\\b(?:my|to my|ke)\\s+(${RELATION_WORDS.map(escapeRe).join('|')})\\b`, 'i')
const HAN_RELATION_RE = /(?:我)?(?:妈妈?|爸爸?|朋友|同事|室友|哥哥?|姐姐?|弟弟?|妹妹?|老婆|老公|男朋友|女朋友|家人|父母)/
const PRONOUN_TARGET_RE = /\b(?:send|give|pay|transfer|lend|wire|kirim)\s+(?:her|him|them|someone|somebody|anyone|a friend|a stranger|this person|that person|that guy|this guy)\b|\bto\s+(?:someone|somebody|another person|other people|a stranger|this person|that person|him|her|them|a friend)\b/i
const FOREIGN_ACCOUNT_RE = /\b(?:new|another|other|different|this|that|external|someone else'?s?|their|his|her)\s+(?:bank\s+)?account\b|\baccount (?:of|belonging to)\b/i
const ACCOUNT_RE = /(?:\b(?:account|acct|a\/c|card|iban|rekening|no\.?\s?rek)\b|账户|账号|卡号)\D{0,14}(\d[\d\s-]{2,}\d)/i
const LONG_DIGITS_RE = /\d(?:[\s-]?\d){7,}/
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/
const PHONE_RE = /\+\d[\d\s-]{6,}\d/

export function maskAccount(digits: string): string | undefined {
  const d = digits.replace(/\D/g, '')
  return d.length >= 4 ? `•••• ${d.slice(-4)}` : undefined
}

function extractAccount(display: string): string | undefined {
  const tagged = display.match(ACCOUNT_RE)
  if (tagged) return maskAccount(tagged[1])
  const bare = display.match(LONG_DIGITS_RE)
  return bare ? maskAccount(bare[0]) : undefined
}

/** True when a phrase names something the user owns or pays (goal, bill, subscription, merchant). */
function namesKnownThing(phrase: string, m: Matchers): boolean {
  const q = makeQuery(normalizeText(phrase))
  if (wordsOf(q.norm).some((w) => NON_PERSON.has(w))) return true
  return Boolean(
    matchEntity(m.goals, q, GOAL_CONCEPTS) || matchEntity(m.bills, q, BILL_CONCEPTS) ||
    matchEntity(m.recurring, q, RECURRING_CONCEPTS) || matchEntity(m.merchants, q, RECURRING_CONCEPTS) ||
    conceptHits(q, BILL_CONCEPTS).size > 0,
  )
}

const MONTH_OR_DAY = /^(?:january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|i)$/i

/** The name-like words at the start of a phrase ("zhang wei for dinner" → "zhang wei"). */
function leadingName(phrase: string): string | undefined {
  const words: string[] = []
  for (const w of phrase.split(/\s+/)) {
    if (NON_PERSON.has(w.toLowerCase()) || MONTH_OR_DAY.test(w) || !/^[\p{L}'-]+$/u.test(w) || isHan(w)) break
    words.push(w)
  }
  return words.length ? words.join(' ') : undefined
}

function cleanPersonName(name: string, m: Matchers): string | undefined {
  const words = name.trim().split(/\s+/).filter((w) => !MONTH_OR_DAY.test(w))
  if (!words.length) return undefined
  const joined = words.join(' ')
  return namesKnownThing(joined, m) ? undefined : joined
}

function extractPerson(display: string, m: Matchers): string | undefined {
  const rel = display.match(RELATION_RE)
  if (rel && rel.index !== undefined) {
    const after = display.slice(rel.index + rel[0].length).match(/^(?:'s)?\s+([\p{L}'-]+(?:\s+[\p{L}'-]+){0,2})/u)
    const name = after ? leadingName(after[1]) : undefined
    return name ?? `my ${rel[1].toLowerCase()}`
  }
  const hanTo = display.match(/给\s*([\p{Script=Han}]{2,4}?)\s*(?:转账?|打钱|汇款?|发红包|还)/u) ??
    display.match(/(?:转账?|汇款?|打钱)\s*(?:[\d.,]+\s*[元块]?\s*)?给\s*([\p{Script=Han}]{2,4})/u)
  if (hanTo) return hanTo[1]
  const email = display.match(EMAIL_RE)
  if (email) return email[0]
  const capitalised = display.match(/(?:\bto|\bTo|\bke|\bKe)\s+([A-Z][\p{Ll}'-]+(?:\s+[A-Z][\p{Ll}'-]+){0,2})/u)
  if (capitalised) {
    const name = cleanPersonName(capitalised[1], m)
    if (name) return name
  }
  const verbName = display.match(/\b(?:[Pp]ay|[Ss]end|[Gg]ive|[Ll]end|[Tt]ransfer|[Ww]ire|[Kk]irim)\s+([A-Za-z][\p{L}'-]*(?:\s+[A-Za-z][\p{L}'-]*){0,2}?)\s+(?:back\s+)?(?:¥|\$|rmb\s?)?\d/u)
  if (verbName) return cleanPersonName(verbName[1], m)
  return undefined
}

const LABEL_PATTERNS: RegExp[] = [
  /\b(?:can|could|may|should|shall|would)\s+i\s+(?:really\s+|still\s+|actually\s+)?(?:afford|buy|purchase|get|order|grab|pick up|splurge on|treat myself to)\s+(?:myself\s+)?(?:to\s+)?(.+)$/i,
  /\bis\s+it\s+(?:ok|okay|fine|alright|wise|smart|sensible|a good idea|a bad idea|reasonable)\s+(?:to|if i)\s+(?:buy|get|purchase|order)\s+(.+)$/i,
  /\b(?:is|are)\s+(.+?)\s+(?:affordable|too (?:much|expensive)|worth it)\b/i,
  /\b(?:afford|buying|buy|purchase|worth buying|room for)\s+(.+)$/i,
  /(?:买得起|能买|可以买|该不该买|要不要买|能不能买|值得买|值不值得买)(.+?)(?:吗|么|嘛|呢)?[?？!。]*$/u,
  /^(?:我)?(.+?)(?:买得起吗|能买吗|可以买吗|值得买吗)/u,
  /\b(?:boleh|bisa|mampu|sanggup)\s+(?:beli|membeli)\s+(.+)$/i,
]

const LABEL_TAIL = /\s+(?:for|at|that costs?|costing|which costs?|priced at|worth|seharga|harga|this month|right now|now|today|tonight|this week|rn|pls|please|nggak|gak|ga|ya|dong|or not|be ok|be okay)\b.*$/i
const LABEL_MONEY = /(?:¥|￥|\$|rmb\s?)\d[\d,]*(?:\.\d+)?\s?(?:k|w|万|千)?|\b\d[\d,]*(?:\.\d+)?\s?(?:k|w|万|千)(?![a-z])|\b\d[\d,]{2,}(?:\.\d+)?\s?(?:元|块|yuan|rmb|kuai|bucks?|dollars?)?(?![a-z])|\d[\d,]*(?:\.\d+)?\s?(?:元|块)的?/gi

function cleanLabel(s: string): string {
  return s
    .replace(LABEL_TAIL, '')
    .replace(/\d[\d,]*(?:\.\d+)?\s?(?:元|块)?的/gu, '')
    .replace(LABEL_MONEY, '')
    .replace(/[?？!！。.,，]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const VAGUE_LABEL = /^(?:it|this|that|one|them|something|anything|stuff)$/i

export function extractLabel(display: string): string | undefined {
  for (const re of LABEL_PATTERNS) {
    const m = display.match(re)
    if (!m) continue
    let label = cleanLabel(m[1])
    // "afford 1.5w for a bag": the price came first, the item follows "for"
    const forObject = m[1].match(/\bfor\s+(.+)$/i)
    if (!label && forObject) label = cleanLabel(forObject[1])
    if (!label || VAGUE_LABEL.test(label)) return undefined
    return label.slice(0, 60)
  }
  return undefined
}

function extractDaysBefore(norm: string): number | undefined {
  const m = norm.match(/(\d{1,2})\s*(?:days?|d)\s*(?:before|ahead|prior|early|earlier|in advance)/) ??
    norm.match(/提前\s*(\d{1,2})\s*天/) ?? norm.match(/(\d{1,2})\s*hari\s*sebelum/)
  if (m) return Number(m[1])
  if (/\b(?:a|one|the) day (?:before|ahead|prior|early)/.test(norm)) return 1
  if (/\b(?:a|one) week (?:before|ahead|prior|early)/.test(norm)) return 7
  return undefined
}

const PACE_RE = /\b(?:pace|projected|projection|on track to|heading (?:for|over)|trending|on course to|forecast)\b|照这个速度|预计/

function tripwireKindOf(norm: string, slots: NluSlots): TripwireKind | undefined {
  const perDay = /\b(?:a day|per day|daily|in one day|in a day|each day|every day|one day)\b|一天|每天|单日|\bsehari\b|\bper hari\b|\bharian\b/.test(norm)
  if (slots.percent !== undefined) {
    if (slots.category) return 'category_pct'
    return PACE_RE.test(norm) ? 'pace_over' : 'month_pct'
  }
  if (slots.amount !== undefined) {
    if (perDay) return 'daily_over'
    if (slots.category) return undefined
    return 'single_over'
  }
  if (PACE_RE.test(norm) || /\b(?:overspend|go over|going over)\b/.test(norm)) return 'pace_over'
  return undefined
}

function budgetMethodOf(norm: string): NluSlots['budgetMethod'] {
  if (/50\s*[/-]\s*30\s*[/-]\s*20|fifty[\s-]thirty[\s-]twenty/.test(norm)) return 'fifty_thirty_twenty'
  if (/\bhistory\b|\bpast (?:spending|months?)\b|\busual(?:ly)? spend|\bbased on (?:my|what i)\b|历史|以往|\bkebiasaan\b/.test(norm)) return 'history'
  return undefined
}

// ───────────────────────────── rules ─────────────────────────────

interface Parsed {
  raw: string
  display: string
  norm: string
  ctx: NluContext
  m: Matchers
  category?: CategoryId
  amount?: Minor
  percent?: number
}

interface RuleHit {
  intent: Intent
  rule: string
  confidence: number
  /** xray text, taken verbatim from the raw input */
  text?: string
}

const XRAY_WORD = /\bx[\s-]?ray(?:ed)?\b|\bxray\b|x光/i
const BILL_DOC_WORD = /\b(?:bills?|invoices?|statements?|receipts?|tagihan|struk|nota)\b|账单|发票|缴费单|电费单|收据/i
const REVIEW_VERB = /\b(?:scan|analy[sz]e|check|read|parse|review|inspect|look|explain|cek|baca|periksa)\b|看|分析|检查/i
const BILL_MARKERS: RegExp[] = [
  /\b(?:total|amount due|balance due|due date|payable|subtotal)\b/i, /\bkwh\b|千瓦时|度电/i,
  /\b(?:account (?:no|number)|acct|customer (?:no|id))\b|户号|账号|客户编号/i, /\b(?:billing period|period|statement date)\b|账期|计费周期/i,
  /应缴|应还|金额|截止|缴费|本期/, /\b(?:tagihan|jatuh tempo|pemakaian)\b/i, /\b(?:invoice|statement|bill)\b/i,
  /\b(?:usage|meter|reading|tariff)\b|电表|读数|电价/i,
]

function xrayRule(p: Parsed): RuleHit | null {
  const prefixed = p.raw.match(/^([^:：\n]{0,60})[:：\n]\s*([\s\S]+)$/)
  if (prefixed) {
    const head = normalizeText(prefixed[1])
    if (XRAY_WORD.test(head) || (REVIEW_VERB.test(head) && BILL_DOC_WORD.test(head))) {
      return { intent: 'xray', rule: 'R-XRAY-PASTE', confidence: 0.97, text: prefixed[2].trim() }
    }
  }
  const long = p.raw.length > 120
  if (long) {
    const lines = p.raw.split(/\n/).filter((l) => /\d/.test(l)).length
    const markers = BILL_MARKERS.filter((re) => re.test(p.raw)).length
    if (/\d/.test(p.raw) && (markers >= 2 || lines >= 3)) {
      return { intent: 'xray', rule: 'R-XRAY-LONG-PASTE', confidence: 0.92, text: p.raw.trim() }
    }
  }
  if (XRAY_WORD.test(p.norm)) return { intent: 'xray', rule: 'R-XRAY-WORD', confidence: 0.93 }
  return null
}

const OVERRIDE_RES: RegExp[] = [
  /\b(?:ignore|disregard|forget|override|bypass)\b[^.!?\n]{0,40}\b(?:instructions?|rules?|guidelines?|prompts?|restrictions?|polic(?:y|ies)|safety|safeguards?|guardrails?|programming|limits?|directives?)\b/i,
  /\byou are now\b|\bfrom now on,? you\b|\bpretend (?:to be|you(?:'re| are))\b|\bact as (?:an? )?(?:unrestricted|admin|administrator|developer|root|bank|dan)\b|\broleplay as\b/i,
  /\b(?:jailbreak|dan mode|developer mode|dev mode|god mode|sudo mode|admin mode|system prompt|prompt injection|debug mode)\b/i,
  /(?:^|\n)\s*\[?(?:system|assistant|developer)\]?\s*:/i,
  /<\/?\s*(?:system|untrusted|instructions?)\s*>/i,
  /\bnotice to (?:the )?(?:ai|assistant|agent)\b|\b(?:ai|assistant|agent) (?:must|should|shall) (?:now )?(?:transfer|send|pay|ignore|wire)\b/i,
  /\bi am (?:your|the) (?:developer|admin|administrator|creator|owner)\b|\bi(?:'m| am) from (?:the bank|anthropic|openai|fundbun)\b/i,
  /忽略.{0,8}(?:指令|规则|指示|限制|设定|提示)|无视.{0,6}(?:规则|指令|限制)|你现在是|开发者模式|越狱/,
  /\babaikan\b.{0,20}\b(?:instruksi|aturan|perintah)\b|\blupakan\b.{0,10}\baturan\b/i,
]

const SECRET_RE = /\b(?:pin(?: code| number)?|passcode|passwords?|cvv2?|cvc|security code|otp|one[- ]time (?:code|password)|verification code|2fa code|login|credentials?|kata sandi|sandi)\b/i
const REVEAL_RE = /\b(?:what(?:'s| is| are| was)?|whats|show|tell|give|reveal|read|display|send|list|unmask|remind|forgot|forget|recover|share|print|know|see|lookup|look up|copy|email|text|apa|berapa|kasih|lihat|tunjukkan|kirim|sebutkan)\b/i
const FULL_NUMBER_RE = /\b(?:full|whole|complete|entire|unmasked|real|actual|all)\s+(?:my\s+)?(?:credit\s+|debit\s+|bank\s+)?(?:card|account|id)\s*(?:numbers?|nos?\.?|#|details)?\b|\b(?:my|the|our)\s+(?:credit\s+|debit\s+|bank\s+)?(?:card|account|id)\s+(?:numbers?|nos?\.?|#)\b|\bcard numbers\b|\bunmask(?:ed)?\b|\b(?:id|passport|social security|ssn) (?:number|no)\b|\bnational id\b|\bnomor (?:kartu|rekening)\b/i
const EXFIL_ALWAYS = /\b(?:email|e-mail|export|upload|leak|dump|fax|transmit|exfiltrate)\b|导出|上传|\b(?:ekspor|unggah)\b/i
const EXFIL_SEND = /\b(?:send|forward|share|post|text|whatsapp|wechat|mail|sync|copy)\b|发给|发送|分享|转发|\b(?:kirim|bagikan|teruskan)\b/i
const DATA_NOUN = /\b(?:transactions?|transaction history|data|statements?|history|records?|bank details|account details|details|info|information|spending|receipts?|logs?|audit|csv|spreadsheet|everything|all my)\b|交易|流水|账单|数据|记录|明细|\b(?:transaksi|mutasi|riwayat)\b/i
const THIRD_PARTY = /\bto\b|\bwith\b|\bme\b|\bke\b|给|third[- ]party|someone|accountant|google|dropbox|drive|cloud/i

function sensitiveRule(p: Parsed): RuleHit | null {
  const n = p.norm
  if (OVERRIDE_RES.some((re) => re.test(p.raw) || re.test(n))) return { intent: 'sensitive_request', rule: 'R-OVERRIDE-ATTEMPT', confidence: 0.98 }
  const userSuppliedNumber = LONG_DIGITS_RE.test(n)
  if (SECRET_RE.test(n) && REVEAL_RE.test(n)) return { intent: 'sensitive_request', rule: 'R-SECRET', confidence: 0.97 }
  if (!userSuppliedNumber && FULL_NUMBER_RE.test(n)) return { intent: 'sensitive_request', rule: 'R-FULL-NUMBER', confidence: 0.96 }
  if (DATA_NOUN.test(n) && !/\b(?:money|cash|funds)\b/.test(n) && (EXFIL_ALWAYS.test(n) || (EXFIL_SEND.test(n) && THIRD_PARTY.test(n)) || EMAIL_RE.test(n))) {
    return { intent: 'sensitive_request', rule: 'R-DATA-EXFIL', confidence: 0.96 }
  }
  const zhSecret = /密码|验证码|安全码|cvv|完整(?:的)?(?:卡号|账号|银行卡号)|身份证号?|卡号/.test(n)
  const zhWaive = /(?:不要|不用|别|免|跳过|取消).{0,6}(?:密码|验证)/.test(n)
  if (zhSecret && !zhWaive) return { intent: 'sensitive_request', rule: 'R-SECRET-ZH', confidence: 0.95 }
  return null
}

const INVEST_RE = /\b(?:invest(?:ing|ment|ments|or|ed)?|stocks?|shares|equit(?:y|ies)|etfs?|index funds?|mutual funds?|bonds?|crypto(?:currency|currencies)?|bitcoin|btc|ethereum|eth|dogecoin|doge|solana|nfts?|forex|day trad(?:e|ing)|options trading|portfolio|brokerage|robo[- ]?advis[eo]r)\b|(?:买|投资|定投|申购|推荐)(?:点|些|一点|一些)?基金|股票|炒股|理财|比特币|加密货币|期货|\b(?:saham|reksa ?dana|investasi|obligasi|kripto)\b/i
const CREDIT_RE = /\b(?:loans?|borrow(?:ing)?|lend me|credit cards?|credit lines?|line of credit|credit limit|cash advance|payday|overdraft|bnpl|buy now,? pay later|pay later|installments?|instalments?|financing|finance (?:this|it|the)|mortgage|apply for credit|get credit)\b|贷款|借钱|借款|花呗|借呗|白条|信用卡|分期|\b(?:pinjaman|pinjol|kredit|paylater|cicilan|utang)\b/i
const PAY_START_RE = /^(?:(?:please|pls|plz|kindly|can you|could you|would you|will you|go ahead and|help me|帮我|请)[\s,]*)*(?:pay|settle|bayar|还(?:钱|款|信用卡|花呗)|交)/

const CARD_BILL_RE = /\b(?:credit )?card (?:bill|statement|payment|repayment|due)\b|信用卡账单|还信用卡|\btagihan kartu kredit\b/

function investCreditRule(p: Parsed): RuleHit | null {
  if (INVEST_RE.test(p.norm)) return { intent: 'invest', rule: 'R-INVEST', confidence: 0.94 }
  if (CREDIT_RE.test(p.norm) && !PAY_START_RE.test(p.norm) && !CARD_BILL_RE.test(p.norm)) return { intent: 'credit', rule: 'R-CREDIT', confidence: 0.94 }
  return null
}

const PERMISSION_RES: RegExp[] = [
  /\bauto[\s-]?pilot\b|\bfull[\s-]auto(?:nomy|matic)?\b|\bautonomy\b|\bmandate\b|自动驾驶|全自动|自动模式/i,
  /\b(?:your|its|the agent'?s|agent'?s?|bun'?s)\s+(?:\w+\s+){0,2}(?:limits?|caps?|permissions?|access|powers?|rights)\b/i,
  /\b(?:raise|increase|up|bump|lift|double|triple|remove|disable|drop|max out|boost|unlock|change|set|expand|extend|loosen)\b[^.?!]{0,30}\b(?:daily|per[- ]?action|transfer|payment|agent)\s+(?:transfer\s+|spending\s+|payment\s+)?(?:limits?|caps?)\b/i,
  /\b(?:give|grant|allow|let)\s+(?:yourself|you|bun|the agent|it)\b[^.?!]{0,30}\b(?:permissions?|access|power|control|rights|admin|freely|more)\b/i,
  /\b(?:admin|root|full|unlimited|unrestricted)\s+(?:access|rights|control|permissions?)\b/i,
  /\b(?:unfreeze|unpause|reactivate)\b|\b(?:unlock|resume)\s+(?:yourself|the agent|bun)\b/i,
  /\b(?:freeze|pause|disable|stop)\s+(?:yourself|the agent|bun)\b|\bkill[\s-]?switch\b/i,
  /\b(?:don'?t|do not|no need to|stop|never)\s+(?:ask(?:ing)?|requir(?:e|ing)|need(?:ing)?|check(?:ing)?)\s+(?:me\s+)?(?:for\s+)?(?:my\s+|a\s+|the\s+)?(?:confirmation|permission|approval|pin|consent|verification)\b/i,
  /\bwithout\s+(?:asking|confirm(?:ing|ation)?|approval|my (?:pin|approval|permission|ok)|a pin|pin|permission|checking with me)\b/i,
  /\b(?:skip|bypass|disable|turn off|switch off|remove|drop)\s+(?:the\s+|my\s+|all\s+)?(?:pin|confirmations?|approvals?|verifications?|step[- ]up|safety checks?)\b/i,
  /\byou don'?t need (?:my )?(?:approval|permission|confirmation|pin)\b/i,
  /\b(?:switch|change|set|move|put|upgrade)\s+(?:yourself\s+|you\s+|bun\s+|the agent\s+|your mode\s+|mode\s+|autonomy\s+)?(?:to|into|in)\s+(?:copilot|full auto|auto mode|suggest mode|observe mode)\b/i,
  /(?:提高|提升|增加|调高|放开|取消|解除|去掉).{0,6}(?:限额|额度|权限|上限|限制)|(?:限额|额度|上限)(?:提高|提升|增加|调高|改成|设为)|(?:不要|不用|别|免|跳过|取消).{0,6}(?:密码|验证|确认)|给你自己.{0,6}权限/,
  /\b(?:naikkan|tambah|hapus|matikan|nonaktifkan|lewati)\b.{0,20}\b(?:limit|batas|konfirmasi|pin|izin|verifikasi)\b|\bmode\s+(?:autopilot|otomatis)\b/i,
]

function permissionRule(p: Parsed): RuleHit | null {
  // "lower my coffee limit" is a category budget, not the agent's mandate
  if (p.category && /\b(?:limit|cap|budget)\b|预算|上限|\bbatas\b/.test(p.norm) && !/\b(?:your|agent|bun'?s)\b/.test(p.norm)) return null
  if (PERMISSION_RES.some((re) => re.test(p.norm))) return { intent: 'change_permissions', rule: 'R-PERMISSIONS', confidence: 0.96 }
  return null
}

const PAYEE_RE = /\b(?:add|create|register|save|set ?up|new|make|verify|whitelist|trust|link)\b[^.?!]{0,40}\b(?:payees?|recipients?|beneficiar(?:y|ies)|contact i can pay)\b|\bwhitelist\b|\btrust (?:this|a|the|my)?\s*(?:new )?account\b|\b(?:add|link)\b[^.?!]{0,30}\bnew (?:bank )?account\b|\badd account\b|添加收款人|新增.{0,4}收款|添加.{0,4}收款账户|\b(?:tambah(?:kan)?|daftarkan)\b.{0,15}\b(?:penerima|rekening)\b/i

function payeeRule(p: Parsed): RuleHit | null {
  return PAYEE_RE.test(p.norm) ? { intent: 'add_payee', rule: 'R-ADD-PAYEE', confidence: 0.95 } : null
}

const LEAD_IN = '(?:(?:please|pls|plz|kindly|can you|could you|would you|will you|can u|could u|can i|could i|may i|bun|hey bun|ok|okay|now|also|and|then|just|go ahead and|help me|i want to|i wanna|i\'d like to|i would like to|i need to|let\'s|lets|let us|i want you to|tolong|bantu|帮我|请|麻烦你?)[\\s,]*)*'
const MOVE_VERBS = 'transfer|send|wire|remit|e-?transfer|pay|give|lend|move|put|save|stash|add|deposit|top up|top-up|chuck|throw|park|feed|kirim|bayar|kasih|tabung|simpan|masukkan|pindahkan'
const IMPERATIVE_MOVE_RE = new RegExp(`^${LEAD_IN}(?:(?:${MOVE_VERBS})\\b|存|放|转|往)`)
const TRANSFER_VERB_RE = /\b(?:transfer|send|wire|remit|e-?transfer|pay|give|lend|move|venmo|zelle|paypal|kirim|bayar|kasih|pinjamkan)\b|转账|转钱|打钱|汇款|汇钱|转给|借给|打给|发红包|转\s*\d/
const SEND_MONEY_RE = /\b(?:send|transfer|wire|remit|e-?transfer|kirim)\b[^.?!]{0,20}\b(?:money|cash|funds?|uang|duit)\b|汇款|打钱|转钱|转账/
const OWN_DEST_RE = /\b(?:pots?|savings?|goals?|funds?|jars?|piggy ?bank|stash|dreams?|my (?:own )?account|own account|checking|tabungan|celengan)\b|储蓄|存钱罐|目标|小金库|基金/
const WITHDRAW_VERB_RE = /\b(?:withdraw|take|pull|move|get|transfer|grab|cash out|unstash|empty|dip into|break|ambil|tarik|pindahkan)\b|取出|拿出|转出|取钱|提取/
const BILL_WORD_RE = /\b(?:bills?|invoices?|rent|utilit(?:y|ies)|electricity|electric|power|water|phone|mobile|broadband|internet|wifi|gas|tagihan|listrik)\b|电费|话费|水费|房租|账单|网费|宽带|燃气费/

function destinationOf(norm: string): string | undefined {
  const m = norm.match(/\b(?:to|into|in|towards?|for|ke|untuk)\s+(.{1,60}?)(?=\s+(?:with|and|by|on|now|today|please|pls)\b|[,.!?]|$)/) ?? norm.match(/(?:到|进|给)\s*(.{1,20})$/u)
  return m?.[1]
}

function sourcePot(norm: string, m: Matchers): boolean {
  const src = norm.match(/\b(?:from|out of|back from|dari)\s+(?:my\s+|the\s+)?(.{1,40}?)(?=\s+(?:to|into|back|and|for|ke)\b|[,.!?]|$)/)
  const zh = norm.match(/从\s*(.{1,12}?)(?:里|中)?\s*(?:取|拿|转出|提)/u) ?? norm.match(/把\s*(.{1,12}?)的钱\s*(?:拿|取)出/u)
  const phrase = src?.[1] ?? zh?.[1]
  if (!phrase || /\bchecking\b|\bmy account\b/.test(phrase)) return false
  return OWN_DEST_RE.test(phrase) || Boolean(matchEntity(m.goals, makeQuery(phrase), GOAL_CONCEPTS))
}

function isOwnDestination(dest: string, m: Matchers): boolean {
  if (FOREIGN_ACCOUNT_RE.test(dest)) return false
  return OWN_DEST_RE.test(dest) || Boolean(matchEntity(m.goals, makeQuery(dest), GOAL_CONCEPTS))
}

/** Signals that money would leave the user's own accounts no matter what else the message says. */
function hasHardExternalSignal(p: Parsed): boolean {
  const { norm, display } = p
  if (LONG_DIGITS_RE.test(norm) || EMAIL_RE.test(norm) || PHONE_RE.test(norm)) return true
  if (ACCOUNT_RE.test(display) && /\d{4}/.test(display)) return true
  return FOREIGN_ACCOUNT_RE.test(norm) || PRONOUN_TARGET_RE.test(norm)
}

function hasExternalSignal(p: Parsed): boolean {
  if (hasHardExternalSignal(p)) return true
  const { norm, display } = p
  const rel = norm.match(RELATION_RE)
  if (rel && !/landlord/.test(rel[1])) return true
  if (/给\s*[\p{Script=Han}]{2,4}?\s*(?:转|打钱|汇)|转账?\s*\d*\s*[元块]?\s*给|借给/u.test(norm)) return true
  if (HAN_RELATION_RE.test(norm) && /转|汇|打钱/.test(norm)) return true
  return Boolean(extractPerson(display, p.m))
}

const HISTORY_QUESTION_RE = /^(?:how (?:much|many|often)|when did|what did|did i|have i|show(?: me)?|list|find|search)\b.*\b(?:did|sent|gave|paid|transferred|moved|lent|spent|spend|have|has)\b|^(?:show|list|find|search)\b/

function moneyMoveRule(p: Parsed): RuleHit | null {
  const n = p.norm
  const imperative = IMPERATIVE_MOVE_RE.test(n)
  const transferish = TRANSFER_VERB_RE.test(n)
  const payish = PAY_START_RE.test(n) || /^(?:schedule|帮我交|交|付|缴)/.test(n)
  if (!imperative && !transferish && !payish && !WITHDRAW_VERB_RE.test(n) && !/\bback from\b/.test(n)) return null
  if (transferish && hasHardExternalSignal(p)) return { intent: 'external_transfer', rule: 'R-EXTERNAL-TRANSFER', confidence: 0.96 }
  // "how much did I give my mom last month" asks about history; the classifier answers it
  if (HISTORY_QUESTION_RE.test(n)) return null
  if ((WITHDRAW_VERB_RE.test(n) || /\bback from\b/.test(n)) && sourcePot(n, p.m)) {
    return { intent: 'withdraw_goal', rule: 'R-WITHDRAW-GOAL', confidence: 0.92 }
  }
  const dest = destinationOf(n)
  const ownDest = dest !== undefined && isOwnDestination(dest, p.m)
  if (transferish && !ownDest && hasExternalSignal(p)) {
    return { intent: 'external_transfer', rule: 'R-EXTERNAL-TRANSFER', confidence: 0.96 }
  }
  if (imperative && (ownDest || (!dest && OWN_DEST_RE.test(n)))) {
    return { intent: 'save_to_goal', rule: 'R-SAVE-TO-GOAL', confidence: 0.92 }
  }
  if (payish) {
    if (matchEntity(p.m.bills, p.m.q, BILL_CONCEPTS) || BILL_WORD_RE.test(n)) return { intent: 'pay_bill', rule: 'R-PAY-BILL', confidence: 0.92 }
  }
  if (SEND_MONEY_RE.test(n) && !ownDest) return { intent: 'external_transfer', rule: 'R-SEND-MONEY', confidence: 0.94 }
  if (/\b(?:send|transfer|wire|remit|e-?transfer|kirim)\b/.test(n) && dest && !ownDest && (p.amount !== undefined || /\bmoney|cash|funds?\b/.test(n))) {
    return { intent: 'external_transfer', rule: 'R-SEND-ELSEWHERE', confidence: 0.92 }
  }
  return null
}

const AFFORD_RE = /\b(?:can|could|may|should|shall|would)\s+i\s+(?:really\s+|still\s+|actually\s+)?(?:afford|buy|purchase|splurge|treat myself)\b|\bafford(?:able)?\b|\bis it (?:ok|okay|fine|alright|wise|smart|sensible|a good idea|a bad idea|reasonable)\s+(?:to|if i)\s+(?:buy|get|purchase|order|spend)\b|\b(?:worth buying|room for an?)\b|\bshould i (?:get|order)\b|\bfit (?:in(?:to)? )?my budget\b|\bbudget handle\b|买得起|能买|可以买|该不该买|要不要买|能不能买|值得买|值不值得买|\b(?:boleh|bisa|mampu|sanggup)\s+(?:beli|membeli)\b/i

function affordRule(p: Parsed): RuleHit | null {
  if (/^(?:when|how long|how soon|by when)\b|什么时候|\bkapan\b/.test(p.norm)) return null
  return AFFORD_RE.test(p.norm) ? { intent: 'afford', rule: 'R-AFFORD', confidence: 0.92 } : null
}

const CANCEL_RE = /\b(?:cancel|unsubscribe|unsub|stop|end|terminate|kill|drop|get rid of|quit|berhenti|batalkan)\b|取消|退订|停掉|关闭自动续费/i
const SUB_WORD_RE = /\b(?:subscriptions?|subs?|memberships?|vip|(?:data|phone|gym|vip|family|premium) plan|auto[- ]?renew(?:al)?|streaming|langganan)\b|会员|订阅|自动续费|包月/

function cancelRule(p: Parsed): RuleHit | null {
  if (!CANCEL_RE.test(p.norm)) return null
  const known = matchEntity(p.m.recurring, p.m.q, RECURRING_CONCEPTS)
  return known || SUB_WORD_RE.test(p.norm) ? { intent: 'cancel_sub', rule: 'R-CANCEL-SUB', confidence: 0.93 } : null
}

const DISPUTE_RE = /\b(?:dispute|chargeback|charge back|contest|refund|money back|claim back|fraudulent|fraud|unauthori[sz]ed|never authori[sz]ed|didn'?t (?:make|authori[sz]e)|not mine|isn'?t mine|wasn'?t me|report (?:this|that|the|a) (?:charge|transaction|payment))\b|申诉|退款|争议|盗刷|不是我(?:买|付)的|\b(?:komplain|sanggah(?:an)?)\b/i

function disputeRule(p: Parsed): RuleHit | null {
  return DISPUTE_RE.test(p.norm) ? { intent: 'dispute', rule: 'R-DISPUTE', confidence: 0.92 } : null
}

const REMIND_RE = /\b(?:remind|reminder|reminders|alert|notify|ping|heads[- ]up)\b|提醒|\b(?:ingatkan|pengingat)\b/i
const THRESHOLD_WORD_RE = /\b(?:over|above|exceed|exceeds|pass|passes|hit|hits|reach|reaches|go over|close to|near|limit|budget|target|pace|projected|overspend|more than|spend|spending|purchase|purchases)\b|超过|超支|花|\blebih dari\b|\bbelanja\b|\bbudget\b/
const TRIPWIRE_RE = /\btripwires?\b|\b(?:alert|warn|notify|ping|buzz|nudge|remind)\s+me\b|\blet me know\b|\btell me (?:when|once|whenever|as soon as)\b|\b(?:set|create|add|make)\s+(?:up\s+)?(?:an?\s+)?(?:spending\s+)?(?:alert|alarm|warning|notification|threshold)s?\b|\bspending alerts?\b|提醒我|预警|\b(?:ingatkan|kabari|kasih tahu)\b/i

function reminderTripwireRule(p: Parsed): RuleHit | null {
  const n = p.norm
  const billish = Boolean(matchEntity(p.m.bills, p.m.q, BILL_CONCEPTS)) || BILL_WORD_RE.test(n) || /\bdue\b|到期|jatuh tempo/.test(n)
  if (REMIND_RE.test(n) && billish && p.percent === undefined && !/\bspend|spending\b|花/.test(n)) {
    return { intent: 'bills', rule: 'R-BILL-REMINDER', confidence: 0.9 }
  }
  if (TRIPWIRE_RE.test(n) && (/\btripwire/.test(n) || p.percent !== undefined || p.amount !== undefined || THRESHOLD_WORD_RE.test(n))) {
    return { intent: 'tripwire', rule: 'R-TRIPWIRE', confidence: 0.92 }
  }
  return null
}

const BUDGET_WORD_RE = /\b(?:budget|limit|cap|max(?:imum)?|at most|no more than|only allow|allowance)\b|预算|上限|最多|\b(?:batas|anggaran)\b/i
const SET_VERB_RE = /\b(?:set|change|make|cap|limit|lower|raise|increase|reduce|cut|adjust|update|bump|drop|allow|keep)\b|设为|设置|改成|改为|调到|\b(?:atur|ubah|batas)\b/

function budgetRule(p: Parsed): RuleHit | null {
  const n = p.norm
  if (p.category && BUDGET_WORD_RE.test(n) && (p.amount !== undefined || SET_VERB_RE.test(n))) {
    return { intent: 'set_budget', rule: 'R-SET-BUDGET', confidence: 0.92 }
  }
  if (budgetMethodOf(n) === 'fifty_thirty_twenty') return { intent: 'budget_plan', rule: 'R-BUDGET-PLAN', confidence: 0.93 }
  const planAsk = /\b(?:make|create|build|plan|generate|draft|set up|redo|rebuild|suggest|design)\b.{0,20}\b(?:budget|budget plan|spending plan|monthly plan|money plan)\b/.test(n) ||
    /(?:做|制定|规划|生成|设计|定)(?:一下|一个|个)?(?:月度|每月)?预算|预算(?:方案|计划)/.test(n) || /\b(?:bikin|buat|buatkan|susun|rancang)\b.{0,12}\b(?:anggaran|budget)\b/.test(n)
  if (!p.category && p.amount === undefined && planAsk) {
    return { intent: 'budget_plan', rule: 'R-BUDGET-PLAN', confidence: 0.9 }
  }
  return null
}

const GREETING_RE = /^(?:hi+|hello+|hey+|heya|hiya|yo|sup|howdy|hola|good (?:morning|afternoon|evening|day)|morning|evening|你好|您好|嗨|哈喽|早上好|早|晚上好|halo|hai|selamat (?:pagi|siang|sore|malam))(?:\s+(?:bun|fundbun|there|again|all))?[\s!.,~]*$/
const THANKS_RE = /^(?:thanks?(?: you)?|thank u|thx|ty|tysm|cheers|ta|many thanks|谢谢|谢啦|多谢|感谢|terima ?kasih|makasih|thanks a lot|much appreciated|appreciated|appreciate it)(?:\s+(?:so much|a lot|bun|fundbun|heaps|again|ya|banyak|你))*[\s!.,~]*$/

function smallTalkRule(p: Parsed): RuleHit | null {
  if (GREETING_RE.test(p.norm)) return { intent: 'greeting', rule: 'R-GREETING', confidence: 0.97 }
  if (THANKS_RE.test(p.norm)) return { intent: 'thanks', rule: 'R-THANKS', confidence: 0.97 }
  return null
}

/** Ordered: untrusted pasted bills first, then every refusal, then specific actions. */
const RULES: ((p: Parsed) => RuleHit | null)[] = [
  xrayRule,
  sensitiveRule,
  investCreditRule,
  permissionRule,
  payeeRule,
  moneyMoveRule,
  affordRule,
  cancelRule,
  disputeRule,
  reminderTripwireRule,
  budgetRule,
  smallTalkRule,
]

// ───────────────────────────── understand ─────────────────────────────

function buildParsed(text: string, ctx: NluContext): Parsed {
  const raw = text.slice(0, MAX_INPUT)
  const norm = normalizeText(raw)
  const m = matchersFor(ctx, makeQuery(norm))
  return {
    raw,
    display: displayText(raw),
    norm,
    ctx,
    m,
    category: extractCategory(norm),
    amount: extractAmount(norm, ctx),
    percent: extractPercent(norm),
  }
}

function slotsFor(intent: Intent, p: Parsed, hit: RuleHit | null): NluSlots {
  if (intent === 'xray' && hit?.text) return { text: hit.text.slice(0, MAX_INPUT) }
  const { norm, display, ctx, m } = p
  const slots: NluSlots = {}
  if (p.amount !== undefined) slots.amount = p.amount
  if (p.percent !== undefined) slots.percent = p.percent
  if (p.category) slots.category = p.category
  const month = extractMonth(norm, ctx.today)
  if (month) slots.month = month
  const merchant = matchEntity(m.merchants, m.q, RECURRING_CONCEPTS)
  if (merchant && merchant.score >= 0.75) slots.merchant = merchant.id
  const goal = matchEntity(m.goals, m.q, GOAL_CONCEPTS)
  if (goal) slots.goalId = goal.id
  const bill = matchEntity(m.bills, m.q, BILL_CONCEPTS)
  if (bill) slots.billId = bill.id
  const recurring = matchEntity(m.recurring, m.q, RECURRING_CONCEPTS)
  if (recurring) slots.recurringId = recurring.id
  if (intent === 'afford') {
    const label = extractLabel(display)
    if (label) slots.label = label
  }
  if (intent === 'external_transfer' || intent === 'add_payee') {
    const person = extractPerson(display, m) ?? fallbackPerson(norm, m)
    if (person) slots.person = person
    const account = extractAccount(display)
    if (account) slots.account = account
  }
  if (intent === 'tripwire') {
    const kind = tripwireKindOf(norm, slots)
    if (kind) slots.tripwireKind = kind
  }
  if (intent === 'bills' && REMIND_RE.test(norm)) {
    slots.reminder = true
    const days = extractDaysBefore(norm)
    if (days !== undefined) slots.daysBefore = days
  }
  if (intent === 'budget_plan') {
    const method = budgetMethodOf(norm)
    if (method) slots.budgetMethod = method
  }
  return slots
}

/** "transfer money to zhang wei" — a lowercase destination that is not anything the user owns. */
function fallbackPerson(norm: string, m: Matchers): string | undefined {
  const dest = destinationOf(norm)
  if (!dest || isOwnDestination(dest, m) || FOREIGN_ACCOUNT_RE.test(dest) || /\d{4}/.test(dest)) return undefined
  const words = dest.replace(/^(?:my|the|a|an)\s+/, '').split(/\s+/).filter((w) => /^[\p{L}'-]+$/u.test(w)).slice(0, 3)
  const name = words.join(' ')
  return name && !namesKnownThing(name, m) ? name : undefined
}

const MONEY_INTENTS: Intent[] = ['save_to_goal', 'withdraw_goal', 'pay_bill']

/** A wh-question is asking for information: an action intent from the classifier becomes its read-only twin. */
const READ_TWIN: Partial<Record<Intent, Intent>> = {
  save_to_goal: 'goals',
  withdraw_goal: 'goals',
  pay_bill: 'bills',
  cancel_sub: 'subscriptions',
  dispute: 'bills',
  set_budget: 'breakdown',
  budget_plan: 'breakdown',
  tripwire: 'overview',
}
const WH_QUESTION_RE = /^(?:how|what|whats|when|why|where|which|who|is|are|does|did|has|have)\b|^(?:多少|什么时候|怎么|为什么|哪)|\b(?:berapa|kapan|gimana|bagaimana)\b/

/** Classifier result adjusted by context the bag-of-words model cannot see. */
function adjustClassified(intent: Intent, p: Parsed): Intent {
  if (intent === 'breakdown' && !p.category && matchEntity(p.m.merchants, p.m.q, RECURRING_CONCEPTS)) return 'search'
  if (MONEY_INTENTS.includes(intent) && TRANSFER_VERB_RE.test(p.norm) && hasExternalSignal(p)) return 'external_transfer'
  const twin = READ_TWIN[intent]
  if (twin && WH_QUESTION_RE.test(p.norm)) return twin
  return intent
}

function alternativesOf(scores: IntentScore[], chosen: Intent): NluResult['alternatives'] {
  return scores
    .filter((s) => s.intent !== chosen && s.intent !== 'unknown')
    .slice(0, 3)
    .map((s) => ({ intent: s.intent, confidence: s.confidence }))
}

export function understand(text: string, ctx: NluContext): NluResult {
  const p = buildParsed(text ?? '', ctx)
  if (!/[\p{L}\p{N}]/u.test(p.norm)) return { intent: 'unknown', confidence: 1, slots: {}, alternatives: [] }
  const table = ctxTermTable(p.m)
  const scores = classifyWith(p.norm, table)
  for (const rule of RULES) {
    const hit = rule(p)
    if (!hit) continue
    const own = scores.find((s) => s.intent === hit.intent)?.confidence ?? 0
    return {
      intent: hit.intent,
      confidence: round2(Math.max(hit.confidence, own)),
      slots: slotsFor(hit.intent, p, hit),
      alternatives: alternativesOf(scores, hit.intent),
      rule: hit.rule,
    }
  }
  const top = scores[0]
  const lowEvidence = top && top.confidence < VOCABULARY_GATE && !hasDomainContent(p.norm, table)
  if (!top || top.intent === 'unknown' || top.confidence < UNKNOWN_THRESHOLD || lowEvidence) {
    const known = scores.find((s) => s.intent !== 'unknown')
    const confidence = round2(1 - (known?.confidence ?? 0))
    return { intent: 'unknown', confidence, slots: slotsFor('unknown', p, null), alternatives: alternativesOf(scores, 'unknown') }
  }
  const intent = adjustClassified(top.intent, p)
  return { intent, confidence: top.confidence, slots: slotsFor(intent, p, null), alternatives: alternativesOf(scores, intent) }
}
