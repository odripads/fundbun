# T4: Finish the FundBun page at kalcerinstitute.com/fundbun

Repo `~/kalcer-website` (Vite + React + Tailwind + shadcn, synced to Lovable). Work in progress, uncommitted:
`src/pages/FundBun.tsx`, `src/components/fundbun/**`, `public/fundbun/**`, route in `src/App.tsx`, link from
`src/components/labs/data.ts`. Read `~/.claude/projects/-Users-odripads/memory/project_kalcer_website_lovable.md` for the
site's traps (no full-viewport fixed layers, no big blur, no document-wide blend modes, no new npm deps, explicit .html
paths for static files, `src/lib/smooth-scroll.tsx` must not be shadowed).

## Brief
Structure follows t3.codes (hero with download, app screenshot, "bring your own subscription" list, safety, open source,
final CTA), but T3's trademark policy forbids their name, logo, icons and visual style: the look, words and illustrations
are FundBun's own (palette and type from `~/fundbun-work/DESIGN.md`, the Bun mascot). Never mention T3 on the page.
Sections: Nav · Hero ("The money app / that works with / the AI you already have.", badge "Top 10 Finalist · FinTechathon
2026 (International Track)") · screenshot · Bring your own AI (agents you are signed in to / API keys / on your laptop) ·
The gate (the model proposes, FundBun's rules decide, paying needs your PIN) · Carrot and stick (happy and furious Bun) ·
Yours, on your computer · Open source (MIT; `git clone https://github.com/odripads/fundbun`, `npm install`,
`npm run dev`) · Footer (Kalcer Labs, GitHub, hello@kalcerinstitute.com, "FundBun is a prototype from Kalcer Labs. The
bank in the demo is simulated; no real money moves.").

## Facts (all in `src/components/fundbun/data.ts`)
- Tested on 25 Nov: Claude Code (agent over ACP) and DeepSeek (own key). Only these two rows `status: 'tested'`.
  Everything else "connects to", untested. Plans: Free = bring your own AI; Pro planned, not available, no price.
- Download: keep `DOWNLOAD.url = null` (shows "run from source") until Odri approves a release.
- Screenshot: put a real 1440 dashboard shot from T2 at `public/fundbun/app-desktop.webp` and set `SCREENSHOT`.
- No em dashes anywhere on the page. No third-party logos, no testimonials, no invented numbers, no AI imagery.

## Done when
`npx tsc --noEmit` and `npm run build` clean; screenshots at 1440x900 and 390x844 look finished; hero fits one screen at
both sizes; no third-party request on load. Then commit and push `main` only after Odri has looked at it, and remind him
to press Publish in Lovable.
