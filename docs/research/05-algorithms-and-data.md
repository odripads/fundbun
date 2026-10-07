# 05: Finance-engine algorithms and sandbox data

*Researched 2026-10-08 for FundBun (Shenzhen FinTechathon 2026, Topic A). [n] refers to the Sources list. **ASSUMPTION** marks a figure I could not verify, and **Design choice** marks a FundBun parameter rather than a sourced fact.*

## Key takeaways for FundBun

1. **Copy Plaid's model for recurring transactions.** It has six frequency labels and three states: `EARLY_DETECTION`, then `MATURE` after at least 3 charges (2 for annual), then `TOMBSTONED` when an expected charge never arrives. Plaid recommends at least 180 days of history [1]. The judges can audit this as a rules engine, and it should be deterministic.
2. **Use the median absolute deviation (MAD) for anomalies.** The modified z-score is 0.6745·(x−median)/MAD, and a reading above 3.5 is flagged [4]. It holds up on the small, skewed datasets of a single person. The interquartile range (IQR) fences give a second, simpler check [5].
3. **Price-hike alerts need two conditions.** Rocket Money alerts only when a subscription rises by more than $1.99 *and* more than 5% [8]. Chinese subscriptions cost ¥15–30, so FundBun should use ≥¥1 and ≥5%. A real example for the sandbox: iQIYI raised its auto-renew monthly price from ¥22 to ¥25 on 2022-12-16 [27].
4. **Detect duplicates across data sources.** Alipay's own bill export warns that a non-balance payment can appear in both the Alipay bill and the bank statement, so it should not be booked twice [13]. Matching Alipay or WeChat records against bank records is a concrete security and compliance story to show judges.
5. **Use real prices in the sandbox.** Shenzhen's 2025 average annual wage in non-private units was ¥191,367 (about ¥15,900 a month) [14]. The average residential rent was ¥83.05/m²/month in August 2026 [17]. Video and music memberships cost ¥15–25 a month on the App Store [28–32]. A Meituan order averages about ¥30 [18].

---

## 1. Detecting recurring charges and subscriptions

**Reference design: Plaid `/transactions/recurring/get` [1]**
- Frequencies: `WEEKLY`, `BIWEEKLY`, `SEMI_MONTHLY` (mostly income), `MONTHLY`, `ANNUALLY`, `UNKNOWN`.
- `MATURE`: "at least 3 transactions" on a regular cadence, or 2 for an annual stream. `EARLY_DETECTION` covers a stream before that point. `TOMBSTONED` means an early stream had no transaction at the next expected date.
- Each stream exposes `average_amount`, `last_amount`, `predicted_next_date` and `is_active`.

**Pipeline (Design choice)**
1. **Normalize the merchant.** Chinese wallet exports already separate the counterparty from the item. WeChat Pay columns are `交易时间, 交易类型, 交易对方, 商品, 收/支, 金额(元), 支付方式, 当前状态, 交易单号, 商户单号`. Alipay adds `交易分类` and `商品说明` [12][13]. Strip branch suffixes in parentheses, so `云膳过桥米线(传奇广场店)` becomes `云膳过桥米线` [12]. Then map the result through an alias table to a canonical merchant.
2. **Group** by (canonical merchant, direction, payment method).
3. **Sort and measure the gaps between charges.** Match the median gap to a frequency window: weekly 7±1 days, biweekly 14±2, monthly 28–31, annual 365±7. Require the gaps to be regular, with a gap MAD of 3 days or less.
4. **Check the amount.** Fixed-price subscriptions must stay within ±max(¥1, 5%) of the median. Utilities are variable, so accept a coefficient of variation up to 0.35.
5. **Run the state machine** as in Plaid [1]. Set `predicted_next_date` to the last date plus the median gap.

**Alternative:** DBSCAN clustering, which a SISSA thesis tested on the public Berka bank dataset [11]. Berka also makes a free test set.

## 2. Price hikes and duplicate charges

**Price hike (Design choice, informed by [8]).** Compare each new `MATURE` charge with the median of the previous 3. When Δ ≥ ¥1 and Δ/median ≥ 5%, mark it `PRICE_CHANGE_PENDING`, and confirm on the next charge at the new price.

**Duplicates.**
- *Pending versus posted:* this pair is not a duplicate. Plaid links the two with `pending_transaction_id` [1].
- *Cross-source:* the same payment can appear in Alipay and on the bank card [13]. Match on amount (exact), time (±2 days) and the payment-method tail (for example `交通银行信用卡(7449)` in Alipay against the bank card's last four digits). Keep the wallet row, because it holds the merchant detail.
- *True double charge:* same merchant and amount, within 10 minutes, different `交易单号`, neither row a refund (`退款`/`不计收支`). The agent drafts a dispute but never files one.

## 3. Anomaly detection on small personal datasets

| Method | Rule | Source |
|---|---|---|
| Modified z-score | M = 0.6745·(x−x̃)/MAD; flag \|M\| > 3.5 | NIST/Iglewicz–Hoaglin [4] |
| Tukey fences | mild: beyond Q1−1.5·IQR or Q3+1.5·IQR; extreme: beyond 3·IQR | NIST [5] |

Transaction counts fall as amounts rise, and amounts cluster at round numbers [11]. **Design choice:** score log(amount) per category over a rolling 90 days and require at least 8 data points. When MAD = 0 (repeated identical prices), switch to the 3×IQR extreme fence. Below 8 points, flag any amount more than 3× the category median. Score daily category totals too: ten ¥15 bubble teas is the anomaly users care about.

## 4. Budgeting methods and safe-to-spend

| Method | Rule [6] | FundBun mode |
|---|---|---|
| 50/30/20 | 50% needs, 30% wants, 20% savings, from take-home pay | Default for onboarding |
| Zero-based | Start at zero each month and justify every expense | "Plan every yuan" |
| Envelope | Fixed cash per category | Maps to goal "pots" |
| Pay yourself first | Save before paying any bills | Auto-sweep to a dream-item pot on payday (Tier-2 action) |

**Safe-to-spend.** PocketGuard "adds up your monthly income, subtracts recurring bills and savings goals you've set, then divides what remains across the days left" [7]. **FundBun formula (Design choice):**
`STS_today = (available − bills_due_before_payday − remaining_goal_contributions − buffer) / days_until_payday`, where buffer = 10% of the remaining variable budget.

## 5. Projecting month-end spending pace

Hyndman and Athanasopoulos describe four simple baselines: mean, naïve, seasonal naïve and drift [9]. Personal spending is part fixed and part variable, so **(Design choice)**:

```
projected = fixed_paid + fixed_scheduled_remaining
          + var_spent + r × days_left
r = w × (var_spent / days_elapsed) + (1 − w) × baseline_daily_var
w = days_elapsed / days_in_month
baseline_daily_var = median daily variable spend over the trailing 3 months
```
Exclude §3 outliers from the run rate, so one ¥3,000 phone does not project a ¥90k month.

**Dream Mirror tripwires:**
- `pace = projected / target`.
- When pace ≥ 1.10, show the dream item ("You could've gotten a Birkin").
- When pace ≤ 0.90, show "¥(target−projected) under, which is new shoes".
- Suppress both until day 5 of the month, because early projections are noisy.

## 6. Categorizing transactions

**Cascade (Design choice):**
1. A user override or exact merchant rule (corrections become rules).
2. Platform fields: Alipay `交易分类` and WeChat `交易类型` [12][13].
3. Keyword and regex rules.
4. ComplementNB on character n-grams of merchant and item. scikit-learn notes that naive Bayes needs "a small amount of training data", and that ComplementNB suits imbalanced data and often beats MultinomialNB on text [10].
5. An LLM fallback only when confidence is below 0.90. Its output is constrained to the category enum, it receives redacted input only (no account numbers), and every call is audit-logged.

**Benchmarks:**
- Plaid's taxonomy has 16 primary and 104 detailed categories [2].
- Plaid states its confidence levels as VERY_HIGH (>98%) and HIGH (>90%) [1].
- Plaid's December 2025 model uses "AI-assisted label generation and targeted human review", and Plaid reports 10% and 20% accuracy gains [3].
- SVM plus Jaccard short-text matching handles bank descriptions with little training data [26].

## 7. Sandbox personas

### A. "Lin", 26, analyst in Nanshan, Shenzhen

| Fact | Value | Src |
|---|---|---|
| 2025 avg wage, non-private units | ¥191,367/yr (≈¥15,947/mo) | [14] |
| 2025 avg wage, private units | ¥99,220/yr (≈¥8,268/mo) | [14] |
| Per-capita disposable income / consumption, 2025 | ¥84,945 / ¥53,548; Engel coefficient 29.2% | [15] |
| Minimum wage (from 2025-03-01) | ¥2,520/mo | [16] |

The persona earns **¥15,000 gross a month**. Take-home pay is about ¥11,800, which is an **ASSUMPTION**: the social insurance, housing fund and income-tax deductions were not verified. Recompute it before the demo. The target spend is ¥7,500. Wishlist: Birkin (illustrative price; no source), sneakers ¥1,200 (**ASSUMPTION**).

### B. International student

- **Chinese student in the UK.** UKVI requires £1,171/month outside London and £1,529 in London, for up to 9 months (page updated 2025-12-31) [24]. At the PBOC central parity of 9.1308 CNY/GBP on 2026-09-09 [25], that is about ¥10,692 and ¥13,961.
- **International student in Shenzhen.** Chinese Government Scholarship stipends are ¥2,500 a month for undergraduates, ¥3,000 for master's students and ¥3,500 for PhDs. The source is a 2018 Peking University page [23], so check the current rates.

## 8. Recommended defaults

| Module | Choice | Defaults |
|---|---|---|
| Recurring | Gap and amount rules plus a Plaid-style state machine | ≥180 days of history; MATURE at ≥3 charges (annual ≥2); gap MAD ≤3 days; fixed amounts ±max(¥1, 5%); TOMBSTONED at expected date + 7 days (monthly) |
| Price hike | Last charge vs median of previous 3 | ≥¥1 and ≥5%; confirmed on the 2nd charge |
| Duplicate | Exact amount + merchant + time window | 10 min (same source); ±2 days (cross-source) |
| Anomaly | Modified z on log amount, per category | 90-day window, n≥8, \|M\|>3.5; fallback to 3×IQR |
| Pace | Fixed+variable blend | Tripwires at 0.90 and 1.10; silent before day 5 |
| Categorization | Rules → NB → LLM | Accept NB at p≥0.90; LLM enum-constrained and redacted |
| Safe-to-spend | PocketGuard-style per day | 10% buffer |

## 9. CNY prices for the sandbox data generator

| Item | Price (CNY) | Generator hint | Src |
|---|---|---|---|
| Rent, 30 m² studio | ≈2,490/mo (83.05 × 30) | Fixed, day 1–5 | [17] |
| Meituan/Ele.me order | ~30 average; tea/coffee orders on new platforms 13–14 | Lognormal, median 28; 15–25 orders/mo | [18] |
| Mixue drink | ~6 (core range 2–8) | 4–8/mo | [19] |
| Mid-tier tea (Chabaidao) | ≈16.8/cup (¥133.32亿 ÷ 7.94亿 cups, 2022) | 6–12/mo | [20] |
| Taxi | ¥10 for the first 2 km + ¥2.7/km; +30% from 23:00 to 06:00 | DiDi Express priced like a taxi (**ASSUMPTION**: no official Shenzhen DiDi tariff found) | [21] |
| Metro | ¥2 for the first 4 km, then ¥1 per 4 km up to 12 km | ¥3–6 per commute leg | [22] |
| Electricity | ¥0.6542/kWh, tier 1 (0–260 kWh summer, 0–200 other months), before government surcharges | 150–250 kWh/mo | [33] |
| Water, tier 1 (0–22 m³) | Tap 2.67 + sewage 1.00 + garbage 0.59 per m³ | 5–8 m³/mo | [34][35] |
| Piped gas, tier 1 | 3.41/m³ | 5–10 m³/mo | [36] |
| Mobile plan | China Mobile average revenue per user ¥46.9/mo, data use 16.1 GB (Q1 2025) | ¥47 default | [37] |
| iQIYI Gold VIP | 25 auto-renew monthly; 30 single month; 238 annual | Price-hike demo from 22 to 25 | [28][27] |
| Tencent Video VIP | 25 monthly; 68 quarterly; 238 annual | Overlaps iQIYI, so a cancel candidate | [29] |
| QQ Music Luxury Green Diamond | 15 auto-renew monthly | | [30] |
| NetEase Cloud Music Black Vinyl VIP | 15 monthly | | [31] |
| Bilibili Premium | 15 auto-renew monthly; 25 single month; 148 annual | | [32] |
| Taobao/JD/Pinduoduo order | **UNVERIFIED** (no sourced per-order figure); suggest lognormal medians of ¥80, ¥120 and ¥25 | 6–12 orders/mo | — |

App Store prices were read on 2026-10-08 from the CN storefront. Android or web prices may differ; I did not verify them.

---

## Sources

1. Plaid Transactions API reference: https://plaid.com/docs/api/products/transactions/
2. Plaid PFC taxonomy blog (2022-02-23): https://plaid.com/blog/transactions-categorization-taxonomy/
3. Plaid AI-enhanced categorization (2025-12-03): https://plaid.com/blog/ai-enhanced-transaction-categorization/
4. NIST e-Handbook, outlier detection: https://itl.nist.gov/div898/handbook/eda/section3/eda35h.htm
5. NIST e-Handbook, outliers and fences: https://itl.nist.gov/div898/handbook/prc/section1/prc16.htm
6. Vanguard, budgeting styles: https://ownyourfuture.vanguard.com/content/en/learn/financial-planning/identify-your-personal-budgeting-style.html
7. Penny Hoarder PocketGuard review (2026-06-04; secondary): https://www.thepennyhoarder.com/budgeting/pocketguard-review/
8. Rocket Money, price-increase alerts (2026-07-06): https://www.rocketmoney.com/learn/personal-finance/is-there-an-app-that-can-tell-me-when-my-subscription-price-increased
9. Hyndman & Athanasopoulos, FPP3: https://otexts.com/fpp3/simple-methods.html
10. scikit-learn, naive Bayes: https://scikit-learn.org/stable/modules/naive_bayes.html
11. Yousfi, *Detection of recurring behavior in banking data* (SISSA): https://backend.mhpc.sissa.it/sites/default/files/2023-09/Yousfi_Tesi.pdf
12. WeChat bill sample (deb-sig): https://github.com/deb-sig/double-entry-generator/blob/master/example/wechat/example-wechat-records.csv
13. Alipay bill sample (deb-sig): https://github.com/deb-sig/double-entry-generator/blob/master/example/alipay/example-alipay-records.csv
14. Shenzhen Statistics Bureau, 2025 wages: https://www.sz.gov.cn/cn/xxgk/zfxxgj/tjsj/tjgb/content/post_12907800.html
15. Shenzhen 2025 statistical communiqué: https://www.sz.gov.cn/cn/xxgk/zfxxgj/tjsj/tjgb/content/post_12805133.html
16. Shenzhen minimum wage (Shenzhen News): https://sznews.com/news/content/2025-02/15/content_31466616.htm
17. Gelonghui, tier-1 city rents for Aug 2026: https://m.gelonghui.com/live/2655821
18. Sina Finance, food-delivery order values (2025-06-18): https://finance.sina.cn/2025-06-18/detail-infannhk7805237.d.html
19. The Paper, Mixue IPO (2025-03-03): https://www.thepaper.cn/newsDetail_forward_30288334
20. Jiemian, Chabaidao prospectus: https://www.jiemian.com/article/9941164.html
21. Shenzhen DRC taxi fares: https://fgw.sz.gov.cn/attachment/1/1398/1398317/10986868.pdf
22. Shenzhen DRC metro fares: https://fgw.sz.gov.cn/attachment/1/1398/1398316/10986860.pdf
23. PKU, CSC scholarship stipends (2018): https://isdplus.pku.edu.cn/info/1515/2544.htm
24. UKVI financial evidence: https://www.gov.uk/guidance/financial-evidence-for-student-and-child-student-route-applicants
25. PBOC central parity rate, 2026-09-09 (10jqka): https://news.10jqka.com.cn/20260909/c679734021.shtml
26. García-Méndez et al., arXiv:2404.08664: https://arxiv.org/abs/2404.08664
27. Jiemian, iQIYI price change (2022-12-16): https://www.jiemian.com/article/8583511.html
28. App Store CN, iQIYI: https://apps.apple.com/cn/app/id393765873
29. App Store CN, Tencent Video: https://apps.apple.com/cn/app/id458318329
30. App Store CN, QQ Music: https://apps.apple.com/cn/app/id414603431
31. App Store CN, NetEase Cloud Music: https://apps.apple.com/cn/app/id590338362
32. App Store CN, Bilibili HD: https://apps.apple.com/cn/app/id1093486973
33. Shenzhen DRC residential electricity tariff: https://fgw.sz.gov.cn/attachment/1/1460/1460239/11394935.pdf
34. Shenzhen sewage fee notice: https://www.sz.gov.cn/szzt2010/zdlyzl/sfxx/bz/fw/content/post_10241194.html
35. Bendibao, Shenzhen water tiers (2026-07-01; secondary): https://m.bendibao.com/show952078.html
36. Shenzhen gas price notice (2024-03-15): https://www.sz.gov.cn/cn/xxgk/zfxxgj/tzgg/content/post_11193390.html
37. China Mobile, Q1 2025 results: https://chinamobileltd.com/en/file/view.php?id=313437
