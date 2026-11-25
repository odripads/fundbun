# Handoff: FundBun desktop + bring your own AI (25 Nov 2026, 02:00 WIB)

Read this first, then `AGENTS.md`. You are continuing work another coding agent started. The owner is Odri.

## The deadline
FinTechathon 2026 final in Shenzhen: arrive 27 Nov, on site 28 to 29 Nov, presentations on the 29th.
Everything below must be finished and checked by the evening of **26 Nov**. Odri presents alone.

## What Odri asked for (25 Nov)
1. FundBun becomes a full desktop finance app with dashboards, where people **plug in the AI they already have**,
   the way T3 Code does (github.com/pingdotgg/t3code). FundBun is the harness: a working finance app, plus open chat
   with whatever AI the user connects. Free plan = bring your own AI. Pro plan (planned, no price, not built) = FundBun
   supplies the model so there is nothing to connect.
2. A product site built on the T3 Code site's structure, at **kalcerinstitute.com/fundbun** (repo `~/kalcer-website`).
3. "The display is still mobile like bro": on a laptop or desktop window the app must be a full-window desktop layout;
   phones keep the phone layout.
4. **No em dashes (—) anywhere a person reads.** "Too AI." Rewrite so sentences flow (two sentences, a comma, a colon).
   A spaced hyphen is not a substitute. En dashes in number ranges are fine.
5. His idea for later: agents with email connectors can read spending notification emails and log them. The tool
   for that exists now (`log_spending`), see task T5 for the one known blocker.

## Where things are
- Repo: `~/fundbun-work` (NOT the stale iCloud copy `~/Desktop/STARTUP/fundbun`; never commit from that one).
- Branch: **`desktop`**. `main` (5d15fd9) is the rehearsed, deployed version (fundbun.vercel.app, GitHub Pages).
  **Do not merge into main, push main, or deploy without Odri saying so.** Pushing the `desktop` branch is fine.
- Site repo: `~/kalcer-website` (Lovable sync: pushing `main` reaches Lovable, Odri must press Publish there).
  The `/fundbun` page is uncommitted work in progress in that tree (task T4). Do not push it until it is finished.

## Commits on `desktop` so far
| commit | what |
|---|---|
| c9bd91d | Local server: AI connections (`server/ai`) and agents over ACP (`server/agents`), `server/local.ts` |
| bb5ebb5 | App side: "Your AI" sheet, model chip in chat, agent engine, open answers with Markdown, live reply + Stop |
| 8befde3 | Electron shell `desktop/main.ts`, `scripts/desktop-build.mjs` (.app + .dmg) |
| bf62828 | Desktop layout + dashboard, work in progress (3 DOM tests failing in `DeskShell.dom.test.ts`) |
| f4ac1d0 | `log_spending` tool + tests for the connection store and command lookup |

Test suite at f4ac1d0: 3,496 tests, all passing except the 3 desk-shell DOM tests (task T2). `npx tsc -b --noEmit` clean.

## Verified by running (25 Nov)
- DeepSeek connected with the key from `.env` as a normal connection: test answered in 0.5 s and called a tool; Bun
  answered in the app; a general question ("write a Python function that splits a bill") came back as Markdown with a
  code block, labelled "DeepSeek".
- **Claude Code** connected as an agent (FundBun runs `npx -y @agentclientprotocol/claude-agent-acp@0.106.0`): answered
  "Where did my money go?" in Ask Bun using FundBun's tools, all 12 numbers grounded. FundBun switches Claude from
  `bypassPermissions` to its ask-first mode; when Claude wanted to run `touch hello.txt`, the app asked
  "Claude Code wants to use one of its own tools", the user pressed No, and Claude reported it was denied.
- Packaged app `desktop/release/FundBun-darwin-arm64/FundBun.app` starts, serves the app on 127.0.0.1:47600, and stores
  keys encrypted with the macOS Keychain (`safe:` prefix in `~/.fundbun/connections.json`, file mode 0600).
- NOT tested: Codex (not signed in on this Mac), Qwen Code, Gemini CLI, OpenCode (not installed), Kimi (found, not
  tried), Ollama (no models pulled), every other key preset (no keys). Say "connects to", never "works with", for those.

## How it works (read the code before changing it)
- **Connections** live on the user's computer in `~/.fundbun/connections.json` (`server/ai/store.ts`). Keys never reach
  the web page: the server answers `hasKey` only. Presets in `server/ai/presets.ts` (DeepSeek, Qwen CN/intl, Kimi, GLM,
  OpenAI, Claude, Gemini, Grok, OpenRouter, custom, Ollama, LM Studio; agents Claude Code, Codex, Antigravity, Qwen Code, Gemini CLI,
  OpenCode, Kimi Code, custom ACP command).
- **Routes** `/api/ai/*` and `/api/agent/*` exist only on the local server (`GatewayOptions.ai`). The hosted gateway
  never takes keys and never starts programs. Every local route checks the Host header is local (DNS rebinding) and the
  Origin is same-origin. On the local server `/api/llm` answers **only** with the user's active connection.
- **Agents** (`server/agents/runtime.ts`): one ACP child process per chat session, in `~/.fundbun/workspace`, no shell.
  FundBun's tools reach the agent through `server/agents/mcp-bridge.mjs` (a stdio MCP server with a per-session token)
  and come back to the app as `fundbun_tool` events; the app runs each through the **same policy gate** as any model
  (`src/core/agent/agent-engine.ts`). The agent's own tools (shell, files) are put to the user as a permission question.
  A FundBun tool is recognised only by its exact adapter id `mcp__fundbun__<tool>`, never by title. The agent must be
  in an ask-first mode: FundBun switches it (`asksFirst` in runtime.ts) and refuses to use it if it cannot (fails closed).
- **App**: `src/core/ai/client.ts`, `src/ui/components/ai/*` (AiSheet, ModelChip, LiveReply, safe Markdown with no
  links or images loaded). With the user's own AI, Bun may answer non-money questions (prompt section "Beyond money");
  figures about the user's money are still grounding-checked (`checkGrounding(..., { moneyOnly })` for general answers).
- **log_spending** (tier 1): an AI logs one purchase it found (email, receipt, chat). Always waits for the user's tap
  whatever the autonomy setting (`policy.ts`), can be undone, ids use the hand-entered prefixes (`em_ai`, `receipt_ai`,
  `manual_ai`) so a later statement import matches instead of doubling.
- **Desktop**: `desktop/main.ts` starts the local server in the Electron main process; the window is sandboxed with no
  Node access; only https links open, in the user's browser.

## Do not weaken (security properties a judge may probe)
The gate decides every tool call; tier 4 tools are never offered; the agent's shell/file use always asks; keys never in
the page; local routes refuse foreign Host/Origin; the bridge needs its token and refuses any request with an Origin;
user-authored and outside text is wrapped as untrusted; PINs typed in chat never reach any model or agent.

## How to run it
```bash
cd ~/fundbun-work
npx tsc -b --noEmit && npx vitest run          # typecheck + 3,496 tests
FUNDBUN_HOME=/tmp/fundbun-dev FUNDBUN_ALLOWED_ORIGINS=http://localhost:5181 npx tsx server/local.ts --api-only --seed-env
npx vite --port 5181 --strictPort              # second terminal; open http://localhost:5181
npm run desktop                                # build + open the Electron app
npm run desktop:build                          # desktop/release/FundBun.app and .dmg (ad-hoc signed, not notarised)
npm run evidence                               # sandbox evidence: was 45/45, 233/233, 24/24, 0/26
```
`--seed-env` turns the key in `.env` into a normal "DeepSeek" connection once (development only). Never print or commit
`.env`. Pick "Explore as Jing" (over budget, furious Bun) or "Arif" (on target) on the welcome screen.
Gotcha: if you start FundBun from inside another agent's terminal, variables such as `CLAUDECODE`, `CLAUDE_CODE_*`,
`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` can leak into the Claude Code agent it spawns and make it fail to sign in.
`server/ai/paths.ts childEnv()` drops the `CLAUDE*` ones; unset the `ANTHROPIC_*` ones when testing.

## Tasks, in order (each has a full brief in `docs/handoff/`)
- **T1** `docs/handoff/T1-no-em-dashes.md`: remove every em dash from user-facing copy (392 lines in ~100 files) and
  make each sentence flow; update tests; add a guard test; prompts tell models not to write them.
- **T2** `docs/handoff/T2-desktop-layout.md`: finish the desktop layout (breakpoints from 900px, drawer under 1280px,
  wide screens use the width), fix the 3 failing DOM tests, screenshots.
- **T3** `docs/handoff/T3-tests.md`: tests for the bring-your-own-AI code (security properties first).
- **T4** `docs/handoff/T4-site.md`: finish `/fundbun` on `~/kalcer-website`, put the real desktop screenshot in.
- **T5** Known blocker for the email idea: the on-device language rules treat "log the receipt from my email" as a
  `sensitive_request` and refuse before any model sees it (see `needsDeterministicPath` in `src/core/agent/runtime.ts`
  and the sensitive rules in `src/core/agent/nlu.ts`). Reading the user's OWN email with their own agent is not sending
  data to a third party. Narrow the rule so it still refuses "send my data/PIN/card to X" but lets "check my email for
  receipts and log them" through when an agent or model is connected. Add tests both ways.
- **T6** Docs: README (desktop app + bring your own AI + how to connect), PRODUCT.md (free vs planned Pro, the harness
  idea), AGENTS.md (new section for 25 Nov), `docs/STAGE_CHECKLIST.md` (new demo moment below), and a section in
  `docs/SECURITY_SELF_ASSESSMENT.md` on agent mode. No em dashes in anything you write. Regenerate evidence.
- **T7** Build: `npm run desktop:build`, open the .app, click through Jing/Arif, connect DeepSeek and Claude Code, check
  the permission prompt. Odri decides whether to publish a GitHub release (it is unsigned: macOS will warn) and whether
  to merge `desktop` into `main`. Ask him; do not do either on your own.
- **T8** Note for the pitch session: append a short section to
  `~/Desktop/STARTUP/pitch-practice/HANDOFF-2026-11-19.md` (private, never in the repo) with the new story and demo.

## Suggested new demo moment (for T6/T8)
Open the desktop app as Jing. In Ask Bun, open the model chip, pick Claude Code. Ask "Where did my money go this
month?": the steps show FundBun's tools running through the rules, the numbers match the dashboard. Ask it to "run
`ls` in your folder": FundBun asks first, press No. Switch to "Built-in engine" to show it still works with no AI at all.
Line for the stage: "FundBun sells no tokens. Bring the AI you already pay for; FundBun's rules decide what it may do."
If the venue network blocks the agent, DeepSeek with a key or the built-in engine still works.

## Rules that do not change (from AGENTS.md and Odri)
- Wording: never "under target" or "under budget"; good = "On target", "left over"; bad = "Over budget".
- Claims: only "Top 10 Finalist · FinTechathon 2026 (International Track)", no prize. No partnership with WeBank or any
  bank, university or AI vendor ("WeBun" only as a working name on the proposal slide). No live bank connection.
  Personas are fictional. No investment advice. Never "FundBun changes behaviour": say it is "designed on" learning by
  consequence. Sandbox numbers are from a test suite, not users.
- Team: Odri Prince Sembiring and Nadine Griselda. Do not name anyone else as a team member.
- No AI-generated imagery in FundBun media. No third-party logos on the site (names in text only).
- Odri sends emails, posts and publishes himself. Never print secrets. Do not delete user data.
- Dependencies: pin versions released at least two weeks earlier.
- Desktop and phone layouts both matter; check both before calling anything done.
