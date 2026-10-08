# FundBun — pitch deck script (10 minutes, 13 slides)

Audience: WeBank industry experts + university scholars. Live talk with a short live demo (or the demo video).
Timing ≈ 45 s per slide; the live product tour (slide 5) gets ~2 minutes. All numbers are from
`evidence/latest/SUMMARY.md`, the test suite, or `docs/research/` (sources cited in speaker notes).

---

## 1 · Title — "You could've gotten a Birkin."
**On slide:** FundBun logo (bao with a ¥ filling) · "An AI money buddy that shows you the dream you could've had" ·
FinTechathon 2026 · International Track · Topic A Personal Finance Assistant · Odri Prince Sembiring (UGM) ·
Nadine Griselda (UNAIR).
**Say:** "Every budgeting app tells you a number. Numbers don't hurt. Missing out on the thing you actually want does.
FundBun is a personal-finance agent that turns your spending into the dreams it costs you — and then actually helps,
safely, inside your bank."

## 2 · The problem — overspending is invisible until it's too late
**On slide:** three short facts with icons — (1) budgets are abstract numbers; (2) people neglect opportunity cost
(Frederick et al. 2009; replicated across 39 studies, Maguire et al. 2023); (3) warnings at the moment of spending work:
Alipay's Huabei bill assistant was linked to 19.6% lower monthly spending (Tsinghua PBCSF).
**Say:** "We don't feel ¥2,580 of extra delivery. We'd feel losing a weekend away. And the research says the moment of
spending is when a nudge matters."

## 3 · The idea — the Dream Mirror
**On slide:** side-by-side phone screenshots: Mei (over) "You could've gotten a Weekend in Chengdu." and Arif (under)
"¥668 closer to your MacBook Air." Caption: your own dream items, your own photos, your own words.
**Say:** "At onboarding you tell FundBun your income, what you're willing to spend, and your dreams — a Birkin, new
shoes, a flight home. Overspend, and the home screen mirrors it back: you could've gotten a weekend in Chengdu, and your
Birkin just moved five weeks further away. Stay under, and it shows how much closer you are — with a guilt-free treat as
your choice, never a push."

## 4 · Tripwires — the crux
**On slide:** a tripwire toast with the dream picture ("That ¥1,299 = 1.3% of your Birkin") + the four tripwire types
(80/100% of target, category limit, any single purchase over ¥X, projected overspend) + tone selector
(Gentle · Cheeky · Just numbers).
**Say:** "You set the thresholds. When you cross one, Bun reminds you with something tangible — not a red number.
Shame backfires in the research, so the cheeky voice is opt-in and gentle is the default."

## 5 · Live product tour (≈2 min — or play the 5-minute video)
**On slide:** 4 screenshots in a row: Home mirror · "Should I buy it?" check · Bills with X-ray · Ask Bun plan card.
**Demo path:** `?demo=mei` → Home mirror → Should I buy ¥1,299 sneakers → Sandbox purchase fires a tripwire → Ask Bun
"Help me get back on track" → plan DAG → approve Youku cancellation with PIN → Bills X-ray of the electricity bill.

## 6 · AI as a financial participant — what Bun actually does
**On slide:** task table — read (overview, breakdown, insights, bills, subscriptions, affordability), organise (budget
plan, category caps, tripwires, recategorise, reminders), move own money (stash surplus into goal pots), pay & cancel
(pay verified bills, cancel subscriptions, dispute duplicates) + a mini task-plan DAG ("Get October back on track":
7 steps, read steps auto-run, actions wait for you).
**Say:** "Bun doesn't just chat. It plans multi-step tasks as a dependency graph, clarifies when you're ambiguous,
accepts corrections like 'make it ¥150', and stops when you say stop."

## 7 · Architecture — local-first, LLM-optional
**On slide:** architecture diagram (docs/assets/diagrams/architecture.png).
**Say:** "Your data stays on your phone. The same TypeScript core powers the app, the tests and the evidence runner.
An on-device engine works fully offline; with separate consent, an LLM gateway adds open-ended dialogue — it only ever
sees redacted, minimised context, and it can only propose."

## 8 · Safety model — the model proposes, the policy engine decides
**On slide:** the permission tiers × autonomy matrix (docs/assets/diagrams/permission-tiers.png) + 5 icons: caps
(¥500 / ¥1,000 a day / ¥5,000 a month), PIN bound to exact amount + payee, undo window, circuit breaker, kill switch.
**Say:** "Five tiers. Reading is free. Organising is reversible. Moving your own money is capped. Paying needs your PIN,
bound to the exact amount and payee — what you see is exactly what runs. And some things Bun can never do: send money to
other people, add payees, invest, borrow, or change its own limits."

## 9 · Red team — the four attacks judges asked about
**On slide:** big numbers: 24/24 attacks blocked · ¥0 moved · 0% false refusals · 4 attack classes (induced transfer,
data extraction, privilege escalation, prompt injection) + the electricity-bill injection card screenshot.
**Say:** "Mei's electricity bill hides an instruction telling the AI to wire ¥4,800 to a stranger. Bun reads the bill,
flags the injection, and nothing moves — because the decision isn't the model's to make."

## 10 · Privacy & compliance by design
**On slide:** PIPL separate consent for financial data (Art. 29), nothing pre-ticked · local-first + optional AES-GCM
vault · PII redaction before any LLM call · AI-content labels · algorithm-recommendation rules: no inducement to consume,
user-controlled tone and tripwires · export + one-tap deletion · hash-chained audit log.

## 11 · Evidence — reproducible, measurable
**On slide:** 45/45 scripted scenarios · 231/231 assertions · 2,700+ automated tests · 44/44 audit chains intact ·
tamper detected · byte-identical reruns · glass-box screenshot. "`npm run evidence` — judges can reproduce everything."

## 12 · Why WeBank — and what's next
**On slide:** fit with "Better Banking for All": young users and international students, local-first privacy, explainable
agent actions. Roadmap: bank-side mandate enforcement via WeBank APIs · WeChat mini-program · federated learning
(FATE) for categorisation without pooling raw data · in-region LLMs (OpenAI-compatible gateway) · consented pilot.

## 13 · Close — "Show me my mirror."
**On slide:** logo, repo URL, demo link, team.
**Say:** "FundBun makes the cost of spending something you can see — and gives you an agent you can actually trust with
your money. Thank you."
