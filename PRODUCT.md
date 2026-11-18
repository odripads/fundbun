# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Young adults in China, roughly 18–30 — students and first-job earners. They are paid and pay
mostly through mobile wallets (WeChat Pay / Alipay), keep a dream in the back of their mind
(a bag, a trip, a gadget), and repeatedly overspend on small everyday things without feeling it.
Their job: set a budget, get warned *before* crossing it, see what overspending is really costing
them in dream terms, and have spare money moved safely into savings pots — without shame or lectures.

## Product Purpose

FundBun ("Bun") is an AI money buddy that helps young people actually stick to their budget.
It turns abstract overspending into something you can see — *"You could've gotten a Birkin."* — so
the cost of a splurge is felt as a dream delayed, not a red number. It warns before self-set
thresholds are crossed (Tripwires) and, unlike read-only assistants, completes safe money tasks.
Success means the user stays under budget more often, saves toward a goal, and trusts the agent
enough to let it act.

## Positioning

The mechanism a read-only assistant cannot truthfully copy: **safe action plus user-set tripwires.**
Claude / ChatGPT / Perplexity can read and advise; FundBun *acts* — but only safely. It moves money
only between the user's own pots, and any payment needs a bank-side confirmation bound to the exact
amount and payee. The user defines their own spending rules; Bun enforces them before they break.

## Operating Context

Built and evaluated for the **2026 Shenzhen International FinTechathon** (Shenzhen University ×
WeBank), International Track, Topic A (personal-finance AI agent). Judging has three parts: scripted
tasks in a sandbox (40%), security attacks — induced transfer, data extraction, privilege escalation,
prompt injection (30%), and innovation (30%). A surprise brief arrives on hackathon day 1.

The app is a mobile-first web app; on desktop it renders a phone-sized app beside the **Glass Box**
(a live agent trace, policy decisions, audit tail, and sandbox controls). Demo users are synthetic
personas (Jing, with a "Mei" alias), reachable via `?demo=jing`; there is no real bank or user data.
Our proposal for a bank setting (nothing is agreed with any bank) is FundBun as a safety layer inside the
bank's own app, where the bank hosts and executes. Public brand is FundBun ("WeBun" is a working name only).

## Capabilities and Constraints

Capabilities:
- **Dream Mirror** — overspend → "you could've had X", with weeks of goal delay; under budget → progress + a guilt-free treat.
- **Tripwires** — self-set thresholds (80%/100% of target, category cap, any purchase over ¥X, projected overspend) that warn before crossing.
- **Smart budgeting** — plans from history or 50/30/20, category caps, pace projection, safe-to-spend today, "should I buy it?" in hours-of-work and days-of-delay.
- **Bill analysis** — hikes, duplicates, spikes, overlapping subscriptions, annual cost, due dates, and Bill X-ray (pasted bills) with prompt-injection detection.
- **Spending insights** — trends, late-night habits, small-frequent purchases, anomalies, top merchants, heatmap, each with a "why" and a dream equivalent.
- **Agent actions** — multi-step task plans (DAG), clarification, correction, interrupt; moves money into pots, pays verified bills, cancels subscriptions, disputes duplicates. Every action gated by policy.
- **Five-tier permission engine** (T0 read → T4 prohibited) and a tamper-evident audit hash chain.

Constraints:
- **No real bank or user data.** Only CSV import and a deterministic synthetic sandbox bank.
- **The offline "on-device AI" is text matching + rules (27 intents), not a neural model.** An optional LLM gateway (Anthropic / any OpenAI-compatible endpoint / mock) provides the AI mode; it was not yet live-tested against a real model.
- Browser-only state; no backend persistence.
- Claims FundBun does not make, because they are not true or not ours to make: "China's Plaid", "compliant" or "legal under PIPL", "first", "our agent moves money", any bank's sub-accounts or logins, or any named bank as a partner. Say "bank-side confirmation bound to amount and payee", not just "PIN".

## Brand Commitments

- **Name:** FundBun. Mascot **Bun** — a steamed bao bun with a gold ¥ filling (logo assets in `docs/assets/brand/`, `public/`).
- **Voice:** a warm, frank "money buddy" — playful but not a lecture; e.g. *"You could've gotten a Birkin."* Feature names **Dream Mirror** and **Tripwires** are part of the brand.
- **Visual system ("the steamer"):** cream/dough/crust/bamboo/soy neutrals with a yuan-gold accent, chili-red for overspend and jade-green for under budget. Display serif **Fraunces**, UI sans **DM Sans**, self-hosted.
- **Honesty is a brand value:** measured results are quoted exactly (45/45 scenarios, 24/24 attacks blocked), and limits (synthetic data, no real bank) are stated, not hidden.

## Evidence on Hand

- Docs: `docs/CONTRACT.md`, `docs/TECHNICAL.md`, `docs/SECURITY_SELF_ASSESSMENT.md`, `docs/SCENARIOS.md`, `docs/PITCH_SCRIPT.md`, `docs/PRIVACY_NOTICE.md`, `docs/DEMO_VIDEO_SCRIPT.md`.
- Measured output: `evidence/` (45/45 scripted scenarios, 231/231 assertions, 24/24 attacks blocked with ¥0 moved, 44/44 audit chains intact).
- Pitch deck builder: `deck/`. Logo/brand art: `docs/assets/brand/`, `public/`.
- Demo video: https://youtu.be/Se5TD4KQ35A · Live: https://fundbun.vercel.app · Mirror: https://odripads.github.io/fundbun/?demo=jing
- Absences future work must not fabricate: real customers, testimonials, benchmarks, press, and any real bank connection.

## Product Principles

1. **Make overspending visible, not shameful** — show the dream it cost, never scold.
2. **Warn before, act safely** — tripwires fire ahead of the line; money only moves with the exact amount and payee bound bank-side.
3. **The model proposes, the policy engine decides** — no action without the permission gate.
4. **Be honest about limits** — synthetic sandbox, no real bank data; never overclaim capability.
5. **Trust is the product** — transparency (Glass Box, audit chain) beats cleverness.

## Accessibility & Inclusion

- Light and dark themes (OS-aware plus manual override), with `prefers-reduced-motion` respected.
- Documented contrast floor of 4.5:1 for body and hint text; CVD-validated chart palette.
- Focus trap and scroll lock for modals; keyboard-accessible controls.
- Self-hosted fonts (no external CDN); CJK fallbacks (Songti SC / PingFang SC / Hiragino Sans GB) already in the token stack, ready for the planned Chinese localization.
