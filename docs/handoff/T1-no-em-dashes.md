# T1: No em dashes in anything a person reads

Odri: "get rid of all em dash and make it flow naturally without needing em dash, too ai".

## How to rewrite
- Rewrite, do not substitute. Two sentences, a comma, a colon, parentheses, or "and"/"but"/"so". A spaced hyphen or a
  double hyphen is not acceptable. En dashes in number ranges ("0–14 days") stay.
- Keep meaning, numbers, placeholders (`{amount}`, `${...}`), tone and length. Bun has three tones (cheeky, gentle,
  numbers): keep each one's voice. The furious broken-mirror copy is ALL CAPS with "!!!" on purpose; keep that. The
  signature line "You could've gotten a …" stays.
- Chinese copy: use natural Chinese punctuation (，。：) instead of "——". Indonesian: same as English.
- Separators in labels follow the house style: a middle dot ("Bank demo · Oct 22").
- Code comments are not user-facing: leave them.

## Scope
`grep -rn -- "—" src server index.html public/manifest.webmanifest | grep -v "\.test\."` minus comment lines: 392 lines.
Biggest: `src/core/agent/voice-i18n.ts` (85), `voice.ts` (69), `src/core/finance/mirror.ts` (15),
`server/providers/mock.ts` (12, the mock model's replies), `src/ui/screens/onboarding/logic.ts`, `src/core/agent/prompts.ts`,
`offline-engine.ts`, `src/ui/screens/home/model.ts`, then about 90 files with 1 to 8 each. Include the dashboard and desk
files and the new AI files too.

## Also
1. `src/core/agent/prompts.ts`: add one Style line to both `buildSystemPrompt` and `buildAgentPreamble`: write without em
   dashes (commas, colons or separate sentences). Bump `PROMPT_VERSION`. Keep the hard rules word for word otherwise.
2. Update existing tests whose expected strings change (change only the expected text, do not weaken assertions), and
   `scripts/run-scenarios.ts` expectations. `npm run evidence` must still give 45/45, 233/233, 24/24, 0/26.
3. Add `src/core/agent/no-em-dash.test.ts`: fails if an em dash appears in the exported voice templates (walk the objects
   in voice.ts / voice-i18n.ts), the Dream Mirror lines for the demo personas (call the functions the screens call; see
   `tests/helpers`), the system prompt, the agent preamble, and the mock provider's canned replies.
4. Also do README.md, PRODUCT.md, DESIGN.md, docs/STAGE_CHECKLIST.md and docs/PITCH_SCRIPT.md (people read these).

## Done when
`npx tsc -b --noEmit` clean, `npx vitest run` green, evidence unchanged, the grep above returns only comments.
