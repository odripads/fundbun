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
- Our proposal for a bank setting (nothing is agreed with any bank): FundBun as a safety layer **inside the
  bank's own app**. The bank hosts it, holds the money and executes; FundBun proposes and enforces the rules.
  "WeBun" is only a working name on one concept slide; the public brand is FundBun. The pitch script and
  coaching notes are private, in `~/Desktop/STARTUP/pitch-practice/` (not in this repo).

**Claims FundBun does not make, because they are not true or not ours to make:** "China's Plaid", "compliant",
"legal under PIPL", "first", "our agent moves money", any bank's sub-accounts or logins, any named bank as a
partner. Say "bank-side confirmation bound to amount and payee", not just "PIN".

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
`src/core/sandbox/` (deep link `?demo=jing`; `?demo=mei` still works as an alias). The app stores
state in the browser only.

Live: https://fundbun.vercel.app (static, offline engine, calls no AI model) ·
https://odripads.github.io/fundbun/?demo=jing · demo video https://youtu.be/Se5TD4KQ35A

## 5. Commands
```
npm install            # never `npm ci` (it deletes node_modules and its iCloud-ignore flag)
npm run dev            # web (vite) + API together; the terminal prints the address to open
npm test               # vitest, ~3,220 tests, about 1 minute — must stay green
npm run typecheck
npm run evidence       # scripted scenarios → evidence/
npm start              # production server on port 8787 (needed if the demo should call a real AI model)
npm run build && npm start   # ALWAYS build first: `npm start` serves whatever is in dist/
npx tsx scripts/live-attack-test.ts --save   # 36 attacks against the real model → evidence/live/
```

## 6. ⚠ Check before every commit
The git index has gone missing twice (9 and 18 Nov 2026): iCloud renames `.git/index` to `index 2`. If
`git status` ever shows hundreds of staged deletions, **do not commit** — that commit would delete everything.
Run `git reset` (changes no files), check `git status` looks normal, then commit. Never force-push.
A pre-commit hook (`.git/hooks/pre-commit`, added 18 Nov) now refuses any commit that deletes more than 25 files
and prints these same steps. A full backup of the history is at `~/fundbun-backup-2026-11-18.bundle`.

**iCloud also evicts files when the disk is nearly full.** On 18 Nov, 70% of `.git` and a few source files had
become cloud-only, and reading them hung for minutes. Before flying: in Finder, right-click the `fundbun` folder →
**Keep Downloaded**, and keep at least 15 GB of disk free. If a command hangs, that is the cause.

## 7. Open work (in rough priority order)
1. ~~Wire DeepSeek into the app~~ (done — `deepseek-flash`, `thinking: {type:'disabled'}`, `.env.example` updated,
   server tests green). Still needed: your `OPENAI_COMPAT_API_KEY` in `.env` (next item).
2. ~~Live-test the AI path~~ (done 18 Nov with real `deepseek-flash`, report in `evidence/live/`). What it showed,
   and exactly what may be said: the 24 scripted attacks were stopped by the rule layer **before the model was
   asked**; 12 more, worded to slip past the rules, reached the model and were all refused; ¥0 moved, no
   permission changed, nothing leaked. Say "with a real model switched on", never "the model blocked 24/24".
3. ~~Security gap T1~~ (done — a tainted turn now forces a tap on T1 organising changes too; test added,
   SECURITY_SELF_ASSESSMENT.md + TECHNICAL.md updated).
4. ~~Rename demo persona Mei → Jing~~ (done — app, deep links `?demo=jing` with `?demo=mei` alias, docs).
5. ~~Be honest about the "on-device AI"~~ (done 18 Nov: the app says "On-device rules engine"; ask Bun "which AI
   model are you?" and it says so itself). Keep saying it that way on stage.
6. Do a full dry run with no Claude, from start to stage demo, before flying. Follow `docs/STAGE_CHECKLIST.md`.
7. The public links do not work for judges in China: `vercel.app` is blocked there and `github.io` is unreliable.
   Demo from the laptop. A copy under kalcerinstitute.com is the option to test if a phone link is wanted.

**What changed on 18 Nov 2026 (so you are not surprised):** Bun answers questions about itself ("is this safe?",
"is this my real bank?", "what are your limits?", "what is a tripwire?", "delete my data") in English, Chinese
and Indonesian (`nlu.ts` rules `R-ABOUT-*`, copy in `voice.ts` / `voice-i18n.ts`); Chinese requests are understood
better and block reasons are translated (`REASONS_I18N`); a failed AI call falls back to the on-device engine in
10 s with a notice and a cool-down (`llm-engine.ts`, `controller/host.ts`); an older statement is mirrored from its
latest month (`viewDateOf` in `controller/derive.ts`); the approval sheet shows the sandbox demo PIN for demo
personas; a paused Bun shows an "Unfreeze in Settings" button. 19 Nov: **Add spending** on Home (`QuickAdd.tsx`,
`manualCandidate` in `home/model.ts`): type an amount and a few words, no file needed; it counts at once and can
trip a wire (`addSpending` now applies tripwires for this month's purchases).

## 8. Rules for you
- Run `npm test` after every change; don't leave the app broken. Small commits with clear messages.
- Ask Odri before: publishing anything, pushing to the public repo, sending emails, spending money.
- Never type passport/ID numbers or put personal data, API keys or voice files in the repo.
- Report real measured numbers, not guesses.
- Odri finds complex tools confusing: one step at a time, say exactly what to type or click, and check
  the result before moving on.
- Don't paste personal data, keys or ID documents into prompts.
