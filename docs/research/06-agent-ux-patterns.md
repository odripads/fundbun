# 06 — Agent UX patterns: trustworthy finance agents + playful finance UX

*Research note for FundBun (Shenzhen FinTechathon 2026, Topic A). Compiled 2026-10-08. Citations are bracketed [S#] and resolve in **Sources**.*

## Key takeaways for FundBun

- **Confirm the exact action, not the idea.** Leading agent products confirm state-changing actions in a card that binds the specific amount, payee and time. OpenAI reports that confirmations cut model-mistake risk by about 90% [S1]. Google's AP2 signs a "Cart Mandate" so that "what you see is what you pay for" [S2]. FundBun's action card should hash its own content and execute only that.
- **Autonomy is a design dial, not a capability.** The five-level user-role model (operator → observer) [S8] and Karpathy's "autonomy slider" [S9] map cleanly onto FundBun's permission tiers. At every level the user keeps activity logs plus an "emergency off switch" [S8].
- **Make loosening slow and tightening instant.** Monzo makes users wait out a 2-day-to-1-year cooldown before switching its gambling block off [S11]. China's payment-clearing industry association and consumer association have criticised password-free payments that were switched on by default and hard to switch off [S12][S13]. Default to low autonomy and make "off" one tap.
- **The Dream Mirror rests on solid behavioural evidence, and also carries a dark-pattern risk.** A photo-labelled goal increased savings [S24], and seeing a vivid future self increased patience with money [S25]. However, the FTC lists "confirm shaming" as a dark pattern [S31], and Robinhood dropped its confetti under regulatory criticism [S30]. Frame the mirror as progress, make roast-style copy opt-in, and celebrate saving, never spending.
- **Compliance is part of the UX.** China requires prominent AI-content labels on interactive interfaces (since 2025-09-01) [S22]. The CFPB warns against chatbot "doom loops" with no human offramp [S18]. The FTC fined Cleo $17M partly over hard-to-cancel subscriptions [S20]. China's elder-friendly app spec bans inducement buttons [S33].

---

## 1. Presenting agent-proposed actions

| Pattern | Evidence | Lesson for FundBun |
|---|---|---|
| Confirm before state-changing actions | Operator asks "before finalizing actions that affect the state of the world". Recall was 92% on 607 risky tasks, confirmations reduced risk by about 90%, and banking transactions were proactively refused (94% recall) [S1] | Every money-moving action goes through a card. No action is ever silently executed |
| Two-stage mandate | AP2: an Intent Mandate sets "price limits, timing, and other conditions", and a Cart Mandate creates "a secure, unchangeable record of the exact items and price". Together they form a "non-repudiable audit trail" [S2] | Standing rules = intent mandates. Each executed action = a signed card |
| User-set limits | Visa Intelligent Commerce lets consumers "set spending limits and conditions". "Only the consumer can instruct the agent… [to] activate a payment credential" [S3] | Per-category caps and expiry on rules |
| Specific labels, sparing use | Confirm only "actions with serious consequences". Use labels like *Delete file* rather than Yes/No, and add undo because overuse makes people stop reading [S4] | Verb + amount on the button ("Move ¥300 to Birkin pot") |
| Undo window | Gmail lets users choose a 5, 10, 20 or 30 s send-cancellation period [S5]. WCAG 3.3.4 requires financial submissions to be Reversible, Checked, or Confirmed. Technique G164 is a "stated time within which [a transaction] may be amended or canceled" [S6] | Show a countdown toast with Undo |
| Undo must be real | WeChat transfers offer real-time, 2 h or 24 h arrival as anti-fraud protection. Staff confirmed the money cannot be pulled back once the recipient accepts, which undercut that protection [S7] | Hold execution until the window closes. Never fake an undo |

## 2. Autonomy sliders and permission levels

- **Levels of autonomy** [S8]. At L1 the user is operator; at L2 collaborator. At L3 (consultant) the agent leads but consults the user. At L4 (approver) the agent asks only in risky or user-preset situations, using "customizable conditions for seeking approval". At L5 (observer) the user only monitors via activity logs and an "emergency off switch".
- **Autonomy slider** [S9]. In Karpathy's YC AI Startup School 2025 talk (secondary summary), products move from autocomplete to whole-repo agents. His advice is to "keep AI on tight leash" and make verification "easy, fast".
- **Product precedent** [S10]. Claude Code ships named permission modes, from "Reads only" up to fully automatic, and users switch with Shift+Tab. Writes to "protected paths" are never auto-approved except in bypass mode. This is a working model of a per-mode table with hard exceptions.
- **Asymmetric friction** [S11]. Monzo's gambling block carries a cooldown "from 2 days to a year" before it can be removed. Its general spending block has no cooldown.
- **China default-consent lessons.** In 2018 Alipay's annual-bill page pre-checked consent to Zhima Credit. Ant apologised, and after the central bank stepped in, the default was reversed to opt-in [S14]. On password-free payments (免密支付), users complained of "默认勾选开启" (default-on) and off-switches "藏得太深" (buried too deep). The Payment & Clearing Association of China called for opt-in via a "显著页面" (prominent page) and a "便捷的关闭通道" (convenient off-channel) [S12]. China's consumer association advises "非必要不开启" (don't enable unless necessary) [S13].

## 3. Explainability ("why am I seeing this")

- **Microsoft HAX** [S15]. Relevant guidelines: G11 "Make clear why the system did what it did", G16 "Convey the consequences of user actions", G17 "Provide global controls", G8/G9 efficient dismissal/correction, and G15 "Encourage granular feedback".
- **Google PAIR** [S16]. Aim for *calibrated* trust. Partial explanations naming "which data sources had the greatest influence" are fine. Show confidence only when it changes decisions.
- **Meta, 2019** [S17]. "Why am I seeing this post?" sits in the post's menu. It names the interaction signals behind a post's ranking and links straight to controls.
- **CFPB, 2023** [S18]. Bank chatbots can trap users in "doom loops" with no "offramp to a human". They can miss dispute language, and "human-like" presentation can lead users to overestimate them.

## 4. Conversational finance and personality

- **Cleo.** Cleo offers "Roast Mode and Hype Mode" and pitches itself as "your funniest, smartest mate who also happens to be a money genius". It reports 85%+ of new users feel better about their finances within a month (Feb 2026 release) [S19]. The cautionary tale: the FTC's $17M order of March 2025 requires "express, informed consent" and a "simple way… to cancel" [S20]. A playful tone does not exempt a product from compliance.
- **Bank of America Erica** [S21]. Erica has passed 3B interactions, averages 58M a month and has served nearly 50M users. Users have interacted with 1.7B *proactive* insights, for example "which way their balances are trending in the next 7 days". Erica answers from a "library of more than 700 responses". In other words, a narrow, reliable scope beats open-ended chat for money.
- **AI disclosure.** China's labelling measures (effective 2025-09-01) require a "显著的提示标识" (prominent notice) in interactive interfaces showing AI-generated content [S22]. The EU AI Act Art. 50 requires people be told they are talking to AI "at the latest at the time of the first interaction" [S23].

## 5. Mascots, gamification and goal visualisation

- **Photos of goals increase saving.** In a field experiment with low-income households, savings envelopes printed with photos of the household's children increased saving. Splitting the money into two envelopes also increased it [S24]. This is the closest evidence for the Dream Mirror.
- **Vivid future selves increase patience.** People who saw age-progressed renderings of themselves were more willing to accept later rewards over immediate ones [S25].
- **Savings jars.** Monzo Pots let users "give it a name, photo, and savings goal" [S26].
- **Streaks with slack.** Duolingo learners who reach a 7-day streak are "3.6 times more likely to complete their course". Allowing two Streak Freezes raised daily active learners by 0.38%, so forgiveness sustains the habit [S27]. Playful characters help because "when the visuals are playful, the intimidation falls away" [S28].
- **Chinese gamified finance at scale.** Alipay's Ant Forest turns low-carbon actions (including paying bills online) into "green energy" that plants real trees, viewable by satellite. It has about 500M users and won the UNEP Champions of the Earth award in 2019 [S29].
- **Limits.** Robinhood retired the confetti for first deposits and upgrades after Massachusetts regulators cited it as manipulating inexperienced investors [S30]. The FTC's dark-patterns report lists "Confirm Shaming: Using shame to steer users away from certain choices" [S31].

## 6. China mobile conventions and accessibility

- **WeChat Mini Program guidelines** [S32]:
  - four principles: 友好礼貌, 清晰明确, 便捷优雅, 统一稳定 (friendly, clear, convenient, consistent)
  - one clear focus per page
  - local (not full-screen) loading feedback
  - 7–9 mm touch targets
  - a 375 px baseline width
- **MIIT elder-friendly app spec, 2021** [S33]:
  - main text in elder mode at least 18 dp
  - contrast at least 4.5:1
  - elder-mode targets at least 60×60 dp
  - no "诱导付款" (payment-inducing) buttons
  - "在用户操作完毕前界面不发生变化" (the interface must not change before the user finishes)
- **WeBank's own app (2020)** [S34]:
  - "Shake-to-enquire" shortcuts
  - voice- and vibration-guided face verification
  - an earphone-only privacy mode, so balances are read aloud only through earphones
- **WCAG 2.2.** Targets at least 24×24 CSS px (2.5.8 AA) [S35]. Colour must not be the only cue (1.4.1 A) [S36].
- **EU.** The European Accessibility Act has covered banking "websites, apps, and mobile-based services" since 28 June 2025 [S37].

---

## 7. Recommendations for FundBun's mobile-first web app

1. **Dream Mirror hero as progress.** Show the user's own dream-item photo with a goal progress bar and "¥X under target, 12% closer". Over budget, show "This month moved your Birkin 9 days further". Grounded in [S24][S25][S26]. Default tone is *Gentle*; *Hype* and *Roast* are opt-in personas [S19]. Never phrase a decline as shame [S31].
2. **Tiered tripwires.** Fire at 50/80/100% of a category budget, once per threshold. Each fires as a dismissible, snoozable card with a forecast line ("at this pace you'll exceed by ¥420 on the 24th"), modelled on Erica's 7-day trend [S21]. Use HAX G3/G8 and NN/g's warning against crying wolf [S4][S15].
3. **"Should I?" check (L3 consultant).** The user enters a price and sees budget impact, the delay to their dream item, and two data chips explaining why. The decision stays with the user [S8][S16].
4. **Action confirmation card.** Show a verb-first title, exact ¥ amount, from→to, timing, a reversibility badge, the policy tier and a "Why?" chip. Buttons carry specific labels, never Yes/No [S1][S4]. Hash the card and execute exactly that payload [S2].
5. **Real undo windows.** Reversible actions show a 10 s countdown toast ("Undo") and execute only after it expires [S5][S6]. Irreversible ones (paying bills, cancelling subscriptions) need explicit confirmation plus a scheduled delay [S7].
6. **Standing rules as visible "mandates".** Example: "Auto-move up to ¥200/week into pots when under budget, until 31 Dec." Each rule card shows cap, scope and expiry, and has an edit/kill control [S2][S3].
7. **Autonomy slider in settings.** Four stops: *Ask me everything* (L1/L2), *Suggest* (L3), *Auto under ¥X* (L4), *Autopilot within rules* (L5). A per-action matrix overrides the slider. Like protected paths, new payees and subscription cancellation are never auto-approved [S8][S9][S10].
8. **Asymmetric friction.** Tightening limits is instant. Loosening needs re-authentication and a 24 h cooldown [S11]. No permission ever defaults on [S12][S14].
9. **Kill switch.** A persistent "Pause agent" control, reachable from every screen in one tap, freezes all rules, cancels pending undo-window actions and shows a summary. Resuming requires re-authentication [S8][S15 G17]. Pause automatically when the app goes to the background mid-action, as Operator's watch mode does [S1].
10. **Activity and audit log.** A day-grouped timeline records actor (you / agent / rule), action, tier, outcome (approved, auto or blocked) and a hash-chain "verified" badge. The log is filterable and exportable for the sandbox-log deliverable [S2][S8].
11. **"Why am I seeing this?" on every insight.** Two or three data chips (e.g., "Dining ¥1,240 vs ¥900 target") plus "Not useful" feedback that tunes future alerts [S15][S16][S17].
12. **Labelled AI with a human exit.** The bao mascot always carries an "AI" badge, with a first-run disclosure. Typing "dispute", "refund" or "人工" routes to a help/human path [S18][S22][S23].
13. **Celebrate saving, never spending.** Steam and confetti for goals reached and under-budget days only, never for purchases or raised autonomy [S30]. An "under-budget streak" with freeze tokens gives slack [S27].
14. **China-ready accessible UI.**
    - 375 px baseline and bottom-sheet confirmations [S32]
    - targets ≥24 px, aiming for 44+ [S35]
    - a large-text mode at ≥18 dp with 4.5:1 contrast and no inducement buttons [S33]
    - over/under-budget states shown with icon and text as well as colour [S36]
    - no auto-advancing screens while the user is acting [S33]
15. **Balance privacy mode.** A "hide amounts" toggle. Screen-reader balance readout only through earphones [S34].

*Not verified:* I could not reach Cleo's or OpenAI's own sites (HTTP 403), so I used Cleo's syndicated press release and OpenAI's PDF system card instead. The Karpathy material comes from a secondary transcript summary. The SEC's 2021 "digital engagement practices" release was not retrievable and is not relied on.

## Sources

- [S1] OpenAI, *Operator System Card* (2025-01-23): https://cdn.openai.com/operator_system_card.pdf
- [S2] Google Cloud, *Announcing Agent Payments Protocol (AP2)* (2025-09-17): https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol
- [S3] Visa, *Find and Buy with AI* (2025-04-30): https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.21361.html
- [S4] Nielsen, NN/g, *Confirmation Dialogs Can Prevent User Errors*: https://www.nngroup.com/articles/confirmation-dialog/
- [S5] Gmail Help, Undo Send: https://support.google.com/mail/answer/2819488
- [S6] W3C, Understanding SC 3.3.4: https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html
- [S7] The Paper (2017-09-13), WeChat delayed arrival: https://www.thepaper.cn/newsDetail_forward_1792789
- [S8] Feng, McDonald, Zhang, *Levels of Autonomy for AI Agents* (2025): https://arxiv.org/html/2506.12469v1
- [S9] Latent Space, notes on Karpathy "Software 3.0" (2025): https://www.latent.space/p/s3
- [S10] Claude Code Docs, *Choose a permission mode*: https://code.claude.com/docs/en/permission-modes
- [S11] Monzo Help, How blocks work: https://monzo.com/help/account-and-profile/gambling-spending-block-how-to
- [S12] Xinhua (2025-12-08), 免密支付: https://www.news.cn/fortune/20251208/2a52b3fb9aa743c8bb722e0f6e248ee1/c.html
- [S13] China Daily (2025-03-25), 中消协 on 免密支付: https://cn.chinadaily.com.cn/a/202503/25/WS67e21387a31008317a2ae6ee.html
- [S14] Caixin Global (2018-01-04), Alipay apology: https://www.caixinglobal.com/2018-01-04/alipays-owner-apologizes-for-automatic-credit-system-enrollment-101193609.html
- [S15] Microsoft HAX Toolkit, 18 Guidelines: https://www.microsoft.com/en-us/haxtoolkit/library/
- [S16] Google PAIR, *Explainability + Trust*: https://pair.withgoogle.com/chapter/explainability-trust/
- [S17] Meta (2019-03-31), *Why Am I Seeing This?*: https://about.fb.com/news/2019/03/why-am-i-seeing-this/
- [S18] CFPB, *Chatbots in consumer finance* (2023): https://www.consumerfinance.gov/data-research/research-reports/chatbots-in-consumer-finance/chatbots-in-consumer-finance/
- [S19] Cleo press release via Bolsamania (2026-02-05): https://www.bolsamania.com/nota-de-prensa/mercados/cleo-brings-ai-powered-money-management-back-to-the-uk--21616424.html
- [S20] FTC (2025-03-27), Cleo AI $17M: https://www.ftc.gov/news-events/news/press-releases/2025/03/cash-advance-company-cleo-ai-agrees-pay-17-million-result-ftc-lawsuit-charging-it-deceives-consumers
- [S21] Bank of America (2025-08-20), Erica 3B interactions: https://newsroom.bankofamerica.com/content/newsroom/press-releases/2025/08/a-decade-of-ai-innovation--bofa-s-virtual-assistant-erica-surpas.html
- [S22] CAC, 《人工智能生成合成内容标识办法》 (2025-03-14): https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm
- [S23] EU AI Act Service Desk, Article 50: https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50
- [S24] Soman & Cheema, *Earmarking and Partitioning*, JMR 48 (2011) S14–S22: https://www.russellsage.org/sites/default/files/u137/jmr-C-s014-s021-online.pdf
- [S25] Hershfield et al., JMR (2011): https://vhil.stanford.edu/publications/increasing-saving-behavior-through-age-progressed-renderings-future-self
- [S26] Monzo Help, Pots: https://monzo.com/ie/help/managing-money/help-pots
- [S27] Duolingo Blog (2022-01-31), streak research: https://blog.duolingo.com/how-duolingo-streak-builds-habit/
- [S28] Duolingo Blog (2020-07-02), shape language: https://blog.duolingo.com/shape-language-duolingos-art-style/
- [S29] UNEP (2019-09-19), Ant Forest: https://www.unep.org/news-and-stories/press-release/chinese-initiative-ant-forest-wins-un-champions-earth-award
- [S30] AP via News4Jax (2021-03-31), Robinhood confetti: https://www.news4jax.com/business/2021/03/31/robinhood-cans-the-confetti-unveils-new-celebratory-designs/
- [S31] FTC, *Bringing Dark Patterns to Light* (2022-09): https://www.ftc.gov/system/files/ftc_gov/pdf/P214800%20Dark%20Patterns%20Report%209.14.2022%20-%20FINAL.pdf
- [S32] WeChat Mini Program design guidelines: https://developers.weixin.qq.com/miniprogram/design/
- [S33] MIIT 工信厅信管函〔2021〕67号 (APP 适老化通用设计规范): https://www.gov.cn/zhengce/zhengceku/2021-04/13/content_5599225.htm
- [S34] Fintech News HK (2020-10-20), WeBank accessibility: https://fintechnews.hk/13709/virtual-banking/tencents-webank-app-now-accessible-for-visually-impaired-users-in-china/
- [S35] W3C, Understanding SC 2.5.8: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- [S36] W3C, Understanding SC 1.4.1: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
- [S37] Central Bank of Ireland, European Accessibility Act: https://www.centralbank.ie/consumer-hub/european-accessibility-act
