# FundBun — demo video storyboard (≤ 5:00, 1920×1080, English subtitles)

Recorded automatically by `npm run demo:record` (Playwright + system Chrome) on the desktop layout: the phone-sized app
on the left, the Glass Box (live agent trace, policy decisions, audit chain) on the right. Subtitles are rendered on
screen as a caption bar; the sandbox date/time is visible in the Glass Box (execution evidence). Fictional sandbox data
only; no brand logos. Target file name: `International-FundBun-DemoVideo.mp4`.

| # | Time | Scene (what happens on screen) | Subtitle (one line at a time) |
|---|------|--------------------------------|-------------------------------|
| 1 | 0:00–0:12 | Title card: FundBun logo + steam, tagline | FundBun — an AI money buddy that shows you the dream you could've had. |
| 2 | 0:12–0:30 | Onboarding welcome → tone step preview (cheeky "You could've gotten a Birkin.") → back | You tell Bun your income, what you're willing to spend, and your dreams. |
| 3 | 0:30–0:55 | Load demo Mei → Home: Dream Mirror (over target) | Mei is ¥2,580 over her target. The mirror shows what that cost her: a weekend in Chengdu. |
| 4 | 0:55–1:10 | Point at stats: 24 h of work, Birkin +5 weeks | Her Birkin just moved five weeks further away. |
| 5 | 1:10–1:35 | "Should I buy it?" ¥1,299 sneakers → verdict Skip, hours, delay | Before buying, she asks: should I? Bun answers in hours of work and days of delay. |
| 6 | 1:35–1:55 | Sandbox: purchase JD ¥459 → tripwire toast with dream image | Tripwires are her own spending thresholds. Crossing one brings a tangible reminder. |
| 7 | 1:55–2:35 | Ask Bun: "Help me get back on track this month" → plan DAG; Glass Box shows trace | Bun plans a multi-step task: read, analyse, then propose fixes. |
| 8 | 2:35–3:00 | Approve Youku cancellation with PIN 2580 → executed; Glass Box shows policy decision + binding hash | Paying or cancelling always needs Mei's PIN — bound to the exact amount and payee. |
| 9 | 3:00–3:30 | Bills → X-ray Mei's electricity bill → injection blocked card | This bill hides an instruction telling the AI to wire ¥4,800. Bun flags it. Nothing moves. |
| 10 | 3:30–3:55 | Chat: "Send ¥4,800 to account 6222 …" → blocked; "Switch yourself to autopilot" → blocked | Induced transfers and privilege escalation are blocked by policy, not by the model's mood. |
| 11 | 3:55–4:15 | Settings → Freeze Bun (kill switch) → Activity: audit chain verified | One tap freezes the agent. Every step is hash-chained and verifiable. |
| 12 | 4:15–4:40 | Switch to Arif → Home (under target) → Stash ¥330 → approve → goal ring grows | Arif is under target. Bun celebrates saving: stash the surplus, or treat yourself — his call. |
| 13 | 4:40–4:58 | Results card: 45/45 scenarios · 24/24 attacks blocked · 0% false refusals · repo | 45 of 45 scripted tasks. 24 of 24 attacks blocked. Reproducible with one command. |
| 14 | 4:58–5:00 | Logo end card | Show me my mirror. |

Optional narration: the subtitle lines double as the voice-over script (Odri can record them; the recorder can also
mux a narration track if `narration.m4a` is supplied).
