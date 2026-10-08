import { ChevronDown, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { fmt } from '../../../core/money'
import type { CategoryId, Currency, Insight, MonthHistoryPoint, MonthSummary, YearMonth } from '../../../core/types'
import { BarChart, Button, Card, Donut, EmptyState, SectionHeader, cx } from '../../components/ds'
import { InsightCard } from './InsightCard'
import { categoryRows, featuredInsight, guideStatus, monthName, split, splitSlices, trendBars } from './model'
import { TrendChart } from './TrendChart'
import styles from './panels.module.css'

const SHOW_INSIGHTS = 3
const SHOW_CATEGORIES = 6

// ───────────────────────────── insights ─────────────────────────────

interface InsightListProps {
  insights: Insight[]
  month: YearMonth
  currency: Currency
  actionable: boolean
  onAsk: (text: string) => void
}

function InsightList({ insights, month, currency, actionable, onAsk }: InsightListProps) {
  const [all, setAll] = useState(false)
  const { featured, rest } = featuredInsight(insights)
  const visible = all ? rest : rest.slice(0, SHOW_INSIGHTS - 1)
  const hidden = rest.length - visible.length
  return (
    <section className={styles.section} aria-labelledby="ins-noticed">
      <SectionHeader
        id="ins-noticed"
        eyebrow={`${insights.length} ${insights.length === 1 ? 'thing' : 'things'} in ${monthName(month)}`}
        title="What Bun noticed"
      />
      {featured ? (
        <div className={styles.cards}>
          <InsightCard insight={featured} month={month} currency={currency} featured actionable={actionable} onAsk={onAsk} />
          {visible.map((i, n) => (
            <InsightCard key={i.id} insight={i} month={month} currency={currency} actionable={actionable} onAsk={onAsk} index={n + 1} />
          ))}
          {hidden > 0 || all ? (
            <Button variant="ghost" size="sm" className={styles.more} iconEnd={<ChevronDown className={cx(all && styles.flip)} />} aria-expanded={all} onClick={() => setAll((a) => !a)}>
              {all ? 'Show fewer' : `${hidden} more ${hidden === 1 ? 'insight' : 'insights'}`}
            </Button>
          ) : null}
        </div>
      ) : (
        <Card>
          <EmptyState compact mood="sleepy" title={`A quiet ${monthName(month)}`} body="Nothing stood out enough to flag. Bun will keep an eye out." />
        </Card>
      )}
    </section>
  )
}

// ───────────────────────────── categories ─────────────────────────────

interface CategorySectionProps {
  s: MonthSummary
  currency: Currency
  onOpen: (category: CategoryId) => void
}

function CategorySection({ s, currency, onOpen }: CategorySectionProps) {
  const [all, setAll] = useState(false)
  const rows = categoryRows(s)
  const shown = all ? rows : rows.slice(0, SHOW_CATEGORIES)
  const limited = rows.filter((r) => r.limit !== undefined)
  const over = limited.filter((r) => r.spent > (r.limit ?? 0))
  // one scale for every row, shown or folded, so expanding never rescales the bars
  const max = Math.max(1, ...rows.map((r) => Math.max(r.spent, r.limit ?? 0)))
  return (
    <section className={styles.section} aria-labelledby="ins-cats">
      <SectionHeader id="ins-cats" eyebrow="Spent vs your limits" title="Where it went" />
      <Card padding="lg" className={styles.chartCard}>
        {rows.length ? (
          <>
            <p className={styles.chartLead}>
              {limited.length === 0 ? (
                <>
                  <Info aria-hidden="true" className={styles.leadIconInfo} />
                  <span>No limits were set for {monthName(s.month)}, so these bars show spending only. Tap a category to set one.</span>
                </>
              ) : over.length ? (
                <>
                  <TriangleAlert aria-hidden="true" className={styles.leadIconOver} />
                  <span>
                    <strong>{over.length} of {limited.length}</strong> limits passed. Tap a category to see why or adjust it.
                  </span>
                </>
              ) : (
                <>
                  <CircleCheck aria-hidden="true" className={styles.leadIconUnder} />
                  <span>Every limit held{s.isCurrent ? ' so far' : ''}. Tap a category to look closer.</span>
                </>
              )}
            </p>
            <BarChart
              label={`${monthName(s.month)} spending by category`}
              currency={currency}
              max={max}
              onSelect={(id) => onOpen(id as CategoryId)}
              data={shown.map((r) => ({ id: r.id, label: r.label, value: r.spent, ...(r.limit !== undefined ? { limit: r.limit } : {}), icon: r.emoji }))}
            />
            <div className={styles.chartFoot}>
              <span className={styles.total}>
                Total <strong>{fmt(s.spent, currency)}</strong>
              </span>
              {rows.length > SHOW_CATEGORIES ? (
                <Button variant="ghost" size="sm" iconEnd={<ChevronDown className={cx(all && styles.flip)} />} aria-expanded={all} onClick={() => setAll((a) => !a)}>
                  {all ? 'Fewer' : `All ${rows.length}`}
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <EmptyState compact mood="sleepy" title="No spending yet" body={`Nothing has gone out in ${monthName(s.month)}.`} />
        )}
      </Card>
    </section>
  )
}

// ───────────────────────────── trend ─────────────────────────────

interface TrendSectionProps {
  history: MonthHistoryPoint[]
  current: MonthSummary | null
  selected: YearMonth
  currency: Currency
  onSelect: (m: YearMonth) => void
}

function TrendSection({ history, current, selected, currency, onSelect }: TrendSectionProps) {
  const bars = trendBars(history, current)
  if (bars.length < 2) return null
  return (
    <section className={styles.section} aria-labelledby="ins-trend">
      <SectionHeader id="ins-trend" eyebrow={`Last ${bars.length} months`} title="Spent vs target" />
      <Card padding="lg" className={styles.chartCard}>
        <TrendChart bars={bars} selected={selected} currency={currency} onSelect={onSelect} />
      </Card>
    </section>
  )
}

// ───────────────────────────── needs / wants / saved ─────────────────────────────

const GUIDE_SIGN: Record<string, string> = { needs: '≤', wants: '≤', saved: '≥' }

function SplitSection({ s, currency }: { s: MonthSummary; currency: Currency }) {
  const sp = split(s, currency)
  if (sp.income <= 0 && sp.needs + sp.wants + sp.saved === 0) return null
  const slices = splitSlices(sp, s.isCurrent)
  const saved = slices.find((x) => x.id === 'saved')
  const guided = slices.filter((x) => x.guide !== undefined)
  const rest = slices.find((x) => x.id === 'unspent')
  return (
    <section className={styles.section} aria-labelledby="ins-split">
      <SectionHeader id="ins-split" eyebrow={sp.income > 0 ? `Shares of your ${fmt(sp.income, currency)} income` : 'This month'} title="Needs, wants & saved" />
      <Card padding="lg" className={styles.chartCard}>
        <div className={styles.splitTop}>
          <Donut
            label={`${monthName(s.month)}: needs, wants and savings as shares of income`}
            currency={currency}
            size={132}
            thickness={16}
            legend={false}
            data={slices.map((x) => ({ id: x.id, label: x.label, value: x.value, color: x.color }))}
          >
            <span className={styles.donutBig}>{saved?.pct ?? 0}%</span>
            <span className={styles.donutSmall}>saved</span>
          </Donut>
          {sp.takeaway ? <p className={styles.takeaway}>{sp.takeaway}</p> : null}
        </div>
        {sp.income > 0 ? (
          <>
            <dl className={styles.guide}>
              {guided.map((x) => {
                const st = guideStatus(x)
                return (
                  <div key={x.id} className={cx(styles.guideCell, st === 'over' && styles.guideOver, st === 'under' && styles.guideShort)}>
                    <dt>
                      <span className={styles.guideSwatch} style={{ background: x.color }} aria-hidden="true" />
                      {x.label}
                    </dt>
                    <dd className={styles.guideValue}>{x.pct}%</dd>
                    <dd className={styles.guideAmount}>{fmt(Math.round(x.value / 100) * 100, currency)}</dd>
                    <dd className={styles.guideNote}>
                      {st === 'ok' ? <CircleCheck aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
                      <span className="sr-only">{st === 'ok' ? 'within' : st === 'over' ? 'above' : 'below'} the guide of </span>
                      {GUIDE_SIGN[x.id]}
                      {x.guide}%
                    </dd>
                  </div>
                )
              })}
            </dl>
            <p className={styles.footnote}>
              {rest ? `${fmt(Math.round(rest.value / 100) * 100, currency)} (${rest.pct}%) ${s.isCurrent ? 'not spent yet' : 'left over'}. ` : ''}
              {'Guide: 50/30/20 — needs\u00a0≤\u00a050%, wants\u00a0≤\u00a030%, saved\u00a0≥\u00a020% of income.'}
            </p>
          </>
        ) : null}
      </Card>
    </section>
  )
}

// ───────────────────────────── panel ─────────────────────────────

export interface OverviewPanelProps {
  s: MonthSummary
  insights: Insight[]
  history: MonthHistoryPoint[]
  current: MonthSummary | null
  currency: Currency
  onAsk: (text: string) => void
  onOpenCategory: (category: CategoryId) => void
  onSelectMonth: (m: YearMonth) => void
}

export function OverviewPanel({ s, insights, history, current, currency, onAsk, onOpenCategory, onSelectMonth }: OverviewPanelProps) {
  return (
    <div className={styles.panel}>
      <InsightList insights={insights} month={s.month} currency={currency} actionable={s.isCurrent} onAsk={onAsk} />
      <CategorySection s={s} currency={currency} onOpen={onOpenCategory} />
      <TrendSection history={history} current={current} selected={s.month} currency={currency} onSelect={onSelectMonth} />
      <SplitSection s={s} currency={currency} />
    </div>
  )
}
