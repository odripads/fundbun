# 04 · Regulation & Security Frameworks for FundBun

*As of 2026-10-08. Design research, not legal advice. **(secondary)** = could not reach the primary text.*

## Key takeaways for FundBun

1. **Transactions are "sensitive PI" in China.** PIPL Art. 28 lists "financial accounts" as sensitive. Art. 29 requires separate consent, Art. 30 a necessity notice and Art. 55 an impact assessment [1]. In PBOC standards, transactions and balances are C2 (level 3) and PINs/passwords are C3 (level 4) [6][7]. → Add a dedicated bank-data consent step and never store C3.
2. **Every LLM call hands data to a third party.** JR/T 0171 says data given to third parties must be de-identified, and "encryption alone" does not count [6]. PIPL Art. 21 and 38 and GenAI Measures Art. 11 also apply [1][2]. → Redact PII on the device and keep the ledger local-first.
3. **Too much agent power is the main attack surface.** OWASP LLM06 requires "complete mediation" (code checks every action). OWASP's agentic playbook requires "explicit user approval for AI tool executions involving financial … functions" [12][13]. → Tiers and caps live in deterministic code. The LLM can only propose.
4. **Copy proven payment-authorization patterns.** AP2 uses constrained *open* mandates that close onto one transaction [15]. PSD2 ties authentication to the exact amount and payee ("dynamic linking") [19]. → Build a "Spending Mandate" plus a PIN step-up that signs amount and destination.
5. **Make Dream Mirror explainable and never push spending.** PIPL Art. 24 and Algorithm Provisions Art. 16–17 require explanations and a non-personalised option. Art. 8 bans models inducing "过度消费" (excessive consumption) [1][4]. Labeling rules, NFRA's 2026 guidance and EU AI Act Art. 50 require AI disclosure [5][9][22]. → Add "Why this nudge?", an AI badge, and frame under-budget wins as goal progress.

## 1. China

### 1.1 PIPL [1]

| Art. | Requirement | FundBun impact |
|---|---|---|
| 6 | "Smallest scope" collection | Ingest only date, amount, category and pot. Drop counterparty names and memos |
| 21, 23 | Contract and supervision for entrusted processing. Separate consent for sharing | Treat the LLM vendor as entrusted. Send redacted payloads only |
| 24 | Transparent automated decisions. Push messages must offer a non-personalised option. Users can get explanations and refuse major-impact decisions | Explanation panel and an un-personalise toggle |
| 28–30 | Financial accounts are sensitive → separate consent plus a notice of necessity | Separate consent screen for bank data |
| 31 | Under-14s need guardian consent | Age 18+ for money actions |
| 38–40 | Cross-border transfers need an assessment, standard contract or certification. Large volumes must stay in China | Local or in-country inference |
| 51, 55–57 | Encryption and de-identification. Impact assessment, records kept ≥3 years. Breach notice | Ship a PIPIA in the self-assessment |
| 66 | Fines up to ¥50M or 5% of revenue | — |

Since March 2024, transfers of non-sensitive PI covering <100,000 people a year are exempt. Any sensitive PI still needs a standard contract or certification [3] **(secondary)**.

### 1.2 AI rules

- **GenAI Interim Measures** (in force 2023-08-15) [2] cover services offered to the PRC public (Art. 2). Internal R&D is exempt, so the hackathon sandbox is likely outside scope. If FundBun launches publicly:
  - Art. 10: state the intended users and uses; guard minors against over-reliance
  - Art. 11: no unnecessary PI; no unlawful retention of identifying inputs
  - Art. 12: label generated content
  - Art. 14: halt generation when illegal content appears
  - Art. 15: provide a complaint channel
  - Art. 17: filing applies only to services with "public-opinion attributes"
- **Algorithm Recommendation Provisions** (in force 2022-03-01) [4] cover personalised push, which includes Dream Mirror.
  - Art. 8: no models that induce excessive consumption
  - Art. 16: disclose the algorithm's principles
  - Art. 17: offer a non-personalised option or an easy off switch, allow user-tag deletion, explain major-impact decisions
  - Art. 21: no differential treatment based on transaction habits
- **AI content labeling measures** (in force 2025-09-01) [5]: visible labels, including in interactive interfaces, plus metadata labels. Tampering with labels is banned.

### 1.3 Financial-sector standards

These bind financial institutions. FundBun can align voluntarily, which should persuade a WeBank-hosted jury.

- **JR/T 0171-2020** (PBOC) [6]:
  - C3 = authentication data (PINs, payment passwords, CVN, authentication biometrics)
  - C2 = account numbers, phone number, balances, loans, transaction records
  - Client apps must not store payment-sensitive data. C3 is stored encrypted, never shown in plaintext, and never given to third parties.
  - Data given to third parties must be de-identified ("不应仅使用加密技术": encryption alone is not enough)
- **JR/T 0197-2020** [7]: five security levels (C3→4, C2→3, C1→2), with need-to-know access.
- **JR/T 0221-2021** [8]: evaluates financial AI algorithms on security (§6.4 traceability), explainability, accuracy and performance. It separates money-moving (资金类) from other scenarios.
- **NFRA AI guidance** (2026-06-18, 32 items) [9]:
  - Risk grading, with an admission gate for high-risk uses
  - "人工监督和干预机制": human oversight and intervention at key points of high-risk uses
  - Transparency and explainability
  - Outsourcing risk
  - No names, ID, phone or bank-card numbers in generative-model training [9b] **(secondary)**

## 2. GDPR and EU AI Act [20][22]

- Art. 3(2): applies if FundBun is offered to people in the EU.
- Art. 9: financial data is *not* a special category, unlike under the PIPL. A DPIA under Art. 35 is still advisable.
- Other relevant articles: Art. 5(1)(c) minimisation; Art. 22 no solely-automated decisions; Art. 25 data protection by design; Art. 32 pseudonymisation and encryption; Art. 44 transfer rules.
- Art. 83(5): fines up to €20M or 4% of turnover.
- **EU AI Act**: Art. 50(1) AI-interaction disclosure applies from 2 Aug 2026. Annex III 5(b) makes credit scoring high-risk, so FundBun should never score creditworthiness.

## 3. AI security frameworks

- **OWASP LLM Top 10 (2025)** [10][11][12]:
  - LLM01 Prompt Injection, including *indirect* injection through merchant names and memos. Fix: segregate untrusted content, enforce least privilege, require human approval.
  - LLM02 Sensitive Information Disclosure. Fix: scrub and mask data.
  - LLM06 Excessive Agency (too much functionality, permission or autonomy). Fix: minimal tools, complete mediation, user approval, logs and rate limits.
- **OWASP Agentic Threats & Mitigations** (v1.1, Dec 2025) [13]. Relevant threats:
  - T1 Memory Poisoning
  - T2 Tool Misuse
  - T3 Privilege Compromise
  - T8 Repudiation & Untraceability
  - T10 Overwhelming Human-in-the-Loop (HITL)

  Playbook 3 calls for sandboxes, just-in-time access, risk-scored limits, user approval for financial tools and auto-suspension. Playbook 5 calls for "immutable audit trails" and caps on approval prompts to prevent decision fatigue.
- **OWASP Agentic Top 10 (2026)** [14]: ASI01 Goal Hijack, ASI02 Tool Misuse, ASI03 Privilege Abuse, ASI06 Memory Poisoning, ASI09 Trust Exploitation. ASI09 notes "polished explanations misled human operators into approving harmful actions". → Confirmation screens must render from structured data, not LLM prose.
- **NIST AI RMF 1.0** [16]: MANAGE 2.4 "deactivate" (a kill switch), MEASURE 2.9 explanation, MEASURE 2.10 privacy. **NIST AI 600-1** [17] adds Confabulation and Human-AI Configuration risks.

## 4. Agent-payment authorization

- **AP2** [15][18]:
  - v0.1 (Sep 2025) chained Intent → Cart → Payment mandates into a "non-repudiable audit trail".
  - v0.2 (2026-04-28) added Human-Not-Present payments and moved to the FIDO Alliance, with Mastercard co-developing "Verifiable Intent".
  - Open mandates carry constraints on items, merchants, amounts and expiry. Closed mandates bind to one transaction through proof-of-possession, signed on a "Trusted Surface".
- **Visa Intelligent Commerce** [21a]: tokenised credentials; users "set spending limits and conditions". **Trusted Agent Protocol** [21b]: signed agent intent.
- **Mastercard Agent Pay** [21c]: agents "registered and verified"; users keep "complete control over what the agent is allowed to purchase".
- **PSD2** [19]:
  - Art. 97: SCA for payment initiation and risky remote actions.
  - Dynamic linking to amount and payee (Art. 97(2), RTS Art. 5). Two independent factors (RTS Art. 4).
  - Exemptions: recurring payments (Art. 14); low-value payments of €30, capped at €100 or 5 in a row (Art. 16).
  - PSD3/PSR adds spending limits [23] **(secondary)**.

## 5. Control checklist → clause mapping

| # | Control | Satisfies |
|---|---|---|
| 1 | **Permission tiers.** T0 read/insights; T1 reversible pot moves and budgets; T2 scheduled bills; T3 cancellations and external payees | OWASP LLM06; NFRA risk grading; JR/T 0221 money scenarios; JR/T 0197 |
| 2 | **Spending mandates.** Per-action, daily and monthly caps; payee/pot allow-list; expiry. Each action is checked as a closed mandate | AP2 open→closed constraints; Visa limits; Mastercard control |
| 3 | **Confirm + PIN step-up** for T2/T3 or over-cap actions. The PIN signs the exact amount and payee shown | PSD2 Art. 97(2), RTS Art. 4–5; OWASP LLM01/06, Playbook 3, ASI09; NFRA intervention |
| 4 | **Policy engine outside the LLM.** The LLM emits JSON proposals; code validates them. No credentials in the model | LLM06 complete mediation; ASI02/03 |
| 5 | **Kill switch** that freezes actions and revokes mandates; auto-suspends on anomalies | NIST MANAGE 2.4; OWASP Playbook 3; NFRA intervention |
| 6 | **Hash-chained, signed audit log** of proposal, policy decision, approver and result | OWASP T8 / Playbook 5; AP2 audit trail; PIPL Art. 55–56; JR/T 0221 §6.4 |
| 7 | **PII redaction** before LLM calls (tokenise names, account and phone numbers) | JR/T 0171 de-identification; PIPL Art. 21, 51; LLM02; GDPR Art. 32 |
| 8 | **Minimisation.** No C3 stored; memos dropped | PIPL Art. 6; GDPR Art. 5(1)(c); JR/T 0171; GenAI Art. 11 |
| 9 | **Local-first encrypted ledger.** No training on user data | PIPL Art. 38–40; GDPR Art. 25, 44; NFRA training ban |
| 10 | **Separate, withdrawable consents** for bank data, personalisation and agent actions | PIPL Art. 14, 29–30; GDPR Art. 6 |
| 11 | **"Why this nudge?"** panel; non-personalised mode; tag deletion | PIPL Art. 24; Algorithm Art. 16–17; NIST MEASURE 2.9; JR/T 0221 §7 |
| 12 | **Goal-progress framing** with no merchant links | Algorithm Art. 8 |
| 13 | **AI badge and metadata labels** | Labeling Measures Art. 3–5; GenAI Art. 12; EU AI Act Art. 50 |
| 14 | **"Not financial advice"** notice; no credit scoring; age 18+ | GenAI Art. 10; NIST 600-1; AI Act Annex III; PIPL Art. 31 |
| 15 | **Treat ingested text as untrusted** and validate memory writes | LLM01; T1/ASI06 |

## 6. Not verified

- The rule requiring a PBOC payment licence to move funds. FundBun should stay a sandbox or use a licensed partner bank.
- The full NFRA guidance text.
- Final adoption of PSD3/PSR.
- The CAC filing status of any specific LLM.

## Sources

1. PIPL (DigiChina): https://digichina.stanford.edu/work/translation-personal-information-protection-law-of-the-peoples-republic-of-china-effective-nov-1-2021/
2. GenAI Interim Measures (CAC): https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm
3. Cross-border provisions (WilmerHale, secondary): https://www.wilmerhale.com/insights/client-alerts/20240326-china-finalizes-rules-to-ease-data-export-compliance-burden
4. Algorithm Recommendation Provisions (CAC): https://www.cac.gov.cn/2022-01/04/c_1642894606364259.htm
5. AI labeling measures (CAC): https://www.cac.gov.cn/2025-03/14/c_1743654685899683.htm
6. JR/T 0171-2020: https://aibank.com/upload/attachs/2022/12/5-个人金融信息保护技术规范.pdf
7. JR/T 0197-2020: https://www.aibank.com/upload/attachs/2022/12/8-金融数据安全%20数据安全分级指南.pdf
8. JR/T 0221-2021: https://aibank.com/upload/attachs/2022/12/12-人工智能算法金融应用评价规范.pdf
9. NFRA AI guidance (Xinhua): https://www.xinhuanet.com/20260618/048469df8b834b36a4e9fe5e4249bacb/c.html
   - 9b. The Paper: https://www.thepaper.cn/newsDetail_forward_33409946
10. OWASP LLM01: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
11. OWASP LLM02: https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/
12. OWASP LLM06: https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
13. OWASP Agentic Threats & Mitigations: https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/
14. OWASP Agentic Top 10: https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/
15. AP2 spec: https://ap2-protocol.org/ap2/agent_authorization/
16. NIST AI RMF: https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf
17. NIST AI 600-1: https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf
18. AP2 announcements: https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol ; https://blog.google/products-and-platforms/platforms/google-pay/agent-payments-protocol-fido-alliance/
19. PSD2: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32015L2366 ; RTS: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32018R0389
20. GDPR: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679
21. Card-network agent programmes:
    - 21a. Visa Intelligent Commerce: https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.21361.html
    - 21b. Visa Trusted Agent Protocol: https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.21716.html
    - 21c. Mastercard Agent Pay: https://newsroom.mastercard.com/news/press/2025/april/mastercard-unveils-agent-pay-pioneering-agentic-payments-technology-to-power-commerce-in-the-age-of-ai
22. EU AI Act: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689
23. PSD3/PSR deal (Taylor Wessing, secondary): https://www.taylorwessing.com/en/insights-and-events/insights/2025/11/eu-lawmakers-strike-a-deal-on-payments-reforms
