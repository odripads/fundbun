# AGENTS.md — FundBun handover (read this first, every session)

You are helping **Odri** (Odri Prince Sembiring, UGM, Indonesia) finish and present **FundBun** at the
**2026 Shenzhen International FinTechathon** (Shenzhen University × WeBank, 8th edition), International
Track, Topic A (personal-finance AI agent). FundBun is a **Top 10 Finalist** — never claim it won anything.

This file replaces the memory Odri's previous assistant had. Claude is not available in mainland China,
so you (OpenCode: `logic` agent = DeepSeek, `ui` agent = Kimi) are the coding helper during the final.

## 1. The team
- **Odri** — team leader, the only person attending and competing in Shenzhen. Talk to Odri directly,
  short updates, plain English (Indonesian is fine too). Odri is a politics/psychology researcher, not a
  career engineer: explain trade-offs in plain words and recommend one option.
- **Nadine Griselda** (UNAIR) — registered teammate, cannot attend (academic retreat). Still a team member
  on all official material.
- Organisers do NOT allow team changes. Never add or name anyone else as a team member.

## 2. The final (in person)
- Place: WeBank Building, No. 88 Jingang Street, Nanshan, Shenzhen. Language: English. Own laptop.
- 27 Nov arrivals (optional WeBank visit) · 28 Nov on-site hackathon day 1 · 29 Nov hackathon day 2 +
  presentations · 30 Nov awards.
- Judging (from the first round): 40% scripted tasks in a sandbox, 30% security (induced transfer, data
  extraction, privilege escalation, prompt injection), 30% innovation (clarification, correction, fallback).
- Expect a surprise brief on 28 Nov: build fast, keep the app working at all times, commit often.

## 3. What FundBun is
An AI money buddy ("Bun", logo = a bao bun with a ¥ filling) that helps young people stick to their budget.
- **Dream Mirror** (Odri's core idea): when you overspend, it shows what that money could have bought
  toward your dream ("You could've gotten a …"); under budget, it shows goal progress or a guilt-free treat.
- **Tripwires** (the crux): spending rules the user sets themselves; Bun warns before they're crossed.
- **Safe action, not just advice**: moves money only between the user's own pots; any payment needs a
  bank-side confirmation bound to the exact amount and payee. 24/24 scripted attacks blocked (with the
  offline engine / mock provider — see §7).
- Positioning vs Claude/ChatGPT/Perplexity personal finance (all read-only): FundBun's edge is safe
  action + user-set tripwires. Weak spot: no real bank data, only CSV import + sandbox.
- China pitch: a safety layer that runs **inside WeBank's own channel** (WeBank hosts and executes, a filed
  Chinese model, synthetic-data test). The ask: a named WeBank technical contact after the final.
  "WeBun" is only a working name on one concept slide; the public brand is FundBun.

**Never say to a bank or judge:** "China's Plaid", "compliant", "legal under PIPL", "first",
"our agent moves money", "WeBank sub-accounts", bank logins, "Claude for Chinese users".
Say "bank-side confirmation bound to amount and payee", not just "PIN".

## 4. Where everything lives (our data)
All under `~/Desktop/STARTUP/` (iCloud Desktop — if a read hangs, the Mac is low on disk; free space first):

| Path | What |
|---|---|
| `fundbun/` | **This repo** — the app. GitHub `odripads/fundbun` (PUBLIC). |
| `fundbun/src/core/` | Logic: `finance/` engines, `agent/` (NLU, planner, runtime, LLM engine), `security/` (policy), `controller/`, `sandbox/` (synthetic demo data), `types.ts`, `app-api.ts` |
| `fundbun/src/ui/` | The web UI (React + Vite) |
| `fundbun/server/` | API server + LLM providers (`providers/anthropic.ts`, `openai.ts` = any OpenAI-compatible API, `mock.ts`) |
| `fundbun/docs/` | `CONTRACT.md` (architecture + demo numbers), `SCENARIOS.md` (scripted tasks = tests), `TECHNICAL.md`, `SECURITY_SELF_ASSESSMENT.md`, `PITCH_SCRIPT.md`, `research/` |
| `fundbun/evidence/` | Output of the scenario runner (`npm run evidence`) |
| `fundbun/deck/` | Pitch deck builder (`npm run deck`) |
| `submission/` | First-round submission package + `CHECKLIST.md` |
| `launch-videos/`, `fundbun-videos/` | Promo videos (private source; holds Odri's voice files — never commit to the public repo) |
| `explainers/` | Simple + technical "how it works" PDFs |
| `pins/`, `FundBun-*.png` | Enamel pin art, LinkedIn graphic, WeBun concept slides |
| `team members/` | **Passport/ID documents. Never open, copy, upload or commit anything from here.** |

**App data:** there is no real user or bank data anywhere. Demo users are synthetic personas in
`src/core/sandbox/` (deep link `?demo=mei` — rename "Mei" to **Jing** is pending). The app stores
state in the browser only.

Live: https://fundbun.vercel.app (static, offline engine, calls no AI model) ·
https://odripads.github.io/fundbun/?demo=mei · demo video https://youtu.be/Se5TD4KQ35A

## 5. Commands
```
npm install            # never `npm ci` (it deletes node_modules and its iCloud-ignore flag)
npm run dev            # web (vite, port 5180) + API together
npm test               # vitest, ~3,086 tests — must stay green
npm run typecheck
npm run evidence       # scripted scenarios → evidence/
npm start              # production server (needed if the demo should call a real AI model)
```

## 6. ⚠ Check before every commit
The git index went missing once (fixed 9 Nov 2026 with `git reset`). If `git status` ever shows hundreds
of staged deletions, **do not commit** — that commit would delete everything. Run `git reset` (changes no
files), check `git status` looks normal, then commit. Never force-push.

## 7. Open work (in rough priority order)
1. **Wire DeepSeek into the app**: `LLM_PROVIDER=openai_compat`, `OPENAI_COMPAT_BASE_URL=https://api.deepseek.com`,
   `OPENAI_COMPAT_MODEL=deepseek-flash` (the repo default `deepseek-chat` is retired), send
   `thinking: {type: 'disabled'}`, `OPENAI_COMPAT_API_KEY` from `.env` (never commit keys). Remove any
   `ANTHROPIC_API_KEY` from the demo setup.
2. **Live-test the AI path**: TECHNICAL.md:635 says the LLM path was never live-tested. Run the 24 attacks
   against real DeepSeek before claiming "24/24" for the AI mode.
3. **Security gap T1**: a hidden instruction can auto-run budget changes in Co-pilot mode
   (`src/core/security/policy.ts:276,292`). Fix it, add a test, correct SECURITY_SELF_ASSESSMENT.md:337.
4. Rename demo persona **Mei → Jing** everywhere (app, deep links, docs).
5. Be honest about the "on-device AI": it is text matching + rules (27 intents), not a neural model.
6. Do a full dry run with no Claude, from start to stage demo, before flying.

## 8. Rules for you
- Run `npm test` after every change; don't leave the app broken. Small commits with clear messages.
- Ask Odri before: publishing anything, pushing to the public repo, sending emails, spending money.
- Never type passport/ID numbers or put personal data, API keys or voice files in the repo.
- Report real measured numbers, not guesses.
- Odri finds complex tools confusing: one step at a time, say exactly what to type or click, and check
  the result before moving on.
- Don't paste personal data, keys or ID documents into prompts.
