# 07 · Official templates and submission rules (International AI Track)

*Read 2026-10-08 from the official files on fintechathon.g-ican.com [T1]–[T9] and the site's JS bundles [B1][B2]. Each .docx/.pptx/.xlsx was parsed from its OOXML (paragraph styles, tables, footers, data validation) in a scratch folder, which was then deleted. Text in "quotes" or code spans is verbatim. Where two official sources disagree, both versions are shown.*

## Key takeaways

1. **No International Track template sets a page, word or slide limit.** The only limits are time limits: the deck covers a talk of "up to 10 minutes" and the demo video runs "no longer than five minutes". There is no rule on file size or file format beyond the template types (DOCX, PPTX, MD, XLSX). The "no more than eight pages" rule belongs to the domestic Data Analytics track only.
2. **There is one naming rule, and it is only a suggestion:** the demo video file should be `Track-TeamName-DemoVideo`. The registration email has a fixed subject: `International Track Registration – Team Name – Team Leader Name`. No subject line is published for the email carrying the work itself. A legacy bundle still shows "[Name of Team + Name of Works]", but that comes from an old Blockchain-track page.
3. **The official sources disagree on what is required.** The site's Process tab says Required: technical document, deck, demo video. It says Optional: source code, security self-assessment, execution evidence. Attachment 2 (Topics & Rules) lists six items, calls the **demo video "optional"** and does not mark the other five as optional. The cheapest safe reading is to **submit all six.**
4. **The deadline is stated two ways.** The site says 24:00 on 20 Oct (UTC+8). Attachment 2 says "October 20, 2026, 23:59 (Beijing Time, UTC+8)", although its own conversion ("16:00 UTC") matches 24:00. **Treat 20 Oct 23:59 Beijing (15:59 UTC) as the hard stop.**
5. **The official deck template is a stale 2025 shell.** It has four slides, 16:9, with Chinese placeholders only (作品名 / 团队名 / 目录 / 演示主标题). The "2025 FinTechathon" branding and the "THANKS 谢谢观看!" slide are baked into the background images. It gives no guidance on content.
6. **Every Word template has a footer:** "If a newer template is published, the newer version prevails." Re-download all templates on about 18 Oct before final export.
7. **The registration form collects more than the site suggests.** It asks for passport/ID number, student ID, an image of the passport bio-page and proof of enrolment for every member. It also asks for gender and age, with 18+ required (minors need guardian consent), and a signed declaration. At least 60% of members must be non-Chinese nationals. **Its dropdowns are attached to the wrong columns** (see §7), so type those cells by hand.
8. **Grand-final attendance is mandatory.** At least one member must attend in Shenzhen on 21–23 Nov. A team absent "without justification forfeits award eligibility."

---

## 0. The package at a glance

| # | Deliverable | Site, Process tab [B1] | Attachment 2 checklist [T6] | Official template | Format |
|---|---|---|---|---|---|
| 1 | Technical documentation | Required | Item 1 (no tag) | `international-technical-document-en.docx` [T1] | DOCX |
| 2 | Presentation deck, talk ≤ 10 min | Required | Item 2 | `presentation-template.pptx` [T7] | PPTX |
| 3 | Demo video, ≤ 5 min | **Required** | Item 3, **"optional"** | `demo-video-guide-en.docx` [T4] (a guide, not a file to submit) | video (no format stated) |
| 4 | Source code + README, GitHub link, deployment, tests | Optional | Item 4 (no tag) | `source-code-readme-template-en.md` [T5] | MD in repo root |
| 5 | Security self-assessment | Optional | Item 5 (no tag) | `international-security-self-assessment-en.docx` [T2] | DOCX |
| 6 | Execution evidence | Optional | Item 6 (no tag) | `international-execution-evidence-en.docx` [T3] | DOCX |
| — | Registration form | Required | "Attachment 3" | `international-registration-form-en.xlsx` [T8] (the modal's Attachment 3). The Process tab instead links the generic `team-information-form.xlsx` [T9] | XLSX |

All templates must be completed in English. The rules state: "English is the official language of the International Track … submitted materials must include an English version." [B1]

---

## 1. Technical Document (required) [T1]

**File:** `international-technical-document-en.docx` · US Letter page (8.5 × 11 in) · **no length limit stated**.

**Title block (verbatim, in order):**
- `2026 FINTECHATHON · SUBMISSION TEMPLATE`
- `International AI Track | Technical Document`
- `Required material for the International AI Track. Please complete this document in English.`

**Header table (2 columns: label | value; value cells are pre-filled with "Please complete"):**

| Field | Value |
|---|---|
| Team name | Please complete |
| Competition track | Please complete |
| Submission date | Please complete |

**Sections.** Headings use Heading 1. Each sub-prompt is a bullet followed by a "Write here" paragraph.

- **01 Project Overview**
  - Problem, target users and selected topic
  - Core value and innovation
- **02 System Architecture**
  - Architecture diagram and component responsibilities
  - Models, tools, data sources and external services
- **03 Agent Design**
  - Intent understanding, planning, tool use and state management
  - Core algorithms and evaluation approach
- **04 Security Design**
  - Tiered permissions and confirmation for sensitive actions
  - Protection against prompt injection, privilege escalation and privacy leakage
- **05 Deployment and Testing**
  - Environment, deployment instructions, test cases and known limitations

**Footer:** "Complete this document according to the competition notice. If a newer template is published, the newer version prevails."

Attachment 2 defines this item as: "Technical documentation (system architecture, core algorithm description, security design)". [T6]

---

## 2. Presentation Deck (required) [T7]

**File:** `presentation-template.pptx` · **16:9** (13.333 × 7.5 in) · 4 slides · no slide-count limit · **talk ≤ 10 minutes**. The domestic brief calls it a "defence deck (no more than 10 minutes)". The English page only gives "Presentation deck, up to 10 minutes".

| Slide | Layout (CN name → meaning) | Placeholder text (verbatim) | Background |
|---|---|---|---|
| 1 | 标题幻灯片 → Title Slide | `作品名` (Project name) · `团队名` (Team name). Speaker notes: `1` | Hero art "2025 FinTechathon 深圳国际金融科技大赛 西丽湖金融科技大学生挑战赛" |
| 2 | 两栏内容 → Two Content (used as agenda) | `目录` / `CONTENTS`, then six slots `01`–`06`, each `目录内容` (agenda item) | Same art family |
| 3 | 标题和内容 → Title and Content | `演示主标题` (Presentation main title) | White body with a branded header strip at top right |
| 4 | 节标题 → Section Header | *(no text; image only)* | "THANKS 谢谢观看!" closing art |

The template contains no content prompts at all. What the deck must cover can only be inferred from the judging criteria and Attachment 2.

---

## 3. Demo Video Guide (required on site; "optional" in Attachment 2) [T4]

**File:** `demo-video-guide-en.docx` · US Letter. It is a guide to read, not something to submit. **Hard limit: ≤ 5 minutes.**

**Title block (verbatim):**
- `2026 FINTECHATHON · SUBMISSION TEMPLATE`
- `Demo Video | Production & Submission Guide`
- `Required for the International AI Track. The video must be no longer than five minutes.`

**Header table (bilingual, unlike the other templates):**

| Field | Value |
|---|---|
| 队伍名称 / Team | 请填写 / Please complete |
| 参赛赛道 / Track | 请填写 / Please complete |
| 提交日期 / Date | 请填写 / Please complete |

**Sections:**
- **01 Recommended Structure**
  - Project and team introduction
  - End-to-end demonstration of the core scenario
  - Safety mechanisms, innovation and results
- **02 Video Quality**
  - Use 16:9 landscape and preferably 1080p
  - Make interface text, narration and English subtitles clearly legible
- **03 Final Check**
  - No copyrighted or sensitive material
  - Suggested filename: Track-TeamName-DemoVideo

**Footer:** same as §1.

Attachment 2 also counts the demo video as part of execution evidence for non-on-chain topics (see §6).

---

## 4. Source Code README (optional on site; Attachment 2 item 4) [T5]

**File:** `source-code-readme-template-en.md`. Instruction: "Copy this file to the repository root and complete every relevant section in English." No length limit.

Verbatim structure:

```
# 2026 FinTechathon | Source Code README Template
> Copy this file to the repository root and complete every relevant section in English.

## 1. Project Overview
- Track:
- Team name:
- Project name:
- One-line summary:

## 2. System Architecture
Describe the main components, models, tools, data sources and their relationships. Include an architecture diagram.

## 3. Environment and Dependencies
- Operating system:
- Runtime versions:
- Main dependencies:
- Environment variables: never commit real secrets or sensitive data.

## 4. Installation and Execution
Provide complete setup, configuration, launch and access instructions for a clean environment.

## 5. Testing
Document test commands, test cases, expected results and known limitations.

## 6. Repository and Deployment
- GitHub / Git repository:
- Live demo (if available):
- Deployment instructions:

## 7. Security Notes
Describe permission tiers, confirmation for sensitive operations, data handling and known risks.
```

Attachment 2 defines this item as: "Source code (with README, GitHub repository link, deployment instructions, and test cases)". A **GitHub link** is therefore expected.

---

## 5. Security Self-assessment (optional on site; Attachment 2 item 5) [T2]

**File:** `international-security-self-assessment-en.docx` · US Letter · no length limit.

**Title block:**
- `2026 FINTECHATHON · SUBMISSION TEMPLATE`
- `International AI Track | Security Self-assessment`
- `Optional supporting material. Please complete this document in English.`

**Header table:** the same three rows as §1 (Team name / Competition track / Submission date → "Please complete").

**Sections:**
- **01 Permission Model**
  - Roles, operations and permission boundaries
  - Confirmation, verification and rollback mechanisms
- **02 Security Tests**
  - Prompt injection, social engineering, privilege escalation and failure recovery tests
- **03 Data and Privacy**
  - Data provenance, consent, minimisation, storage and deletion
- **04 Known Risks**
  - Risk, impact, mitigation and planned improvement

**Footer:** same as §1. Attachment 2 defines this item as: "Security self-assessment report (permission-tier implementation and known-risk list)".

---

## 6. Execution Evidence (optional on site; Attachment 2 item 6) [T3]

**File:** `international-execution-evidence-en.docx` · US Letter · no length limit.

**Title block:**
- `2026 FINTECHATHON · SUBMISSION TEMPLATE`
- `International AI Track | Execution Evidence`
- `Optional supporting material for operation logs or on-chain transaction evidence.`

**Header table:** the same three rows as §1.

**Sections:**
- **01 Evidence Summary**
  - Selected topic and scenario
  - What the evidence demonstrates
- **02 Logs or Transactions**
  - Simulated account/sandbox logs, or transaction hashes for Topic F
  - Timestamp, action, result and relevant screenshot/link
- **03 Reproduction Guide**
  - Steps required for judges to reproduce or verify the evidence

**Footer:** same as §1. Attachment 2 defines this item as: "Execution evidence (for non-on-chain topics: simulated-account/sandbox operation logs and demo video; for the on-chain topic: real on-chain transaction hashes)".

The judging criteria say Task Completion (40%) is "Completion of scripted tasks in a simulated environment for non-on-chain topics". This document is how judges check that score.

---

## 7. Registration Form, "Attachment 3" (required) [T8]

**File:** `international-registration-form-en.xlsx`, with sheets `Instructions` and `Registration Form`.

**Instructions sheet (verbatim, numbered as in the file):**
1. This form must be completed in English, the official language of the International Track.
2. One form per team (2–5 members); all members' information must be completed. Gender and age are collected once for finals accommodation and statistics.
3. Fields marked * are required. Both a passport (or other valid ID) number AND a student ID number must be provided; no scans are required at registration.
4. Enrollment status must be supported by proof of enrollment (student card / enrollment certificate / registration letter); please attach a scan when submitting by email.
5. Submission: email the completed form to the official competition mailbox【fintechathon@ican-x.com】 , subject: **International Track Registration – Team Name – Team Leader Name**. A confirmation reply will be sent within 48 hours.
6. All information must be true, accurate and valid. Each person may join only one team across both tracks; duplicate registrations are invalid.
7. The advisor and proposal summary fields are optional: if your team has an advisor, please give their name and affiliation; the summary (100–200 words) outlines your approach for the preliminary screening.
8. Participants must be 18 or older; minors must attach a consent form signed by a parent or guardian.
9. Image of the passport bio‑page

Item 3 says "no scans are required", yet item 4 asks for an enrolment scan and the member table asks for a passport image. The form contradicts itself. Attach both.

**Registration Form sheet.** Section I, "Team Information":

| Field | Notes |
|---|---|
| Team Name * | |
| Topic (A–F, choose one) * | dropdown A,B,C,D,E,F → **A** |
| Entry Title (provisional) | |
| Advisor (optional) | |
| Proposal Summary (optional, 100–200 words) | |
| Team Email * | |

Section II, "Member Information (2–5 members)". The template note reads "the gray first row is a filled example; overwrite it". Columns, verbatim and in order:

| Role * | Full Name * | Gender * | Age * | Country of Nationality * | Passport / ID Type * | Passport / ID Number * | Student ID * | University * | Major * | Year of Study * | *Please provide an image of the passport bio‑page. | Proof of Enrollment (attachment) * | Email * | Phone / WhatsApp |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

The example row uses `队长 Leader`, `Passport`, `UG Year 3`, `Passport.jpg` and `student_card.pdf`. This suggests the attachments are referenced by filename in the cells and sent with the email.

**Known defect:** the data-validation dropdowns are attached to the wrong columns. The column D (**Age**) dropdown offers `护照 Passport / 其他身份证件 Other ID`. The column H (**Student ID**) dropdown offers `本科 Undergraduate / 硕士研究生 Master / 博士研究生 PhD`. Type these cells by hand, or clear the validation.

Section III, "Declaration & Signature". The declaration text says the info is true, the entry is original, rules and laws are followed, all members are 18+, and the team will cooperate with identity and enrolment verification before results, "failing which the award is forfeited". Below it: `Team Leader's Signature` | `Date`.

The Process tab's own "Registration Form" link [T9] is a simpler bilingual table: No. | Name | Nationality | University | Major | Year | Email | Phone | Role, with rows 1 Leader and 2–5 Member. Its instruction says "国际赛道请使用英文填写" ("International Track: fill in English"). Attachment 3 is a superset of it, so submit Attachment 3.

---

## 8. Submission rules from Attachment 2, "International Track — Topics & Rules" [T6]

- **Deadline:** "Registration and submission share the same deadline: October 20, 2026, 23:59 (Beijing Time, UTC+8) — i.e., 16:00 UTC | 17:00 London (BST) | 09:00 US Pacific (PDT) | 01:00 Tokyo (Oct 21) | 03:00 Sydney (Oct 21). A bilingual email reminder will be sent 24 hours before the deadline." The site says "by 24:00 on 20 October (UTC+8)" [B1].
- **Updates:** "Submissions may be updated any time before the deadline; the latest version received prevails. No changes are accepted after the deadline."
- **Channel:** the site says "Register by official email, select one of six topics and submit the required English materials" [B1]. The mailbox is **fintechathon@ican-x.com** (site and Attachment 3). Attachment 2's contact line instead gives info@ican-x.com. No upload portal, file-size cap or link-vs-attachment rule is published.
- **Topic A wording:** "Topic A | Personal Finance Assistant: An intelligent assistant for individual users, capable of smart budgeting, bill analysis, and spending insights, delivering actionable recommendations based on the user's income and expenses." The site card says "AI Personal Finance Assistant — Conversational bookkeeping, budgeting and bill management".
- **Scoring:** Task completion 40% · Security & compliance 30% · Innovation & interaction 30% · bonus 0–5. The site adds that "serious security failures trigger substantial deductions". It frames the bonus as rewarding "advanced topics or demonstrated real-world deployment" and says "Topic choice itself does not affect the base score". Attachment 2 frames the same bonus as "on-chain exploration". Under the site's wording, a live deployment could plausibly argue for the bonus on Topic A.
- **Timeline:** compliance screening 21 Oct → online review 22–23 Oct → finalists and invitations by 31 Oct → check-in and WeBank HQ visit 20 Nov → Grand Final 21–23 Nov in Shenzhen. The site places the International defence on 22 Nov. "At least one member of each finalist team must attend in person".
- **Appeals:** "within three business days after results are announced" [B1].
- **Precedence:** "in case of discrepancy, the Chinese version prevails" [B1].

## 9. Limits, formats, naming: what exists and what does not

| Rule type | What is published | Source |
|---|---|---|
| Page/word limits | **None** for any International deliverable. Only the optional proposal summary on the registration form has a range: 100–200 words | T1–T5, T8 |
| Time limits | Deck talk ≤ 10 min. Demo video ≤ 5 min | B1, T4, T6 |
| Video specs | 16:9 landscape, preferably 1080p, legible UI text, narration, **English subtitles**, no copyrighted or sensitive material | T4 |
| File formats | Implied by the templates: DOCX (technical doc, security, evidence), PPTX (deck), MD (README), XLSX (registration). No PDF requirement and no video container named | B1 |
| File naming | Video only: "Suggested filename: Track-TeamName-DemoVideo" | T4 |
| Email subject | Registration only: "International Track Registration – Team Name – Team Leader Name" | T8 |
| Page size | Word templates are US Letter. Attachment 2 is A4. Neither is mandated | T1–T4, T6 |
| Language | English. Materials "must include an English version" | B1, T6 |

---

## 10. How FundBun should structure each deliverable

**Common rules.** Use the official templates unchanged, keeping the title block, header table, numbered Heading 1 sections and footer. Replace each "Write here" with content and keep every bullet prompt as a bold lead-in so judges can tick them off. Fill the header table as follows:
- **Team name:** `<team>`
- **Competition track:** `International AI Track — Topic A: Personal Finance Assistant`
- **Submission date:** `2026-10-20`

Name every file on the video pattern, for example `InternationalAI-<TeamName>-TechnicalDocument.docx`, `…-Deck.pptx`, `…-DemoVideo.mp4`, `…-SecuritySelfAssessment.docx`, `…-ExecutionEvidence.docx` and `…-RegistrationForm.xlsx`. Also attach a PDF export of each DOCX/PPTX so fonts and layout survive. Send everything in one email. The subject line is our convention, since none is published: `International Track Submission – <Team Name> – FundBun`. Target 19 Oct so the deadline ambiguity cannot bite. Re-download the templates about 18 Oct in case newer versions are posted.

**Technical Document** (no limit; aim for 8–12 pages so it gets read):
- **01 Project Overview**
  - Topic A problem, the two personas (Mei over budget, Arif under budget) and why behaviour-first budgeting matters.
  - Core value and innovation: Dream Mirror, tripwires, consent-first nudges, and the evidence (doc 02).
- **02 System Architecture**
  - One diagram of `src/core` (finance, sandbox, security, agent), `src/ui` and the `server/` LLM gateway, with a table of each component's job.
  - Models and tools: the on-device Bun Engine (TF-IDF NLU, rule planner), an optional LLM through the gateway, the tool specs, a deterministic synthetic sandbox bank, and no real bank data.
- **03 Agent Design**
  - Intent → TaskPlan DAG → tool calls → DialogueState, covering interrupt, rollback, human takeover, and clarification and correction.
  - Algorithms (recurring detection, anomalies, affordability, tripwires) and the evaluation suite with its metrics: task success rate, turns per task, attack block rate, false-refusal rate, grounding violations.
- **04 Security Design**
  - Tier table showing what each tier may do and `allow | confirm | step_up | deny`, plus PIN step-up and caps.
  - Injection scan and taint, the rule that the LLM never decides permissions, redaction and minimisation, and the hash-chained audit log.
- **05 Deployment and Testing**
  - Clean-machine commands, environment variables (no secrets), the A/B/C/D test scenarios as a table, and honest limitations.

**Presentation Deck** (≤ 10 min, so about 12–15 slides). Keep the official cover, agenda, body and Thanks layouts and replace the Chinese placeholders with English. Use the template's six agenda slots:
1. Problem and Topic A
2. Dream Mirror demo moment
3. Agent architecture and planning
4. Security model (permission tiers, attack results)
5. Evidence and metrics from the scripted suite
6. Team, roadmap and WeBank fit

Put one number per claim. Keep the scoring weights (40/30/30) visible as the spine of the talk.

**Demo Video** (≤ 5:00, 16:9 1080p, burned-in English subtitles, filename `InternationalAI-<TeamName>-DemoVideo.mp4`). Follow the guide's three beats:
- **Intro (about 0:30):** project and team.
- **Core scenario end to end (about 2:30):** Mei's over-budget Home, then "help me get back on track", the DAG plan, approve or deny, and the audit entry.
- **Safety, innovation and results (about 1:30):** a live injection attempt blocked, a PIN step-up, Arif stashing his surplus, and the metric card.

Use no copyrighted music or brand logos beyond the fictional sandbox. The video also counts as execution evidence, so show sandbox timestamps on screen.

**Source Code README.** Copy the seven official sections into the repo-root `README.md` in order, and keep the numbered headings exactly. In §6 give the public GitHub link plus a live demo URL, because a deployment may count toward the 0–5 bonus. §7 Security Notes should mirror the security self-assessment in summary form. Never commit `.env` files or keys.

**Security Self-assessment:**
- **01 Permission Model.** A table: Role (user, agent, gateway, sandbox bank) × Operation × Tier × Decision. Then confirmation (copilot tap), verification (PIN step-up; loosening needs the PIN, tightening never does) and rollback (pending-action cancel, undo, audit).
- **02 Security Tests.** One results table covering the four named attack classes (prompt injection, social engineering, privilege escalation, failure recovery), plus the doc-04 induced-transfer and data-extraction cases. Columns: Test ID | Attack | Input | Expected | Observed | Pass. Pull it from `npm run evidence`.
- **03 Data and Privacy.** Provenance (synthetic seeded sandbox), separate PIPL consents, minimisation and redaction before the LLM, local-first storage, and deletion and export rights.
- **04 Known Risks.** Use exactly the prompt's four columns: Risk | Impact | Mitigation | Planned improvement.

**Execution Evidence:**
- **01 Evidence Summary:** Topic A, the Mei and Arif scenarios, and what the logs prove for the 40% task-completion and 30% security scores.
- **02 Logs or Transactions:** a table of Timestamp | Action | Result | Screenshot/link, generated from `evidence/` with one row per tool call or policy decision. Link the full JSON logs and the demo video.
- **03 Reproduction Guide:** seed, sandbox date and persona switch as given in `docs/SCENARIOS.md`, then `npm ci` → `npm test` → `npm run evidence`, with expected pass counts. Judges should be able to verify in under 10 minutes.

**Registration Form (Attachment 3).** Use the international XLSX, not the generic one. Topic = A. Entry Title = FundBun. Add a 100–200-word proposal summary even though it is optional, because it feeds "preliminary screening". Type the Age and Student ID cells by hand because the dropdowns are misaligned. Attach each member's passport bio-page image and proof of enrolment. Have the leader sign. Subject: `International Track Registration – <Team Name> – <Team Leader Name>`. Before sending, confirm the team is at least 60% non-Chinese nationals and every member is 18+.

---

## Sources

- [T1] https://fintechathon.g-ican.com/templates/international-technical-document-en.docx
- [T2] https://fintechathon.g-ican.com/templates/international-security-self-assessment-en.docx
- [T3] https://fintechathon.g-ican.com/templates/international-execution-evidence-en.docx
- [T4] https://fintechathon.g-ican.com/templates/demo-video-guide-en.docx
- [T5] https://fintechathon.g-ican.com/templates/source-code-readme-template-en.md
- [T6] https://fintechathon.g-ican.com/templates/international-topics-rules-en.docx (Attachment 2, linked from the International registration modal; authored 2026-08-24)
- [T7] https://fintechathon.g-ican.com/templates/presentation-template.pptx
- [T8] https://fintechathon.g-ican.com/templates/international-registration-form-en.xlsx (Attachment 3)
- [T9] https://fintechathon.g-ican.com/templates/team-information-form.xlsx
- [B1] https://fintechathon.g-ican.com/js/chunk-4516c2dd.7f79eeba.js (Rules page: registration rules, process, judging criteria, statement)
- [B2] https://fintechathon.g-ican.com/js/app.83e69cd7.js, https://fintechathon.g-ican.com/js/chunk-29f967ea.5bd7744c.js and https://fintechathon.g-ican.com/js/chunk-55a31b26.d8e3ee35.js (home page topic cards, schedule, International registration modal and attachment links). `lang-en-US-rule.5d04a38a.js` is a legacy pre-2026 rules bundle (AI/Blockchain tracks, "[Name of Team + Name of Works]" email rule) and is **not** current.
