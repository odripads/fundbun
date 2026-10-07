# 02 · Behavioral-science evidence for FundBun

*Researched 2026-10-08. Every claim links to its source. **[unverified]** marks anything I could not check against a primary source.*

## Key takeaways for FundBun

1. **The core mechanism holds up, but its effect is modest.** Making opportunity costs salient reduces purchase intent ([Frederick et al. 2009](https://doi.org/10.1086/599764)). A 39-study meta-analysis puts the effect at d = 0.22, against the original 0.45–0.85 ([Maguire et al. 2023](https://doi.org/10.1007/s40881-023-00134-6)). Pitch the Dream Mirror as an evidence-based nudge, not a cure.
2. **Personal, specific goals have the strongest field evidence.** Children's photos on savings envelopes ([Soman & Cheema 2011](https://doi.org/10.1509/jmkr.48.SPL.S14)), reminders naming the saver's goal (+16%, [Karlan et al. 2016](https://doi.org/10.1287/mnsc.2015.2296)) and in-app goal setting ([Gargano & Rossi 2024](https://doi.org/10.1111/jofi.13339)) all raised saving.
3. **"You could've gotten a Birkin" should not be the default tone.** Shame makes people withdraw from their finances ([Gladstone et al. 2021](https://doi.org/10.1016/j.obhdp.2021.06.002)), and people already avoid looking at bad balances ([Olafsson & Pagel 2017](https://www.nber.org/papers/w23945)). Default to gentle copy and make blunt copy opt-in.
4. **Alerts work, but they have side effects.** Auto-enrolled alerts cut overdraft charges by 25% ([FCA OP36](https://www.fca.org.uk/publications/occasional-papers/occasional-paper-no-36-sending-out-sms-impact-automatically-enrolling-consumers-overdraft-alerts)). Payment reminders raised overdraft fees by 9% ([Medina 2021](https://doi.org/10.1093/rfs/hhaa108)). The agent must check liquidity before it moves any money.
5. **"Under budget = guilt-free shoes" can license overspending** ([Fishbach & Dhar 2005](https://doi.org/10.1086/497548)). By default, send surplus to the goal pot and make a treat an explicit choice. Disclose every nudge: disclosure does not weaken nudges ([Bruns et al. 2018](https://doi.org/10.1016/j.joep.2018.02.002)), and Chinese rules ban algorithms that induce excessive consumption ([CAC 2022, Art. 8](https://www.cac.gov.cn/2022-01/04/c_1642894606364259.htm)).

---

## 1. Opportunity cost neglect (the core of the Dream Mirror)

**Mechanism.** Consumers rarely think of what a purchase displaces. Cues such as "leaving you $X for other purchases" lower purchase rates ([Frederick, Novemsky, Wang, Dhar & Nowlis 2009, *JCR* 36(4)](https://doi.org/10.1086/599764)). Tight budgets and a habit of planning both prompt people to consider opportunity costs ([Spiller 2011, *JCR*](https://doi.org/10.1086/660045)). In intertemporal choice, people attend to opportunity costs asymmetrically ([Read, Olivola & Hardisty 2017, *Mgmt Sci*](https://doi.org/10.1287/mnsc.2016.2547)).

**Replications.** Across 39 studies (N = 14,005), the effect is robust but smaller: d = 0.22 ([Maguire, Persson & Tinghög 2023](https://doi.org/10.1007/s40881-023-00134-6)). A Swedish study found no overall effect for private consumption. Younger participants showed the bias and older participants showed the reverse ([Persson & Tinghög 2020](https://doi.org/10.1016/j.jebo.2019.12.012)).

**FundBun:**
- The Dream Mirror makes the opportunity cost specific: the user's own item, photo and price.
- Show it at decision points (tripwires, pre-purchase checks), not only on the landing page.
- Offer a plain-budget view.
- Report d ≈ 0.22 honestly, alongside measured effects from the sandbox logs.

## 2. Mental accounting and earmarking (goal pots)

**Mechanism.** People sort money into labelled, non-fungible mental accounts ([Thaler 1985](https://doi.org/10.1287/mksc.4.3.199); [Thaler 1999](https://doi.org/10.1002/(SICI)1099-0771(199909)12:3%3C183::AID-BDM318%3E3.0.CO;2-F)). A 2025 Registered Replication supported 11 of Thaler's 17 problems, was mixed on 3 and failed on 3 ([RSOS 2025](https://doi.org/10.1098/rsos.250979)).

**Field evidence.** In 146 rural Indian labourer households, splitting earmarked savings into two envelopes increased saving. Printing the children's photos on the envelopes amplified this, and the proposed mechanism is guilt. Photos alone did nothing when the money sat in one envelope ([Soman & Cheema 2011](https://doi.org/10.1509/jmkr.48.SPL.S14); [PDF](https://www.russellsage.org/sites/default/files/u137/jmr-C-s014-s021-online.pdf)).

**FundBun:**
- Each dream item gets a photo-labelled pot, and the agent's "move to pot" action is earmarking.
- Split large pots into milestone sub-pots.
- Keep the guilt mild (see §9).

## 3. Pain of paying

**Mechanism.** Consumption pleasure and payment pain interact ([Prelec & Loewenstein 1998, *Marketing Science*](https://doi.org/10.1287/mksc.17.1.4)). Credit cards raise willingness to pay ([Prelec & Simester 2001](https://doi.org/10.1023/A:1008196717017)); I could not confirm the magnitude **[unverified]**. "Tightwads" feel too much pain and "spendthrifts" too little ([Rick, Cryder & Loewenstein 2008, *JCR*](https://doi.org/10.1086/523285)).

**FundBun:**
- Tripwires restore friction that low-friction digital payments remove. I found no verified primary study on pain of paying with WeChat Pay or Alipay **[unverified]**.
- Add the 4-item tightwad–spendthrift scale to onboarding. Amplify nudges for spendthrifts and soften them for tightwads.

## 4. Goal gradient and goal framing

**Evidence.**
- Customers sped up their coffee purchases as a free reward approached, and illusionary head-start progress also worked ([Kivetz, Urminsky & Zheng 2006, *JMR*](https://doi.org/10.1509/jmkr.43.1.39)).
- Randomised access to goal setting in a fintech app raised savings rates without reducing saving elsewhere. Low-propensity savers gained most ([Gargano & Rossi 2024, *J. Finance*](https://doi.org/10.1111/jofi.13339)).
- Whether specific goals help depends on construal level ([Ülkümen & Cheema 2011](https://doi.org/10.1509/jmr.09.0516)).
- Requiring specific deposit plans *reduced* saving ([Loibl & Scharff 2010](https://doi.org/10.1111/j.1745-6606.2010.01160.x)).

**FundBun:**
- "X% closer to your Birkin" with a progress ring is well supported.
- A small, disclosed seed amount avoids a 0% start.
- Let users choose an exact target or "as much as I can".

## 5. Showing prices as hours of work

**Thin evidence.** I found no peer-reviewed RCT showing that hours-of-work price framing reduces spending **[unverified gap]**. The adjacent findings are mixed:
- People value time more ambiguously than money and rationalise time spent more easily ([Okada & Hoch 2004](https://doi.org/10.1086/422110)).
- Priming time *raises* attachment to products ([Mogilner & Aaker 2009](https://doi.org/10.1086/597161)), so time framing could increase desire.
- See also [DeVoe & Pfeffer 2007](https://doi.org/10.1016/j.obhdp.2006.05.003) and [Pan, Etkin & Berger 2024](http://thearf-org-unified-admin.s3.amazonaws.com/MSI_Report_24-126.pdf).

There is stronger support for consumption-equivalent framing. In a field experiment, a consumption-oriented frame plus a comparison with past spending cut discretionary spending ([Levi 2025, *JFQA* accepted manuscript](https://jfqa.org/wp-content/uploads/2025/10/24988_Personal_Financial_Info.pdf)).

**FundBun:** Lead with dream-item equivalents. Treat "hours of work" as an optional lens to A/B test.

## 6. Future-self continuity

**Evidence.** Age-progressed self-renderings increased hypothetical retirement allocations ([Hershfield et al. 2011, *JMR*](https://doi.org/10.1509/jmkr.48.SPL.S23)). A pre-registered review of 23 studies found mixed, small-to-large effects, mostly in student or online samples ([Grekin et al. 2025](https://doi.org/10.1177/27000710251391610)). A UK replication (n = 219) of a different, generic ageing-prime intervention found no effect ([Stockdale & Sanders 2020](https://doi.org/10.1111/jasp.12673)).

**FundBun:** "Future You" is a stretch feature at most. Skip AI face-ageing: the evidence is weak and it adds biometric-privacy risk.

## 7. Implementation intentions (tripwires as if-then plans)

**Evidence.** If-then plans improve goal attainment ([Gollwitzer & Sheeran 2006](https://doi.org/10.1016/S0065-2601(06)38002-1)). The pooled d = 0.65 over 94 tests is confirmed only through a secondary summary ([summary](https://www.thebehavioralscientist.com/glossary/implementation-intentions)) **[partially verified]**. In savings, rigid quantitative plans backfired ([Loibl & Scharff 2010](https://doi.org/10.1111/j.1745-6606.2010.01160.x)).

**FundBun:** Users write their own tripwires in if-then form, for example: "If takeout passes ¥300 this week, show my Birkin and suggest ¥50 to the pot." User-authored rules support autonomy and consent. Keep the "then" part flexible.

## 8. Spending alerts and real-time feedback

- **Salience.** Overdraft-salient survey questions reduced overdrafts for up to two years ([Stango & Zinman 2014, *RFS*](https://doi.org/10.1093/rfs/hhu008)).
- **Alerts and apps (FCA).** Text alerts or a banking app cut unarranged-overdraft charges by 5–8%, and both together by 24%. Annual summaries had no effect ([FCA OP10](https://www.fca.org.uk/publications/occasional-papers/occasional-paper-no-10-message-received-impact-annual-summaries-text)).
- **Auto-enrolment (FCA).** Auto-enrolment cut charges by 25%, but heavy users kept most of theirs ([FCA OP36](https://www.fca.org.uk/publications/occasional-papers/occasional-paper-no-36-sending-out-sms-impact-automatically-enrolling-consumers-overdraft-alerts)).
- **Specific reminders.** Reminders raised saving by 6% and goal-specific reminders by 16%. Generic reminders had no significant effect ([Karlan et al. 2016](https://doi.org/10.1287/mnsc.2015.2296); [NBER](https://www.nber.org/bah/2010no3/do-reminders-increase-saving)).
- **Mobile access.** Mobile access cut discretionary spending, by 15.7% a month according to a newsletter report of the working paper ([Levi & Benartzi 2020, SSRN](https://papers.ssrn.com/author=3573455); [BCFG](https://bcfg.wharton.upenn.edu/newsletter-may-2019/)).
- **Side effects of nudging.** Reminders cut late fees by 14% but raised overdraft fees by 9%. Users who had overdrawn before paid 5% more in total, while others saved 15% ([Medina 2021, *RFS*](https://doi.org/10.1093/rfs/hhaa108)).

**FundBun:**
1. Every alert names the dream item.
2. Before any transfer or scheduled payment, the policy engine checks that it will not cause an overdraft. This answers Medina directly and is a strong compliance point.
3. Give chronic overspenders different help, such as budget redesign.
4. Rate-limit alerts and log them in the audit trail.

## 9. Shame vs. positive framing

- **Shame causes withdrawal.** Shame leads to financial withdrawal and deeper hardship, and is worse than guilt. Self-affirmation broke the cycle (6 studies, N = 9,110; [Gladstone et al. 2021, *OBHDP*](https://doi.org/10.1016/j.obhdp.2021.06.002)).
- **Ostrich effect.** People log in less often when in debt ([Olafsson & Pagel 2017](https://www.nber.org/papers/w23945)).
- **Values appeals can work.** A moral-appeal text cut credit-card delinquency by 4.4 points from a 66% baseline. It appealed to values and did not humiliate ([Bursztyn et al. 2019, *JPE*](https://doi.org/10.1086/701605)).
- **Boomerang risk.** Below-norm households increased consumption after normative feedback, and an approving message prevented this ([Schultz et al. 2007](https://doi.org/10.1111/j.1467-9280.2007.01917.x)).
- **Licensing.** Goal progress licenses goal-inconsistent choices ([Fishbach & Dhar 2005](https://doi.org/10.1086/497548)).

**FundBun:**
- **Tone presets.** Gentle is the default, Coach is available, and Blunt ("You could've gotten a Birkin") is opt-in.
- **Behaviour, not the person.** For example: "This week's takeout = 12% of your Birkin."
- **Auto-soften.** Switch to a gentler tone after repeated overspending or when logins drop.
- **Under budget.** Praise the user, then suggest "Move ¥X to the Birkin pot?", with "Treat myself" as a second button.

## 10. Ethics, dark patterns, compliance

- **Dark patterns.** These are designs that coerce, steer or deceive users. A crawl of about 11K shopping sites found 1,818 instances ([Mathur et al. 2019](https://doi.org/10.1145/3359183); see also [Gray et al. 2018](https://doi.org/10.1145/3173574.3174108)).
- **Nudge vs. sludge.** Thaler argues for "nudge, not sludge" ([Thaler 2018, *Science*](https://doi.org/10.1126/science.aau9241)). On the ethics of nudging, see [Sunstein 2014](https://doi.org/10.2139/ssrn.2526341).
- **Transparency.** Disclosing a default's purpose did not significantly reduce its effect ([Bruns et al. 2018](https://doi.org/10.1016/j.joep.2018.02.002)).
- **Chinese rules.** The CAC algorithm-recommendation rules (in force since 1 March 2022) ban models that induce addiction or excessive consumption (Art. 8). They also require an option not based on personal characteristics, or a way to switch recommendations off (Art. 17) ([CAC](https://www.cac.gov.cn/2022-01/04/c_1642894606364259.htm)).

**FundBun:**
- Every card has a "Why am I seeing this?" link.
- Nudges can be switched off.
- Dream items are never used for upselling.
- Every nudge goes into the tamper-evident audit log.

**Known risks for the security self-assessment:** shame-driven withdrawal, licensing, nudge side effects, uneven effects across segments, and materialism reinforced by luxury dream items.

---

## Sources

- Bruns et al. 2018, *J. Econ. Psych.* 65:41–59 — https://doi.org/10.1016/j.joep.2018.02.002 ; abstract https://ideas.repec.org/a/eee/joepsy/v65y2018icp41-59.html
- Bursztyn, Fiorin, Gottlieb & Kanz 2019, *JPE* 127(4) — https://doi.org/10.1086/701605
- CAC et al. 2022, 互联网信息服务算法推荐管理规定 — https://www.cac.gov.cn/2022-01/04/c_1642894606364259.htm
- Caflisch, Grubb, Kelly, Nieboer & Osborne 2018, FCA OP36 — https://www.fca.org.uk/publications/occasional-papers/occasional-paper-no-36-sending-out-sms-impact-automatically-enrolling-consumers-overdraft-alerts
- DeVoe & Pfeffer 2007, *OBHDP* 104 — https://doi.org/10.1016/j.obhdp.2006.05.003
- FCA 2015, Occasional Paper 10 — https://www.fca.org.uk/publications/occasional-papers/occasional-paper-no-10-message-received-impact-annual-summaries-text
- Fishbach & Dhar 2005, *JCR* 32(3) — https://doi.org/10.1086/497548
- Frederick, Novemsky, Wang, Dhar & Nowlis 2009, *JCR* 36(4) — https://doi.org/10.1086/599764
- Gargano & Rossi 2024, *J. Finance* 79(3) — https://doi.org/10.1111/jofi.13339
- Gladstone, Jachimowicz, Greenberg & Galinsky 2021, *OBHDP* 167 — https://doi.org/10.1016/j.obhdp.2021.06.002
- Gollwitzer & Sheeran 2006 — https://doi.org/10.1016/S0065-2601(06)38002-1
- Gray et al. 2018, CHI — https://doi.org/10.1145/3173574.3174108
- Grekin et al. 2025, *Personality Science* — https://doi.org/10.1177/27000710251391610
- Hershfield et al. 2011, *JMR* 48(SPL) — https://doi.org/10.1509/jmkr.48.SPL.S23
- Karlan, McConnell, Mullainathan & Zinman 2016, *Mgmt Sci* — https://doi.org/10.1287/mnsc.2015.2296 ; https://www.nber.org/bah/2010no3/do-reminders-increase-saving
- Kivetz, Urminsky & Zheng 2006, *JMR* 43(1) — https://doi.org/10.1509/jmkr.43.1.39
- Levi 2025, *JFQA* (accepted) — https://jfqa.org/wp-content/uploads/2025/10/24988_Personal_Financial_Info.pdf
- Levi & Benartzi 2020, SSRN — https://papers.ssrn.com/author=3573455 ; https://bcfg.wharton.upenn.edu/newsletter-may-2019/
- Loibl & Scharff 2010, *J. Consumer Affairs* 44(1) — https://doi.org/10.1111/j.1745-6606.2010.01160.x
- Maguire, Persson & Tinghög 2023, *JESA* 9 — https://doi.org/10.1007/s40881-023-00134-6
- Mathur et al. 2019, *PACM HCI* 3 — https://doi.org/10.1145/3359183
- Medina 2021, *RFS* 34(5) — https://doi.org/10.1093/rfs/hhaa108
- Mogilner & Aaker 2009, *JCR* 36(2) — https://doi.org/10.1086/597161
- Okada & Hoch 2004, *JCR* 31(2) — https://doi.org/10.1086/422110
- Olafsson & Pagel 2017, NBER w23945 — https://www.nber.org/papers/w23945
- Pan, Etkin & Berger 2024, MSI WP 24-126 — http://thearf-org-unified-admin.s3.amazonaws.com/MSI_Report_24-126.pdf
- Persson & Tinghög 2020, *JEBO* 170 — https://doi.org/10.1016/j.jebo.2019.12.012
- Prelec & Loewenstein 1998, *Marketing Science* 17(1) — https://doi.org/10.1287/mksc.17.1.4
- Prelec & Simester 2001, *Marketing Letters* 12 — https://doi.org/10.1023/A:1008196717017
- Read, Olivola & Hardisty 2017, *Mgmt Sci* 63(12) — https://doi.org/10.1287/mnsc.2016.2547
- Rick, Cryder & Loewenstein 2008, *JCR* 34(6) — https://doi.org/10.1086/523285
- Replication of Thaler 1999, *R. Soc. Open Sci.* 2025 — https://doi.org/10.1098/rsos.250979
- Schultz et al. 2007, *Psych. Science* 18(5) — https://doi.org/10.1111/j.1467-9280.2007.01917.x
- Soman & Cheema 2011, *JMR* 48(SPL) — https://doi.org/10.1509/jmkr.48.SPL.S14
- Spiller 2011, *JCR* 38(4) — https://doi.org/10.1086/660045
- Stango & Zinman 2014, *RFS* 27(4) — https://doi.org/10.1093/rfs/hhu008
- Stockdale & Sanders 2020, *JASP* — https://doi.org/10.1111/jasp.12673
- Sunstein 2014, "The Ethics of Nudging," SSRN — https://doi.org/10.2139/ssrn.2526341
- Thaler 1985, *Marketing Science* 4(3) — https://doi.org/10.1287/mksc.4.3.199
- Thaler 1999, *JBDM* 12(3) — https://doi.org/10.1002/(SICI)1099-0771(199909)12:3%3C183::AID-BDM318%3E3.0.CO;2-F
- Thaler 2018, *Science* 361 — https://doi.org/10.1126/science.aau9241
- Ülkümen & Cheema 2011, *JMR* 48(6) — https://doi.org/10.1509/jmr.09.0516
