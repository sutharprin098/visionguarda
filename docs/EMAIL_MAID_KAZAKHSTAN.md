# Email — Ministry of AI and Digital Development, Kazakhstan

> **DRAFT — not sent.** Fill every `[bracket]` before dispatch.
> The formal letter (`LETTER_MAID_KAZAKHSTAN.md`) is the attachment; this is the
> covering email. Ministries generally act on the attached letter, not the email
> body, so this is kept short and points at the letter.

---

## Recipient

**To:** [official address — see note below]
**Cc:** [if you have a named officer, put them here]

> **Find the right address before sending.** A cold mail to a generic inbox is
> usually filed and forgotten. Check the Ministry's official site (gov.kz) for
> the department handling digital-infrastructure or AI procurement, and if
> possible address a named official. Kazakhstan also runs an e-government
> portal for formal appeals from foreign parties — that route is often more
> reliable than email and produces a tracked reference number.

## Subject

```
Offer of full IP and source-code transfer — CamAI, an on-premise AI video analytics platform for traffic enforcement and public safety
```

## Body

---

Dear Sir / Madam,

I am writing to offer the Ministry the outright transfer of intellectual property and complete source code of **CamAI Enterprise**, an AI video analytics platform I have developed and brought to a working, deployed state.

CamAI turns existing CCTV cameras into an automated enforcement and situational-awareness system. It performs all AI processing **on the operator's own hardware** — video is never sent to any external or foreign cloud service, so all data remains physically within the country of deployment.

The following are implemented and validated against real video, not simulated data:

- Automatic Number Plate Recognition (ANPR)
- Helmet / no-helmet detection on two-wheeler riders
- Vehicle speed estimation from calibrated camera geometry
- Person and vehicle detection with persistent tracking
- Face detection (detection only — the system performs no biometric identity matching)

Together these cover a complete road-safety enforcement workflow, producing a structured evidence record for each violation.

I am proposing an **outright sale**, not a licence or subscription: full source code, trained models, database schemas, documentation and test suite would pass permanently to the Ministry, with no royalty, retained rights or continuing dependency on me. The platform is built exclusively on permissively licensed components (Apache-2.0 and MIT), so it is free of copyleft obligations that would restrict state ownership or onward use. A complete third-party licence inventory is available for independent legal review.

I have attached a formal letter setting this out in full.

I would welcome the opportunity to give a technical demonstration at the Ministry's convenience, online or on-site, and I am willing to submit the system for independent technical and legal due diligence before any commercial discussion. I have not stated a price, as it seems more appropriate to establish technical suitability first.

I would be grateful for your guidance on the correct procedure for submitting a proposal of this nature.

With respect,

**[Your Full Name]**
[Founder / Independent Developer]
[Company / Trading Name]
[your email] · [+91 …]
[camai.princesite.in]

---

**Attachment:** CamAI — Formal Proposal for IP and Source Code Transfer (PDF)

---

## Before you send — checklist

- [ ] Fill every `[bracket]`, in both this email and the letter.
- [ ] Export `LETTER_MAID_KAZAKHSTAN.md` to PDF and attach it.
- [ ] **Delete the "Verification notes" section from the letter** — it is internal.
- [ ] Consider a Russian translation of the letter. Kazakh and Russian are both
      official; an English-only approach to a ministry is workable but a Russian
      version materially improves the odds of it being read by the right person.
- [ ] Send yourself a test copy first and check the PDF renders.
- [ ] Do not attach source code or the due-diligence audit at first contact.

## Deliberately not included

- **No price.** Naming a figure in a cold approach to a ministry sets an anchor
  before they have assessed the system, and invites a procurement-process
  objection rather than a technical conversation.
- **No performance benchmarks.** The figures in
  `docs/12_PERFORMANCE_BENCHMARKS.md` (RTX 4090, 60 FPS, 8.2 ms) could not be
  confirmed as measured on that hardware. Quote throughput only for
  configurations you have personally run, and be ready to reproduce them.
- **No claim of face recognition, fire, smoke or PPE detection.** The first is
  not implemented; the others were removed. A government technical reviewer
  will test what you claim.
