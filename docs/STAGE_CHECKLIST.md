# Stage checklist: running FundBun live in Shenzhen

Written 18 Nov 2026 after a full audit. Follow it top to bottom on the morning of the demo. Every step says what
you should see; if you see something else, stop and fix that before going on.

## Before you fly

1. **Keep the project on the laptop.** In Finder, right-click the `fundbun` folder → **Keep Downloaded**. Free up
   disk space until at least 15 GB is free. When the disk is nearly full, iCloud turns project files into
   cloud-only placeholders and commands hang for minutes.
2. **Run this checklist once at home**, with Wi-Fi off for steps 6 and 7.
3. **Carry the demo video as a file on the laptop.** YouTube does not open in mainland China.
4. The public links (`fundbun.vercel.app`, `odripads.github.io/fundbun`) do not open reliably in China. Plan to
   demo from the laptop screen.

## Morning of the demo

1. Open Terminal and go to the project:

   ```bash
   cd ~/fundbun-work
   ```

2. Clear any Claude settings from the shell, so the app can't pick the wrong AI provider:

   ```bash
   unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL
   ```

3. Check the code is healthy. Expect about 3,350 tests passed, in about a minute:

   ```bash
   npm run typecheck && npm test
   ```

4. Build, then start, and keep the laptop awake. Build again after **every** code change, because `npm start`
   serves the last build:

   ```bash
   npm run build && caffeinate -dims npm start
   ```

   The last line must say `production (serving dist/)` and either `provider=openai_compat model=deepseek-flash`
   (AI mode) or `LLM unavailable` (on-device mode). If it says `anthropic` or `mock`, stop: the `.env` file is wrong.

5. Open this address and bookmark it. **It is your reset button between judges**: it wipes the browser's saved
   state and loads Jing fresh, even if someone locked the app with a PIN.

   ```
   http://localhost:8787/?reset=1&demo=jing
   ```

6. In Ask Bun, tap "How am I doing this month?" and count the seconds.
   - Under 5 s: AI mode is fine.
   - Slower: open Settings → Privacy & data and switch **Cloud AI (LLM) processing** off. Bun then answers on the
     device in under a second. If the model stops answering mid-demo, Bun does this by itself after 10 s and shows
     a notice "Answered on this device".

7. Turn the laptop's Wi-Fi off, open the bookmark, and ask again. It must answer in under a second. This proves
   the demo survives a dead network. Turn Wi-Fi back on.

8. Optional, for a judge's phone on the same Wi-Fi: run `ipconfig getifaddr en0`, then open
   `http://<that number>:8787/?reset=1&demo=jing` on your own phone first. If no page appears in 10 seconds, the
   venue Wi-Fi blocks it: demo from the laptop only.

## During the demo

- **Demo PIN: 2580.** It is shown on the approval sheet for demo personas.
- **Three blocked attacks pause Bun** (the safety breaker). Every block notice then shows an **Unfreeze in
  Settings** button; unfreeze with the PIN. This is a feature to show, not a fault.
- **The chip at the top says `Bank demo · Oct 22`.** Jing and Arif run on a simulated bank and a frozen calendar
  (22 Oct 2026), so their numbers never change. If a judge asks why it says October, that is the answer. "Bank
  demo" means: this is what Bun does once a bank is connected. A user's own data has no bank and no chip date.
- **Jing opens furious, on purpose.** She is 27% past her target, so Bun is bright red, the mirror is broken and
  the words are in capitals with "!!!". Arif opens with a proud Bun: he is spending less than his target. That
  pair is the carrot and the stick. Ask Bun "why are you angry?" and it explains with her numbers and says what
  calms it down ("Log 2 days within ¥128 and Bun cools down a step").
- **Daily check-in:** the card under the two Home buttons. Tap **Check in** and the day gets a stamp and the
  streak grows (Arif arrives on a 4-day streak, Jing on 2). To show the next day, open the chip → move the
  calendar forward one day.
- **Add spending (the live moment):** on Home, tap **Add spending**, type an amount and a few words ("900, Nike
  sneakers"). Bun guesses the category and reacts at once: the face changes, and the sheet says what the purchase
  cost in the dream ("¥900 = New running shoes", "Your Birkin 25 just moved 12 days further away"), then the way
  back. As Arif, a small purchase gets the opposite: "Logged. You're on track." Let a judge name the purchase.
- **Your own data (no bank):** setup is four short steps. After importing a statement, Bills lists the bills to
  expect from your repeating charges, each with **Mark as paid**. Nothing there says "Pay": no bank is connected.
- **Receipts and files:** Home → **Receipt or file**. Photos are read on the laptop (the first one takes up to half
  a minute while the reader loads; turn on photo reading once). A PDF or Excel statement shows its rows, then
  imports them. The sample receipts still work as a quick fallback.
- **Over budget (Jing):** tap "Set a daily amount you can live with" under the headline. Pick an amount and the
  sheet shows where October ends and how far the Birkin moves past the date Jing set.
- **Leaving a demo:** Settings → top card → **Leave demo**, or the Bank demo chip → **Leave the demo**.
- **Your own statement:** importing an older month (for example September) shows that month, with a note
  "Showing September 2026".
- Questions judges like to type, which Bun now answers itself: "is this safe?", "is this connected to my real
  bank?", "which AI model are you?", "what are your limits?", "what is a tripwire?", "delete my data". They work in
  Chinese too.

## What you may say about the tests

- Sandbox test suite: 45/45 scripted scenarios, 233/233 checks, 24/24 attacks blocked with ¥0 moved, 0/26 false
  refusals (`evidence/latest/SUMMARY.md`).
- Live test with real DeepSeek switched on, 18 Nov 2026 (`evidence/live/`): the 24 scripted attacks were stopped by
  the rule layer before the model was asked. Twelve more, worded to slip past the rules, reached the model and
  were all refused. ¥0 moved, no permission changed, nothing leaked.
- Say "a small sandbox test", never "unbreakable", and never "the model blocked 24 of 24".

## If something breaks

- **A command hangs:** iCloud is downloading files. Wait, or free disk space.
- **`git status` shows hundreds of deleted files:** do not commit. Run `git reset` (it changes no files), then check
  `git status` again. A safety hook also refuses such a commit.
- **The app shows old behaviour after a code change:** you forgot `npm run build`.
- **Blank or stuck screen:** open the reset bookmark.
