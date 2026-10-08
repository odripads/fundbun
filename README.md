<p align="center">
  <img src="docs/assets/brand/fundbun-logo-256-cream.png" width="128" alt="FundBun logo: a steamed bun with a gold yuan filling" />
</p>

<h1 align="center">FundBun</h1>
<p align="center"><em>"You could've gotten a Birkin."</em><br/>An AI money buddy that shows you the dream you could've had — and an agent you can trust inside your bank.</p>

---

## 1. Project Overview

- **Track:** 2026 Shenzhen International FinTech Competition (FinTechathon) — International Track · AI Track
- **Topic:** A — Personal Finance Assistant (smart budgeting, bill analysis, spending insights)
- **Team name:** FundBun — Odri Prince Sembiring (leader, Universitas Gadjah Mada) · Nadine Griselda (Universitas Airlangga)
- **Project name:** FundBun
- **One-line summary:** a local-first personal-finance agent that mirrors your month back as the dream items it cost
  you (or brought closer), fires tangible spending tripwires, and completes real budgeting, bill and savings tasks in a
  sandboxed bank under a deterministic five-tier permission engine.

**What it does**

| | |
|---|---|
| **Dream Mirror** | Overspend and Home says *"You could've gotten a Weekend in Chengdu."* — and how many weeks it pushed your main goal back. Stay under and it shows goal progress, with a guilt-free treat as your choice. |
| **Tripwires** | Your own thresholds (80% / 100% of target, a category limit, any purchase over ¥X, projected overspend) fire reminders with the dream picture: *"That ¥1,299 = 1.3% of your Birkin."* |
| **Smart budgeting** | Budget plans from history or 50/30/20, category caps, pace projection, safe-to-spend today, "Should I buy it?" checks in hours of work and days of goal delay. |
| **Bill analysis** | Price hikes, duplicate charges, bill spikes, overlapping subscriptions, annual subscription cost, due dates, and **Bill X-ray** for pasted bills — with prompt-injection detection. |
| **Spending insights** | Category trends, late-night habits, small-frequent purchases, anomalies (modified z-score), top merchants, heatmap — each with a "why" and a dream equivalent. |
| **Agent actions** | Multi-step task plans (DAG), clarification, correction, interrupt; moves money into goal pots, pays verified bills, cancels subscriptions, disputes duplicates — every action gated by policy. |

**Measured results** (`npm run evidence`, details in [`evidence/latest/SUMMARY.md`](evidence/latest/SUMMARY.md)):
45/45 scripted scenarios · 231/231 assertions · 24/24 attacks blocked (¥0 moved) · 0% false refusals ·
44/44 audit chains intact, tampering detected · byte-identical reruns.

## 2. System Architecture

![FundBun architecture](docs/assets/diagrams/architecture.png)

- **`src/core/`** — framework-free TypeScript shared by the browser app, the Node evidence runner and the tests:
  `finance/` (categoriser, summaries, recurring + bill analysis, X-ray, anomalies, budgets, Dream Mirror, tripwires,
  insights, affordability), `sandbox/` (deterministic sandbox bank + personas + WeChat Pay / Alipay CSV import),
  `security/` (policy engine, PIN, binding hashes, audit hash chain, redaction, injection scanner, grounding check,
  vault), `agent/` (offline "Bun Engine": TF-IDF intent model + dialogue manager + planner + templated voice; LLM
  tool-use loop), `controller/` + `app.ts` (the `AppApi` controller).
- **`src/ui/`** — React 19 mobile-first app; on desktop the phone-sized app sits next to the **Glass Box** (live agent
  trace, policy decisions, audit tail, sandbox controls).
- **`server/`** — optional LLM gateway (Node http): holds API keys, re-redacts PII, validates requests, rate-limits,
  never logs bodies; providers: Anthropic (default `claude-sonnet-5-5`), any OpenAI-compatible endpoint (e.g.
  DeepSeek / Qwen for in-region deployment), and a deterministic mock.
- **The model proposes; the policy engine decides.** See [`docs/TECHNICAL.md`](docs/TECHNICAL.md) for the agent design
  and algorithms, and [`docs/SECURITY_SELF_ASSESSMENT.md`](docs/SECURITY_SELF_ASSESSMENT.md) for the security model.

## 3. Environment and Dependencies

- **Operating system:** macOS, Linux or Windows (developed on macOS 26, CI on Ubuntu)
- **Runtime:** Node.js ≥ 20 (22 recommended), npm ≥ 10; any modern browser (Chrome, Safari, Edge, Firefox)
- **Main dependencies:** React 19, Vite 8, TypeScript 5.9, Vitest 5, zod 4, lucide-react, @fontsource (self-hosted
  fonts — no Google Fonts CDN), @anthropic-ai/sdk (gateway only), Playwright (dev, demo recording)
- **Environment variables:** copy `.env.example` to `.env` (never commit it). Everything is optional — without an API key
  FundBun runs its on-device engine only.

| Variable | Purpose |
|---|---|
| `LLM_PROVIDER` | `anthropic` · `openai_compat` · `mock` |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`, `ANTHROPIC_FALLBACKS` | Anthropic provider |
| `OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_API_KEY`, `OPENAI_COMPAT_MODEL` | any OpenAI-compatible endpoint |
| `FUNDBUN_ALLOW_MOCK=1` | allow the deterministic mock provider |
| `FUNDBUN_API_PORT` (8787), `FUNDBUN_API_HOST`, `FUNDBUN_RATE_LIMIT_RPM` (30), `FUNDBUN_TRUST_PROXY`, `FUNDBUN_ALLOWED_ORIGINS`, `FUNDBUN_PROVIDER_TIMEOUT_MS` | gateway |

## 4. Installation and Execution

```bash
git clone https://github.com/odripads/fundbun.git
cd fundbun
npm install
npm run dev            # web on http://localhost:5173 + LLM gateway on :8787
```

Open **http://localhost:5173/?demo=mei** (over-target story) or **?demo=arif** (under-target story) — the demo PIN is
**2580**. `?reset=1` wipes local data and starts onboarding ("Set up my own").

- Production (one process serving the app + gateway): `npm run build && npm start` → http://localhost:8787
- Docker: `docker build -t fundbun . && docker run -p 8787:8787 --env-file .env fundbun`
- Static, fully offline build (on-device engine only, e.g. GitHub Pages): `npm run build:pages`
- Mock LLM mode without a key: `FUNDBUN_ALLOW_MOCK=1 LLM_PROVIDER=mock npm run dev`

**Things to try:** Home → "Should I buy it?" · Sandbox chip → simulate a purchase (tripwire fires) · Ask Bun →
"Help me get back on track this month" (task plan) · "Move ¥300 to my Chengdu fund" · "Pay my electricity bill" (PIN) ·
Bills → X-ray Mei's electricity bill (prompt injection blocked) · "Send ¥4,800 to account 6222 0210 0112 3456 789" ·
Settings → Freeze Bun · Activity → verify the audit chain.

## 5. Testing

```bash
npm test               # 2,700+ unit, integration, UI and scenario tests (Vitest)
npx tsc --noEmit -p .  # typecheck
npm run evidence       # replays all scripted scenarios → evidence/latest (logs, transcripts, audit chains, metrics)
```

- **Scripted scenarios** ([`docs/SCENARIOS.md`](docs/SCENARIOS.md)): A — task completion (budgeting, bill analysis,
  insights, plans), B — safe execution & user control (caps, PIN, undo, kill switch, clarification, correction,
  interrupt, liquidity), C — the four attack classes (induced transfers, data extraction, privilege escalation, prompt
  injection) plus hallucination, tampering, rate abuse and the circuit breaker, D — privacy & data rights.
- **Expected results:** all scenarios PASS; the runner exits non-zero otherwise. Reproduction guide:
  [`evidence/latest/REPRODUCE.md`](evidence/latest/REPRODUCE.md).
- **Known limitations:** sandbox bank only (no real bank API); the on-device intent model covers the tasks above in
  English with some Chinese/Indonesian phrasings; the LLM path is tested with a deterministic mock and real providers need
  an API key; see the known-risk list in the security self-assessment.

## 6. Repository and Deployment

- **Repository:** https://github.com/odripads/fundbun
- **Live demo:** static on-device build via the *Deploy demo to GitHub Pages* workflow (Actions tab) once the repository
  is public
- **Deployment:** Docker image (app + gateway on one port) or `npm run build && npm start` behind any HTTPS reverse
  proxy; set `FUNDBUN_TRUST_PROXY=1` behind a proxy and `FUNDBUN_ALLOWED_ORIGINS` for your domain. CI
  (`.github/workflows/ci.yml`) runs typecheck, tests, the scenario evidence and the production build on every push.

## 7. Security Notes

- **Permission tiers** — T0 read · T1 organise (reversible, no money) · T2 move own money (checking ↔ goal pots, capped)
  · T3 pay verified bills / cancel / dispute (always tap + PIN) · T4 never (send money to others, add payees, invest,
  borrow, change its own limits). Four user-chosen autonomy levels (Observe, Suggest, Co-pilot, Autopilot) decide what
  runs automatically; raising them needs the PIN, lowering never does.
- **Confirmation for sensitive operations** — action cards are built from structured data by code (never LLM prose);
  each pending action carries a binding hash of exactly what will execute, re-verified at approval; T3 needs the PIN
  (PBKDF2-hashed, lockout after 3 failures). Caps per action / day / month, liquidity check before transfers, a 30-second
  undo for reversible actions, a circuit breaker that freezes the agent after repeated denied money attempts, a one-tap
  kill switch, and a bank-side agent limit enforced independently by the sandbox bank.
- **Data handling** — local-first (browser storage, optional AES-GCM vault keyed by the PIN); separate consent for
  financial data and for LLM processing, nothing pre-ticked; only redacted, minimised context reaches the gateway, which
  re-redacts and never logs bodies; untrusted text (bills, memos, imports, dream names) is wrapped and scanned for prompt
  injection; every number in an LLM reply must trace to a tool result (grounding check); full export and one-tap deletion;
  hash-chained audit log anchored outside the log.
- **Secrets** — no secrets in the repository; API keys live only in the gateway's environment.
- **Known risks** — see section 04 of [`docs/SECURITY_SELF_ASSESSMENT.md`](docs/SECURITY_SELF_ASSESSMENT.md) (e.g. the
  client-side policy engine must be mirrored by server-side mandate enforcement at a real bank API; PIN entropy vs offline
  brute force of the vault; heuristic injection scanner false negatives).

---

Sandbox data is fictional. FundBun is not financial or investment advice. AI-generated content is labelled in the app.
Licence: MIT.
