# AGENTS.md: FundBun handover (read this first, every session)

> **25 to 26 Nov 2026: desktop app and bring-your-own-AI on branch `desktop`. Read `HANDOFF.md` first.** It has the
> state, the tasks (`docs/handoff/T1` to `T4`), how to run the desktop app and the local AI server, and the rules.


You are helping **Odri** (Odri Prince Sembiring, UGM, Indonesia) finish and present **FundBun** at the
**2026 Shenzhen International FinTechathon** (Shenzhen University × WeBank, 8th edition), International
Track, Topic A (personal-finance AI agent). FundBun is a **Top 10 Finalist**: never claim it won anything.

This file replaces the memory Odri's previous assistant had. Claude and Antigravity are not reliable in
mainland China, so T3 Code runs on **Kimi Code** (`acpRegistry_kimi_code`) during the final:
- **Orchestrator** (planner, reviewer, strategy): **K3.1 Pro** (`kimi-code/k3.1-pro`, `thinking: "high"`).
- **Worker** (delegated coding/build/test tasks via `delegate_task`): **K2.7 Code Highspeed** (`kimi-code/kimi-for-coding-highspeed`, `mode: "yolo"`), or **K3.1 Pro Highspeed** (`kimi-code/k3.1-pro-highspeed`) when an urgent complex task needs extra intelligence at high speed.

## 1. The team
- **Odri**: team leader, the only person attending and competing in Shenzhen. Talk to Odri directly,
  short updates, plain English (Indonesian is fine too). Odri is a politics/psychology researcher, not a
  career engineer: explain trade-offs in plain words and recommend one option.
- **Nadine Griselda** (UNAIR): registered teammate, cannot attend (academic retreat). Still a team member
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
- **The carrot and the stick** (why the two above exist): behaviour follows its consequences, and a consequence
  teaches best when it is immediate, consistent and in proportion. So Bun's face is one ladder computed from the
  ledger (`finance/temper.ts`): happy → calm → worried → angry → furious (bright red, broken mirror, capitals).
  Good logged days cool Bun down; a daily check-in keeps a streak. The stick is for the spending, never for
  logging it, and there is always a stated way back.
- **Two steps, one app** (`finance/expected.ts`, `hasBank`): with no bank connected Bun watches and reminds
  (bills are predicted from the user's own repeating charges and "marked as paid"; pots are envelopes, "set
  aside"). With a bank connected the same screens act (pay, move), behind the PIN. Only the demo personas have a
  bank, and it is simulated ("Bank demo").
- **Safe action, not just advice**: moves money only between the user's own pots; any payment needs a
  bank-side confirmation bound to the exact amount and payee. 24/24 scripted attacks blocked (with the
  offline engine or mock provider, see §7).
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
All under `~/Desktop/STARTUP/` (iCloud Desktop; if a read hangs, the Mac is low on disk, so free space first):

| Path | What |
|---|---|
| `fundbun/` | **This repo** (the app). GitHub `odripads/fundbun` (PUBLIC). Working copy is `~/fundbun-work`. |
| `fundbun/src/core/` | Logic: `finance/` engines, `agent/` (NLU, planner, runtime, LLM engine, agent engine), `ai/` (local client), `security/` (policy), `controller/`, `sandbox/` (synthetic demo data), `types.ts`, `app-api.ts` |
| `fundbun/src/ui/` | The React + Vite UI (responsive desktop layout + phone layout, `components/ai/` for Your AI) |
| `fundbun/desktop/` | Electron desktop shell (`main.ts`, `scripts/desktop-build.mjs`, packaged `release/`) |
| `fundbun/server/` | API server + local connections (`server/local.ts`, `server/ai/`, `server/agents/` + `mcp-bridge.mjs`) + LLM providers (`providers/anthropic.ts`, `openai.ts` = any OpenAI-compatible API, `mock.ts`) |
| `fundbun/docs/` | `CONTRACT.md` (architecture + demo numbers), `SCENARIOS.md` (scripted tasks = tests), `TECHNICAL.md`, `SECURITY_SELF_ASSESSMENT.md`, `PITCH_SCRIPT.md`, `research/` |
| `fundbun/evidence/` | Output of the scenario runner (`npm run evidence`) |
| `fundbun/deck/` | Pitch deck builder (`npm run deck`) |
| `submission/` | First-round submission package + `CHECKLIST.md` |
| `launch-videos/`, `fundbun-videos/` | Promo videos (private source; holds Odri's voice files; never commit to the public repo) |
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
npm test               # vitest, ~4,000+ tests (includes agent lint suite); must stay green
npx tsx scripts/lint-agents.ts   # anti-slop + Factory-style AST & architecture linter across src/ and server/
npm run typecheck
npm run evidence       # scripted scenarios → evidence/
npm run local          # build + start local server on 127.0.0.1:47600 (supports Your AI)
npm run desktop        # build + open the Electron desktop app
npm run desktop:build  # package desktop/release/FundBun-darwin-arm64/FundBun.app and .dmg
npm start              # production server on port 8787 (needed if the demo should call a real AI model)
npm run build && npm start   # ALWAYS build first: `npm start` serves whatever is in dist/
npx tsx scripts/live-attack-test.ts --save   # 36 attacks against the real model → evidence/live/
```

## 6. ⚠ Check before every commit
The git index has gone missing twice (9 and 18 Nov 2026): iCloud renames `.git/index` to `index 2`. If
`git status` ever shows hundreds of staged deletions, **do not commit**: that commit would delete everything.
Run `git reset` (changes no files), check `git status` looks normal, then commit. Never force-push.
A pre-commit hook (`.git/hooks/pre-commit`, added 18 Nov) now refuses any commit that deletes more than 25 files
and prints these same steps. A full backup of the history is at `~/fundbun-backup-2026-11-18.bundle`.

**iCloud also evicts files when the disk is nearly full.** On 18 Nov, 70% of `.git` and a few source files had
become cloud-only, and reading them hung for minutes. Before flying: in Finder, right-click the `fundbun` folder →
**Keep Downloaded**, and keep at least 15 GB of disk free. If a command hangs, that is the cause.

## 7. Open work (in rough priority order)
1. ~~Wire DeepSeek into the app~~ (done: `deepseek-flash`, `thinking: {type:'disabled'}`, `.env.example` updated,
   server tests green). Still needed: your `OPENAI_COMPAT_API_KEY` in `.env` (next item).
2. ~~Live-test the AI path~~ (done 18 Nov with real `deepseek-flash`, report in `evidence/live/`). What it showed,
   and exactly what may be said: the 24 scripted attacks were stopped by the rule layer **before the model was
   asked**; 12 more, worded to slip past the rules, reached the model and were all refused; ¥0 moved, no
   permission changed, nothing leaked. Say "with a real model switched on", never "the model blocked 24/24".
3. ~~Security gap T1~~ (done: a tainted turn now forces a tap on T1 organising changes too; test added,
   SECURITY_SELF_ASSESSMENT.md + TECHNICAL.md updated).
4. ~~Rename demo persona Mei → Jing~~ (done: app, deep links `?demo=jing` with `?demo=mei` alias, docs).
5. ~~Be honest about the "on-device AI"~~ (done 18 Nov: the app says "On-device rules engine"; ask Bun "which AI
   model are you?" and it says so itself). Keep saying it that way on stage.
6. Do a full dry run with no Claude, from start to stage demo, before flying. Follow `docs/STAGE_CHECKLIST.md`.
7. The public links do not work for judges in China: `vercel.app` is blocked there and `github.io` is unreliable.
   Demo from the laptop. A copy under `kalcerinstitute.com/fundbun` is being built on `~/kalcer-website` (T4).

**What changed on 18 Nov 2026 (so you are not surprised):** Bun answers questions about itself ("is this safe?",
"is this my real bank?", "what are your limits?", "what is a tripwire?", "delete my data") in English, Chinese
and Indonesian (`nlu.ts` rules `R-ABOUT-*`, copy in `voice.ts` / `voice-i18n.ts`); Chinese requests are understood
better and block reasons are translated (`REASONS_I18N`); a failed AI call falls back to the on-device engine in
10 s with a notice and a cool-down (`llm-engine.ts`, `controller/host.ts`); an older statement is mirrored from its
latest month (`viewDateOf` in `controller/derive.ts`); the approval sheet shows the sandbox demo PIN for demo
personas; a paused Bun shows an "Unfreeze in Settings" button. 19 Nov: **Add spending** on Home (`QuickAdd.tsx`,
`manualCandidate` in `home/model.ts`): type an amount and a few words, no file needed; it counts at once and can
trip a wire (`addSpending` now applies tripwires for this month's purchases).

**What changed on 19 Nov 2026, later the same day:**
- Importing is safe to repeat: several statement files for one month, overlapping files, and typed-in purchases
  are each counted once (`mergeTransactions` in `controller/data.ts`). Known limit: a wallet export plus the bank
  card that funded it shows one purchase under two names, and both are kept.
- Bun's temper (`finance/temper.ts`): the ladder above; a blowout day adds a step, every two logged days within
  the day limit take one off, a day with nothing logged is skipped. New faces `angry` and `furious` in
  `components/brand` (drawn in code; `burnt` still draws for saved cards). When Bun is angry the Home hero breaks
  the mirror and shouts (`shout`, `isAngry` in `home/model.ts`; "the broken mirror" in `MirrorHero.module.css`).
- Bun reacts the moment a purchase is added (`spendReaction` in `home/model.ts`, shown by `QuickAdd.tsx`), and
  answers "why are you angry?" in three languages (`R-ABOUT-MOOD`).
- Wording: the good state is "On target", with "left over" and "spend less than your target"; the bad one is
  "Over budget". Never write "under target" or "under budget" in the app: it reads like falling short.
- Bills with no bank connected (`finance/expected.ts`, `app.markBillPaid`): predicted from repeating charges,
  "Mark as paid" / "Undo", no PIN because FundBun pays nothing. Asked to pay, Bun says no bank is connected.
- Daily check-in (`finance/checkin.ts`, `CheckInCard.tsx`): seven-day stamp card, streak, a golden bun every
  seventh day. A check-in counts as a logged day for the temper; logging a purchase checks in by itself.
- Setup is four steps by default (`QUICK_FLOW` in `onboarding/logic.ts`); "Set up every detail instead" gives the
  full seven.

**What changed on 20 Nov 2026 (Odri's revision list):**
- The working copy is `~/fundbun-work`, outside iCloud (the Desktop copy kept getting offloaded). Commit, build and
  deploy from there.
- Log out (`components/account/LogOut.tsx`): Settings starts with who is using the app; demos "Leave", own data
  "Log out and delete" (there is no online account).
- Add spending asks the day (Today / Yesterday / Earlier). Goals take an optional target month (`targetDate`,
  `targetPlan` in `finance/dreams.ts`), shown with what it takes per month and per day.
- Over budget: a daily amount the user can live with (`finance/dailyplan.ts`, `DailyPlanSheet.tsx`), with what it
  costs the goal; it becomes the temper's day limit for that month.
- Daily tracking mode (`profile.mode = 'tracking'`): no target, no verdicts, target-based tripwires rest.
- Subscriptions can be added by hand (`finance/subscriptions.ts`); with no bank they become bills to expect.
- One screen reads any file (`screens/receipt/readFile.ts`): photo, PDF, .xlsx, .docx, CSV, text. Statements become
  rows to import (`core/receipt/statement.ts`); one receipt or bill becomes a draft ("I paid this" / "A bill to
  pay" → `app.addBill`). OCR ships with the app (`scripts/ocr-assets.mjs` → `public/ocr`, generated at every dev
  and build); the CSP allows `'wasm-unsafe-eval'` and same-origin workers only.
- Storage meter and a save-failed banner (`components/account/StorageMeter.tsx`, `app.storageStatus()`).
- Move to another device: `app.exportBackup(password)` / `app.restoreBackup(text, password)`, encrypted like the
  vault. One-way, no sync: real accounts need a server (open decision).

**What changed on 25 to 26 Nov 2026 (desktop app and bring your own AI, branch `desktop`):**
- **Desktop app (`desktop/main.ts`, `scripts/desktop-build.mjs`):** Electron wrapper around `server/local.ts`
  (`127.0.0.1:47600`), with a sandboxed window (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`),
  ad-hoc signed macOS `.app` and `.dmg` (`npm run desktop:build`), and OS Keychain encryption (`safeStorage`, `safe:`
  prefix) for saved API keys.
- **Full desktop layout (`DeskShell`, T2):** responsive breakpoints from 900px (sidebar, dashboard, Ask Bun panel,
  drawer under 1280px, Glass Box) while keeping the phone layout on narrow screens.
- **Plug in your own AI (`server/ai/`, `src/core/ai/`, `src/ui/components/ai/`):** **Your AI** sheet and Ask Bun
  model chip. Starts on **Built-in engine**; users can connect API keys (DeepSeek, Qwen, Kimi, GLM, OpenAI, Claude,
  Gemini, Grok, OpenRouter, custom OpenAI-compatible), local models (Ollama, LM Studio), or CLI agents over ACP (Claude Code,
  Codex, Antigravity, Qwen Code, Gemini CLI, OpenCode, Kimi Code, custom ACP command). Connections live on the user's computer in
  `~/.fundbun/connections.json` (mode `0600`); keys never reach the web page (`hasKey` only).
- **Plans:** Free plan = bring your own AI (or built-in engine); Pro plan (FundBun supplies the model) is planned, with
  no price set and not built.
- **Agent mode & security (`server/agents/`, `mcp-bridge.mjs`, `agent-engine.ts`):** ACP agents run in
  `~/.fundbun/workspace` with `fs` and `terminal` ACP capabilities disabled, receive FundBun's 20 T0-T3 tools via a
  token-authenticated stdio MCP bridge (`POST /api/agent/mcp`, rejecting any `Origin` header), and pass every tool call
  through the same `evaluatePolicy()` gate (`mcp__fundbun__<tool>` id check only). `asksFirst()` switches agents into an
  ask-first mode and fails closed if impossible; native agent tools (shell, files) always ask the user first.
- **`log_spending` tool & email receipts (T5):** T1 tool that lets a connected AI log a purchase it found (always waits
  for a user tap regardless of autonomy); `sensitive_request` NLU rule narrowed so reading the user's own email receipts
  reaches a connected AI while still blocking data exfiltration.
- **Open "Beyond money" mode & Markdown:** with a user's own AI connected, Bun can answer general questions in safe
  Markdown (`Markdown.tsx`, no remote links or images) while money figures stay grounding-checked (`moneyOnly`).
- **No em dashes (T1):** removed em dashes (U+2014) from user-facing copy, prompts, and docs; guarded by
  `src/core/agent/no-em-dash.test.ts`.
- **Tests (T3):** new test suites for `server/ai/*`, `server/agents/*`, `src/core/ai/client.ts`, `agent-engine.ts`,
  `open-mode`, `Markdown`, and `DeskShell`. Do not merge `desktop` into `main`, deploy, or publish a release without
  Odri's explicit say-so.

**What changed on 25 Nov 2026, later (Creator Mode and chat attachments, branch `desktop`):**
- **Desktop Creator Mode (`server/plugins/`, `src/core/plugins/`, `src/core/agent/creator-tools.ts`,
  `src/ui/components/plugins/`):** Settings > Creator Mode (on with the PIN). Then Bun can draft Dashboard or Home
  widgets in the chat: a live preview card with Install / Discard and See code. Widgets run in a sandboxed iframe
  with no network and get a read-only, PII-free snapshot. Three starters ship. Files in `~/.fundbun/plugins/<id>/`.
- **Attach files or a folder in the chat (`src/ui/screens/chat/attach.ts`, `src/core/agent/attachments.ts`):**
  paperclip and folder buttons in the chat box. Read on the device, sent to the user's own AI as untrusted data;
  the built-in engine says files need your own AI.

## 8. Rules for you
- Run `npm test` after every change; don't leave the app broken. Small commits with clear messages.
- **Agent-directing linter (`scripts/lint-agents.ts`, enforced by `tests/lint-agents.test.ts`):** Inspired by `dmmulroy/anti-slop` and `Factory-AI/eslint-plugin`, FundBun runs 13 zero-dependency AST and boundary checks on every test run (`no-chained-type-assertions`, `no-as-any`, `no-object-parameters`, `no-reflect-apply-or-get`, `no-reduce-accumulator-copy`, `no-shape-in-symbol-names`, `no-module-mocking`, `no-ts-suppression`, `fundbun/layer-boundaries`, `no-dangerous-html-or-eval`, `no-log-before-throw`, `no-empty-catch`, and `fundbun/no-forbidden-ui-copy`). Never work around failures with type assertions, module mocks, or `@ts-ignore`; follow the `Fix:` printed by the linter.
- Ask Odri before: publishing anything, pushing to the public repo, sending emails, spending money.
- Never type passport/ID numbers or put personal data, API keys or voice files in the repo.
- Report real measured numbers, not guesses.
- Odri finds complex tools confusing: one step at a time, say exactly what to type or click, and check
  the result before moving on.
- Don't paste personal data, keys or ID documents into prompts.
