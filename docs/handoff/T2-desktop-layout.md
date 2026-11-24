# T2: Finish the desktop layout

State: commit bf62828. `src/ui/components/desk/**` (useDeskMode, DeskShell, ViewSwitch), `src/ui/screens/dashboard/**`
(cards + hand-drawn SVG charts in `charts/`), `src/ui/App.tsx`. Desk mode is on at >= 1100px unless the saved preference
`fundbun.view` is 'phone'. Earlier screenshots: ask Odri, or take new ones (below).

Odri's feedback: "the display is still mobile like bro, remember to pivot into desktop style rectangle for desktop and
mobile for mobile". The Electron window opens at 1440x920; the in-app browser he previews in is often 1000 to 1200px.

## To do
1. Breakpoints: desk layout from **900px**. 900 to 1279px: sidebar may become an icon rail; the right panel (Ask Bun /
   Glass box) becomes a drawer, closed by default, opened by an Ask Bun button in the top bar. From 1280px the panel sits
   beside the content. Below 900px: exactly the old phone layout (`AppFrame`). Remember the user's panel choice.
2. Fix the 3 failing tests in `src/ui/components/desk/DeskShell.dom.test.ts` (decide whether test or code is wrong).
3. No phone-shaped columns inside the desk layout: Bills, Goals, Insights, Settings, Activity use the width (two columns
   or a readable centred column about 720px wide). No holes in the dashboard grid, chart labels readable, nothing
   clipped, dark mode checked. The chat composer (model chip, live reply, Stop) must fit the panel.
4. Route `chat` in desk mode opens/focuses the panel; the Ask Bun tab shows the pending approval count.
5. No em dashes in any text you add (labels, aria labels, test names).

## Check
`npx tsc -b --noEmit`, `npx vitest run`. Screenshots with Playwright (`channel: 'chrome'`, see
`scripts/capture-screens.ts` for loading Jing and Arif) at 1440x900, 1280x800, 1024x768, 920x700, 390x844: dashboard as
Jing and as Arif, Bills, Goals, Insights, Settings, chat panel open, dark mode once. Look at every one. The 390 shots must
match the old phone layout. Save the best 1440 dashboard shot for the site (T4).
