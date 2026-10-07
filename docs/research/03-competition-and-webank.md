# 03 — Competition rules, past winners, and WeBank (host) profile

*Researched 2026-10-08. The official site (fintechathon.g-ican.com) is a single-page app. Its 2026 text was read from the site's own JS bundles and template files, listed as [S1]–[S4]. When press coverage disagrees with the site, this document follows the site.*

## Key takeaways for FundBun

1. **Deadline: 20 Oct 2026, 24:00 UTC+8, which is 12 days away.** Three items are **required**: a technical document, a deck of up to 10 minutes and a demo video of up to 5 minutes. Source code, the security self-assessment and "execution evidence" (sandbox logs) are **optional**, but we should submit all three. Security is 30% of the score, and the 40% for task completion is scored on "scripted tasks in a simulated environment" [S1][S2][S3].
2. **The security score names four attacks:** "induced transfers, data extraction, privilege escalation and prompt injection". It warns that "serious security failures trigger substantial deductions". FundBun needs a red-team suite that shows each attack being blocked [S2].
3. **Copy the domestic brief's vocabulary.** It asks for a 3-tier permission model: low risk runs automatically, high risk needs confirmation, very high risk needs strong verification, with the line at RMB 1,000/day. It also asks for hallucination guards, injection defence, full decision and execution logs, a circuit breaker, a sandbox, task plans as a DAG, and interrupt, rollback and human takeover [S4].
4. **Past winners already cover parts of our idea.** A 2024 product-track winner had a "wish piggy bank" (心愿储钱罐). An LLM bookkeeping agent took third in the 2025 AI track. A behavioural-economics Gen-Z simulation won Best Creative in 2025. Dream Mirror fits the theme but is not novel on its own. Our edge is **safe agentic execution under user control**, plus the counterfactual mirror [S1].
5. **WeBank's identity: inclusive finance, AI-native, privacy-preserving.** Its mission is "Better Banking for All". It runs 800+ agents and 20B tokens/day. It created FATE federated learning, and Qiang Yang is a 2026 adviser. Pitch FundBun as a trustworthy, privacy-minimal participant for ordinary young users, not as a nudge to spend [W1][W2][W5][S1].

**Eligibility check.** Every member must be a full-time student at a university outside China. Teams have 2–5 members, and at least 60% must be non-Chinese nationals (rounded up). Each person may join only one team. Confirm the team qualifies now [S2].

---

## 1. The 2026 competition (8th edition)

**Hosts.** Strategic guidance comes from the Shenzhen Local Financial Administration, Shenzhen University and WeBank. The host is the Shenzhen University–WeBank Institute of FinTech. Technical advisers are CCF Digital Finance, the Tsinghua Institute of Financial Technology and the IEEE CIS Singapore and Shenzhen chapters. The International Track was "comprehensively upgraded" for APEC 2026 in Shenzhen [S1][P1].

**Theme: "AI as a Financial Participant".** Teams choose one of six directions:

- **A: Personal Finance Assistant**, "conversational bookkeeping, budgeting and bill management" (FundBun's direction)
- B: Wealth
- C: Cross-border/student, which the Chinese page tags "APEC 特色" (APEC feature)
- D: Insurance
- E: SME
- F: Agent Wallet (on-chain)

Teams must "deliver a working financial Agent that demonstrates intent understanding, task planning, safe execution, user control and measurable value". The choice of direction does not affect the base score [S1][S2].

**Judging (same for all six directions) [S2]:**

| Weight | Dimension | Official wording |
|---|---|---|
| 40% | Task Completion | "Completion of scripted tasks in a simulated environment" |
| 30% | Security & Compliance | Induced transfers, data extraction, privilege escalation, prompt injection; serious failures → large deductions |
| 30% | Innovation & Interaction | "Scenario novelty, real-world value, dialogue efficiency, clarification, correction and fallback capability" |
| +0–5 | Bonus (capped) | "advanced topics or demonstrated real-world deployment" |

Press describes the review as "自动评测与专家盲审双轨机制": automated evaluation plus blind expert review [P1].

**What the templates ask for (English only) [S2][S3]:**

- **Technical Document (required):**
  - Overview and Architecture
  - Agent Design: intent, planning, tool use, state
  - Security Design: tiered permissions and confirmation; injection, privilege escalation and privacy leakage
  - Deployment and Testing
- **Demo video (required):**
  - 5 minutes or less, 16:9, ideally 1080p, with English subtitles
  - Structure: intro, then the end-to-end core scenario, then safety, innovation and results
  - Filename: `Track-TeamName-DemoVideo`
- **Security Self-assessment (optional):**
  - Permission Model: roles, boundaries, confirmation, verification, rollback
  - Security Tests: injection, social engineering, privilege escalation, failure recovery
  - Data and Privacy: provenance, consent, minimisation, storage, deletion
  - Known Risks: risk, impact, mitigation
- **Execution Evidence (optional):** sandbox logs with timestamp, action, result and screenshot, plus a reproduction guide for judges.
- **README (optional):** must include "Security Notes"; never commit secrets.
- **Third-party material:** must be licensed. The rules are governed by PRC law, and the Chinese version prevails.

**Timeline (UTC+8):**

| Date | Step |
|---|---|
| 20 Oct | Submission deadline |
| 21 Oct | Compliance screening |
| 22–23 Oct | Online review selects the top 10 (dates conflict across sources; see open questions) |
| 31 Oct | Finalists announced, invitations issued |
| 20 Nov | Check-in and WeBank visit |
| 22 Nov | Closed-door defence in English at WeBank |
| 23 Nov | Awards |

The 48-hour hackathon is domestic-only [S1][S2][I1][P1].

**Prizes and contact.** The track pays out RMB 250k, pre-tax:

- First prize: RMB 100k
- Second prize: RMB 80k
- Third prize: RMB 50k
- Best Creative: RMB 20k

The IEEE notice adds a WeBank fast-track interview for finalists and covered travel for international finalists. Contact: fintechathon@ican-x.com [S1][S2][I1].

## 2. Prior editions: what has won

The competition grew from 178 teams in 2019 to 372 teams in 2025 (1,709 students from 270 universities) [S1][P2][H1].

| Year | Track | Winner | Relevance |
|---|---|---|---|
| 2025 | AI | 灵操盘 (1st): NL→quant strategy, multi-agent, "hallucination filtering", **deployed with securities firms** | Real deployment + trust controls win [S1][H1] |
| 2025 | AI | FinAgent (3rd): Qwen3-VL bill OCR, on-device privacy, Risk/Analyst/Trade agents | Closest prior art to Topic A [S1] |
| 2025 | AI | EchoPolis (Best Creative): DeepSeek life-sim + behavioural economics for Gen Z | Behavioural/gamified framing rewarded [S1][N1] |
| 2024 | AI | Vertical federated credit scoring on FATE (1st); FATE-LLM elderly assistant with encrypted inference (3rd) | WeBank's own stack scores well [S1] |
| 2024 | Product | 成长盈 (1st): "graduation fund" + gamified learning; 3rd place: budgets with rewards + **心愿储钱罐 wish piggy bank** | Wish-saving is **not novel** here [S1] |
| 2023 | Product | Conversational WeBank "digital butler" with "有温度" (warm) replies; gamified family-farm app | Warmth + gamification valued [S1] |

The winners share a pattern: LLMs with multi-agent setups, explicit trust controls, WeBank technology (FATE, FISCO BCOS) and measurable or real-world results. No detailed judges' commentary has been published. In 2025, Qiang Yang called for coordinated "technological innovation + scenario implementation + value creation" [P2].

## 3. WeBank (微众银行)

- **Model.** China's first internet-only bank: approved in December 2014, operating since 2015, with no branches. Tencent was the lead founder; Wikipedia, a secondary source, gives its stake as about 30%. Main products are Weilidai (consumer microloans) and Weiyedai (SME loans) [W6][W1].
- **2025 figures.** Revenue RMB 36.28bn (−4.84%), net profit RMB 11.01bn (+1.0%), total assets RMB 766.3bn. Individual customers: Chinese press says "4.2亿+" while WeBank says "over 430 million". It serves 7M+ SMEs [W7][W1].
- **Efficiency.** About US$0.3 IT cost per account per year and 99.999% availability [W3].
- **AI-native strategy (since 2025).**
  - By March 2026: 100+ scenarios, 800+ agents and 60+ digital employees [W1].
  - By July 2026: 20B+ tokens/day on an AI Engineering Platform with an MCP plugin marketplace and reusable Skills. Anti-fraud case handling fell "from three days to five minutes" [W2].
  - Chief AI Architect Eason Wang: "shifting from human-led execution with AI assistance to AI-led execution" [W2].
  - EVP and CIO Henry Ma (马智涛) showed digital employee "Emily Ye" at HK Fintech Week 2025 [W3].
- **Values.** The mission is "Better Banking for All" (让金融普惠大众), and WeBank wants its service to stay "distinctly human" [W1][P1].
- **Privacy-preserving AI.**
  - FATE was started by WeBank's AI group as "the world's first industrial grade federated learning open source framework". It is hosted by the Linux Foundation and uses homomorphic encryption and multi-party computation [W4][W5].
  - FATE-LLM adds federated fine-tuning and private inference [W8].
  - Qiang Yang says agents are "大模型在这个世界的体现" (how large models act in the world) and argues for federated large models that keep data in-domain [W9].
  - The site's learning materials cite his "AI three laws": protect privacy, protect model security, and keep AI understandable to humans [S1].
- **Judges.** The site lists eight academic advisers, including Qiang Yang (WeBank Chief AI Adviser), Dacheng Xiu and W. K. Härdle. A track-judge block (Qiang Yang, WeBank AI chief scientist Fan Lixin) appears beside a defunct blockchain track and is probably legacy content. **We could not verify the 2026 international panel** [S1].

## 4. Compliance anchors (PIPL)

Under PIPL, financial accounts are sensitive personal information (Art. 28) and need separate consent (Art. 29). Other relevant articles:

- Art. 6: data minimisation
- Art. 24: an opt-out for automated decisions and targeted pushes
- Art. 47: deletion
- Art. 55: an impact assessment for sensitive data and automated decisions

Cite these article numbers in the self-assessment [L1].

## 5. What judges will look for

1. **A reproducible sandbox with scripted tasks and seed data**, plus Execution Evidence with a reproduction guide. This feeds the 40% for task completion [S2][S3].
2. **Tests and logs for the four named attacks.** Include indirect injection through user content such as wishlist names, photo text and bill memos [S2].
3. **The official 3-tier permission ladder**, with RMB thresholds, rollback and human takeover [S4].
4. **Good conversation handling:** clarifying questions, correction, out-of-scope fallback and few turns per task [S2].
5. **No hallucinated numbers.** Every figure must trace back to a ledger query [S4].
6. **Measurable value and real-world traction**, which earn the 0–5 bonus [S2][H1].
7. **Privacy by design:** minimisation, consent, local processing [L1][W4].

## 6. Pitch angles for FundBun (our inferences)

- **"A participant with a mandate."** The agent moves money only into the user's own goal pots, within limits the user sets. Map this onto the official 3 tiers in a single slide [S4].
- **The Dream Mirror as safe behavioural finance.** Echo the EchoPolis framing that won Best Creative [S1]. The mirror never promotes credit or spending: being under budget rewards *saving toward* the dream.
- **Clear difference from past winners** such as the wish piggy bank and FinAgent: agentic execution, the counterfactual mirror, a tamper-evident audit log and a red-team scorecard [S1].
- **A "Security scorecard" slide:** the four attack classes × N cases, block rate, false-refusal rate and circuit-breaker events [S2].
- **A privacy story for WeBank judges:** separate consent for account data, dream photos kept on-device or local, one-tap deletion. Present FATE-style federated learning as roadmap only [L1][W5].
- **Inclusive, international users:** young people and international students. Show amounts in CNY plus the user's home currency, without drifting into Direction C [S1].
- **Metrics:** task success rate, turns per task and attack block rate. If possible, add a small consented pilot to compete for the bonus [S2].

**Unverified or open questions:**
- Who sits on the 2026 international judging panel.
- Whether the evaluators supply their own task scripts.
- Online review dates: 22–23 Oct (site process) vs "23 Oct" (site schedule) vs 23–28 Oct (IEEE).
- Revolut AIR and OpenClaw, both cited in the brief, were not researched because the search budget ran out.

---

## Sources

- [S1] Official site and main bundle (tracks, directions, schedule, prizes, advisers, past winners 2019–2025): https://fintechathon.g-ican.com/ · https://fintechathon.g-ican.com/js/app.83e69cd7.js
- [S2] Official rules bundle (eligibility, submissions, judging weights, bonus, governing law): https://fintechathon.g-ican.com/js/chunk-4516c2dd.7f79eeba.js
- [S3] Official templates: https://fintechathon.g-ican.com/templates/international-technical-document-en.docx · https://fintechathon.g-ican.com/templates/international-security-self-assessment-en.docx · https://fintechathon.g-ican.com/templates/international-execution-evidence-en.docx · https://fintechathon.g-ican.com/templates/demo-video-guide-en.docx · https://fintechathon.g-ican.com/templates/source-code-readme-template-en.md
- [S4] Official challenge-brief bundle (domestic AI brief: permission tiers, security mechanisms): https://fintechathon.g-ican.com/js/chunk-55a31b26.d8e3ee35.js
- [I1] IEEE CIS Shenzhen, International Track notice (17 Jun 2026): https://r10.ieee.org/shenzhen-cis/blog/2026/06/17/2026-shenzhen-international-fintech-competition-international-track/
- [P1] ifeng Tech, 2026 launch (10 Sep 2026): https://tech.ifeng.com/c/8wJG9eH2KFs · CLS: https://www.cls.cn/detail/2471634
- [P2] People's Daily app, 2025 wrap-up: https://www.peopleapp.com/column/30051004536-500007261769
- [H1] HKUST(GZ), 2025 winners: https://www.hkust-gz.edu.cn/zh/?p=13630%2F
- [N1] Nanjing University, EchoPolis award: https://sdem.nju.edu.cn/b0/99/c56973a831641/pagem.htm
- [W1] WeBank / The Asian Banker release (16 Mar 2026): https://www.aap.com.au/aapreleases/cision20260316ae10617
- [W2] WeBank "Best AI-Driven Bank" release (21 Jul 2026): https://technode.global/prnasia/webank-wins-the-asian-bankers-best-ai-driven-bank-of-the-year-award-in-asia-pacific/
- [W3] Fintech News HK, HK Fintech Week 2025: https://fintechnews.hk/36263/hong-kong-fintech-week-news/webank-hk-fintech-week-2025/
- [W4] FATE repository: https://github.com/FederatedAI/FATE
- [W5] DevClass, Linux Foundation to host WeBank's FATE (2019): https://devclass.com/2019/06/25/linux-foundation-to-become-home-of-webanks-fate/
- [W6] Wikipedia, WeBank (China) (secondary): https://en.wikipedia.org/wiki/WeBank_(China)
- [W7] ifeng, WeBank 2025 results: https://i.ifeng.com/c/8svfrQUihxr · Jiemian: https://www.jiemian.com/article/9247932.html
- [W8] FATE-LLM repository: https://github.com/FederatedAI/FATE-LLM
- [W9] TMTPost, Qiang Yang interview (14 Jul 2024): https://www.tmtpost.com/7166977.html
- [L1] PIPL English translation (DigiChina): https://digichina.stanford.edu/work/translation-personal-information-protection-law-of-the-peoples-republic-of-china-effective-nov-1-2021/
