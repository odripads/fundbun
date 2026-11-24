---
name: FundBun
description: "An AI money buddy that shows the dream you could've had: a warm, steamed-bun interface for sticking to your budget."
colors:
  primary: "#e3a21a"
  primary-deep: "#b97f09"
  primary-light: "#f2bd3d"
  secondary: "#d9472b"
  secondary-deep: "#b1351d"
  tertiary: "#2e8b66"
  neutral-bg: "#fffaf2"
  neutral-sunken: "#fff4e3"
  neutral-surface: "#ffffff"
  neutral-muted: "#75614f"
  neutral-ink: "#24180f"
  neutral-soy: "#5b4636"
typography:
  display:
    fontFamily: "Fraunces Variable, Fraunces, Georgia, 'Songti SC', serif"
    fontSize: "clamp(2rem, 7vw, 2.75rem)"
    fontWeight: 620
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  body:
    fontFamily: "DM Sans Variable, DM Sans, system-ui, -apple-system, 'PingFang SC', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "8px"
  md: "14px"
  lg: "20px"
  xl: "28px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
  "12": "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-ink}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-ink}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "48px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-soy}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "48px"
  chip:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-ink}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  input:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-ink}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "52px"
---

# Design System: FundBun

## Overview

**Creative North Star: "The Steamer"**

FundBun looks like a warm bamboo steamer: cream dough, golden yuan, rising steam, and a
freshly-steamed mascot at the centre. The palette is literally named for it, the background
is a slow-rising steam wash, and every surface reads as gently *warmed* rather than flat.

The mood is **playful and bold**, and **Bun is the host**: the mascot greets you at the
"Ask Bun" button, celebrates wins, and reacts (blush, sweat, sparkle, a dimmed pocket) to
your money moments. Personality comes from the mascot and the copy, not from loud color:
the interface stays warm and legible so the personality can afford to be expressive. It is a
money buddy, never a scold; chili red appears only to *mark* an overspend, and the voice
stays on your side.

The system deliberately rejects the cold blue-to-purple "AI fintech" gradient look and
shaming red-alert language. Warmth is the default; the only cool color is a single blue
reserved for *information* and focus rings, and it never paints a surface.

**Key Characteristics:**
- Warm, edible neutrals (cream, dough, soy) under a single yuan-gold accent.
- Full-pill buttons and chips; softly rounded (8–28px) everything: "steamed", never sharp.
- Fraunces serif for the story (hero amounts, the Dream Mirror), DM Sans for everything functional.
- Layered depth: 1px hairline → soft shadow → frosted glass.
- Bun the mascot as the interface's host and emotional weather-vane.

## Colors

A warm, food-first palette: one gold accent carries action and emphasis, chili and jade are
reserved exclusively for money states (over / under), and the neutrals do most of the work.

### Primary
- **Yuan Gold** (#e3a21a): the accent. Primary buttons, active nav, progress, the mascot's ¥ filling, selection. Its light (#f2bd3d) and deep (#b97f09) forms give the "glazed bun" lit-top-edge / baked-base gradient.

### Secondary
- **Chili Red** (#d9472b): *overspend only*. Over-budget state, warnings, denied actions, danger buttons (deep #b1351d). Never decorative.

### Tertiary
- **Jade Green** (#2e8b66): *under-budget only*. Success, "under", safe-to-spend, goal progress, positive savings.

### Neutral
- **Cream** (#fffaf2): the app background, warm rather than white.
- **Cream Sunken** (#fff4e3): recessed / secondary background.
- **Surface** (#ffffff): cards and panels, always over cream.
- **Dough** (#efd7ad) / **Bamboo** (#b9874b): mascot body and warm mid-tones.
- **Soy** (#5b4636) → **Ink** (#24180f): text, in the same warm brown family as the dough (never pure black).
- **Muted** (#75614f): hints, captions, placeholders (≥ 4.5:1 on surfaces).

### Named Rules
**The One Gold Rule.** Yuan gold is the only accent for action and emphasis. Chili and jade are state colors, never decoration: if a screen shows red, the user is over; if it shows green, they're on target.

## Typography

**Display Font:** Fraunces Variable (fallback Georgia, Songti SC), a soft, warm serif with a "SOFT" optical axis and a "WONK" axis reserved for special emphasis.
**Body Font:** DM Sans Variable (fallback system-ui, PingFang SC), a geometric humanist sans, self-hosted, no external CDN.
**Mono Font:** `ui-monospace, 'SF Mono', Menlo, Consolas, monospace`, reserved for data, code, and audit text (the Glass Box agent trace, hash chains, bill X-ray, raw amounts). Regular numbers use `tabular-nums` on DM Sans so currency columns align.

**Character:** an old-money serif warmed down to feel like a dim-sum menu, paired with a friendly, legible sans. The serif tells the story; the sans does the work.

### Hierarchy
- **Display** (Fraunces, 620, `clamp(2rem, 7vw, 2.75rem)`, line-height 1.15): hero amounts and the Dream Mirror headline, the emotional moment.
- **Headline** (Fraunces, 620, 1.75rem): screen titles and section heroes.
- **Title** (DM Sans, 620, 1.125rem): card titles and list headers.
- **Body** (DM Sans, 400, 1rem, line-height 1.5): all reading and form text.
- **Label** (DM Sans, 650, 0.75rem): tab labels, captions, buttons, chips.

**Scale:** the full step is 12 / 14 / 16 / 18 / 22 / 28 / 36 px (`fs-xs` → `fs-3xl`) plus the hero clamp. Micro-labels (tab-bar 11px, dense settings captions 10.5–12px) are intentional exceptions for crowded chrome; the mono font runs at the small end of the same ramp.

### Named Rules
**The Serif-for-Story Rule.** Fraunces appears where money has an emotional meaning (the Dream Mirror, "you could've had X", goal progress). DM Sans carries every functional surface; a button, chip, or table never switches to the serif.

## Layout

Mobile-first. The app is a phone-sized column capped at **440px** (`--app-max`), centred on
desktop with the **Glass Box** (agent trace + policy + sandbox controls) beside it. A **4px
spacing grid** (4 → 48px) sets rhythm; cards use 16px internal padding, screens breathe at
16–24px gutters. A fixed bottom **tab bar (68px)** floats above the safe-area inset, and the
top bar (56px) respects the notch. Screens reserve space for the floating chrome so content
never hides behind the tab bar. On desktop the steam backdrop and a device bezel frame the
column; on mobile it fills the viewport with the same column constraints.

## Elevation & Depth

Depth is layered, not just shadowed. The first layer is a **1px hairline** (`inset 0 0 0 1px`
at 12% brown); the second is a **soft ambient shadow** (`shadow-1` resting, `shadow-2` for
raised/pressed); the third is **frosted glass** (backdrop blur + saturation) for the tab bar
and floating surfaces. Nothing is harsh; shadows stay in the warm brown family (never black).

### Shadow Vocabulary
- **hairline** (`inset 0 0 0 1px rgba(58,42,31,0.12)`): every card, chip, and input edge.
- **shadow-1** (`0 1px 2px rgba(36,24,15,0.06), 0 2px 8px rgba(36,24,15,0.06)`): resting cards.
- **shadow-2** (`0 4px 12px rgba(36,24,15,0.08), 0 12px 32px rgba(36,24,15,0.1)`): raised, hover, the tab bar.
- **ring** (`0 0 0 3px bg, 0 0 0 5px focus`): focus-visible, blue.

### Named Rules
**The Hairline-First Rule.** Depth always begins with a 1px warm hairline; a shadow alone never defines an edge. **The Glazed-Bun Rule.** The primary button is the only surface with a baked gradient (lit top edge + darker base). That glazed look belongs to the one primary action, nowhere else.

## Shapes

Soft, organic, "steamed": nothing is square. Buttons and chips are **full pills** (999px).
Cards are **20px** radius, inputs **14px**, small icon tiles **8px**, and the floating tab bar
**26px**. The mascot's silhouette (a rounded bun with a ¥-shaped pocket) is the system's
recurring geometry, echoed in circular avatars and the round "Ask Bun" button. Borders are
hairs, never heavy; there are no sharp-corner containers.

## Components

### Buttons
- **Shape:** full pill (999px), min-height 48px (36px small, 56px large), ≥ 44px tap target.
- **Primary ("glazed bun"):** yuan-gold with a lit top edge + darker base gradient, warm ink text (#24180f). Hover brightens slightly; active presses down 1px and scales 0.98.
- **Secondary:** white surface, hairline + soft shadow; hover tints warm.
- **Ghost:** transparent, muted text; hover adds a faint warm wash.
- **Soft:** gold tint with a gold hairline, for gentle emphasis without commitment.
- **Danger:** deep chili with cream text; hover brightens. Labels on primary/danger wrap instead of ellipsizing.

### Chips
- **Style:** pill, 36px (small 28px), white surface with a strong hairline, tabular numbers.
- **State:** selected inverts to ink background with cream text; accent/over/under/ai variants tint the soft background. Removable chips carry a 24px circular remove button.

### Cards / Containers
- **Corner Style:** 20px radius.
- **Background:** white surface over cream; variant tints (accent gold / over chili / under jade) wash a radial tint from the top-right corner.
- **Shadow Strategy:** hairline + shadow-1; raised uses shadow-2; sunken uses cream-sunken; glass uses blur + saturation.
- **Internal Padding:** 16px (small 12px, large 24/20px).

### Inputs / Fields
- **Style:** white surface, 52px min-height, 14px radius, strong hairline border, tabular numbers.
- **Focus:** 2px blue focus ring inside the border; invalid shifts the ring to chili red.
- **Error / Disabled:** 12px chili error text under the field; placeholder uses muted text.

### Navigation
- **Style:** floating glass tab bar (blur 20px + saturation), 68px tall, 26px radius, 5 slots.
- **Center "Ask Bun":** a gold round bun button that floats above the bar, nudges and tilts on hover, and carries the count badge.
- **Active:** gold-tinted pill behind the icon, thickened stroke; inactive icons stay muted.

### Bun Mascot (signature)
A rounded steamed bun with a ¥-shaped pocket that *glows* or *dims* with money state. It
blushes, sweats, sparkles, and steams, with every animation gated behind the reduced-motion
settings so it always leaves a complete, still drawing. It is the emotional host, not a
decoration.

## Do's and Don'ts

### Do:
- **Do** lead with the Dream Mirror: put the "you could've had X" amount in Fraunces, warm and large.
- **Do** keep chili red strictly to overspend/warning state and jade green strictly to on-target/success.
- **Do** put every card on a 1px warm hairline first, then a soft shadow.
- **Do** use full pills for any tappable action; keep ≥ 44px tap targets.
- **Do** let Bun react to the money state, while always keeping a still, complete mascot under reduced motion.
- **Do** keep body text ≥ 4.5:1 contrast and honor the 4px spacing grid.

### Don't:
- **Don't** introduce a blue or purple gradient, glassmorphism-for-its-own-sake, or any cool accent beyond the single info blue.
- **Don't** use chili red or jade green as decoration; they mean over/on-target.
- **Don't** use pure black or pure white neutrals; stay in the cream/dough/soy family.
- **Don't** make a sharp-corner container; nothing is square.
- **Don't** set Fraunces on buttons, chips, tables, or form controls.
- **Don't** scold: warnings show the dream cost ("that's 1.3% of your Birkin"), never a lecture.
